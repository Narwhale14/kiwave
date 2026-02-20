import { MiniSynth } from "./MiniSynth";
import type { SynthEntry } from "./types";

export const REGISTERED_SYNTHS: SynthEntry[] = [
    {
        id: 'minisynth',
        displayName: 'MiniSynth',
        factory: (ctx) => new MiniSynth(ctx)
    }
];

// convenience
export * from './types';