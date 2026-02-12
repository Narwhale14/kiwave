import { ref } from 'vue';
import { getAudioEngine } from './audioEngineManager';

export type PlaybackMode = 'pattern' | 'arrangement';

type PlayheadCallback = (beat: number) => void;
type PlayStateCallback = (playing: boolean) => void;

interface ModeCallbacks {
    playhead: PlayheadCallback | null;
    playState: PlayStateCallback | null;
}

// Global playback mode state
export const playbackMode = ref<PlaybackMode>('pattern');

// Store callbacks for each mode
const patternCallbacks: ModeCallbacks = {
    playhead: null,
    playState: null
};

const arrangementCallbacks: ModeCallbacks = {
    playhead: null,
    playState: null
};

// Switch active callbacks when mode changes
function updateActiveCallbacks() {
    const engine = getAudioEngine();
    const callbacks = playbackMode.value === 'pattern' ? patternCallbacks : arrangementCallbacks;

    engine.scheduler.setPlayheadCallback(callbacks.playhead);
    engine.scheduler.setPlayStateCallback(callbacks.playState);
}

export function registerPatternCallbacks(playhead: PlayheadCallback, playState: PlayStateCallback) {
    patternCallbacks.playhead = playhead;
    patternCallbacks.playState = playState;

    // If we're in pattern mode, activate these callbacks immediately
    if (playbackMode.value === 'pattern') {
        updateActiveCallbacks();
    }
}

export function registerArrangementCallbacks(playhead: PlayheadCallback, playState: PlayStateCallback) {
    arrangementCallbacks.playhead = playhead;
    arrangementCallbacks.playState = playState;

    // If we're in arrangement mode, activate these callbacks immediately
    if (playbackMode.value === 'arrangement') {
        updateActiveCallbacks();
    }
}

export function unregisterPatternCallbacks() {
    patternCallbacks.playhead = null;
    patternCallbacks.playState = null;

    if (playbackMode.value === 'pattern') {
        updateActiveCallbacks();
    }
}

export function unregisterArrangementCallbacks() {
    arrangementCallbacks.playhead = null;
    arrangementCallbacks.playState = null;

    if (playbackMode.value === 'arrangement') {
        updateActiveCallbacks();
    }
}

export function setPlaybackMode(mode: PlaybackMode) {
    const engine = getAudioEngine();

    // Stop playback when switching modes
    if (engine.scheduler.isPlaying) {
        engine.scheduler.stop();
    }

    // Clear notes from previous mode
    engine.scheduler.setNotes([]);

    playbackMode.value = mode;
    updateActiveCallbacks();
}

export function togglePlaybackMode() {
    setPlaybackMode(playbackMode.value === 'pattern' ? 'arrangement' : 'pattern');
}

export function isPatternMode() {
    return playbackMode.value === 'pattern';
}

export function isArrangementMode() {
    return playbackMode.value === 'arrangement';
}
