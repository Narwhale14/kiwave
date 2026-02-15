import { MiniSynth } from "./MiniSynth";
import { AudioGraph } from "./AudioGraph";
import { Scheduler, type SchedulerNote } from "./Scheduler";
import { channelManager } from "./ChannelManager";
import { mixerManager } from "./MixerManager";
import { ArrangementCompiler } from "./ArrangementCompiler";
import { arrangement } from "../audio/Arrangement";
import { GLOBAL_VOLUME_DEFAULT } from "../constants/defaults";

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
        for(const track of mixerManager.getAllMixers()) {
            if(track.id !== 'master') {
                this._audioGraph.addGainNode(track.id, track.route);
            }
        }

        // add default mixers
        if(mixerManager.getAllMixers().length === 1) {
            this._addMixer('Insert 1');
            this._addMixer('Insert 2');
            this._addMixer('Insert 3');
        }

        // wire up existing channels (HMR)
        for(const ch of channelManager.getAllChannels()) {
            this._audioGraph.addPannerNode(ch.id, ch.instrument.getOutputNode(), ch.mixerTrack);
        }

        // add default channel if none exist
        if(channelManager.getAllChannels().length === 0) {
            this.addChannel('minisynth');
        }

        // sync gain nodes with current mute state (HMR)
        this._syncChannelGains();
        this._syncMixerGains();
        this._audioGraph.setGain('global', GLOBAL_VOLUME_DEFAULT);

        // register callbacks — managers update state, engine syncs gains
        channelManager.onMuteStateChanged = () => this._syncChannelGains();
        mixerManager.onMuteStateChanged = () => this._syncMixerGains();

        this._startMeteringLoop();
    }

    private _startMeteringLoop() {
        const buf = this._meterBuf;
        const loop = () => {
            for(const track of mixerManager.getAllMixers()) {
                const analysers = this._audioGraph.getAnalysers(track.id);
                if(!analysers) { track.peakDbL = -Infinity; track.peakDbR = -Infinity; continue; }

                analysers.left.getFloatTimeDomainData(buf);
                let peakL = 0;
                for(let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]!); if(a > peakL) peakL = a; }

                analysers.right.getFloatTimeDomainData(buf);
                let peakR = 0;
                for(let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]!); if(a > peakR) peakR = a; }

                track.peakDbL = peakL > 0 ? 20 * Math.log10(peakL) : -Infinity;
                track.peakDbR = peakR > 0 ? 20 * Math.log10(peakR) : -Infinity;
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
    }

    setChannelPan(channelId: string, pan: number) {
        const channel = channelManager.getChannel(channelId);
        if(!channel) return;
        channel.pan = pan;
        this._audioGraph.setPan(channelId, pan);
    }

    private _syncMixerGains() {
        const now = this._audioContext.currentTime;
        for(const track of mixerManager.getAllMixers()) {
            this._audioGraph.setGain(track.id, track.volume);
            if(track.muted) {
                this._audioGraph.setMuteGainImmediate(track.id, now);
            } else {
                this._audioGraph.setMuteGain(track.id, 1);
            }
        }
    }

    setMixerGain(trackId: string, volume: number) {
        const track = mixerManager.getMixer(trackId);
        if(!track) return;
        track.volume = volume;
        this._audioGraph.setGain(trackId, volume)
    }

    setMixerPan(trackId: string, pan: number) {
        const track = mixerManager.getMixer(trackId);
        if(!track) return;
        track.pan = pan;
        this._audioGraph.setPan(trackId, pan);
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

    private _addMixer(name: string) {
        mixerManager.addMixer(name);
        const tracks = mixerManager.getAllMixers();
        const track = tracks[tracks.length - 1]!;
        this._audioGraph.addGainNode(track.id, track.route);
    }

    removeMixer(mixerId: string) {
        if(mixerId === 'master') return;
        const num = parseInt(mixerId.replace('mixer-', ''), 10);

        // reroute all channels that were using this mixer back to master
        for(const ch of channelManager.getAllChannels()) {
            if(ch.mixerTrack === num) this.setChannelRoute(ch.id, 0);
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