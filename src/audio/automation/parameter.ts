import type { AutomationSegment, CompiledParamEvent } from "./types";
import { midiToFrequency } from "../../util/midi";
import { buildCurveArray, buildPowerCurveArray } from "./nodeOperations";

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
    curveStyle?: 'bezier' | 'power'; // bezier = handle can bow outside segment; power = bounded FL-studio style
    followNote?: boolean; // shift curve values when the note's pitch changes
    getDefaultNormalized?: (noteMidi: number) => number;

    compile(
        segments: AutomationSegment[],
        noteMidi: number,
        noteStartAudioTime: number,
        bpm: number
    ): Record<string, CompiledParamEvent[]>;
}

// Curve must be sampled in normalized [0,1] space first, then each sample mapped through
// toAudioValue — avoids corrupting the bezier/power math with large Hz numbers.
function compileSegmentToFreq(
    startNorm: number, endNorm: number,
    tension: number, curveStyle: 'bezier' | 'power',
    startTime: number, endTime: number,
    toAudioValue: (norm: number) => number,
    events: CompiledParamEvent[]
): void {
    events.push({ type: 'setValueAtTime', value: toAudioValue(startNorm), time: startTime });

    if(Math.abs(tension) < 1e-4) {
        events.push({ type: 'linearRampToValueAtTime', value: toAudioValue(endNorm), time: endTime });
    } else {
        const SAMPLES = 64;
        const normCurve = curveStyle === 'power'
            ? buildPowerCurveArray(startNorm, endNorm, tension, SAMPLES)
            : buildCurveArray(startNorm, endNorm, tension, SAMPLES);
        const audioCurve = new Float32Array(SAMPLES);
        for(let i = 0; i < SAMPLES; i++) audioCurve[i] = toAudioValue(normCurve[i]!);
        events.push({ type: 'setValueCurveAtTime', curve: audioCurve, startTime, duration: endTime - startTime });
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
    followNote: true,
    curveStyle: 'power',

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
            compileSegmentToFreq(seg.startValue, seg.endValue, seg.curveTension, this.curveStyle ?? 'bezier', tStart, tEnd, toHz, events);
        }

        return { frequency: events };
    }
};

export const VOLUME: AutomationParameterDef = {
    id: 'volume',
    label: 'Volume',
    min: 0,
    max: 1,
    defaultNormalized: 0.5,
    unit: '%',
    color: '#f98bf9',
    overlayRows: 'note',
    snapInterval: null,
    followNote: false,
    curveStyle: 'power',

    compile(segments, _noteMidi, t0, bpm) {
        const events: CompiledParamEvent[] = [];
        const beatsToSec = (b: number) => (b / bpm) * 60;
        const toGain = (norm: number) => norm;

        for(const seg of segments) {
            const tStart = t0 + beatsToSec(seg.startBeat);
            const tEnd   = t0 + beatsToSec(seg.endBeat);
            compileSegmentToFreq(seg.startValue, seg.endValue, seg.curveTension, this.curveStyle ?? 'power', tStart, tEnd, toGain, events);
        }

        return { gain: events };
    }
};

export const PAN: AutomationParameterDef = {
    id: 'pan',
    label: 'Pan',
    min: -1,
    max: 1,
    defaultNormalized: 0.5,
    unit: '',
    color: '#f78a8a',
    overlayRows: 10,
    snapInterval: null,
    followNote: false,
    curveStyle: 'power',

    compile(segments, _noteMidi, t0, bpm) {
        const events: CompiledParamEvent[] = [];
        const beatsToSec = (b: number) => (b / bpm) * 60;
        const toPan = (norm: number) => norm * 2 - 1; // [0,1] -> [-1,1]

        for(const seg of segments) {
            const tStart = t0 + beatsToSec(seg.startBeat);
            const tEnd   = t0 + beatsToSec(seg.endBeat);
            compileSegmentToFreq(seg.startValue, seg.endValue, seg.curveTension, this.curveStyle ?? 'power', tStart, tEnd, toPan, events);
        }

        return { pan: events };
    }
};

export const ALL_PARAMETERS: AutomationParameterDef[] = [PITCH_BEND, VOLUME, PAN];
export const PARAMETER_MAP = new Map(ALL_PARAMETERS.map(p => [p.id, p]));