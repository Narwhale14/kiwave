import { MiniSynth } from "./MiniSynth";
import { Scheduler, type SchedulerNote } from "./Scheduler";

export class AudioEngine {
    private _synth = new MiniSynth;
    private _scheduler = new Scheduler(this._synth, { bpm: 120 });

    get synth(): MiniSynth {
        return this._synth;
    }

    get scheduler(): Scheduler {
        return this._scheduler;
    }

    play() { return this.scheduler.play() };
    pause() { return this.scheduler.pause() };
    stop() { return this.scheduler.stop() };
    seek(beat: number) { this.scheduler.seek(beat) };

    setNote(notes: SchedulerNote[]) {
        this.scheduler.setNotes(notes);
    }
}