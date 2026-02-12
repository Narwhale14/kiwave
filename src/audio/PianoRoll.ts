import { reactive } from 'vue';
import { snapDivision, snapNearest, getSnapSize } from '../util/snap'

export type Cell = { row: number; col: number };
export type NoteBlock = {
    id: string,
    row: number,
    col: number,
    length: number,
    velocity: number,
    channelId: string,
    midi: number
};

export class PianoRoll {
    readonly _noteData: NoteBlock[] = [];
    readonly _keyboardNotes: { midi: number; note: string; isBlack: boolean }[];
    resizingNote: NoteBlock | null = null;

    readonly range: { min: number, max: number };

    constructor(range: {min: number, max: number }, keyboardNotes: { midi: number; note: string; isBlack: boolean }[]) {
        if(range.min > range.max)
            throw new Error('Range min cannot be greater than max!');

        this.range = range;
        this._noteData = reactive([]);
        this._keyboardNotes = keyboardNotes;
    }


    get getNoteData(): NoteBlock[] {
        return [...this._noteData];
    }

    get getKeyboardNotes(): { midi: number; note: string; isBlack: boolean }[] {
        return [...this._keyboardNotes];
    }

    isResizing(): boolean {
        return this.resizingNote !== null;
    }

    rowToMidi(row: number): number {
        const index = this._keyboardNotes.length - 1 - row;
        return this._keyboardNotes[index] ? this._keyboardNotes[index].midi : -1;
    }

    getHoveredNote(cell: Cell) {
        const gridCol = Math.round(cell.col * snapDivision.value);
        const index = this._noteData.findIndex(n => {
            if(n.row !== cell.row) return false;

            const noteStart = Math.round(n.col * snapDivision.value);
            const noteEnd = Math.round((n.col + n.length) * snapDivision.value);

            return gridCol >= noteStart && gridCol < noteEnd;
        });

        return index === -1 ? null : { note: this._noteData[index], index };
    }

    getEndBeat(beatsPerBar: number): number {
        if(this._noteData.length === 0) return beatsPerBar;

        const lastNoteEnd = Math.max( ...this._noteData.map(n => n.col + n.length));
        return Math.ceil(lastNoteEnd / beatsPerBar) * beatsPerBar;
    }

    addNote(cell: Cell, id: string, length: number, velocity: number): number {
        if(cell.row < 0 || cell.row > (this.range.max - this.range.min))
            return -1;

        const midi = this.rowToMidi(cell.row);
        this._noteData.push({ id, ...cell, length, velocity, channelId: 'synth', midi });
        return midi;
    }

    deleteNote(index: number) {
        this._noteData.splice(index, 1);
    }

    startResize(note: NoteBlock) {
        this.resizingNote = note;
    }

    getResizingNoteCol(): number {
        return this.resizingNote?.col ?? 0;
    }

    resize(targetCol: number): number {
        if(!this.resizingNote) return getSnapSize();
        const snappedTarget = snapNearest(targetCol);
        this.resizingNote.length = Math.max(getSnapSize(), snappedTarget - this.resizingNote.col);

        return this.resizingNote.length;
    }

    stopResize() {
        this.resizingNote = null;
    }

    move(noteId: string, newRow: number, newCol: number) {
        const note = this._noteData.find(n => n.id === noteId);
        if(!note) return;

        note.row = Math.max(0, Math.min(newRow, this._keyboardNotes.length - 1));
        note.col = Math.max(0, newCol);
        note.midi = this.rowToMidi(note.row);
    }
}