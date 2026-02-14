import type { AutomationSegment, CompiledParamEvent } from "./types";
import { midiToFrequency } from "../../util/midiUtils";
import { buildCurveArray } from "./nodeOperations";

// a single automatable parameter - how it's displayed and compiled
export interface AutomationParameterDef {
    id: string;
    label: string;
    min: number;
    max: number;
    defaultNormalized: number;
    unit?: string;
    color: string;
    overlayRows: 'note' | 'roll' | number; // number is range with center on note
    snapInterval: number | null; // 0 to 1
    getDefaultNormalized?: (noteMidi: number) => number;

    compile(
        segments: AutomationSegment[],
        noteMidi: number,
        noteStartAudioTime: number,
        bpm: number
    ): Record<string, CompiledParamEvent[]>;
}

function compileSegmentToFreq(startHz: number, endHz: number, tension: number, startTime: number, endTime: number, events: CompiledParamEvent[]): void {
    events.push({ type: 'setValueAtTime', value: startHz, time: startTime });

    if(Math.abs(tension) < 1e-4) {
        events.push({ type: 'linearRampToValueAtTime', value: endHz, time: endTime });
    } else {
        const curve = buildCurveArray(startHz, endHz, tension);
        events.push({ type: 'setValueCurveAtTime', curve, startTime, duration: endTime - startTime });
    }
}

export const PITCH_BEND: AutomationParameterDef = {
    id: 'pitchBend',
    label: 'Pitch Bend',
    min: 12, // MIDI C0
    max: 132, // MIDI C10
    defaultNormalized: 0.5,
    unit: 'st',
    color: '#a78bfa',
    overlayRows: 'roll',
    snapInterval: 1 / (132 - 12),

    getDefaultNormalized(noteMidi) {
        return (noteMidi - this.min) / (this.max - this.min);
    },

    compile(segments, _noteMidi, t0, bpm) {
        const events: CompiledParamEvent[] = [];
        const beatsToSec = (b: number) => (b / bpm) * 60;
        // value -> absolute MIDI -> Hz
        const toHz = (norm: number) => midiToFrequency(this.min + norm * (this.max - this.min));

        for(const seg of segments) {
            const tStart = t0 + beatsToSec(seg.startBeat);
            const tEnd   = t0 + beatsToSec(seg.endBeat);
            compileSegmentToFreq(toHz(seg.startValue), toHz(seg.endValue), seg.curveTension, tStart, tEnd, events);
        }

        return { frequency: events };
    }
};

export const ALL_PARAMETERS: AutomationParameterDef[] = [PITCH_BEND];
export const PARAMETER_MAP = new Map(ALL_PARAMETERS.map(p => [p.id, p]));