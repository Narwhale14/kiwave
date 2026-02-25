import { clamp } from "../../util/math";
import { midiToFrequency } from "../../util/midi";
import type { CompiledNoteAutomation } from "../Automation";
import type { BaseSynth } from "./types";

export type Waveform = 'sine' | 'square' | 'sawtooth' | 'triangle' | 'noise';
export const MINISYNTH_WAVEFORM_MODES: Waveform[] = ['sine', 'square', 'sawtooth', 'triangle', 'noise'];

export type EchoMode = 'mono' | 'stereo' | 'ping-pong';
export const MINISYNTH_ECHO_MODES: EchoMode[] = ['mono', 'stereo', 'ping-pong'];

export interface MiniSynthConfig {
    waveform: Waveform;
    masterVolume: number;
    adsr: { attack: number, decay: number, sustain: number, release: number };
    filter: { type: BiquadFilterType, frequency: number, resonance: number };
    echo: { time: number, feedback: number, mix: number, mode: EchoMode };
    chorus: { rate: number, depth: number, mix: number };
}

interface ActiveVoice {
    source: OscillatorNode | AudioBufferSourceNode;
    filter: BiquadFilterNode;
    automationGain: GainNode;
    envelopeGain: GainNode;
    pannerNode: StereoPannerNode;
    pitch: number;
    sustainLevel: number; // absolute gain at sustain (envelopeTarget * sustain)
}

export class MiniSynth implements BaseSynth {
    readonly id = 'minisynth';

    private audioContext: AudioContext;
    private noiseBuffer!: AudioBuffer;

    private masterGain: GainNode;
    private finalOutput: GainNode;

    private echoDelayLeft!: DelayNode;
    private echoDelayRight!: DelayNode;
    private echoFeedbackLeft!: GainNode;
    private echoFeedbackRight!: GainNode;
    private echoSendRight!: GainNode;
    private echoMix!: GainNode;

    private chorusDelayL!: DelayNode;
    private chorusDelayR!: DelayNode;
    private chorusLFOL!: OscillatorNode;
    private chorusLFOR!: OscillatorNode;
    private chorusDepthL!: GainNode;
    private chorusDepthR!: GainNode;
    private chorusMix!: GainNode;

    private scheduledVoices: Map<string, ActiveVoice> = new Map();
    private liveVoices: Map<number, ActiveVoice> = new Map();

    private static readonly BASE_GAIN = 0.25;
    private static readonly ANTI_CLICK_RAMP = 0.005; // 5ms

    // chorus voice parameters
    private static readonly CHORUS_BASE_DELAY_L = 0.020; // 20 ms
    private static readonly CHORUS_BASE_DELAY_R = 0.023; // 23 ms — offset gives stereo width
    private static readonly CHORUS_LFO_DETUNE = 1.03; // 3 % rate difference between L/R LFOs

    // default values for instance
    private config: MiniSynthConfig = {
        waveform: 'sawtooth',
        masterVolume: 0.8,
        adsr: { attack: 0, decay: 0, sustain: 1 , release: 0 },
        filter: { type: 'lowpass' as BiquadFilterType, frequency: 20000, resonance: 0.1 },
        echo: { time: 0, feedback: 0, mix: 0, mode: 'stereo' },
        chorus: { rate: 0, depth: 0, mix: 0 }
    };

    constructor(audioContext: AudioContext) {
        this.audioContext = audioContext;

        this.masterGain = this.audioContext.createGain();
        this.finalOutput = this.audioContext.createGain();

        this.masterGain.gain.value = this.config.masterVolume;
        this.finalOutput.gain.value = 1;

        this._setupNoiseBuffer();
        this._setupEffectsBus();
    }

    private _setupNoiseBuffer() {
        const bufferSize = 2 * this.audioContext.sampleRate;
        this.noiseBuffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);

        const data = this.noiseBuffer.getChannelData(0);
        let lfsr = 1;

        for (let i = 0; i < data.length; i++) {
            const bit = (lfsr ^ (lfsr >> 1)) & 1;
            lfsr = (lfsr >> 1) | (bit << 14);
            data[i] = (lfsr & 1) ? 1 : -1;
        }

