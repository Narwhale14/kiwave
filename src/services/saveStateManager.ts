import { watch, nextTick } from 'vue';
import { getAudioEngine } from './audioEngineManager';
import { patterns, getNextPatternNum } from './patternsListManager';
import { globalVolume, projectName } from './settingsManager';
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

// big boi
let _db: IDBDatabase | null = null;

// auto save stuff
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
let isLoading = false;

import { dirty, markDirty } from '../util/dirty';
watch(dirty, (ready) => { if(ready) scheduleAutosave(); });

// convenience metadata
const SAVE_FILE_VERSION = '1.0.0';
const DB_NAME = 'webdaw';
const DB_VERSION = 1;
const AUTOSAVE_STORE = 'autosave';
const PROJECTS_STORE = 'projects';

const AUTOSAVE_DEBOUNCE_MS = 2000;

// converting data to saveable types
type SavedMixer = Omit<MixerTrack, 'peakDbL' | 'peakDbR'>;
type SavedChannel = Omit<Channel, 'instrument'> & { synthId: string; synthNum: number };
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

async function idbPut(storeName: string, value: unknown): Promise<void> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).put(value);
        tx.oncomplete = () => resolve();
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

// serialization / deserialization

function serializeNote(note: NoteBlock): SavedNote {
    return {
        ...note,
        automation: [...note.automation.values()],
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
        mixerTrack: ch.mixerTrack,
        volume: ch.volume,
        pan: ch.pan,
        muted: ch.muted,
        solo: ch.solo,
    }));

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
            clips: arrangement.clips.map(c => ({ ...c })),
            tracks: arrangement.getAllTracks().map(t => ({ ...t })),
        },
        ui: {
            patternsListWidth: patternsListWidth.value,
            headerHeight: headerHeight.value,
            windowVisibility: {
                arrangementVisible: arrangementVisible.value,
                channelRackVisible: channelRackVisible.value,
                mixerVisible: mixerVisible.value,
            },
            windows: windows.map(w => ({ ...w })),
        },
        idCounters: {
            nextChannelId: channelManager.nextChannelIdCounter,
            nextClipId: arrangement.nextClipIdCounter,
            nextPatternNum: getNextPatternNum(),
            nextMixerNum: savedMixers.filter(m => m.id !== 'master').length + 1,
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
        globalVolume.value = save.global.globalVolume;
        engine.setGlobalVolume(save.global.globalVolume);
        snapDivision.value = save.global.snapDivision;
        setPlaybackMode(save.global.playbackMode);

        engine.resetForLoad();
        channelManager.setNextId(save.idCounters.nextChannelId);

        const masterSave = save.mixers.find(m => m.id === 'master');
        if(masterSave) Object.assign(mixerManager.getMixer('master')!, masterSave);

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
        for(const sp of save.patterns) {
            const roll = new PianoRoll(keyboard.getRange(), keyboard.getKeyboardInfo());
            for(const note of sp.notes) roll.loadNote(note);
            patterns.value.push({ id: sp.id, num: sp.num, name: sp.name, visible: sp.visible, selectedChannelId: sp.selectedChannelId ?? '', roll });
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
        throw new Error('Error deserializing state:');
    } finally {
        await nextTick();
        isLoading = false;
        dirty.value = false;
    }
}

export async function autoSaveToDb(): Promise<void> {
    await idbPut(AUTOSAVE_STORE, { id: 1, ...serializeState() });
}

export async function loadAutoSave(): Promise<SaveFile | null> {
    return idbGet<SaveFile>(AUTOSAVE_STORE, 1);
}

export async function saveProject(name: string): Promise<void> {
    projectName.value = name;
    const save = serializeState();
    save.metadata.lastModified = Date.now();
    await idbPut(PROJECTS_STORE, save);
}

export async function loadProject(id: number): Promise<SaveFile | null> {
    return idbGet<SaveFile>(PROJECTS_STORE, id);
}

export function scheduleAutosave(debounce = AUTOSAVE_DEBOUNCE_MS) {
    if(isLoading) return;
    if(autosaveTimer !== null) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => { 
        autosaveTimer = null; 
        autoSaveToDb().then(() => { dirty.value = false; }).catch(err => console.error('[saveStateManager] autosave failed:', err));
    }, debounce);
}

export function startAutosave() {
    watch([globalVolume, snapDivision, patternsListWidth, headerHeight, arrangementVisible, channelRackVisible, mixerVisible, projectName], markDirty);
    watch(() => patterns.value.map(p => p.selectedChannelId).join(','), markDirty);
}