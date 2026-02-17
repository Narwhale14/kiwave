/**
 * saveStateManager — serialization, IndexedDB persistence, and autosave.
 *
 * Dependency chain on load (must be followed exactly):
 *   1. idCounters
 *   2. global settings (bpm, volume, snap, playbackMode)
 *   3. mixers (non-master, in order)
 *   4. channels
 *   5. patterns + notes
 *   6. arrangement tracks + clips
 *   7. playback state (pauseTime, loop)
 *   8. UI state
 */

import { watch } from 'vue';
import { getAudioEngine } from './audioEngineManager';
import { patterns, getNextPatternNum } from './patternsListManager';
import { globalVolume } from './settingsManager';
import { snapDivision } from '../util/snap';
import { playbackMode, setPlaybackMode } from './playbackModeManager';
import { patternsListWidth, headerHeight } from './layoutManager';
import { windows, arrangementVisible, channelRackVisible, mixerVisible, positionWindow } from './windowManager';
import { arrangement } from '../audio/Arrangement';
import {
    type SaveFile,
    type SavedNote,
    type SavedPattern,
    SAVE_FILE_VERSION,
    DB_NAME,
    DB_VERSION,
    AUTOSAVE_STORE,
    PROJECTS_STORE,
} from '../types/saveFile';
import { Keyboard } from '../audio/Keyboard';
import { PianoRoll } from '../audio/PianoRoll';

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const AUTOSAVE_DEBOUNCE_MS = 2000;

// ─── IndexedDB ───────────────────────────────────────────────────────────────

let _db: IDBDatabase | null = null;

