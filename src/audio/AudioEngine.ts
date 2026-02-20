import { AudioGraph } from "./AudioGraph";
import { Scheduler, type SchedulerNote } from "./Scheduler";
import { channelManager } from "./ChannelManager";
import { mixerManager } from "./MixerManager";
import { ArrangementCompiler } from "./ArrangementCompiler";
import { arrangement } from "../audio/Arrangement";
import { globalVolume } from "../services/settingsManager";
import type { BaseSynth, SynthEntry } from "./synths";

export class AudioEngine {
    private _audioContext = new AudioContext();
    private _audioGraph = new AudioGraph(this._audioContext);

    private _registry = new Map<string, SynthEntry>()
    private _channelSynths: Map<string, { synthId: string; num: number }> = new Map();

    private _meterAnimFrame: number | null = null;
    private _meterBuf = new Float32Array(256);

    private _scheduler = new Scheduler(this._audioContext, channelManager, { bpm: 120 });
    private _compiler = new ArrangementCompiler(arrangement);

    constructor(initialSynths: SynthEntry[]) {
        initialSynths.forEach(entry => this.registerSynth(entry));
        this._initGraph();

        if(channelManager.getAllChannels().length === 0) {
            this.addChannel('minisynth');
        }

        if(mixerManager.getAllMixers().length === 1) {
            this.addMixer('Insert 1');
            this.addMixer('Insert 2');
            this.addMixer('Insert 3');
        }

        this._syncChannelGains();
        this._syncMixerGains();
        this._audioGraph.setGain('global', globalVolume.value);

        channelManager.onMuteStateChanged = () => this._syncChannelGains();
        mixerManager.onMuteStateChanged = () => this._syncMixerGains();

        this._startMeteringLoop();
    }

    private _initGraph() {
        for(const mixer of mixerManager.getAllMixers()) {
            if(mixer.id !== 'master') {
                this._audioGraph.addGainNode(mixer.id, mixer.route);
            }
        }

        for(const channel of channelManager.getAllChannels()) {
            this._audioGraph.addPannerNode(channel.id, channel.instrument.getOutputNode(), channel.mixerTrack);
        }
    }

    // SYNTH REGISTRY

    registerSynth(entry: SynthEntry) {
        if(this._registry.has(entry.id)) {
            throw new Error(`Synth already registered: ${entry.id}`);
        }

        this._registry.set(entry.id, entry);
    }

    getAvailableSynths(): SynthEntry[] {
        return [...this._registry.values()];
    }

    createSynth(id: string): BaseSynth {
        const entry = this._registry.get(id);
        if(!entry) throw new Error(`Unknown synth: ${id}`);
        return entry.factory(this._audioContext);
    }

    // CHANNEL MANAGEMENT

    addChannel(synthId: string) {
        const entry = this._registry.get(synthId);
        if(!entry) return;

        const used = new Set(
            [...this._channelSynths.values()]
                .filter(v => v.synthId === synthId)
                .map(v => v.num)
        );

        let num = 1;
        while(used.has(num)) num++;

        const instrument = entry.factory(this._audioContext);
        const channelId = channelManager.addChannel(instrument, `${entry.displayName} ${num}`);
        this._channelSynths.set(channelId, { synthId, num });

        this._audioGraph.addPannerNode(channelId, instrument.getOutputNode(), 0);
    }

    removeChannel(channelId: string) {
        const channel = channelManager.getChannel(channelId);
        if(channel) {
            this._audioGraph.disconnectNode(channelId);
            channel.instrument.dispose();
        }
        this._channelSynths.delete(channelId);
        channelManager.removeChannel(channelId);
    }

    setChannelGain(channelId: string, volume: number) {
        const channel = channelManager.getChannel(channelId);
        if(!channel) return;

        channel.volume = volume;
        const node = channel.instrument.getOutputNode();
        node.gain.setTargetAtTime(volume, this._audioContext.currentTime, 0.005);
    }

    setChannelPan(channelId: string, pan: number) {
        const channel = channelManager.getChannel(channelId);
        if(!channel) return;
        channel.pan = pan;
        this._audioGraph.setPan(channelId, pan);
    }

    setChannelRoute(channelId: string, mixerTrack: number) {
        const channel = channelManager.getChannel(channelId);
        if(!channel) return;

        this._audioGraph.rerouteNode(channelId, mixerTrack);
        channelManager.setMixerRoute(channelId, mixerTrack);
    }

    toggleChannelMute(id: string) { channelManager.toggleMute(id); }
    toggleChannelSolo(id: string) { channelManager.toggleSolo(id); }

    // MIXER MANAGEMENT

    addMixer(name?: string) {
        mixerManager.addMixer(name);
        const mixers = mixerManager.getAllMixers();
        const mixer = mixers[mixers.length - 1]!;
        this._audioGraph.addGainNode(mixer.id, mixer.route);
    }

    removeMixer(mixerId: string) {
        if(mixerId === 'master') return;
        const num = parseInt(mixerId.replace('mixer-', ''), 10);

        for(const channel of channelManager.getAllChannels()) {
            if(channel.mixerTrack === num) this.setChannelRoute(channel.id, 0);
        }

        this._audioGraph.removeGainNode(mixerId);
        mixerManager.removeMixer(mixerId);
    }

    setMixerGain(mixerId: string, volume: number) {
        const mixer = mixerManager.getMixer(mixerId);
        if(!mixer) return;
        mixer.volume = volume;
        this._audioGraph.setGain(mixerId, volume);
    }

