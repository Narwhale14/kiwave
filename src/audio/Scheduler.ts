import { PARAMETER_MAP } from './Automation';
import { deriveSegments, type AutomationCurve, type CompiledNoteAutomation } from './Automation';
import type { ChannelManager } from './ChannelManager';
import { markDirty } from '../util/dirty';

/**
 * interface used to convert note data to a type the scheduler can read
 */
export interface SchedulerNote {
    id: string;
    pitch: number;
    startTime: number;
    duration: number;
    velocity: number;
    channel: string;
    automation: Map<string, AutomationCurve>; // may be empty
}

/**
 * interface used to init the scheduler
 */
export interface SchedulerOptions {
    bpm?: number;
    lookAhead?: number;
    scheduleInterval?: number;
}

type PlayheadCallback = (time: number) => void;
type PlayStateCallback = (playing: boolean) => void;

/**
 * scheduler object - schedules notes with a playhead
 */
export class Scheduler {
    private audioContext: AudioContext;
    private channelManager: ChannelManager;

    // timing
    private _bpm: number;
    private lookAhead: number;
    private scheduleInterval: number;

    // state
    private _isPlaying = false;
    private _pauseTime = 0;
    private _lastSeekPosition = 0;
    private startTime = 0;
    private playheadPos = 0;
    private schedulerTimerId: number | null = null;

    // notes
    private notes: SchedulerNote[] = [];
    private scheduledNoteOns: Set<string> = new Set();
    private scheduledNoteOffs: Set<string> = new Set();

    private _loopEnabled = false;
    private _loopStart = 0;
    private _loopEnd = 4;

    private playheadCallback: PlayheadCallback | null = null;
    private playStateCallback: PlayStateCallback | null = null;
    private animationFrameId: number | null = null;

    constructor(
        audioContext: AudioContext,
        channelManager: ChannelManager,
        options: SchedulerOptions = {}
    ) {
        this.audioContext = audioContext;
        this.channelManager = channelManager;

        this._bpm = options.bpm ?? 120;
        this.lookAhead = options.lookAhead ?? 0.1; // 100ms
        this.scheduleInterval = options.scheduleInterval ?? 25; // 25ms

    }

    // GETTERS

    get bpm(): number { return this._bpm; }
    get isPlaying(): boolean { return this._isPlaying; }
    get loopEnabled(): boolean { return this._loopEnabled; }
    get loopStart(): number { return this._loopStart; }
    get loopEnd(): number { return this._loopEnd; }
    get pauseTime(): number { return this._pauseTime; }


    // HELPERS

    private _beatsToSeconds(beats: number): number {
        return (beats / this._bpm) * 60;
    }

    private _secondsToBeats(seconds: number): number {
        return (seconds / 60) * this._bpm;
    }

    private _beatToAudioTime(beat: number): number {
        const beatOffset = beat - this.pauseTime;
        return this.startTime + this._beatsToSeconds(beatOffset);
    }

    private _getRawBeat(): number {
        if(!this.isPlaying) return this.pauseTime;
        const elapsed = this.audioContext.currentTime - this.startTime;
        return this._secondsToBeats(elapsed) + this.pauseTime;
    }

    getCurrentBeat(): number {
        const rawBeat = this._getRawBeat();

        if(this._loopEnabled && rawBeat >= this.loopEnd) {
            const loopLength = this.loopEnd - this._loopStart;
            if(loopLength > 0) return this._loopStart + ((rawBeat - this._loopStart) % loopLength);
        }

        return rawBeat
    }

    getRelativeBeat(): number {
        return this.getCurrentBeat() - this.playheadPos;
    }

    // SCHEDULING

    private panicAll() {
        for(const channel of this.channelManager.getAllChannels()) {
            channel.instrument.panic();
        }
    }

    addNote(note: SchedulerNote) {
        this.notes.push(note);
    }

    removeNote(id: string) {
        const index = this.notes.findIndex(n => n.id === id);
        if(index !== -1) {
            const note = this.notes[index]!;
            const ch = this.channelManager.getChannel(note.channel);
            this.notes.splice(index, 1);
            ch?.instrument.triggerRelease(id, this.audioContext.currentTime);
        }
    }

