import { midiToFrequency } from "../util/midiUtils";
import type { CompiledNoteAutomation } from "./automation/types";

// automationGain (0-1 raw, default 0.5) → envelopeGain (velocity*BASE_GAIN*2) → masterGain
// Final gain at default automation: 0.5 * velocity * BASE_GAIN * 2 = velocity * BASE_GAIN
interface ActiveVoice {
    oscillator: OscillatorNode;
    automationGain: GainNode; // receives automation curves (gain param, 0-1)
    envelopeGain: GainNode;   // receives ADSR / velocity
    pitch: number;
}

export class MiniSynth {
    private audioContext: AudioContext;
    private masterGain: GainNode;
    private scheduledVoices: Map<string, ActiveVoice> = new Map(); // maped by id (workspace notes)
    private liveVoices: Map<number, ActiveVoice> = new Map(); // mapped by pitch (for keyboard sampling)

    // per-voice headroom budget: -12 dBFS at velocity 1.0.
    // 4 voices at full velocity sum to ~0 dBFS — clean without limiter involvement.
    // doubled here because automationGain defaults to 0.5 (center of its range).
    private static readonly BASE_GAIN = 0.25;

    // env settings
    private attackTime = 0.005;
    private releaseTime = 0.005;

    constructor(audioContext: AudioContext) {
        this.audioContext = audioContext;

        this.masterGain = this.audioContext.createGain();
        this.masterGain.gain.value = 1;
    }

    // instruments output gain - must be linked to audiograph
    getOutputNode(): GainNode {
        return this.masterGain;
    }

    async resume() {
        if(this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }
    }

    getAudioContext(): AudioContext {
        return this.audioContext;
    }

    // scheduled playback

    triggerAttack(noteId: string, pitch: number, time: number, velocity: number = 0.8, automation: CompiledNoteAutomation = new Map()) {
        if(this.scheduledVoices.has(noteId)) {
            this.triggerRelease(noteId, time);
        }

        // doubled so automation at default 0.5 yields velocity * BASE_GAIN
        const envelopeTarget = Math.max(0, Math.min(1, velocity)) * MiniSynth.BASE_GAIN * 2;

        const oscillator = this.audioContext.createOscillator();
        const automationGain = this.audioContext.createGain();
        const envelopeGain = this.audioContext.createGain();

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(midiToFrequency(pitch), time);

        // osc -> automationGain -> envelopeGain -> master
        oscillator.connect(automationGain);
        automationGain.connect(envelopeGain);
        envelopeGain.connect(this.masterGain);

        // automationGain defaults to 0.5 (center); automation events override this
        automationGain.gain.setValueAtTime(0.5, time);

        // apply pre-compiled automation events to their dedicated node — no ADSR on this node
        const voice: ActiveVoice = { oscillator, automationGain, envelopeGain, pitch };
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

        // attack anti-click on envelopeGain only — fully isolated from automationGain curves
        envelopeGain.gain.setValueAtTime(0, time);
        envelopeGain.gain.linearRampToValueAtTime(envelopeTarget, time + this.attackTime);

        oscillator.start(time);
        this.scheduledVoices.set(noteId, voice);
    }

    private _resolveParam(voice: ActiveVoice, paramName: string): AudioParam | null {
        switch(paramName) {
            case 'frequency': return voice.oscillator.frequency;
            case 'gain':      return voice.automationGain.gain;
            default:          return null;
        }
    }

    triggerRelease(noteId: string, time: number) {
        const voice = this.scheduledVoices.get(noteId);
        if(!voice) return;

        const { oscillator, automationGain, envelopeGain } = voice;

        envelopeGain.gain.cancelAndHoldAtTime(time);
        envelopeGain.gain.setTargetAtTime(0, time, this.releaseTime / 3);

        oscillator.stop(time + this.releaseTime + 0.01);

        oscillator.onended = () => {
            if(this.scheduledVoices.get(noteId) === voice) {
                this.scheduledVoices.delete(noteId);
            }
            automationGain.disconnect();
            envelopeGain.disconnect();
            oscillator.disconnect();
        };
    }

    // live playback (for keyboard playback)

    noteOn(pitch: number, velocity: number = 0.8) {
        if(this.liveVoices.has(pitch)) return;

        const now = this.audioContext.currentTime;
        const envelopeTarget = Math.max(0, Math.min(1, velocity)) * MiniSynth.BASE_GAIN * 2;

        const oscillator = this.audioContext.createOscillator();
        const automationGain = this.audioContext.createGain();
        const envelopeGain = this.audioContext.createGain();

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(midiToFrequency(pitch), now);

        oscillator.connect(automationGain);
        automationGain.connect(envelopeGain);
        envelopeGain.connect(this.masterGain);

        automationGain.gain.setValueAtTime(0.5, now);

        envelopeGain.gain.setValueAtTime(0, now);
        envelopeGain.gain.setTargetAtTime(envelopeTarget, now, this.attackTime / 3);

        oscillator.start(now);
        this.liveVoices.set(pitch, { oscillator, automationGain, envelopeGain, pitch });
    }

    noteOff(pitch: number) {
        const voice = this.liveVoices.get(pitch);
        if(!voice) return;

        const now = this.audioContext.currentTime;
        const { oscillator, automationGain, envelopeGain } = voice;

        envelopeGain.gain.cancelAndHoldAtTime(now);
        envelopeGain.gain.setTargetAtTime(0, now, this.releaseTime / 3);

        oscillator.stop(now + this.releaseTime + 0.01);

        oscillator.onended = () => {
            if(this.liveVoices.get(pitch) === voice) {
                this.liveVoices.delete(pitch);
            }
            automationGain.disconnect();
            envelopeGain.disconnect();
            oscillator.disconnect();
        };
    }

    // util

    panic() {
        const now = this.audioContext.currentTime;
        for(const noteId of this.scheduledVoices.keys()) {
            this.triggerRelease(noteId, now);
        }
    }

    killAll() {
        const now = this.audioContext.currentTime;

        const killVoice = (voice: ActiveVoice) => {
            voice.envelopeGain.gain.cancelScheduledValues(now);
            voice.envelopeGain.gain.setValueAtTime(0, now);
            voice.oscillator.stop(now);
            voice.automationGain.disconnect();
            voice.envelopeGain.disconnect();
            voice.oscillator.disconnect();
        };

        for(const voice of this.scheduledVoices.values()) killVoice(voice);
        this.scheduledVoices.clear();

        for(const voice of this.liveVoices.values()) killVoice(voice);
        this.liveVoices.clear();
    }

    setMasterVolume(volume: number) {
        const clamped = Math.max(0, Math.min(1, volume));
        this.masterGain.gain.setTargetAtTime(clamped, this.audioContext.currentTime, 0.01);
    }

    getActiveVoiceCount(): number {
        return this.scheduledVoices.size + this.liveVoices.size;
    }

    async dispose() {
        this.killAll();
    }
}