    setMixerPan(mixerId: string, pan: number) {
        const mixer = mixerManager.getMixer(mixerId);
        if(!mixer) return;
        mixer.pan = pan;
        this._audioGraph.setPan(mixerId, pan);
    }

    setMixerRoute(mixerId: string, targetMixerNum: number) {
        if(mixerId === 'master') return;
        const mixer = mixerManager.getMixer(mixerId);
        if(!mixer) return;
        const selfNum = parseInt(mixerId.replace('mixer-', ''), 10);
        if(selfNum === targetMixerNum) return;

        this._audioGraph.rerouteNode(mixerId, targetMixerNum);
        mixerManager.setRoute(mixerId, targetMixerNum);
    }

    // LOAD/SAVE HELPERS

    resetForLoad() {
        for(const channel of channelManager.getAllChannels()) {
            this._audioGraph.disconnectNode(channel.id);
            channel.instrument.dispose();
        }
        this._channelSynths.clear();
        channelManager.clearAllChannels();

        mixerManager.getAllMixers()
            .filter(m => m.id !== 'master')
            .forEach(m => {
                this._audioGraph.removeGainNode(m.id);
            });
        mixerManager.clearMixers();
    }

    loadChannel(saved: { id: string; name: string; synthId: string; synthNum: number; mixerTrack: number; volume: number; pan: number; muted: boolean; solo: boolean }) {
        const entry = this._registry.get(saved.synthId);
        if(!entry) return;

        const instrument = entry.factory(this._audioContext);
        channelManager.addChannelWithId(instrument, saved.id, saved.name);
        this._channelSynths.set(saved.id, { synthId: saved.synthId, num: saved.synthNum });
        this._audioGraph.addPannerNode(saved.id, instrument.getOutputNode(), saved.mixerTrack);

        const channel = channelManager.getChannel(saved.id)!;
        channel.mixerTrack = saved.mixerTrack;
        channel.volume = saved.volume;
        channel.pan = saved.pan;
        channel.muted = saved.muted;
        channel.solo = saved.solo;
        this._audioGraph.setPan(saved.id, saved.pan);
    }

    loadMixer(saved: { id: string; name: string; route: number; volume: number; pan: number; muted: boolean; solo: boolean }) {
        mixerManager.addMixerWithId(saved.id, saved.name, saved.route);
        this._audioGraph.addGainNode(saved.id, saved.route);

        const mixer = mixerManager.getMixer(saved.id)!;
        mixer.volume = saved.volume;
        mixer.pan = saved.pan;
        mixer.muted = saved.muted;
        mixer.solo = saved.solo;
    }

    toggleMixerMute(id: string) { mixerManager.toggleMute(id); }
    toggleMixerSolo(id: string) { mixerManager.toggleSolo(id); }

    // GAIN CONTROL

    private _syncChannelGains() {
        const now = this._audioContext.currentTime;
        for(const channel of channelManager.getAllChannels()) {
            const node = channel.instrument.getOutputNode();
            if(channel.muted) {
                node.gain.cancelScheduledValues(now);
                node.gain.setValueAtTime(node.gain.value, now);
                node.gain.linearRampToValueAtTime(0, now + 0.01);
            } else {
                node.gain.setTargetAtTime(channel.volume, now, 0.005);
            }
        }
    }

    private _syncMixerGains() {
        const now = this._audioContext.currentTime;
        for(const mixer of mixerManager.getAllMixers()) {
            this._audioGraph.setGain(mixer.id, mixer.volume);
            if(mixer.muted) {
                this._audioGraph.setMuteGainImmediate(mixer.id, now);
            } else {
                this._audioGraph.setMuteGain(mixer.id, 1);
            }
        }
    }

    setBpm(bpm: number) { this.scheduler.setBpm(bpm); }
    setNotes(notes: SchedulerNote[]) { this.scheduler.setNotes(notes); }
    setGlobalVolume(gain: number) { this._audioGraph.setGain('global', gain); }

    // METERING

    private _startMeteringLoop() {
        const buf = this._meterBuf;
        const loop = () => {
            for(const mixer of mixerManager.getAllMixers()) {
                const analysers = this._audioGraph.getAnalysers(mixer.id);
                if(!analysers) { mixer.peakDbL = -Infinity; mixer.peakDbR = -Infinity; continue; }

                analysers.left.getFloatTimeDomainData(buf);
                let peakL = 0;
                for(let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]!); if(a > peakL) peakL = a; }

                analysers.right.getFloatTimeDomainData(buf);
                let peakR = 0;
                for(let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]!); if(a > peakR) peakR = a; }

                mixer.peakDbL = peakL > 0 ? 20 * Math.log10(peakL) : -Infinity;
                mixer.peakDbR = peakR > 0 ? 20 * Math.log10(peakR) : -Infinity;
            }
            this._meterAnimFrame = requestAnimationFrame(loop);
        };
        this._meterAnimFrame = requestAnimationFrame(loop);
    }

    // DISPOSE

    dispose() {
        if(this._meterAnimFrame !== null) cancelAnimationFrame(this._meterAnimFrame);
        this.scheduler.dispose();
        this._audioGraph.dispose();
        this._audioContext.close();
    }

    // GETTERS

    get scheduler(): Scheduler { return this._scheduler; }
    get compiler(): ArrangementCompiler { return this._compiler; }
    get channelManager() { return channelManager; }
    get mixerManager() { return mixerManager; }
    get channelSynths(): ReadonlyMap<string, { synthId: string; num: number }> { return this._channelSynths; }
}