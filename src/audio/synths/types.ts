import type { CompiledNoteAutomation } from "../Automation";

export interface SynthEntry {
    id: string;
    displayName: string;
    factory: (ctx: AudioContext) => BaseSynth;
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
    getState(): unknown;
    setState(state: unknown): void;
}