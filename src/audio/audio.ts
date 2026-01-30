let actx: AudioContext | null = null;

export function getAudioContext(): AudioContext {
    if(!actx) actx = new AudioContext;
    return actx;
}

export async function resumeAudioContext() {
    const context = getAudioContext();
    if(context.state === 'suspended') await context.resume();
}