    updateNote(id: string, updates: Partial<SchedulerNote>) {
        const note = this.notes.find(n => n.id === id);
        if(note) {
            Object.assign(note, updates);
        }
    }

    private _schedulerTick = () => {
        const now = this.audioContext.currentTime;
        const rawBeat = this._getRawBeat();
        const lookAheadBeats = this._secondsToBeats(this.lookAhead);
        const scheduleUntilBeat = rawBeat + lookAheadBeats;

        for(const note of this.notes) {
            if(!this._loopEnabled) {
                this.scheduleNoteIfInWindow(note, note.startTime, rawBeat, scheduleUntilBeat, now);
                continue;
            }

            const loopLength = this.loopEnd - this._loopStart;
            if(loopLength <= 0) continue;
            if(note.startTime < this._loopStart || note.startTime >= this.loopEnd) continue;

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

    private compileNoteAutomation(automation: Map<string, AutomationCurve>, noteMidi: number, noteStartAudioTime: number, bpm: number): CompiledNoteAutomation {
        const result: CompiledNoteAutomation = new Map();
        if(!automation.size) return result;

        for(const [parameterId, curve] of automation) {
            const def = PARAMETER_MAP.get(parameterId);
            if(!def) continue;

            const segments = deriveSegments(curve.nodes);
            const compiled = def.compile(segments, noteMidi, noteStartAudioTime, bpm);

            for(const [paramName, events] of Object.entries(compiled)) {
                if(!result.has(paramName)) result.set(paramName, []);
                result.get(paramName)!.push(...events);
            }
        }

        return result;
    }

    private scheduleNoteIfInWindow(note: SchedulerNote, noteStartBeat: number, currentBeat: number, scheduleUntilBeat: number, now: number) {
        const noteEndBeat = noteStartBeat + note.duration;
        if(noteEndBeat < currentBeat) return;

        const noteOnKey = `${note.id}-on-${noteStartBeat.toFixed(4)}`;
        const noteOffKey = `${note.id}-off-${noteEndBeat.toFixed(4)}`;

        const lookBehindTolerance = 0.05;

        const channel = this.channelManager.getChannel(note.channel);
        if(!channel) return;

        // schedule note on
        if(!this.scheduledNoteOns.has(noteOnKey)) {
            if(noteStartBeat >= currentBeat - lookBehindTolerance && noteStartBeat < scheduleUntilBeat) {
                const scheduleTime = Math.max(now, this._beatToAudioTime(noteStartBeat));
                const compiled = this.compileNoteAutomation(note.automation, note.pitch, scheduleTime, this._bpm);
                channel.instrument.triggerAttack(note.id, note.pitch, scheduleTime, note.velocity, compiled);
                this.scheduledNoteOns.add(noteOnKey);
            } else if(noteStartBeat < currentBeat) {
                // mid-note case: playhead is inside the note
                const compiled = this.compileNoteAutomation(note.automation, note.pitch, now, this._bpm);
                channel.instrument.triggerAttack(note.id, note.pitch, now, note.velocity, compiled);
                this.scheduledNoteOns.add(noteOnKey);
            }
        }

        // schedule note off
        if(noteEndBeat >= currentBeat && noteEndBeat < scheduleUntilBeat && !this.scheduledNoteOffs.has(noteOffKey)) {
            const scheduleTime = Math.max(now, this._beatToAudioTime(noteEndBeat));
            channel.instrument.triggerRelease(note.id, scheduleTime);
            this.scheduledNoteOffs.add(noteOffKey);
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

        for(const key of this.scheduledNoteOffs) {
            const match = key.match(/-off-([\d.-]+)$/);
            if(match && parseFloat(match[1]!) < threshold) {
                this.scheduledNoteOffs.delete(key);
            }
        }
    }

    // ANIMATION

    private animateTick = () => {
        if(!this._isPlaying) return;

        const currentBeat = this.getCurrentBeat();
        if(this.playheadCallback) {
            this.playheadCallback(currentBeat);
        }

        this.animationFrameId = requestAnimationFrame(this.animateTick);
    };

    // CONFIG

    setNotes(notes: SchedulerNote[]) {
        this.notes = notes;
    }

    resetSchedule() {
        this.scheduledNoteOns.clear();
        this.scheduledNoteOffs.clear();
        if (this._isPlaying) {
            this.panicAll();
            this._schedulerTick();
        }
    }

    setBpm(bpm: number) {
        if(bpm <= 0) return;

        const currentBeat = this.getCurrentBeat();
        this._bpm = bpm;

        if(this._isPlaying) {
            this._pauseTime = currentBeat;
            this.startTime = this.audioContext.currentTime;

            this.scheduledNoteOns.clear();
            this.scheduledNoteOffs.clear();
        }

        markDirty();
    }

    setLoop(enabled: boolean, start?: number, end?: number) {
        const wasPlaying = this._isPlaying;
        const currentBeat = this.getCurrentBeat();

        this._loopEnabled = enabled;
        if(start !== undefined) this._loopStart = Math.max(0, start);
        if(end !== undefined) this._loopEnd = Math.max(this._loopStart, end);

        if(wasPlaying && this._loopEnabled) {
            if(currentBeat >= this.loopEnd || currentBeat < this._loopStart) {
                this.startTime = this.audioContext.currentTime;
                this._pauseTime = this.loopStart;

                this.panicAll();
                this.scheduledNoteOns.clear();
                this.scheduledNoteOffs.clear();

                if(this.playheadCallback) this.playheadCallback(this.loopStart);
                this._schedulerTick();
            } else {
                this.startTime = this.audioContext.currentTime;
                this._pauseTime = currentBeat;
            }
        }

        markDirty();
    }

    // CONTROLS

    async play() {
        if(this._isPlaying) return;

        if(this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }

        this._isPlaying = true;
        this.playheadPos = this.pauseTime; // starting pos
        this.startTime = this.audioContext.currentTime;
        this.scheduledNoteOns.clear();
        this.scheduledNoteOffs.clear();

        if(this.playheadCallback) {
            this.playheadCallback(this.playheadPos);
        }

        this._schedulerTick();
        this.schedulerTimerId = window.setInterval(this._schedulerTick, this.scheduleInterval);
        this.animationFrameId = requestAnimationFrame(this.animateTick);
        if(this.playStateCallback) {
            this.playStateCallback(true);
        }
    }

    pause() {
        if(!this._isPlaying) return;

        this._isPlaying = false;

        if(this.schedulerTimerId !== null) {
            clearInterval(this.schedulerTimerId);
            this.schedulerTimerId = null;
        }

        if(this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        this.panicAll();
        if(this.playStateCallback) {
            this.playStateCallback(false);
        }
        if(this.playheadCallback) {
            this.playheadCallback(this._pauseTime);
        }
    }

    stop() {
        this.pause();
        this._pauseTime = this._lastSeekPosition;

        if(this.playheadCallback) {
            this.playheadCallback(this.pauseTime);
        }
    }

    async toggle() {
        if(this._isPlaying) {
            this.pause();
        } else {
            await this.play();
        }
    }

    async seek(beat: number) {
        const wasPlaying = this._isPlaying;

        if(wasPlaying) {
            this.pause();
        }

        this._pauseTime = Math.max(0, beat);
        this._lastSeekPosition = this._pauseTime;
        this.scheduledNoteOns.clear();
        this.scheduledNoteOffs.clear();

        if(this.playheadCallback) {
            this.playheadCallback(this.pauseTime);
        }

        if(wasPlaying) {
            await this.play();
        }
    }

    // CALLBACKS

    setPlayheadCallback(callback: PlayheadCallback | null) { this.playheadCallback = callback; }
    setPlayStateCallback(callback: PlayStateCallback | null) { this.playStateCallback = callback; }

    // CLEANUP

    dispose() {
        this.stop();
        this.playheadCallback = null;
        this.playStateCallback = null;
        this.notes = [];
    }
}