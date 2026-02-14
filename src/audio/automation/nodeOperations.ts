import { nanoid } from 'nanoid';
import type { AutomationNode, AutomationCurve, AutomationSegment } from './types';
import { clamp } from '../../util/parameterMapping';

// maps linear t through a tension shaped curve
export function applyTension(t: number, tension: number): number {
    if(Math.abs(tension) < 1e-4) return t;
    const exp = Math.pow(2, tension * 2);
    if(t < 0.5) {
        return 0.5 * Math.pow(2 * t, exp);
    } else {
        return 1 - 0.5 * Math.pow(2 * (1 - t), exp);
    }
}

export function buildCurveArray(startValue: number, endValue: number, tension: number, samples = 64): Float32Array {
    const array = new Float32Array(samples);
    for(let i = 0; i < samples; i++) {
        const t = i / (samples - 1);
        const curvedT = applyTension(t, tension);
        array[i] = startValue + (endValue - startValue) * curvedT;
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

export function insertNode(nodes: AutomationNode[], atBeat: number, noteLengthBeats: number): AutomationNode[] {
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
    if (rightIndex < nodes.length) {
        const left = nodes[leftIndex];
        const right = nodes[rightIndex];
        const tLinear = (clampedBeat - left!.beat) / (right!.beat - left!.beat);
        const tCurved = applyTension(tLinear, left!.curveTension);
        interpolatedValue = left!.value + tCurved * (right!.value - left!.value);
    }

    const newNode: AutomationNode = {
        id: nanoid(),
        beat: clampedBeat,
        value: interpolatedValue,
        curveTension: nodes[leftIndex]!.curveTension
    };

    return [...nodes.slice(0, leftIndex + 1), newNode, ...nodes.slice(rightIndex)];
}

export function setNodeValue(nodes: AutomationNode[], nodeId: string, newValue: number): AutomationNode[] {
    return nodes.map(n => n.id === nodeId ? { ...n, value: clamp(newValue, 0, 1) }: n);
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
    return nodes.map((n, i) =>
        i === nodes.length - 1 ? { ...n, beat: newLength } : n
    );
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