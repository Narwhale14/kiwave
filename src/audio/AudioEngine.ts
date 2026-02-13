import { MiniSynth } from "./MiniSynth";
import { Scheduler, type SchedulerNote } from "./Scheduler";
import { channelManager } from "./channelManager";
import { mixerManager } from "./mixerManager";
import { ArrangementCompiler } from "./ArrangementCompiler";
import { arrangement } from "../services/arrangementManager";

export interface SynthEntry {
    id: string;
    displayName: string;
    instance: MiniSynth;
}

/**
 * audio engine object to manage synths and schedule and compile
 */
export class AudioEngine {
    private _synth = new MiniSynth();
    private _synths: SynthEntry[] = [];
    private _synthChannels: Map<string, Map<string, number>> = new Map(); // synthId -> (channelId -> num)
    private _scheduler = new Scheduler(this._synth, channelManager, { bpm: 120 });
    private _compiler = new ArrangementCompiler(arrangement);

    constructor() {
        this._synths = [
            { id: 'minisynth', displayName: 'MiniSynth', instance: this._synth },
        ];

        // for preventing HMR duplication
        if(channelManager.getAllChannels().length === 0) {
            this.addChannel('minisynth');
        }

        if(mixerManager.getMixers().length === 1) { // only master exists
            mixerManager.addMixer('Insert 1');
            mixerManager.addMixer('Insert 2');
            mixerManager.addMixer('Insert 3');
        }
    }

    get availableSynths(): { id: string; displayName: string }[] {
        return this._synths.map(({ id, displayName }) => ({ id, displayName }));
    }

    addChannel(synthId: string) {
        const entry = this._synths.find(s => s.id === synthId);
        if (!entry) return;
        if (!this._synthChannels.has(synthId)) this._synthChannels.set(synthId, new Map());
        const channelNums = this._synthChannels.get(synthId)!;
        const used = new Set(channelNums.values());
        let num = 1;
        while (used.has(num)) num++;
        channelManager.addChannel(entry.instance, `${entry.displayName} ${num}`);
        channelNums.set(channelManager.getLatestChannelId()!, num);
    }

    removeChannel(channelId: string) {
        for (const channelNums of this._synthChannels.values()) {
            if (channelNums.has(channelId)) {
                channelNums.delete(channelId);
                break;
            }
        }
        channelManager.removeChannel(channelId);
    }

    get synth(): MiniSynth {
        return this._synth;
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

    play() { return this.scheduler.play(); }
    pause() { return this.scheduler.pause(); }
    stop() { return this.scheduler.stop(); }
    toggle() { return this.scheduler.toggle(); }
    seek(beat: number) { this.scheduler.seek(beat); }

    setBpm(bpm: number) { this.scheduler.setBpm(bpm); }
    setNotes(notes: SchedulerNote[]) { this.scheduler.setNotes(notes); }

    dispose() {
        this.scheduler.dispose();
        this.synth.dispose();
    }
}