function openDb(): Promise<IDBDatabase> {
    if(_db) return Promise.resolve(_db);

    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);

        req.onupgradeneeded = (e) => {
            const db = (e.target as IDBOpenDBRequest).result;

            if(!db.objectStoreNames.contains(PROJECTS_STORE)) {
                const store = db.createObjectStore(PROJECTS_STORE, { keyPath: 'id', autoIncrement: true });
                store.createIndex('lastModified', 'lastModified', { unique: false });
            }

            if(!db.objectStoreNames.contains(AUTOSAVE_STORE)) {
                db.createObjectStore(AUTOSAVE_STORE, { keyPath: 'id' });
            }
        };

        req.onsuccess = (e) => {
            _db = (e.target as IDBOpenDBRequest).result;
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

// ─── SERIALIZATION ────────────────────────────────────────────────────────────

function serializeNote(note: import('../audio/PianoRoll').NoteBlock): SavedNote {
    return {
        id: note.id,
        row: note.row,
        col: note.col,
        length: note.length,
        velocity: note.velocity,
        channelId: note.channelId,
        midi: note.midi,
        // AutomationCurve already has {parameterId, nodes} — spread map values directly
        automation: [...note.automation.values()],
    };
}

export function serializeState(projectName = 'Untitled Project'): SaveFile {
    const engine = getAudioEngine();
    const scheduler = engine.scheduler;
    const channelSynths = engine.channelSynths;

    // patterns
    const savedPatterns: SavedPattern[] = patterns.value.map(p => ({
        id: p.id,
        num: p.num,
        name: p.name,
        visible: p.visible,
        notes: p.roll.getNoteData.map(serializeNote),
    }));

    // channels
    const savedChannels = engine.channelManager.getAllChannels().map(ch => {
        const synth = channelSynths.get(ch.id) ?? { synthId: 'minisynth', num: 1 };
        return {
            id: ch.id,
            name: ch.name,
            synthId: synth.synthId,
            synthNum: synth.num,
            mixerTrack: ch.mixerTrack,
            volume: ch.volume,
            pan: ch.pan,
            muted: ch.muted,
            solo: ch.solo,
        };
    });

    // mixers
    const savedMixers = engine.mixerManager.getAllMixers().map(m => ({
        id: m.id,
        name: m.name,
        route: m.route,
        volume: m.volume,
        pan: m.pan,
        muted: m.muted,
        solo: m.solo,
    }));

    // arrangement
    const savedArrangement = {
        clips: arrangement.clips.map(c => ({ ...c })),
        tracks: arrangement.getAllTracks().map(t => ({ ...t })),
    };

    // ui
    const savedUI = {
        patternsListWidth: patternsListWidth.value,
        headerHeight: headerHeight.value,
        windowVisibility: {
            arrangementVisible: arrangementVisible.value,
            channelRackVisible: channelRackVisible.value,
            mixerVisible: mixerVisible.value,
        },
        windows: windows.map(w => ({ ...w })),
    };

    // id counters
    const savedIdCounters = {
        nextChannelId: engine.channelManager.nextChannelIdCounter,
        nextClipId: arrangement.nextClipIdCounter,
        nextPatternNum: getNextPatternNum(),
        nextMixerNum: savedMixers.filter(m => m.id !== 'master').length + 1,
    };

    const now = Date.now();

    return {
        version: SAVE_FILE_VERSION,
        metadata: {
            projectName,
            created: now,
            lastModified: now,
        },
        global: {
            bpm: scheduler.bpm,
            globalVolume: globalVolume.value,
            snapDivision: snapDivision.value,
            playbackMode: playbackMode.value,
        },
        playback: {
            pauseTime: scheduler.pauseBeat,
            loopEnabled: scheduler.loopEnabled,
            loopStart: scheduler.loopStart,
            loopEnd: scheduler.loopEndBeat,
        },
        patterns: savedPatterns,
        channels: savedChannels,
        mixers: savedMixers,
        arrangement: savedArrangement,
        ui: savedUI,
        idCounters: savedIdCounters,
    };
}

// ─── DESERIALIZATION ──────────────────────────────────────────────────────────

const _keyboard = new Keyboard({ note: 'C', octave: 0 }, { note: 'C', octave: 10 });

export async function deserializeState(save: SaveFile): Promise<void> {
    const engine = getAudioEngine();
    const scheduler = engine.scheduler;

    // 1. ID counters — restore first so nothing collides
    engine.channelManager.setNextId(save.idCounters.nextChannelId);
    arrangement.setNextClipId(save.idCounters.nextClipId);

    // 2. Global settings
    engine.setBpm(save.global.bpm);
    globalVolume.value = save.global.globalVolume;
    engine.setGlobalVolume(save.global.globalVolume);
    snapDivision.value = save.global.snapDivision;
    setPlaybackMode(save.global.playbackMode);

    // 3. Reset audio engine state (removes default channel + mixers created at init)
    engine.resetForLoad();

    // 4. Mixers — restore non-master first, then apply master state
    const masterSave = save.mixers.find(m => m.id === 'master');
    if(masterSave) {
        const master = engine.mixerManager.getMixer('master')!;
        master.name = masterSave.name;
        master.volume = masterSave.volume;
        master.pan = masterSave.pan;
        master.muted = masterSave.muted;
        master.solo = masterSave.solo;
    }

    for(const m of save.mixers.filter(m => m.id !== 'master')) {
        engine.loadMixer(m);
    }

    const soloMixer = save.mixers.find(m => m.solo);
    engine.mixerManager.restoreSoloState(soloMixer?.id ?? null);

    // 5. Channels
    for(const ch of save.channels) {
        engine.loadChannel(ch);
    }

    const soloChannel = save.channels.find(c => c.solo);
    engine.channelManager.restoreSoloState(soloChannel?.id ?? null);

    // sync gains now that mute/solo state is restored
    // (AudioEngine's _syncChannelGains + _syncMixerGains are private,
    //  but toggling a channel triggers the callback — instead we directly set volumes)
    for(const ch of engine.channelManager.getAllChannels()) {
        if(!ch.muted) engine.setChannelGain(ch.id, ch.volume);
        engine.setChannelPan(ch.id, ch.pan);
    }
    for(const m of engine.mixerManager.getAllMixers()) {
        engine.setMixerGain(m.id, m.volume);
        engine.setMixerPan(m.id, m.pan);
    }

    // 6. Patterns
    // Clear existing patterns (including the default pattern created at module init)
    patterns.value.splice(0, patterns.value.length);

    for(const sp of save.patterns) {
        const roll = new PianoRoll(_keyboard.getRange(), _keyboard.getKeyboardInfo());

        for(const sn of sp.notes) {
            // AutomationCurve[] on disk → Map<string, AutomationCurve> at runtime
            const automationMap = new Map(sn.automation.map(curve => [curve.parameterId, curve]));

            roll._noteData.push({
                id: sn.id,
                row: sn.row,
                col: sn.col,
                length: sn.length,
                velocity: sn.velocity,
                channelId: sn.channelId,
                midi: sn.midi,
                automation: automationMap,
            });
        }

        patterns.value.push({
            id: sp.id,
            num: sp.num,
            name: sp.name,
            visible: sp.visible,
            roll,
        });
    }

    // 7. Arrangement
    arrangement.clearClips();
    arrangement.clearTracks();

    for(const t of save.arrangement.tracks) {
        arrangement.loadTrack({ ...t });
    }
    for(const c of save.arrangement.clips) {
        arrangement.loadClip({ ...c });
    }

    const soloTrack = save.arrangement.tracks.find(t => t.solo);
    arrangement.restoreSoloState(soloTrack?.id ?? null);

    // 8. Playback state
    scheduler.seek(save.playback.pauseTime);
    scheduler.setLoop(save.playback.loopEnabled, save.playback.loopStart, save.playback.loopEnd);

    // 9. UI state
    patternsListWidth.value = save.ui.patternsListWidth;
    headerHeight.value = save.ui.headerHeight;
    arrangementVisible.value = save.ui.windowVisibility.arrangementVisible;
    channelRackVisible.value = save.ui.windowVisibility.channelRackVisible;
    mixerVisible.value = save.ui.windowVisibility.mixerVisible;

    // Restore user-modified window positions (after next tick so windows have mounted)
    await Promise.resolve(); // yield to Vue
    for(const sw of save.ui.windows) {
        if(sw.userModified) {
            positionWindow(sw.id, sw.x, sw.y, sw.width, sw.height);
        }
    }
}

// ─── IndexedDB PERSISTENCE ────────────────────────────────────────────────────

/** Save the current state to the autosave slot. */
export async function autoSaveToDb(): Promise<void> {
    const save = serializeState();
    await idbPut(AUTOSAVE_STORE, { id: 1, ...save });
}

/** Load the autosaved state, if any. Returns null if no autosave exists. */
export async function loadAutoSave(): Promise<SaveFile | null> {
    return idbGet<SaveFile>(AUTOSAVE_STORE, 1);
}

/** Save the current state as a named project. Returns the assigned project ID. */
export async function saveProject(projectName: string): Promise<void> {
    const now = Date.now();
    const save = serializeState(projectName);
    save.metadata.lastModified = now;
    await idbPut(PROJECTS_STORE, save);
}

/** Load a named project by its IDB key. */
export async function loadProject(id: number): Promise<SaveFile | null> {
    return idbGet<SaveFile>(PROJECTS_STORE, id);
}

// ─── AUTOSAVE WATCHER ─────────────────────────────────────────────────────────

let _autosaveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleAutosave() {
    if(_autosaveTimer !== null) clearTimeout(_autosaveTimer);
    _autosaveTimer = setTimeout(() => {
        _autosaveTimer = null;
        autoSaveToDb().catch(err => console.error('[saveStateManager] autosave failed:', err));
    }, AUTOSAVE_DEBOUNCE_MS);
}

/**
 * Start watching all reactive singletons that should trigger an autosave.
 * Call once during app initialization (e.g. in App.vue onMounted).
 */
export function startAutosave() {
    // patterns ref — note edits bump _state.version inside PianoRoll,
    // but since _state is local to each PianoRoll we watch the patterns array
    // plus each roll's _state.version via a deep watch.
    watch(
        () => patterns.value.map(p => ({ ...p, version: p.roll._state.version })),
        scheduleAutosave,
        { deep: true }
    );

    watch(globalVolume, scheduleAutosave);
    watch(snapDivision, scheduleAutosave);
    watch(playbackMode, scheduleAutosave);
    watch(patternsListWidth, scheduleAutosave);
    watch(headerHeight, scheduleAutosave);
    watch(arrangementVisible, scheduleAutosave);
    watch(channelRackVisible, scheduleAutosave);
    watch(mixerVisible, scheduleAutosave);

    // arrangement (clips + tracks)
    watch(() => arrangement.clips, scheduleAutosave, { deep: true });
    watch(() => arrangement.tracks, scheduleAutosave, { deep: true });

    // windows
    watch(windows, scheduleAutosave, { deep: true });

    // channel + mixer state (volume, pan, mute, solo, route)
    watch(
        () => getAudioEngine().channelManager.getAllChannels().map(c => ({ ...c, instrument: undefined })),
        scheduleAutosave,
        { deep: true }
    );
    watch(
        () => getAudioEngine().mixerManager.getAllMixers().map(m => ({ id: m.id, name: m.name, route: m.route, volume: m.volume, pan: m.pan, muted: m.muted, solo: m.solo })),
        scheduleAutosave,
        { deep: true }
    );

    // scheduler bpm + loop (polled via getters — wrap in computed-like watch source)
    watch(
        () => {
            const s = getAudioEngine().scheduler;
            return { bpm: s.bpm, loopEnabled: s.loopEnabled, loopStart: s.loopStart, loopEnd: s.loopEndBeat };
        },
        scheduleAutosave,
        { deep: true }
    );
}
