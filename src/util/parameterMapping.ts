export function linear(value: number, min: number, max: number) {
    return min + value * (max - min);
}

export function exponential(value: number, min: number, max: number) {
    return min * Math.pow(max / min, value);
}

export function clamp(v: number, min: number, max: number) {
    return Math.min(max, Math.max(min, v));
}

export function dbToGain(value: number, minDb: number, maxDb: number) {
    const db = linear(value, minDb, maxDb);
    return Math.pow(10, db / 20);
}

export function gainToDb(gain: number) {
    return 20 * Math.log10(gain);
}