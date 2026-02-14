const RAMP_TIME = 0.005; // 5ms ramp for click-free gain changes

/**
 * manages the physical Web Audio GainNode graph for all mixer tracks.
 * each mixer track (including master) has one GainNode.
 * channel instruments connect their output node into the appropriate mixer GainNode.
 *
 * signal path: channel outputNode -> mixerGainNode -> ... -> masterGainNode -> destination
 */
export class AudioGraph {
    private audioContext: AudioContext;
    private gainNodes: Map<string, GainNode> = new Map();

    constructor(audioContext: AudioContext) {
        this.audioContext = audioContext;

        // soft clipper
        const softClipper = audioContext.createWaveShaper();
        softClipper.curve = AudioGraph.makeSoftClipCurve();
        softClipper.oversample = '4x';

        // safety limiter
        const limiter = audioContext.createDynamicsCompressor();
        limiter.threshold.value = -6; // headroom
        limiter.knee.value = 2; // knee
        limiter.ratio.value = 20; // hard limit
        limiter.attack.value = 0.001;
        limiter.release.value = 0.05;

        softClipper.connect(limiter);
        limiter.connect(audioContext.destination);

        const globalGain = audioContext.createGain();
        globalGain.connect(softClipper);
        this.gainNodes.set('global', globalGain);

        const masterGain = audioContext.createGain();
        masterGain.connect(globalGain);
        this.gainNodes.set('master', masterGain);
    }

    private resolveTargetId(route: number): string {
        return route === 0 ? 'master' : `mixer-${route}`;
    }

    addNode(id: string, route: number): void {
        if(this.gainNodes.has(id)) return;
        const gain = this.audioContext.createGain();
        const target = this.gainNodes.get(this.resolveTargetId(route));
        if(target) gain.connect(target);
        this.gainNodes.set(id, gain);
    }

    removeNode(id: string): void {
        const node = this.gainNodes.get(id);
        if(!node) return;
        node.disconnect();
        this.gainNodes.delete(id);
    }

    // wire channel to mixer track
    connectChannel(outputNode: GainNode, mixerTrack: number): void {
        const target = this.gainNodes.get(this.resolveTargetId(mixerTrack));
        if(target) outputNode.connect(target);
    }

    // rewires channel to mixer track
    rerouteChannel(outputNode: GainNode, newMixerTrack: number): void {
        outputNode.disconnect();
        this.connectChannel(outputNode, newMixerTrack);
    }

    // disconnects a channel completely
    disconnectChannel(outputNode: GainNode): void {
        outputNode.disconnect();
    }

    setGain(id: string, value: number): void {
        const node = this.gainNodes.get(id);
        if(!node) return;
        node.gain.setTargetAtTime(value, this.audioContext.currentTime, RAMP_TIME);
    }

    setGainImmediate(id: string, now: number): void {
        const node = this.gainNodes.get(id);
        if(!node) return;
        node.gain.cancelScheduledValues(now);
        node.gain.setValueAtTime(node.gain.value, now);
        node.gain.linearRampToValueAtTime(0, now + 0.01);
    }

    // piecewise tanh soft clip: linear for |x| <= 0.8, saturates smoothly to ceiling of 1.0 above.
    // inaudible at normal levels; catches transient peaks before they hit the limiter.
    private static makeSoftClipCurve(numSamples = 256): Float32Array<ArrayBuffer> {
        const curve = new Float32Array(new ArrayBuffer(numSamples * 4));
        for(let i = 0; i < numSamples; i++) {
            const x = (i * 2) / (numSamples - 1) - 1;
            const abs = Math.abs(x);
            const sign = x < 0 ? -1 : 1;
            if(abs <= 0.8) {
                curve[i] = x;
            } else {
                const t = (abs - 0.8) / 0.2;
                curve[i] = sign * (0.8 + 0.2 * Math.tanh(t * 2));
            }
        }
        return curve;
    }

    dispose(): void {
        for(const node of this.gainNodes.values()) node.disconnect();
        this.gainNodes.clear();
    }
}
