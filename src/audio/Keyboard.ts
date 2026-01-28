import { noteToMidi, midiToNoteName, isBlackKey } from "./midiUtils";

export type MidiNote = { note: string, octave: number };

export class Keyboard {
    private keys: number[];
    private range: { start: number, end: number };

    constructor(start: MidiNote, end: MidiNote) {
        const startMidi = noteToMidi(start.note, start.octave);
        const endMidi = noteToMidi(end.note, end.octave);

        if(startMidi > endMidi) throw new Error('Start note must be lower than end note');

        this.keys = [];
        for(let midi = startMidi; midi <= endMidi; midi++) {
            this.keys.push(midi);
        }

        this.range = { start: startMidi, end: endMidi };
    }

    public getKeys(): readonly number[] {
        return this.keys;
    }

    public getRange(): { start: number, end: number } {
        return { ...this.range };
    }

    public getKeyboardInfo() {
        return this.keys.map(midi => ({
            midi,
            note: midiToNoteName(midi),
            isBlack: isBlackKey(midi)
        }));
    }
}