import { ref, nextTick } from 'vue';
import { getAudioEngine } from './audioEngineManager';
import { patterns, getNextPatternNum } from './patternsListManager';
import { globalVolume, projectName, bpm } from './settingsManager';
import { snapDivision } from '../util/snap';
import { playbackMode, setPlaybackMode } from './playbackModeManager';
import { patternsListWidth, headerHeight } from './layoutManager';
import { windows, arrangementVisible, channelRackVisible, mixerVisible, positionWindow } from './windowManager';
import { arrangement } from '../audio/Arrangement';
import { keyboard } from '../audio/Keyboard';
import { PianoRoll } from '../audio/PianoRoll';
import type { NoteBlock } from '../audio/PianoRoll';
import type { ArrangementClip, ArrangementTrack } from '../audio/Arrangement';
import type { MixerTrack } from '../audio/MixerManager';
import type { Channel } from '../audio/ChannelManager';
import type { AutomationCurve } from '../audio/Automation';
import type { Pattern } from './patternsListManager';
import type { Window } from './windowManager';
import { DEFAULT_GLOBAL_VOLUME } from '../constants/defaults';
import { PATTERNS_LIST_WIDTH, HEADER_HEIGHT } from '../constants/layout';

// big boi
let _db: IDBDatabase | null = null;

let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
let isLoading = false;

let savingLock = false
const saving = ref(false); // fuh headerbuh
export function isSaving() { return saving.value };

const SAVE_FILE_VERSION = '1.0.0';
const DB_NAME = 'webdaw';
const DB_VERSION = 1;
const AUTOSAVE_STORE = 'autosave';
const PROJECTS_STORE = 'projects';
const TEMPSAVE_KEY = 'tempsave';

const AUTOSAVE_DEBOUNCE_MS = 1500;
const SCHEDULE_SAVE_INTERVAL_MS = 45000;
const LAST_PROJECT_KEY = 'webdaw_lastProjectId';

export const currentProjectId = ref<number | null>(null);

// converting data to saveable types
type SavedMixer = Omit<MixerTrack, 'peakDbL' | 'peakDbR'>;
type SavedChannel = Omit<Channel, 'instrument'> & { synthId: string; synthNum: number; synthState?: Record<string, unknown> };
type SavedNote = Omit<NoteBlock, 'automation'> & { automation: AutomationCurve[] };
type SavedPattern = Omit<Pattern, 'roll'> & { notes: SavedNote[] };

interface SavedArrangement {
    clips: ArrangementClip[];
    tracks: ArrangementTrack[];
}

interface SavedUI {
    patternsListWidth: number;
    headerHeight: number;
    windowVisibility: {
        arrangementVisible: boolean;
        channelRackVisible: boolean;
        mixerVisible: boolean;
    };
    windows: Window[];
}

interface SavedIdCounters {
    nextChannelId: number;
    nextClipId: number;
    nextPatternNum: number;
    nextMixerNum: number;
}

interface SaveFile {
    id?: number;
    version: string;

    metadata: {
        projectName: string;
        created: number;
        lastModified: number;
    };

    global: {
        bpm: number;
        globalVolume: number;
        snapDivision: number;
        playbackMode: 'pattern' | 'arrangement';
    };

    playback: {
        pauseTime: number;
        loopEnabled: boolean;
        loopStart: number;
        loopEnd: number;
    };

    patterns: SavedPattern[];
    channels: SavedChannel[];
    mixers: SavedMixer[];
    arrangement: SavedArrangement;
    ui: SavedUI;
    idCounters: SavedIdCounters;
}

export interface ProjectSummary {
    id: number;
    name: string;
    lastModified: number;
}

// db management

function openDb(): Promise<IDBDatabase> {
    if(_db) return Promise.resolve(_db);

    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);

        req.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;

            if(!db.objectStoreNames.contains(PROJECTS_STORE)) {
                const store = db.createObjectStore(PROJECTS_STORE, { keyPath: 'id', autoIncrement: true });
                store.createIndex('lastModified', 'lastModified', { unique: false });
            }

            if(!db.objectStoreNames.contains(AUTOSAVE_STORE)) {
                db.createObjectStore(AUTOSAVE_STORE, { keyPath: 'id' });
            }
        };

        req.onsuccess = (event) => {
            _db = (event.target as IDBOpenDBRequest).result;
            resolve(_db);
        };

        req.onerror = () => reject(req.error);
    });
}

async function idbPut(storeName: string, value: unknown): Promise<IDBValidKey> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const req = tx.objectStore(storeName).put(value);
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error);
    });
}

