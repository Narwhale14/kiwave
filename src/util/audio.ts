import { linear } from "./math";

export function dbToGain(value: number, minDb: number, maxDb: number) {
    const db = linear(value, minDb, maxDb);
    return Math.pow(10, db / 20);
}

export function gainToDb(gain: number) {
    return 20 * Math.log10(gain);
}