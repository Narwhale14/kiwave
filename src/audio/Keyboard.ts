import { noteToMidi, midiToNoteName, isBlackKey } from "../util/midi";

/**
 * type used to define a note
 */
export type MidiNote = { note: string, octave: number };

export class Keyboard {
    private keys: number[];
    private range: { min: number, max: number };

    constructor(min: MidiNote, max: MidiNote) {
        const startMidi = noteToMidi(min.note, min.octave);
        const endMidi = noteToMidi(max.note, max.octave);

        if(startMidi > endMidi) throw new Error('Start note must be lower than end note');

        this.keys = [];
        for(let midi = startMidi; midi <= endMidi; midi++) {
            this.keys.push(midi);
        }

        this.range = { min: startMidi, max: endMidi };
    }

    getKeys(): readonly number[] {
        return this.keys;
    }

    getRange(): { min: number, max: number } {
        return { ...this.range };
    }

    getKeyboardInfo() {
        return this.keys.map(midi => ({
            midi,
            note: midiToNoteName(midi),
            isBlack: isBlackKey(midi)
        }));
    }
}

// single instance
export const keyboard = new Keyboard({ note: 'C', octave: 0 }, { note: 'C', octave: 10 });