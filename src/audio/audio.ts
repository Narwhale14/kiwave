let actx: AudioContext | null = null;

export function getAudioContext(): AudioContext {
    if(!actx) actx = new AudioContext;
    return actx;
}

export function resumeAudioContext() {
    const context = getAudioContext();
    if(context.state === 'suspended') context.resume();
}