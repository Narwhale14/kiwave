const RAMP_TIME = 0.005; // 5ms ramp for click-free gain changes

/**
 * manages the physical Web Audio GainNode graph for all mixer tracks.
 * each mixer track has a volumeGain + panner + muteGain; channels connect to the volumeGain.
 * the analyser splitter taps from the panner output (pre-mute) so meters read even when muted.
 *
 * signal path: channel panner -> mixerVolumeGain -> mixerPanner -> [analyser] -> mixerMuteGain -> parentGain -> ... -> destination
 */
export class AudioGraph {
    private audioContext: AudioContext;
    private gainNodes: Map<string, GainNode> = new Map();
    private muteGainNodes: Map<string, GainNode> = new Map();
    private pannerNodes: Map<string, StereoPannerNode> = new Map();
    private analyserNodes: Map<string, { left: AnalyserNode; right: AnalyserNode; splitter: ChannelSplitterNode }> = new Map();

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
        const masterPanner = audioContext.createStereoPanner();
        const masterMuteGain = audioContext.createGain();

        masterGain.connect(masterPanner);
        masterPanner.connect(masterMuteGain);
        masterMuteGain.connect(globalGain);

        this.gainNodes.set('master', masterGain);
        this.muteGainNodes.set('master', masterMuteGain);
        this.pannerNodes.set('master', masterPanner);
        
        this._addAnalysers('master', masterPanner);
    }

    // converts a route number to a gain node id: 0 -> 'master', n -> 'mixer-n'
    private resolveTargetId(route: number): string {
        return route === 0 ? 'master' : `mixer-${route}`;
    }

    // creates a gain node and a paired panner: gain → panner → target mixer gain
    addGainNode(id: string, route: number): void {
        if(this.gainNodes.has(id)) return;
        const gain = this.audioContext.createGain();
        this.gainNodes.set(id, gain);
        this.addPannerNode(id, gain, route);
    }

    // disconnects and removes a gain node and its paired panner/muteGain/analysers from the chain
    removeGainNode(id: string): void {
        const gain = this.gainNodes.get(id);
        if(!gain) return;
        gain.disconnect();
        this.gainNodes.delete(id);
        const panner = this.pannerNodes.get(id);
        if(panner) {
            panner.disconnect();
            this.pannerNodes.delete(id);
        }
        const muteGain = this.muteGainNodes.get(id);
        if(muteGain) {
            muteGain.disconnect();
            this.muteGainNodes.delete(id);
        }
        const analysers = this.analyserNodes.get(id);
        if(analysers) {
            analysers.splitter.disconnect();
            this.analyserNodes.delete(id);
        }
    }

    // creates a panner node for a channel or mixer track.
    // channels:      inputNode → panner → targetGain
    // mixer tracks:  inputNode → panner → [analyserSplitter] AND [muteGain → targetGain]
    //                analyers tap pre-mute so meters read even when the track is muted.
    addPannerNode(id: string, inputNode: AudioNode, route: number): void {
        const panner = this.audioContext.createStereoPanner();
        inputNode.connect(panner);
        this.pannerNodes.set(id, panner);

        if(this.gainNodes.has(id)) {
            // mixer track: analyser taps from panner, muteGain sits between panner and parent
            this._addAnalysers(id, panner);
            const muteGain = this.audioContext.createGain();
            panner.connect(muteGain);
            const target = this.gainNodes.get(this.resolveTargetId(route));
            if(target) muteGain.connect(target);
            this.muteGainNodes.set(id, muteGain);
        } else {
            // channel: panner connects directly to target gain
            const target = this.gainNodes.get(this.resolveTargetId(route));
            if(target) panner.connect(target);
        }
    }

    // taps a stereo source into a channel splitter → two analysers (L + R)
    private _addAnalysers(id: string, source: AudioNode): void {
        const splitter = this.audioContext.createChannelSplitter(2);
        const left = this.audioContext.createAnalyser();
        const right = this.audioContext.createAnalyser();
        left.fftSize = 256;
        right.fftSize = 256;
        source.connect(splitter);
        splitter.connect(left, 0);
        splitter.connect(right, 1);
        this.analyserNodes.set(id, { left, right, splitter });
    }

    getAnalysers(id: string): { left: AnalyserNode; right: AnalyserNode } | null {
        return this.analyserNodes.get(id) ?? null;
    }

    // moves a node to a different mixer.
    // mixer tracks: reconnects muteGain output (panner/analyser are untouched)
    // channels:     reconnects panner output directly
    rerouteNode(id: string, targetMixerNum: number): void {
        const target = this.gainNodes.get(this.resolveTargetId(targetMixerNum));

        const muteGain = this.muteGainNodes.get(id);
        if(muteGain) {
            muteGain.disconnect();
            if(target) muteGain.connect(target);
            return;
        }

        const panner = this.pannerNodes.get(id);
        if(!panner) return;
        panner.disconnect();
        if(target) panner.connect(target);
    }

    // detaches and removes a node's panner from the graph entirely
    disconnectNode(id: string): void {
        const panner = this.pannerNodes.get(id);
        if(panner) {
            panner.disconnect();
            this.pannerNodes.delete(id);
        }
    }

    // smoothly ramps a gain node to a new value (5ms)
    setGain(id: string, value: number): void {
        const node = this.gainNodes.get(id);
        if(!node) return;
        node.gain.setTargetAtTime(value, this.audioContext.currentTime, RAMP_TIME);
    }

    // smoothly ramps a mute gain node to a target value (use 0 to mute, 1 to unmute)
    setMuteGain(id: string, value: number): void {
        const node = this.muteGainNodes.get(id);
        if(!node) return;
        node.gain.setTargetAtTime(value, this.audioContext.currentTime, RAMP_TIME);
    }

    // immediately silences a mute gain node (click-free 10ms ramp to 0)
    setMuteGainImmediate(id: string, now: number): void {
        const node = this.muteGainNodes.get(id);
        if(!node) return;
        node.gain.cancelScheduledValues(now);
        node.gain.setValueAtTime(node.gain.value, now);
        node.gain.linearRampToValueAtTime(0, now + 0.01);
    }

    // hard-mutes a gain node immediately (cancels scheduled values, ramps to 0 in 10ms)
    setGainImmediate(id: string, now: number): void {
        const node = this.gainNodes.get(id);
        if(!node) return;
        node.gain.cancelScheduledValues(now);
        node.gain.setValueAtTime(node.gain.value, now);
        node.gain.linearRampToValueAtTime(0, now + 0.01);
    }

    // smoothly ramps a panner node's position to a new value (-1 left, 0 center, 1 right)
    setPan(id: string, value: number): void {
        const node = this.pannerNodes.get(id);
        if(!node) return;
        node.pan.setTargetAtTime(value, this.audioContext.currentTime, RAMP_TIME);
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
        for(const node of this.muteGainNodes.values()) node.disconnect();
        this.muteGainNodes.clear();
        for(const { splitter } of this.analyserNodes.values()) splitter.disconnect();
        this.analyserNodes.clear();
    }
}