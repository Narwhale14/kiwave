import { MiniSynth } from "./MiniSynth";
import { Scheduler, type SchedulerNote } from "./Scheduler";
import { channelManager } from "./channelManager";
import { mixerManager } from "./mixerManager";

/**
 * audio engine object to manage synths and schedule and compile
 */
export class AudioEngine {
    private _synth = new MiniSynth();
    private _scheduler = new Scheduler(this._synth, { bpm: 120 });

    get synth(): MiniSynth {
        return this._synth;
    }

    get scheduler(): Scheduler {
        return this._scheduler;
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
    seek(beat: number) { this.scheduler.seek(beat); }

    setBpm(bpm: number) { this.scheduler.setBpm(bpm); }
    setNotes(notes: SchedulerNote[]) { this.scheduler.setNotes(notes); }

    dispose() {
        this.scheduler.dispose();
        this.synth.dispose();
    }
}