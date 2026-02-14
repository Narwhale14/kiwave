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

        const masterGain = audioContext.createGain();
        masterGain.connect(audioContext.destination);
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

    dispose(): void {
        for(const node of this.gainNodes.values()) node.disconnect();
        this.gainNodes.clear();
    }
}
