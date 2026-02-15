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

export function manipulateColor(color: string, percent: number, alpha = 1) {
    if(color.length !== 7 || !color.startsWith('#')) return;

    let r = 0, g = 0, b = 0;
    r = parseInt(color.slice(1, 3), 16);
    g = parseInt(color.slice(3, 5), 16);
    b = parseInt(color.slice(5, 7), 16);

    r = Math.min(255, Math.round(r + (255 - r) * percent));
    g = Math.min(255, Math.round(g + (255 - g) * percent));
    b = Math.min(255, Math.round(b + (255 - b) * percent));

    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}