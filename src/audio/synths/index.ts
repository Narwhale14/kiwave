import { MiniSynth } from "./MiniSynth";
import type { MiniSynthConfig } from "./MiniSynth";
import type { SynthEntry } from "./types";

export const REGISTERED_SYNTHS: SynthEntry[] = [
    {
        id: 'minisynth',
        displayName: 'MiniSynth',
        factory: (ctx) => new MiniSynth(ctx),
        serializeState: (synth) => (synth as MiniSynth).getState() as unknown as Record<string, unknown>,
        deserializeState: (synth, state) => (synth as MiniSynth).setState(state as Partial<MiniSynthConfig>),
    }
];

// convenience
export * from './types';