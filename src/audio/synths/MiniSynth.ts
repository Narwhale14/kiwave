import { clamp } from "../../util/math";
import { midiToFrequency } from "../../util/midi";
import type { CompiledNoteAutomation } from "../Automation";
import type { BaseSynth } from "./types";

interface ActiveVoice {
    oscillator: OscillatorNode;
    automationGain: GainNode; // receives automation curves (gain param, 0-1)
    envelopeGain: GainNode; // receives ADSR / velocity
    pannerNode: StereoPannerNode; // receives pan automation (-1 to 1, default 0)
    pitch: number;
}

export class MiniSynth implements BaseSynth {
    readonly id = 'minisynth';

    private audioContext: AudioContext;
    private masterGain: GainNode;

    private scheduledVoices: Map<string, ActiveVoice> = new Map(); // maped by id (workspace notes)
    private liveVoices: Map<number, ActiveVoice> = new Map(); // mapped by pitch (for keyboard sampling)

    private static readonly BASE_GAIN = 0.25;
    private attackTime = 0.005;
    private releaseTime = 0.005;

    constructor(audioContext: AudioContext) {
        this.audioContext = audioContext;
        this.masterGain = this.audioContext.createGain();
        this.masterGain.gain.value = 1;
    }

    getOutputNode(): GainNode {
        return this.masterGain;
    }

    getAudioContext(): AudioContext {
        return this.audioContext;
    }

    getActiveVoiceCount(): number {
        return this.scheduledVoices.size + this.liveVoices.size;
    }

    getState() {
        return { attack: this.attackTime, release: this.releaseTime };
    }

    setState(state: any) {
        if(state.attack) this.attackTime = state.attack;
        if(state.release) this.releaseTime = state.release;
    }

    setMasterVolume(volume: number) {
        const clamped = clamp(volume, 0, 1);
        this.masterGain.gain.setTargetAtTime(clamped, this.audioContext.currentTime, 0.01);
    }

    // voice lifecycle helpers

    private _startVoice(pitch: number, time: number, velocity: number, automation: CompiledNoteAutomation = new Map()): ActiveVoice {
        const envelopeTarget = clamp(velocity, 0, 1) * MiniSynth.BASE_GAIN * 2;
        
        const oscillator = this.audioContext.createOscillator();
        const automationGain = this.audioContext.createGain();
        const envelopeGain = this.audioContext.createGain();
        const pannerNode = this.audioContext.createStereoPanner();

        oscillator.type = 'square';
        oscillator.frequency.setValueAtTime(midiToFrequency(pitch), time);

        // routing
        oscillator.connect(automationGain);
        automationGain.connect(envelopeGain);
        envelopeGain.connect(pannerNode);
        pannerNode.connect(this.masterGain);

        // default automation gain
        automationGain.gain.setValueAtTime(0.5, time);

        const voice: ActiveVoice = { oscillator, automationGain, envelopeGain, pannerNode, pitch };

        // apply automation
        for(const [paramName, events] of automation) {
            const param = this._resolveParam(voice, paramName);
            if(!param) continue;

            for(const event of events) {
                switch(event.type) {
                    case 'setValueAtTime':
                        param.setValueAtTime(event.value, event.time);
                        break;
                    case 'linearRampToValueAtTime':
                        param.linearRampToValueAtTime(event.value, event.time);
                        break;
                    case 'setValueCurveAtTime':
                        param.setValueCurveAtTime(event.curve, event.startTime, event.duration);
                        break;
                }
            }
        }

        // apply attack env
        envelopeGain.gain.setValueAtTime(0, time);
        envelopeGain.gain.linearRampToValueAtTime(envelopeTarget, time + this.attackTime);

        oscillator.start(time);
        return voice;
    }

    private _stopVoice(voice: ActiveVoice, time: number, cleanupCallback: () => void) {
        voice.envelopeGain.gain.cancelAndHoldAtTime(time);
        voice.envelopeGain.gain.setTargetAtTime(0, time, this.releaseTime / 3);

        voice.oscillator.stop(time + this.releaseTime + 0.01);

        // cleanup
        voice.oscillator.onended = () => {
            cleanupCallback();
            voice.oscillator.disconnect();
            voice.automationGain.disconnect();
            voice.envelopeGain.disconnect();
            voice.pannerNode.disconnect();
        }
    }

    private _killVoice(voice: ActiveVoice, time: number) {
        voice.envelopeGain.gain.cancelScheduledValues(time);
        voice.envelopeGain.gain.setValueAtTime(0, time);
        voice.oscillator.stop(time);

        voice.oscillator.disconnect();
        voice.automationGain.disconnect();
        voice.envelopeGain.disconnect();
        voice.pannerNode.disconnect();
    }

    private _resolveParam(voice: ActiveVoice, paramName: string): AudioParam | null {
        switch(paramName) {
            case 'frequency': return voice.oscillator.frequency;
            case 'gain': return voice.automationGain.gain;
            case 'pan': return voice.pannerNode.pan;
            default: return null;
        }
    }

    // scheduled playback

    triggerAttack(noteId: string, pitch: number, time: number, velocity: number = 0.8, automation: CompiledNoteAutomation = new Map()) {
        if(this.scheduledVoices.has(noteId)) {
            this.triggerRelease(noteId, time);
        }

        const voice = this._startVoice(pitch, time, velocity, automation);
        this.scheduledVoices.set(noteId, voice);
    }

    triggerRelease(noteId: string, time: number) {
        const voice = this.scheduledVoices.get(noteId);
        if(!voice) return;

        this._stopVoice(voice, time, () => {
            if(this.scheduledVoices.get(noteId) === voice) {
                this.scheduledVoices.delete(noteId);
            }
        });
    }

    // live playback

    noteOn(pitch: number, velocity: number = 0.8) {
        if(this.liveVoices.has(pitch)) return;
        const now = this.audioContext.currentTime;
        const voice = this._startVoice(pitch, now, velocity);
        this.liveVoices.set(pitch, voice);
    }

    noteOff(pitch: number) {
        const voice = this.liveVoices.get(pitch);
        if(!voice) return;

        const now = this.audioContext.currentTime;

        this._stopVoice(voice, now, () => {
            if(this.liveVoices.get(pitch) === voice) {
                this.liveVoices.delete(pitch);
            }
        });
    }

    // util

    panic() {
        const now = this.audioContext.currentTime;
        
        for(const noteId of this.scheduledVoices.keys()) {
            this.triggerRelease(noteId, now);
        }

        for(const pitch of this.liveVoices.keys()) {
            this.noteOff(pitch);
        }
    }

    killAll() {
        const now = this.audioContext.currentTime;

        for(const voice of this.scheduledVoices.values()) {
            this._killVoice(voice, now);
        };
        this.scheduledVoices.clear();

        for(const voice of this.liveVoices.values()) {
            this._killVoice(voice, now);
        };
        this.liveVoices.clear();
    }

    async resume() {
        if(this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }
    }

    async dispose() {
        this.killAll();
    }
}