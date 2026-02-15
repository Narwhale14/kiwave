import { nanoid } from 'nanoid';
import type { AutomationNode, AutomationCurve, AutomationSegment } from './types';
import { clamp } from '../../util/miscUtil';

// The value the curve passes through at the segment midpoint (x = 0.5).
// tension = 0 → linear midpoint; tension > 0 → bowed up; tension < 0 → bowed down.
export function getHandleValue(v0: number, v1: number, tension: number): number {
    return clamp((v0 + v1) / 2 + tension, 0, 1);
}

// Evaluate the quadratic bezier at fraction x ∈ [0, 1].
// The curve is constructed so it passes through getHandleValue(v0, v1, tension) at x = 0.5.
// Because the bezier control point is always at x = 0.5, the bezier parameter equals x directly.
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

// Power curve (FL Studio style): handle is bounded within [min(v0,v1), max(v0,v1)].
// tension ∈ [-1, 1] maps linearly to h ∈ [0, 1]; h = 0.5 → linear.
// curve: v(x) = v0 + (v1 - v0) * x^p, where p = log2(1/h).

export function getPowerHandleValue(v0: number, v1: number, tension: number): number {
    const h = (tension + 1) / 2; // [0, 1]
    return v0 + (v1 - v0) * h;
}

export function evalPowerCurve(x: number, v0: number, v1: number, tension: number): number {
    if(Math.abs(tension) < 1e-4) return v0 + (v1 - v0) * x;
    const h = clamp((tension + 1) / 2, 1e-4, 1 - 1e-4);
    // Symmetric split: p is always ≥ 1 so slopes are finite at both ends.
    // h < 0.5 → ease in:  x^p           (slow start, fast finish)
    // h > 0.5 → ease out: 1-(1-x)^p     (fast start, slow finish)
    // Both pass through h at x=0.5 by construction.
    let t: number;
    if(h <= 0.5) {
        const p = Math.log2(1 / h);         // ≥ 1 since h ≤ 0.5
        t = Math.pow(x, p);
    } else {
        const p = Math.log2(1 / (1 - h));   // ≥ 1 since (1-h) ≤ 0.5
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