export function stepReduceByInterval(value: number, interval: number, steps: number) {
    let result = value;

    for(let i = 0; i < steps; i++) {
        if(result % interval !== 0) break;
        result /= interval;
    }

    return result;
}

export function clamp(v: number, min: number, max: number) {
    return Math.min(max, Math.max(min, v));
}

export function linear(value: number, min: number, max: number) {
    return min + value * (max - min);
}

export function exponential(value: number, min: number, max: number) {
    return min * Math.pow(max / min, value);
}