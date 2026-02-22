import type { CompiledNoteAutomation } from "../Automation";

export interface SynthEntry {
    id: string;
    displayName: string;
    factory: (ctx: AudioContext) => BaseSynth;
    serializeState: (synth: BaseSynth) => Record<string, unknown>;
    deserializeState: (synth: BaseSynth, state: Record<string, unknown>) => void;
}

export interface BaseSynth {
    readonly id: string;
    getOutputNode(): GainNode;
    getAudioContext(): AudioContext;

    noteOn(pitch: number, velocity?: number): void;
    noteOff(pitch: number): void;

    triggerAttack(noteId: string, pitch: number, time: number, velocity?: number, automation?: CompiledNoteAutomation): void;
    triggerRelease(noteId: string, time: number): void;

    panic(): void;
    killAll(): void;
    dispose(): void;
    resume(): void;
}