        /* metallic
        const bit = ((lfsr & 1) ^ ((lfsr >> 6) & 1));
        lfsr = (lfsr >> 1) | (bit << 14);
        */
    }

    private _setupEffectsBus() {
        const ctx = this.audioContext;

        // echo
        this.echoDelayLeft = ctx.createDelay(2.0);
        this.echoDelayRight = ctx.createDelay(2.0);
        this.echoFeedbackLeft = ctx.createGain();
        this.echoFeedbackRight = ctx.createGain();
        this.echoSendRight = ctx.createGain();   // gated to 0 in ping-pong mode
        this.echoMix = ctx.createGain();

        // initialise to config values so the echo is silent/correct from the start
        this.echoDelayLeft.delayTime.value = this.config.echo.time;
        this.echoDelayRight.delayTime.value = this.config.echo.time;
        this.echoFeedbackLeft.gain.value = this.config.echo.feedback;
        this.echoFeedbackRight.gain.value = this.config.echo.feedback;
        this.echoSendRight.gain.value = 1;  // mono default: both channels receive input
        this.echoMix.gain.value  = this.config.echo.mix;

        // signal feed - right channel is gated so ping-pong can silence it
        this.masterGain.connect(this.echoDelayLeft);
        this.masterGain.connect(this.echoSendRight);
        this.echoSendRight.connect(this.echoDelayRight);

        // feedback loops (default mono: L->L, R->R)
        this.echoDelayLeft.connect(this.echoFeedbackLeft);
        this.echoFeedbackLeft.connect(this.echoDelayLeft);
        this.echoDelayRight.connect(this.echoFeedbackRight);
        this.echoFeedbackRight.connect(this.echoDelayRight);

        // echo wet output - merge L and R into stereo then to mix gain
        const echoMerger = ctx.createChannelMerger(2);
        this.echoDelayLeft.connect(echoMerger, 0, 0);
        this.echoDelayRight.connect(echoMerger, 0, 1);
        echoMerger.connect(this.echoMix);
        this.echoMix.connect(this.finalOutput);

        // chorus
        // two-voice stereo chorus: independent delay lines with slightly detuned LFOs.
        // different base delays (20 ms / 23 ms) create natural phase offset.
        this.chorusDelayL = ctx.createDelay(0.05);
        this.chorusDelayR = ctx.createDelay(0.05);
        this.chorusDelayL.delayTime.value = MiniSynth.CHORUS_BASE_DELAY_L;
        this.chorusDelayR.delayTime.value = MiniSynth.CHORUS_BASE_DELAY_R;

        this.chorusLFOL = ctx.createOscillator();
        this.chorusLFOR = ctx.createOscillator();
        this.chorusLFOL.type = 'sine';
        this.chorusLFOR.type = 'sine';
        this.chorusLFOL.frequency.value = this.config.chorus.rate;
        this.chorusLFOR.frequency.value = this.config.chorus.rate * MiniSynth.CHORUS_LFO_DETUNE;

        this.chorusDepthL = ctx.createGain();
        this.chorusDepthR = ctx.createGain();
        this.chorusDepthL.gain.value = this.config.chorus.depth;
        this.chorusDepthR.gain.value = this.config.chorus.depth;

        // LFOs modulate delay time
        this.chorusLFOL.connect(this.chorusDepthL);
        this.chorusDepthL.connect(this.chorusDelayL.delayTime);
        this.chorusLFOR.connect(this.chorusDepthR);
        this.chorusDepthR.connect(this.chorusDelayR.delayTime);

        this.chorusLFOL.start();
        this.chorusLFOR.start();

        // merge L/R chorus voices into stereo wet signal
        const chorusMerger = ctx.createChannelMerger(2);
        this.chorusDelayL.connect(chorusMerger, 0, 0);
        this.chorusDelayR.connect(chorusMerger, 0, 1);

        this.chorusMix = ctx.createGain();
        this.chorusMix.gain.value = this.config.chorus.mix;
        chorusMerger.connect(this.chorusMix);
        this.chorusMix.connect(this.finalOutput);

        this.masterGain.connect(this.chorusDelayL);
        this.masterGain.connect(this.chorusDelayR);

        // dry
        this.masterGain.connect(this.finalOutput);
    }

    private _smoothUpdate(param: AudioParam, value: number, timeConstant = 0.05) {
        const now = this.audioContext.currentTime;
        param.setTargetAtTime(value, now, timeConstant);
    }

    setMasterVolume(volume: number) {
        this.config.masterVolume = clamp(volume, 0, 1);
        this._smoothUpdate(this.masterGain.gain, this.config.masterVolume);
    }

    setWaveform(waveform: Waveform) {
        this.config.waveform = waveform;

        const allVoices = [...this.scheduledVoices.values(), ...this.liveVoices.values()];

        allVoices.forEach(voice => {
            if(voice.source instanceof OscillatorNode) {
                voice.source.type = waveform as OscillatorType;
            }
        });
    }

    setADSR(adsr: Partial<MiniSynthConfig['adsr']>) {
        this.config.adsr = { ...this.config.adsr, ...adsr };
    }

    setFilter(filter: Partial<MiniSynthConfig['filter']>) {
        this.config.filter = { ...this.config.filter, ...filter };

        const allVoices = [  ...this.scheduledVoices.values(), ... this.liveVoices.values() ];
        allVoices.forEach(voice => {
            if(filter.type) voice.filter.type = filter.type;
            if(filter.frequency !== undefined) this._smoothUpdate(voice.filter.frequency, filter.frequency);
            if(filter.resonance !== undefined) this._smoothUpdate(voice.filter.Q, filter.resonance);
        });
    }

    setEcho(echo: Partial<MiniSynthConfig['echo']>) {
        this.config.echo = { ...this.config.echo, ...echo };
        const { time, feedback, mix, mode } = this.config.echo;
        const now = this.audioContext.currentTime;

        this._smoothUpdate(this.echoDelayLeft.delayTime, time);
        this._smoothUpdate(this.echoDelayRight.delayTime, mode === 'stereo' ? time * 0.75 : time);

        if(mode === 'ping-pong') {
            this._smoothUpdate(this.echoFeedbackLeft.gain, 1);
            this._smoothUpdate(this.echoFeedbackRight.gain, feedback);
        } else {
            this._smoothUpdate(this.echoFeedbackLeft.gain, feedback);
            this._smoothUpdate(this.echoFeedbackRight.gain, feedback);
        }

        this._smoothUpdate(this.echoMix.gain, mix);

        this.echoSendRight.gain.setTargetAtTime(mode === 'ping-pong' ? 0 : 1, now, 0.05);

        this.echoFeedbackLeft.disconnect();
        this.echoFeedbackRight.disconnect();

        if(mode === 'ping-pong') {
            this.echoFeedbackLeft.connect(this.echoDelayRight);
            this.echoFeedbackRight.connect(this.echoDelayLeft);
        } else {
            this.echoFeedbackLeft.connect(this.echoDelayLeft);
            this.echoFeedbackRight.connect(this.echoDelayRight);
        }
    }

    setChorus(chorus: Partial<MiniSynthConfig['chorus']>) {
        this.config.chorus = { ...this.config.chorus, ...chorus };

        if(chorus.rate !== undefined) {
            this._smoothUpdate(this.chorusLFOL.frequency, chorus.rate);
            this._smoothUpdate(this.chorusLFOR.frequency, chorus.rate * MiniSynth.CHORUS_LFO_DETUNE);
        }
        if(chorus.depth !== undefined) {
            this._smoothUpdate(this.chorusDepthL.gain, chorus.depth);
            this._smoothUpdate(this.chorusDepthR.gain, chorus.depth);
        }

        if(chorus.mix !== undefined) this._smoothUpdate(this.chorusMix.gain, chorus.mix);
    }

    // BaseSynth implements

    getOutputNode(): GainNode { return this.finalOutput; }
    getAudioContext(): AudioContext { return this.audioContext; }
    getActiveVoiceCount(): number { return this.scheduledVoices.size + this.liveVoices.size; }
    getState(): MiniSynthConfig {
        return {
            ...this.config,
            adsr: { ...this.config.adsr },
            filter: { ...this.config.filter },
            echo: { ...this.config.echo },
            chorus: { ...this.config.chorus },
        };
    }

    setState(state: Partial<MiniSynthConfig>) {
        if(state.masterVolume !== undefined) this.setMasterVolume(state.masterVolume);
        if(state.waveform) this.setWaveform(state.waveform);
        if(state.adsr) this.setADSR(state.adsr);
        if(state.filter) this.setFilter(state.filter);
        if(state.echo) this.setEcho(state.echo);
        if(state.chorus) this.setChorus(state.chorus);
    }

    // voice lifecycle

    private _startVoice(pitch: number, time: number, velocity: number, automation: CompiledNoteAutomation = new Map()): ActiveVoice {
        const envelopeTarget = clamp(velocity, 0, 1) * MiniSynth.BASE_GAIN * 2;

        // voice form
        let source: OscillatorNode | AudioBufferSourceNode;
        if(this.config.waveform === 'noise') {
            const noise = this.audioContext.createBufferSource();
            noise.buffer = this.noiseBuffer;
            noise.loop = true;
            source = noise;
        } else {
            const osc = this.audioContext.createOscillator();
            osc.type = this.config.waveform;
            osc.frequency.setValueAtTime(midiToFrequency(pitch), time);
            source = osc;
        }
        
        // post noise nodes
        const filter = this.audioContext.createBiquadFilter();
        const automationGain = this.audioContext.createGain();
        const envelopeGain = this.audioContext.createGain();
        const pannerNode = this.audioContext.createStereoPanner();

        filter.type = this.config.filter.type;
        filter.frequency.setValueAtTime(this.config.filter.frequency, time);
        filter.Q.setValueAtTime(this.config.filter.resonance, time);

        source.connect(filter);
        filter.connect(automationGain);
        automationGain.connect(envelopeGain);
        envelopeGain.connect(pannerNode);
        pannerNode.connect(this.masterGain);

        // default automation gain
        automationGain.gain.setValueAtTime(0.5, time);

        const { attack, decay, sustain } = this.config.adsr;
        const sustainLevel = envelopeTarget * sustain;
        const decayTime = Math.max(decay, 0.0001); // to avoid collapsing attack + decay into a single event

        const voice: ActiveVoice = { source, filter, automationGain, envelopeGain, pannerNode, pitch, sustainLevel };

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

        const attackEndTime = time + attack + MiniSynth.ANTI_CLICK_RAMP;
        envelopeGain.gain.setValueAtTime(0, time);
        envelopeGain.gain.linearRampToValueAtTime(envelopeTarget, attackEndTime);
        envelopeGain.gain.linearRampToValueAtTime(sustainLevel, attackEndTime + decayTime);

        source.start(time);
        return voice;
    }

    private _stopVoice(voice: ActiveVoice, time: number, cleanupCallback: () => void) {
        const release = this.config.adsr.release;
        const releaseTimeConstant = Math.max(release / 3, 0.001);

        voice.envelopeGain.gain.cancelAndHoldAtTime(time);
        voice.envelopeGain.gain.setTargetAtTime(0, time, releaseTimeConstant);
        voice.source.stop(time + Math.max(release, 0.05) + 0.15);

        voice.source.onended = () => {
            cleanupCallback();
            voice.source.disconnect();
            voice.filter.disconnect();
            voice.automationGain.disconnect();
            voice.envelopeGain.disconnect();
            voice.pannerNode.disconnect();
        }
    }

    private _killVoice(voice: ActiveVoice, time: number) {
        voice.envelopeGain.gain.cancelAndHoldAtTime(time);
        voice.envelopeGain.gain.linearRampToValueAtTime(0, time + MiniSynth.ANTI_CLICK_RAMP);
        voice.source.stop(time + MiniSynth.ANTI_CLICK_RAMP);

        voice.source.onended = () => {
            voice.source.disconnect();
            voice.filter.disconnect();
            voice.automationGain.disconnect();
            voice.envelopeGain.disconnect();
            voice.pannerNode.disconnect();
        };
    }

    private _resolveParam(voice: ActiveVoice, paramName: string): AudioParam | null {
        switch(paramName) {
            case 'frequency':
                return voice.source instanceof OscillatorNode
                    ? voice.source.frequency
                    : null;
            case 'filterFreq': return voice.filter.frequency;
            case 'gain': return voice.automationGain.gain;
            case 'pan': return voice.pannerNode.pan;
            default: return null;
        }
    }

    // scheduled playback

    triggerAttack(noteId: string, pitch: number, time: number, velocity: number = 0.8, automation: CompiledNoteAutomation = new Map()) {
        if(this.scheduledVoices.has(noteId)) this.triggerRelease(noteId, time);
        const voice = this._startVoice(pitch, time, velocity, automation);
        this.scheduledVoices.set(noteId, voice);
    }

    triggerRelease(noteId: string, time: number) {
        const voice = this.scheduledVoices.get(noteId);
        if(!voice) return;

        this._stopVoice(voice, time, () => {
            if(this.scheduledVoices.get(noteId) === voice) this.scheduledVoices.delete(noteId);
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
            if(this.liveVoices.get(pitch) === voice) this.liveVoices.delete(pitch);
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
        }
        this.scheduledVoices.clear();

        for(const voice of this.liveVoices.values()) {
            this._killVoice(voice, now);
        }
        this.liveVoices.clear();
    }

    async resume() {
        if(this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }
    }

    async dispose() {
        this.killAll();
        this.chorusLFOL.stop();
        this.chorusLFOR.stop();
        this.masterGain.disconnect();
        this.finalOutput.disconnect();
    }
}