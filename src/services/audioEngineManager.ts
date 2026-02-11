import { AudioEngine } from '../audio/AudioEngine';

// singleton AudioEngine instance shared across the entire app
let audioEngineInstance: AudioEngine | null = null;

export function getAudioEngine(): AudioEngine {
    if(!audioEngineInstance) {
        audioEngineInstance = new AudioEngine();
    }
    
    return audioEngineInstance;
}

export function disposeAudioEngine() {
    if(audioEngineInstance) {
        audioEngineInstance.dispose();
        audioEngineInstance = null;
    }
}
