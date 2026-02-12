export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const BLACK_KEYS = new Set(['C#', 'D#', 'F#', 'G#', 'A#']);

export function midiToNoteName(midi: number): string {
    const note = NOTE_NAMES[midi % 12];
    const octave = Math.floor(midi / 12) - 1;
    return `${note}${octave}`;
}

export function midiToFrequency(midi: number): number {
    return 440 * Math.pow(2, (midi - 69) / 12);
}

export function noteToMidi(note: string, octave: number): number {
    const index = NOTE_NAMES.indexOf(note);
    if(index === -1) throw new Error(`Invalid note: ${note}`);
    return (octave + 1) * 12 + index;
}

export function isBlackKey(midi: number): boolean {
    return BLACK_KEYS.has(NOTE_NAMES[midi % 12]!);
}