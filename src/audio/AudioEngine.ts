import { MiniSynth } from "./MiniSynth";
import { AudioGraph } from "./AudioGraph";
import { Scheduler, type SchedulerNote } from "./Scheduler";
import { channelManager } from "./ChannelManager";
import { mixerManager } from "./MixerManager";
import { ArrangementCompiler } from "./ArrangementCompiler";
import { arrangement } from "../audio/Arrangement";
import { globalVolume } from "../services/settingsManager";
import { markDirty } from '../util/dirty';

export interface SynthEntry {
    id: string;
    displayName: string;
    factory: (ctx: AudioContext) => MiniSynth;
}

/**
 * audio engine — owns the AudioContext and AudioGraph, coordinates
 * all channel/mixer creation, routing, and mute/solo state.
 */
export class AudioEngine {
    private _audioContext = new AudioContext(); // context
    private _audioGraph = new AudioGraph(this._audioContext); // total graph of nodes via routing

    // registered synths + bookkeeping
    private _synths: SynthEntry[] = [];
    private _channelSynths: Map<string, { synthId: string; num: number }> = new Map(); // channelId -> { synthId, num }
    private _meterAnimFrame: number | null = null;
    private _meterBuf = new Float32Array(256);

    private _scheduler = new Scheduler(this._audioContext, channelManager, { bpm: 120 });
    private _compiler = new ArrangementCompiler(arrangement);

    constructor() {
        this._synths = [
            { id: 'minisynth', displayName: 'MiniSynth', factory: (ctx) => new MiniSynth(ctx) },
        ];

        // adds a gain node for each mixer track
        for(const mixer of mixerManager.getAllMixers()) {
            if(mixer.id !== 'master') {
                this._audioGraph.addGainNode(mixer.id, mixer.route);
            }
        }

        // wire up existing channels (HMR)
        for(const channel of channelManager.getAllChannels()) {
            this._audioGraph.addPannerNode(channel.id, channel.instrument.getOutputNode(), channel.mixerTrack);
        }

        // add default channel if none exist
        if(channelManager.getAllChannels().length === 0) {
            this.addChannel('minisynth');
        }

        if(mixerManager.getAllMixers().length === 1) {
            this.addMixer('Insert 1');
            this.addMixer('Insert 2');
            this.addMixer('Insert 3');
        }

        // sync gain nodes with current mute state (HMR)
        this._syncChannelGains();
        this._syncMixerGains();
        this._audioGraph.setGain('global', globalVolume.value);

        // register callbacks — managers update state, engine syncs gains
        channelManager.onMuteStateChanged = () => this._syncChannelGains();
        mixerManager.onMuteStateChanged = () => this._syncMixerGains();

        this._startMeteringLoop();
    }

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

    // GAIN SYNC

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

    setChannelGain(channelId: string, volume: number) {
        const channel = channelManager.getChannel(channelId);
        if(!channel) return;

        channel.volume = volume;
        const node = channel.instrument.getOutputNode();
        node.gain.setTargetAtTime(volume, this._audioContext.currentTime, 0.005);
        markDirty();
    }

    setChannelPan(channelId: string, pan: number) {
        const channel = channelManager.getChannel(channelId);
        if(!channel) return;
        channel.pan = pan;
        this._audioGraph.setPan(channelId, pan);
        markDirty();
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

    setMixerGain(mixerId: string, volume: number) {
        const mixer = mixerManager.getMixer(mixerId);
        if(!mixer) return;
        mixer.volume = volume;
        this._audioGraph.setGain(mixerId, volume);
        markDirty();
    }

    setMixerPan(mixerId: string, pan: number) {
        const mixer = mixerManager.getMixer(mixerId);
        if(!mixer) return;
        mixer.pan = pan;
        this._audioGraph.setPan(mixerId, pan);
        markDirty();
    }

    // GETTERS

    get availableSynths(): { id: string; displayName: string }[] {
        return this._synths.map(({ id, displayName }) => ({ id, displayName }));
    }

    get scheduler(): Scheduler {
        return this._scheduler;
    }

    get compiler(): ArrangementCompiler {
        return this._compiler;
    }

    get channelManager() {
        return channelManager;
    }

    get mixerManager() {
        return mixerManager;
    }

    get channelSynths(): ReadonlyMap<string, { synthId: string; num: number }> {
        return this._channelSynths;
    }

    // LOAD HELPERS

    // dispose all current channels + mixers so state can be restored from a save file
    // should be called before loading save
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

    // restore single channel. call resetForLoad, then restore idCounters, then call this per channel
    loadChannel(saved: { id: string; name: string; synthId: string; synthNum: number; mixerTrack: number; volume: number; pan: number; muted: boolean; solo: boolean }) {
        const entry = this._synths.find(s => s.id === saved.synthId);
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

    // call after resetForLoad and before restoring channels
    loadMixer(saved: { id: string; name: string; route: number; volume: number; pan: number; muted: boolean; solo: boolean }) {
        mixerManager.addMixerWithId(saved.id, saved.name, saved.route);
        this._audioGraph.addGainNode(saved.id, saved.route);

        const mixer = mixerManager.getMixer(saved.id)!;
        mixer.volume = saved.volume;
        mixer.pan = saved.pan;
        mixer.muted = saved.muted;
        mixer.solo = saved.solo;
    }

    // CHANNEL MANAGEMENT

    addChannel(synthId: string) {
        const entry = this._synths.find(s => s.id === synthId);
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
        this._channelSynths.set(channelId, { synthId, num }); // store in bookkeeping

        // default connect to master
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

    // sets a channel's mixer routing in both audio graph and data model
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

        // reroute all channels that were using this mixer back to master
        for(const channel of channelManager.getAllChannels()) {
            if(channel.mixerTrack === num) this.setChannelRoute(channel.id, 0);
        }

        this._audioGraph.removeGainNode(mixerId);
        mixerManager.removeMixer(mixerId);
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

    toggleMixerMute(id: string) { mixerManager.toggleMute(id); }
    toggleMixerSolo(id: string) { mixerManager.toggleSolo(id); }

    // PLAYBACK

    play() { return this.scheduler.play(); }
    pause() { return this.scheduler.pause(); }
    stop() { return this.scheduler.stop(); }
    toggle() { return this.scheduler.toggle(); }
    seek(beat: number) { this.scheduler.seek(beat); }

    setBpm(bpm: number) { this.scheduler.setBpm(bpm); }
    setNotes(notes: SchedulerNote[]) { this.scheduler.setNotes(notes); }
    setGlobalVolume(gain: number) { this._audioGraph.setGain('global', gain); }

    dispose() {
        if(this._meterAnimFrame !== null) cancelAnimationFrame(this._meterAnimFrame);
        this.scheduler.dispose();
        this._audioGraph.dispose();
        this._audioContext.close();
    }
}