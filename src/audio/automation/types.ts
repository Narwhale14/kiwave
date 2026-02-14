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

/**
 * a pre-compiled web audio API scheduling command.
 * the scheduler produces these; the synth consumes them with no curve knowledge.
 *
 * setValueCurveAtTime is used for all non-linear segments (tension ≠ 0).
 * It takes a pre-sampled float32array — one web audio call per curved segment,
 * far more efficient than N individual linearRampToValueAtTime calls.
 */
export type CompiledParamEvent =
    | { type: 'setValueAtTime'; value: number, time: number }
    | { type: 'linearRampToValueAtTime'; value: number, time: number }
    | { type: 'setValueCurveAtTime'; curve: Float32Array; startTime: number; duration: number};

export type CompiledNoteAutomation = Map<string, CompiledParamEvent[]>;