async function idbGet<T>(storeName: string, key: IDBValidKey): Promise<T | null> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).get(key);
        req.onsuccess = () => resolve((req.result as T) ?? null);
        req.onerror = () => reject(req.error);
    });
}

async function idbGetAll<T>(storeName: string): Promise<T[]> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).getAll();
        req.onsuccess = () => resolve(req.result as T[]);
        req.onerror = () => reject(req.error);
    });
}

async function idbDelete(storeName: string, key: IDBValidKey): Promise<void> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

// serialization / deserialization

function serializeNote(note: NoteBlock): SavedNote {
    return {
        id: note.id,
        row: note.row,
        col: note.col,
        length: note.length,
        velocity: note.velocity,
        channelId: note.channelId,
        midi: note.midi,
        automation: [...note.automation.values()].map(curve => ({
            parameterId: curve.parameterId,
            nodes: curve.nodes.map(node => ({
                id: node.id,
                beat: node.beat,
                value: node.value,
                curveTension: node.curveTension,
            })),
        })),
    };
}

export function serializeState(): SaveFile {
    const engine = getAudioEngine();
    const { scheduler, channelManager, mixerManager, channelSynths } = engine;

    const savedPatterns: SavedPattern[] = patterns.value.map(p => ({
        id: p.id,
        num: p.num,
        name: p.name,
        visible: p.visible,
        notes: p.roll.getNoteData.map(serializeNote),
        selectedChannelId: p.selectedChannelId
    }));

    const savedChannels = channelManager.getAllChannels().map(ch => ({
        id: ch.id,
        name: ch.name,
        synthId: channelSynths.get(ch.id)?.synthId ?? 'minisynth',
        synthNum: channelSynths.get(ch.id)?.num ?? 1,
        synthState: engine.serializeChannelState(ch.id),
        mixerTrack: ch.mixerTrack,
        volume: ch.volume,
        pan: ch.pan,
        muted: ch.muted,
        solo: ch.solo,
    }));

    savedChannels.forEach(channel => {
        console.log(channel.synthState);
    });

    const savedMixers = mixerManager.getAllMixers().map(({ peakDbL: _l, peakDbR: _r, ...m }) => m);

    const now = Date.now();

    return {
        version: SAVE_FILE_VERSION,
        metadata: { projectName: projectName.value, created: now, lastModified: now },
        global: {
            bpm: scheduler.bpm,
            globalVolume: globalVolume.value,
            snapDivision: snapDivision.value,
            playbackMode: playbackMode.value,
        },
        playback: {
            pauseTime: scheduler.pauseTime,
            loopEnabled: scheduler.loopEnabled,
            loopStart: scheduler.loopStart,
            loopEnd: scheduler.loopEnd,
        },
        patterns: savedPatterns,
        channels: savedChannels,
        mixers: savedMixers,
        arrangement: {
            clips: arrangement.clips.map(clip => ({ ...clip })),
            tracks: arrangement.getAllTracks().map(track => ({ ...track })),
        },
        ui: {
            patternsListWidth: patternsListWidth.value,
            headerHeight: headerHeight.value,
            windowVisibility: {
                arrangementVisible: arrangementVisible.value,
                channelRackVisible: channelRackVisible.value,
                mixerVisible: mixerVisible.value,
            },
            windows: windows.map(window => ({ ...window })),
        },
        idCounters: {
            nextChannelId: channelManager.nextChannelIdCounter,
            nextClipId: arrangement.nextClipIdCounter,
            nextPatternNum: getNextPatternNum(),
            nextMixerNum: savedMixers.filter(mixer => mixer.id !== 'master').length + 1,
        },
    };
}

