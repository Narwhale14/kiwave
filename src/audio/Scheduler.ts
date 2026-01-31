import { MiniSynth } from './MiniSynth';

export interface SchedulerNote {
    id: string;
    pitch: number;
    startTime: number;
    duration: number;
    velocity: number;
}

export interface SchedulerOptions {
    bpm?: number;
    lookAhead?: number;
    scheduleInterval?: number;
}

type PlayheadCallback = (time: number) => void;
type PlayStateCallback = (playing: boolean) => void;

export class Scheduler {
    private synth: MiniSynth;
    private audioContext: AudioContext;

    // timing
    private _bpm: number;
    private lookAhead: number;
    private scheduleInterval: number;

    // state
    private _isPlaying = false;
    private startTime = 0;
    private pauseTime = 0;
    private schedulerTimerId: number | null = null;

    // notes
    private notes: SchedulerNote[] = [];
    private scheduledNoteOns: Set<string> = new Set();
    private scheduledNotesOffs: Set<string> = new Set();

    private _loopEnabled = false;
    private _loopStart = 0;
    private _loopEnd = 4;

    private playheadCallback: PlayheadCallback | null = null;
    private playStateCallback: PlayStateCallback | null = null;
    private animationFrameId: number | null = null;

    constructor(synth: MiniSynth, options: SchedulerOptions = {}) {
        this.synth = synth;
        this.audioContext = synth.getAudioContext();

        this._bpm = options.bpm ?? 120;
        this.lookAhead = options.lookAhead ?? 0.1; // 100ms
        this.scheduleInterval = options.scheduleInterval ?? 25; // 25ms
    }

    // GETTERS

    get bpm(): number {
        return this._bpm;
    }

    get isPlaying(): boolean {
        return this._isPlaying;
    }

    get loopEnabled(): boolean {
        return this._loopEnabled;
    }

    get loopStart(): number {
        return this._loopStart;
    }

    get loopEnd(): number {
        return this._loopEnd;
    }

    // MATH HELPERS

    private beatsToSeconds(beats: number): number {
        return (beats / this._bpm) * 60;
    }

    private secondsToBeats(seconds: number): number {
        return (seconds / 60) * this._bpm;
    }

    // gets raw beat from start to playhead, no matter if in loop. used for audio scheduling math
    private getRawBeat(): number {
        if(!this.isPlaying) return this.pauseTime;
        const elapsed = this.audioContext.currentTime - this.startTime;
        return this.secondsToBeats(elapsed) + this.pauseTime;
    }

    // gets elapsed beat number, works with loops. used for the visual playhead
    getCurrentBeat(): number {
        const rawBeat = this.getRawBeat();

        if(this._loopEnabled && rawBeat >= this._loopEnd) {
            const loopLength = this._loopEnd - this._loopStart;
            if(loopLength > 0) return this._loopStart + ((rawBeat - this._loopStart) % loopLength);
        }

        return rawBeat
    }

    // converting beat to time so Web Audio know exactly when to play note
    private beatToAudioTime(beat: number): number {
        const beatOffset = beat - this.pauseTime;
        return this.startTime + this.beatsToSeconds(beatOffset);
    }

    // SCHEDULING

    // the lookahead
    private schedulerTick = () => {
        const now = this.audioContext.currentTime;
        const rawBeat = this.getRawBeat();
        const lookAheadBeats = this.secondsToBeats(this.lookAhead);
        const scheduleUntilBeat = rawBeat + lookAheadBeats;

        for(const note of this.notes) {
            if(!this._loopEnabled) {
                // if no looping
                this.scheduleNoteIfInWindow(note, note.startTime, rawBeat, scheduleUntilBeat, now);
                continue;
            }

            // if looping
            const loopLength = this._loopEnd - this._loopStart;
            if(loopLength <= 0) continue;
            if(note.startTime < this._loopStart || note.startTime >= this._loopEnd) continue;

            // logic to schedule ahead into the next iteration as well
            const loopIteration = Math.floor((rawBeat - this._loopStart) / loopLength);
            for(let i = Math.max(0, loopIteration); i <= loopIteration + 1; i++) {
                const iterationOffset = i * loopLength;
                this.scheduleNoteIfInWindow(note, note.startTime + iterationOffset, rawBeat, scheduleUntilBeat, now);
            }
        }

        // periodically cleanup scheduled keys
        if(this.scheduledNoteOns.size > 500) {
            this.cleanupScheduledSets(rawBeat);
        }
    }

