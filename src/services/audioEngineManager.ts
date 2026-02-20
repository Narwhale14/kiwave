import { AudioEngine } from '../audio/AudioEngine';
import { REGISTERED_SYNTHS } from '../audio/synths/index'

// singleton AudioEngine instance shared across the entire app
let audioEngineInstance: AudioEngine | null = null;

export function getAudioEngine(): AudioEngine {
    if(!audioEngineInstance) {
        audioEngineInstance = new AudioEngine(REGISTERED_SYNTHS);
    }
    
    return audioEngineInstance;
}

export function disposeAudioEngine() {
    if(audioEngineInstance) {
        audioEngineInstance.dispose();
        audioEngineInstance = null;
    }
}