export async function deserializeState(save: SaveFile): Promise<void> {
    isLoading = true;
    try {
        const engine = getAudioEngine();
        const { scheduler, channelManager, mixerManager } = engine;

        arrangement.setNextClipId(save.idCounters.nextClipId);

        projectName.value = save.metadata.projectName;
        engine.setBpm(save.global.bpm);
        bpm.value = save.global.bpm;
        globalVolume.value = save.global.globalVolume;
        engine.setGlobalVolume(save.global.globalVolume);
        snapDivision.value = save.global.snapDivision;
        setPlaybackMode(save.global.playbackMode);

        engine.resetForLoad();
        channelManager.setNextId(save.idCounters.nextChannelId);

        const master = mixerManager.getMixer('master')!;
        const masterSave = save.mixers.find(m => m.id === 'master');

        if(masterSave) {
            Object.assign(master, masterSave);
        } else {
            // legacy saves / blank saves without master - reset to defaults
            Object.assign(master, { volume: 1, pan: 0, muted: false, solo: false });
        }

        for(const mixer of save.mixers.filter(m => m.id !== 'master')) {
            engine.loadMixer(mixer);
        }

        mixerManager.restoreSoloState(save.mixers.find(m => m.solo)?.id ?? null);

        for(const channel of save.channels) engine.loadChannel(channel);
        channelManager.restoreSoloState(save.channels.find(c => c.solo)?.id ?? null);

        for(const channel of channelManager.getAllChannels()) {
            engine.setChannelGain(channel.id, channel.muted ? 0 : channel.volume);
            engine.setChannelPan(channel.id, channel.pan);
        }
        for(const mixer of mixerManager.getAllMixers()) {
            engine.setMixerGain(mixer.id, mixer.volume);
            engine.setMixerPan(mixer.id, mixer.pan);
        }

        patterns.value.splice(0, patterns.value.length);
        for(const pattern of save.patterns) {
            const roll = new PianoRoll(keyboard.getRange(), keyboard.getKeyboardInfo());
            for(const note of pattern.notes) roll.loadNote(note);
            patterns.value.push({ id: pattern.id, num: pattern.num, name: pattern.name, visible: pattern.visible, selectedChannelId: pattern.selectedChannelId ?? '', roll });
        }

        arrangement.clearClips();
        arrangement.clearTracks();
        for(const track of save.arrangement.tracks) arrangement.loadTrack({ ...track });
        for(const clip of save.arrangement.clips) arrangement.loadClip({ ...clip });
        arrangement.restoreSoloState(save.arrangement.tracks.find(t => t.solo)?.id ?? null);

        scheduler.seek(save.playback.pauseTime);
        scheduler.setLoop(save.playback.loopEnabled, save.playback.loopStart, save.playback.loopEnd);

        patternsListWidth.value = save.ui.patternsListWidth;
        headerHeight.value = save.ui.headerHeight;
        arrangementVisible.value = save.ui.windowVisibility.arrangementVisible;
        channelRackVisible.value = save.ui.windowVisibility.channelRackVisible;
        mixerVisible.value = save.ui.windowVisibility.mixerVisible;

        await Promise.resolve();
        for(const win of save.ui.windows) {
            if(win.userModified) positionWindow(win.id, win.x, win.y, win.width, win.height);
        }
    } catch(error) {
        throw error instanceof Error ? error : new Error('Error deserializing state');
    } finally {
        await nextTick();
        isLoading = false;
    }
}

export async function autoSaveToDb(): Promise<void> {
    if(savingLock) return;
    savingLock = true;

    try {
        if(currentProjectId.value === null) {
            await idbPut(AUTOSAVE_STORE, { id: TEMPSAVE_KEY, ...serializeState() });
        } else {
            const existing = await idbGet<SaveFile>(PROJECTS_STORE, currentProjectId.value);
            const state = serializeState();
            if(existing) {
                state.metadata.created = existing.metadata.created;
                if(!state.metadata.projectName) state.metadata.projectName = existing.metadata.projectName;
            }
            await idbPut(PROJECTS_STORE, { id: currentProjectId.value, ...state });
        }
    } finally {
        savingLock = false;
    }
}

export async function loadAutoSave(): Promise<SaveFile | null> {
    return (await idbGet<SaveFile>(AUTOSAVE_STORE, TEMPSAVE_KEY))
}

// project management

export async function getAllProjects(): Promise<ProjectSummary[]> {
    const all = await idbGetAll<SaveFile & { id: number }>(PROJECTS_STORE);
    return all.map(p => ({ id: p.id, name: p.metadata.projectName, lastModified: p.metadata.lastModified })).sort((a, b) => b.lastModified - a.lastModified);
}

export type SaveResult = 'ok' | 'duplicate_name';

export async function saveManualProject(): Promise<SaveResult> {
    const name = projectName.value.trim();

    // reject if another project already uses this name
    const projects = await getAllProjects();
    const duplicate = projects.some(p =>
        p.name.trim().toLowerCase() === name.toLowerCase() &&
        p.id !== currentProjectId.value
    );
    if(duplicate) return 'duplicate_name';

    const save = serializeState();
    const now = Date.now();
    save.metadata.lastModified = now;

    if(currentProjectId.value !== null) {
        const existing = await idbGet<SaveFile>(PROJECTS_STORE, currentProjectId.value);
        if(existing) save.metadata.created = existing.metadata.created;
        await idbPut(PROJECTS_STORE, { id: currentProjectId.value, ...save });
    } else {
        save.metadata.created = now;
        const newId = await idbPut(PROJECTS_STORE, save);
        currentProjectId.value = newId as number;
        localStorage.setItem(LAST_PROJECT_KEY, String(newId));
    }

    return 'ok';
}

