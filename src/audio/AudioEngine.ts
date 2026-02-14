import { MiniSynth } from "./MiniSynth";
import { AudioGraph } from "./AudioGraph";
import { Scheduler, type SchedulerNote } from "./Scheduler";
import { channelManager } from "./channelManager";
import { mixerManager } from "./mixerManager";
import { ArrangementCompiler } from "./ArrangementCompiler";
import { arrangement } from "../audio/Arrangement";

export interface SynthEntry {
    id: string;
    displayName: string;
    factory: (ctx: AudioContext) => MiniSynth;
}

/**
 * Audio engine — owns the AudioContext and AudioGraph, coordinates
 * all channel/mixer creation, routing, and mute/solo state.
 */
export class AudioEngine {
    private _audioContext = new AudioContext(); // context
    private _audioGraph = new AudioGraph(this._audioContext); // total graph of nodes via routing

    // registered synths + bookkeeping
    private _synths: SynthEntry[] = [];
    private _channelSynths: Map<string, { synthId: string; num: number }> = new Map(); // channelId -> { synthId, num }

    private _scheduler = new Scheduler(this._audioContext, channelManager, { bpm: 120 });
    private _compiler = new ArrangementCompiler(arrangement);

    constructor() {
        this._synths = [
            { id: 'minisynth', displayName: 'MiniSynth', factory: (ctx) => new MiniSynth(ctx) },
        ];

        // adds a gain node for each mixer track
        for(const track of mixerManager.getAllMixers()) {
            if(track.id !== 'master') {
                this._audioGraph.addNode(track.id, track.route);
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
            this._audioGraph.connectChannel(ch.instrument.getOutputNode(), ch.mixerTrack);
        }

        // add default channel if none exist
        if(channelManager.getAllChannels().length === 0) {
            this.addChannel('minisynth');
        }

        // sync gain nodes with current mute state (HMR)
        this._syncChannelGains();
        this._syncMixerGains();

        // register callbacks — managers update state, engine syncs gains
        channelManager.onMuteStateChanged = () => this._syncChannelGains();
        mixerManager.onMuteStateChanged = () => this._syncMixerGains();
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

    private _syncMixerGains() {
        const now = this._audioContext.currentTime;
        for(const track of mixerManager.getAllMixers()) {
            if(track.muted) {
                this._audioGraph.setGainImmediate(track.id, now);
            } else {
                this._audioGraph.setGain(track.id, track.volume);
            }
        }
    }

    setMixerGain(trackId: string, volume: number) {
        const track = mixerManager.getMixer(trackId);
        if(!track) return;
        track.volume = volume;
        this._audioGraph.setGain(trackId, volume)
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
        this._audioGraph.connectChannel(instrument.getOutputNode(), 0);
    }

    removeChannel(channelId: string) {
        const channel = channelManager.getChannel(channelId);
        if(channel) {
            this._audioGraph.disconnectChannel(channel.instrument.getOutputNode());
            channel.instrument.dispose();
        }
        this._channelSynths.delete(channelId);
        channelManager.removeChannel(channelId);
    }

    // sets a channel's mixer routing in both audio graph and data model
    setChannelRoute(channelId: string, mixerTrack: number) {
        const channel = channelManager.getChannel(channelId);
        if(!channel) return;

        this._audioGraph.rerouteChannel(channel.instrument.getOutputNode(), mixerTrack);
        channelManager.setMixerRoute(channelId, mixerTrack);
    }

    toggleChannelMute(id: string) { channelManager.toggleMute(id); }
    toggleChannelSolo(id: string) { channelManager.toggleSolo(id); }

    // MIXER MANAGEMENT

    private _addMixer(name: string) {
        mixerManager.addMixer(name);
        const tracks = mixerManager.getAllMixers();
        const track = tracks[tracks.length - 1]!;
        this._audioGraph.addNode(track.id, track.route);
    }

    removeMixer(mixerId: string) {
        if(mixerId === 'master') return;
        const num = parseInt(mixerId.replace('mixer-', ''), 10);

        // reroute all channels that were using this mixer back to master
        for(const ch of channelManager.getAllChannels()) {
            if (ch.mixerTrack === num) this.setChannelRoute(ch.id, 0);
        }

        this._audioGraph.removeNode(mixerId);
        mixerManager.removeMixer(mixerId);
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
    setMasterVolume(gain: number) { this._audioGraph.setGain('master', gain); }

    dispose() {
        this.scheduler.dispose();
        this._audioGraph.dispose();
        this._audioContext.close();
    }
}
