import { ref } from 'vue';
import { getAudioEngine } from './audioEngineManager';

export type PlaybackMode = 'pattern' | 'arrangement';

type PlayheadCallback = (beat: number) => void;
type PlayStateCallback = (playing: boolean) => void;

interface ModeCallbacks {
    playhead: PlayheadCallback | null;
    playState: PlayStateCallback | null;
}

export const playbackMode = ref<PlaybackMode>('pattern');

// callbacks for each mode
const patternCallbacks: ModeCallbacks = { playhead: null, playState: null };
const arrangementCallbacks: ModeCallbacks = { playhead: null, playState: null };

// wwitch active callbacks when mode changes
function updateActiveCallbacks() {
    const engine = getAudioEngine();
    const callbacks = playbackMode.value === 'pattern' ? patternCallbacks : arrangementCallbacks;
    engine.scheduler.setPlayheadCallback(callbacks.playhead);
    engine.scheduler.setPlayStateCallback(callbacks.playState);
}

export function registerPatternCallbacks(playhead: PlayheadCallback, playState: PlayStateCallback) {
    patternCallbacks.playhead = playhead;
    patternCallbacks.playState = playState;

    if(playbackMode.value === 'pattern') {
        updateActiveCallbacks();
    }
}

export function registerArrangementCallbacks(playhead: PlayheadCallback, playState: PlayStateCallback) {
    arrangementCallbacks.playhead = playhead;
    arrangementCallbacks.playState = playState;

    if(playbackMode.value === 'arrangement') {
        updateActiveCallbacks();
    }
}

export function unregisterPatternCallbacks() {
    patternCallbacks.playhead = null;
    patternCallbacks.playState = null;

    if(playbackMode.value === 'pattern') {
        updateActiveCallbacks();
    }
}

export function unregisterArrangementCallbacks() {
    arrangementCallbacks.playhead = null;
    arrangementCallbacks.playState = null;

    if(playbackMode.value === 'arrangement') {
        updateActiveCallbacks();
    }
}

export function setPlaybackMode(mode: PlaybackMode) {
    const engine = getAudioEngine();

    if(engine.scheduler.isPlaying) {
        engine.scheduler.stop();
    }

    engine.scheduler.setNotes([]);
    playbackMode.value = mode;
    updateActiveCallbacks();
}

export function togglePlaybackMode() {
    setPlaybackMode(playbackMode.value === 'pattern' ? 'arrangement' : 'pattern');
}