    private scheduleNoteIfInWindow(note: SchedulerNote, noteStartBeat: number, currentBeat: number, scheduleUntilBeat: number, now: number) {
        const noteEndBeat = noteStartBeat + note.duration;
        if(noteEndBeat < currentBeat) return;

        const noteOnKey = `${note.id}-on-${noteStartBeat.toFixed(4)}`;
        const noteOffKey = `${note.id}-off-${noteEndBeat.toFixed(4)}`;

        // schedules note on (with small look-behind tolerance)
        const lookBehindTolerance = 0.01; // ~10ms at 120bpm
        if(noteStartBeat >= currentBeat - lookBehindTolerance && noteStartBeat < scheduleUntilBeat && !this.scheduledNoteOns.has(noteOnKey)) {
            const audioTime = this.beatToAudioTime(noteStartBeat);
            if(audioTime >= now) {
                this.synth.triggerAttack(note.id, note.pitch, audioTime, note.velocity);
                this.scheduledNoteOns.add(noteOnKey);
            }
        }

        // schedules note off
        if(noteEndBeat >= currentBeat && noteEndBeat < scheduleUntilBeat && !this.scheduledNotesOffs.has(noteOffKey)) {
            const audioTime = this.beatToAudioTime(noteEndBeat);
            if(audioTime >= now) {
                this.synth.triggerRelease(note.id, audioTime);
                this.scheduledNotesOffs.add(noteOffKey);
            }
        }
    }

    private cleanupScheduledSets(currentBeat: number) {
        const threshold = currentBeat - 2;

        for(const key of this.scheduledNoteOns) {
            const match = key.match(/-on-([\d.-]+)$/);
            if(match && parseFloat(match[1]!) < threshold) {
                this.scheduledNoteOns.delete(key);
            }
        }

        for(const key of this.scheduledNotesOffs) {
            const match = key.match(/-off-([\d.-]+)$/);
            if(match && parseFloat(match[1]!) < threshold) {
                this.scheduledNotesOffs.delete(key);
            }
        }
    }

    // ANIMATION

    private animateTick = () => {
        if(!this._isPlaying) return;

        if(this.playheadCallback) {
            this.playheadCallback(this.getCurrentBeat());
        }

        this.animationFrameId = requestAnimationFrame(this.animateTick);
    };

    // CONTROLS

    async play() {
        if(this._isPlaying) return;

        if(this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }

        this._isPlaying = true;
        this.startTime = this.audioContext.currentTime;
        this.scheduledNoteOns.clear();
        this.scheduledNotesOffs.clear();

        // schedule immediately to catch notes at playhead position
        this.schedulerTick();
        this.schedulerTimerId = window.setInterval(this.schedulerTick, this.scheduleInterval);
        this.animationFrameId = requestAnimationFrame(this.animateTick);
        this.playStateCallback?.(true);
    }

    pause() {
        if(!this._isPlaying) return;

        this._isPlaying = false;
        this.pauseTime = this.getCurrentBeat();

        if(this.schedulerTimerId !== null) {
            clearInterval(this.schedulerTimerId);
            this.schedulerTimerId = null;
        }

        if(this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        this.synth.panic();
        this.playStateCallback?.(false);
    }

    stop() {
        this.pause();
        this.pauseTime = this._loopEnabled ? this._loopStart : 0;

        this.playheadCallback?.(this.pauseTime);
    }

    async toggle() {
        if(this._isPlaying) {
            this.pause();
        } else {
            await this.play();
        }
    }

    // CONFIG

    setNotes(notes: SchedulerNote[]) {
        this.notes = notes;
    }

    setBpm(bpm: number) {
        if(bpm <= 0) return;

        const currentBeat = this.getCurrentBeat();
        this._bpm = bpm;

        if(this._isPlaying) {
            this.pauseTime = currentBeat;
            this.startTime = this.audioContext.currentTime;

            // clear schedule since timing changed
            this.scheduledNoteOns.clear();
            this.scheduledNotesOffs.clear();
        }
    }

    setLoop(enabled: boolean, start?: number, end?: number) {
        this._loopEnabled = enabled;
        if(start !== undefined) this._loopStart = Math.max(0, start);
        if(end !== undefined) this._loopEnd = Math.max(this._loopStart, end);
    }

    seek(beat: number) {
        const wasPlaying = this._isPlaying;

        if(wasPlaying) {
            this.pause();
        }

        this.pauseTime = Math.max(0, beat);
        this.scheduledNoteOns.clear();
        this.scheduledNotesOffs.clear();

        this.playheadCallback?.(this.pauseTime);

        if(wasPlaying) {
            this.play();
        }
    }

    // CALLBACKS

    onPlayhead(callback: PlayheadCallback) {
        this.playheadCallback = callback;
    }

    onPlayStateChange(callback: PlayStateCallback) {
        this.playStateCallback = callback;
    }

    // CLEANUP

    dispose() {
        this.stop();
        this.playheadCallback = null;
        this.playStateCallback = null;
        this.notes = [];
    }
}