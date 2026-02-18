import { midiToFrequency } from "../util/midi";
import { nanoid } from 'nanoid';
import { clamp } from '../util/math';

// curve builder types

export interface AutomationNode {
    id: string;
    beat: number;
    value: number;
    curveTension: number;
}

export interface AutomationSegment {
    startBeat: number;
    endBeat: number;
    startValue: number;
    endValue: number;
    curveTension: number; // inherited from left node
}

export interface AutomationCurve {
    parameterId: string;
    nodes: AutomationNode[];
}

export type CompiledParamEvent =
    | { type: 'setValueAtTime'; value: number, time: number }
    | { type: 'linearRampToValueAtTime'; value: number, time: number }
    | { type: 'setValueCurveAtTime'; curve: Float32Array; startTime: number; duration: number};

export type CompiledNoteAutomation = Map<string, CompiledParamEvent[]>;

// parameter definitions

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

// curve must be sampled in normalized [0,1] space first, then each sample mapped through
// toAudioValue - avoids corrupting the bezier/power math with large Hz numbers.
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

// node operations

export function getHandleValue(v0: number, v1: number, tension: number): number {
    return clamp((v0 + v1) / 2 + tension, 0, 1);
}

export function evalBezier(x: number, v0: number, v1: number, tension: number): number {
    if(Math.abs(tension) < 1e-4) return v0 + (v1 - v0) * x;
    const hv = getHandleValue(v0, v1, tension);
    const cv = 2 * hv - 0.5 * (v0 + v1); // bezier control point value (not on-curve)
    return (1 - x) * (1 - x) * v0 + 2 * x * (1 - x) * cv + x * x * v1;
}

export function buildCurveArray(startValue: number, endValue: number, tension: number, samples = 64): Float32Array {
    const array = new Float32Array(samples);
    for(let i = 0; i < samples; i++) {
        array[i] = evalBezier(i / (samples - 1), startValue, endValue, tension);
    }
    return array;
}

export function getPowerHandleValue(v0: number, v1: number, tension: number): number {
    const h = (tension + 1) / 2; // [0, 1]
    return v0 + (v1 - v0) * h;
}

export function evalPowerCurve(x: number, v0: number, v1: number, tension: number): number {
    if(Math.abs(tension) < 1e-4) return v0 + (v1 - v0) * x;
    const h = clamp((tension + 1) / 2, 1e-4, 1 - 1e-4);
    let t: number;
    if(h <= 0.5) {
        const p = Math.log2(1 / h);
        t = Math.pow(x, p);
    } else {
        const p = Math.log2(1 / (1 - h));
        t = 1 - Math.pow(1 - x, p);
    }
    return v0 + (v1 - v0) * t;
}

export function buildPowerCurveArray(startValue: number, endValue: number, tension: number, samples = 64): Float32Array {
    const array = new Float32Array(samples);
    for(let i = 0; i < samples; i++) {
        array[i] = evalPowerCurve(i / (samples - 1), startValue, endValue, tension);
    }
    return array;
}

export function deriveSegments(nodes: AutomationNode[]): AutomationSegment[] {
    if(nodes.length < 2) return [];

    const result: AutomationSegment[] = [];
    for(let i = 0; i < nodes.length - 1; i++) {
        result.push({
            startBeat: nodes[i]!.beat,
            endBeat: nodes[i + 1]!.beat,
            startValue: nodes[i]!.value,
            endValue: nodes[i + 1]!.value,
            curveTension: nodes[i]!.curveTension
        });
    }

    return result;
}

export function insertNode(nodes: AutomationNode[], atBeat: number, noteLengthBeats: number, curveStyle: 'bezier' | 'power' = 'bezier'): AutomationNode[] {
    const clampedBeat = clamp(atBeat, 0, noteLengthBeats);

    let leftIndex = 0;
    for(let i = nodes.length - 1; i >= 0; i--) {
        if(nodes[i]!.beat <= clampedBeat) {
            leftIndex = i;
            break;
        }
    }
    const rightIndex = leftIndex + 1;

    let interpolatedValue = nodes[leftIndex]!.value;
    if(rightIndex < nodes.length) {
        const left = nodes[leftIndex]!;
        const right = nodes[rightIndex]!;
        const t = (clampedBeat - left.beat) / (right.beat - left.beat);
        interpolatedValue = curveStyle === 'power'
            ? evalPowerCurve(t, left.value, right.value, left.curveTension)
            : evalBezier(t, left.value, right.value, left.curveTension);
    }

    const newNode: AutomationNode = {
        id: nanoid(),
        beat: clampedBeat,
        value: interpolatedValue,
        curveTension: 0,
    };

    return [...nodes.slice(0, leftIndex + 1), newNode, ...nodes.slice(rightIndex)];
}

export function setNodeValue(nodes: AutomationNode[], nodeId: string, newValue: number): AutomationNode[] {
    return nodes.map(n => n.id === nodeId ? { ...n, value: clamp(newValue, 0, 1) }: n);
}

export function moveNode(nodes: AutomationNode[], nodeId: string, newBeat: number, newValue: number): AutomationNode[] {
    const index = nodes.findIndex(n => n.id === nodeId);
    if(index < 0) return nodes;

    const isBorder = index === 0 || index === nodes.length - 1;
    const clampedBeat = isBorder
        ? nodes[index]!.beat
        : clamp(newBeat, nodes[index - 1]!.beat, nodes[index + 1]!.beat);

    return nodes.map(n => n.id === nodeId ? { ...n, beat: clampedBeat, value: clamp(newValue, 0, 1) } : n);
}

export function shiftNodeValues(nodes: AutomationNode[], delta: number): AutomationNode[] {
    return nodes.map(n => ({ ...n, value: clamp(n.value + delta, 0, 1) }));
}

export function setNodeTension(nodes: AutomationNode[], nodeId: string, newTension: number): AutomationNode[] {
    return nodes.map(n => n.id === nodeId ? { ...n, curveTension: clamp(newTension, -1, 1) }: n);
}

export function deleteNode(nodes: AutomationNode[], nodeId: string): AutomationNode[] {
    if(nodes.length <= 2) return nodes;

    const index = nodes.findIndex(n => n.id === nodeId);
    if(index <= 0 || index >= nodes.length - 1) return nodes; // guard first/last
    return [ ...nodes.slice(0, index), ...nodes.slice(index + 1) ];
}

export function resizeNodes(nodes: AutomationNode[], _oldLength: number, newLength: number): AutomationNode[] {
    const cutIndex = nodes.findIndex(n => n.beat >= newLength);

    if(cutIndex === -1) {
        // expanding: just move the end node forward
        return nodes.map((n, i) => i === nodes.length - 1 ? { ...n, beat: newLength } : n);
    }

    // the first node at/past newLength becomes the new end node, snapped to newLength
    return [...nodes.slice(0, cutIndex), { ...nodes[cutIndex]!, beat: newLength }];
}

export function createDefaultCurve(parameterId: string, noteLengthBeats: number, defaultNormalized: number): AutomationCurve {
    return {
        parameterId,
        nodes: [
            { id: nanoid(), beat: 0, value: defaultNormalized, curveTension: 0 },
            { id: nanoid(), beat: noteLengthBeats, value: defaultNormalized, curveTension: 0 },
        ]
    };
}