export async function loadProjectById(id: number): Promise<void> {
    const save = await idbGet<SaveFile>(PROJECTS_STORE, id);
    if(!save) throw new Error(`Project ${id} not found`);
    await deserializeState(save);
    currentProjectId.value = id;
    localStorage.setItem(LAST_PROJECT_KEY, String(id));
}

function createBlankSave(): SaveFile {
    const now = Date.now();

    return {
        version: SAVE_FILE_VERSION,
        metadata: { projectName: '', created: now, lastModified: now },
        global: {
            bpm: 140,
            globalVolume: DEFAULT_GLOBAL_VOLUME,
            snapDivision: 4,
            playbackMode: 'arrangement',
        },
        playback: { pauseTime: 0, loopEnabled: false, loopStart: 0, loopEnd: 8 },
        patterns: [
            { id: 'pattern-1', num: 1, name: 'Pattern 1', visible: true, notes: [], selectedChannelId: 'channel-1' },
        ],
        channels: [
            { id: 'channel-1', name: 'MiniSynth', synthId: 'minisynth', synthNum: 1, mixerTrack: 0, volume: 1, pan: 0, muted: false, solo: false }
        ],
        mixers: [
            { id: 'master', name: 'Master', route: -1, volume: 1, pan: 0, muted: false, solo: false },
            { id: 'mixer-1', name: 'Mixer 1', route: 0, volume: 1, pan: 0, muted: false, solo: false },
            { id: 'mixer-2', name: 'Mixer 2', route: 0, volume: 1, pan: 0, muted: false, solo: false },
            { id: 'mixer-3', name: 'Mixer 3', route: 0, volume: 1, pan: 0, muted: false, solo: false },
            { id: 'mixer-4', name: 'Mixer 4', route: 0, volume: 1, pan: 0, muted: false, solo: false },
        ],
        arrangement: {
            clips: [],
            tracks: [
                { id: 'track-1', name: 'Track 1', height: 100, muted: false, solo: false },
                { id: 'track-2', name: 'Track 2', height: 100, muted: false, solo: false },
                { id: 'track-3', name: 'Track 3', height: 100, muted: false, solo: false },
                { id: 'track-4', name: 'Track 4', height: 100, muted: false, solo: false },
            ],
        },
        ui: {
            patternsListWidth: PATTERNS_LIST_WIDTH,
            headerHeight: HEADER_HEIGHT,
            windowVisibility: { arrangementVisible: true, channelRackVisible: true, mixerVisible: true },
            windows: [],
        },
        idCounters: { nextChannelId: 2, nextClipId: 1, nextPatternNum: 2, nextMixerNum: 1 },
    };
}

export async function newProject(): Promise<void> {
    await deserializeState(createBlankSave());
    currentProjectId.value = null;
    localStorage.removeItem(LAST_PROJECT_KEY);
    await autoSaveToDb();
}

export async function deleteCurrentProject(): Promise<void> {
    if(currentProjectId.value === null) return;
    await idbDelete(PROJECTS_STORE, currentProjectId.value);
    await newProject();
}

export async function initLoad(): Promise<void> {
    const storedId = localStorage.getItem(LAST_PROJECT_KEY);
    if(storedId !== null) {
        const id = parseInt(storedId, 10);
        try {
            await loadProjectById(id);
            return;
        } catch {
            localStorage.removeItem(LAST_PROJECT_KEY);
        }
    }

    const tempsave = await loadAutoSave();
    if(tempsave) await deserializeState(tempsave);
    currentProjectId.value = null;
}

export function scheduleAutosave(debounce = AUTOSAVE_DEBOUNCE_MS) {
    if(isLoading) return;

    saving.value = true;

    if(autosaveTimer !== null) clearTimeout(autosaveTimer);

    autosaveTimer = setTimeout(() => {
        autosaveTimer = null;
        autoSaveToDb().then(() => saving.value = false).catch(err => { saving.value = false; console.error('[saveStateManager] autosave failed:', err); });
    }, debounce);
}

setInterval(() => {
    scheduleAutosave();
}, SCHEDULE_SAVE_INTERVAL_MS);