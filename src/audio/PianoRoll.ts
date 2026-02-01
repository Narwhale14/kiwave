import { reactive } from 'vue';

export type Cell = { row: number; col: number };
export type NoteBlock = { id: string; row: number; col: number, length: number, midi: number };

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
        const index = this._noteData.findIndex(n => n.row === cell.row && cell.col >= n.col && cell.col < n.col + n.length);
        return index === -1 ? null : { note: this._noteData[index], index };
    }

    addNote(cell: Cell, length: number, id: string): number {
        if(cell.row < 0 || cell.row > (this.range.max - this.range.min))
            return -1;

        const midi = this.rowToMidi(cell.row);
        this._noteData.push({ id, ...cell, length, midi });
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
        if(!this.resizingNote) return 1; // default length
        this.resizingNote.length = Math.max(1, Math.round(targetCol - this.resizingNote.col));

        return this.resizingNote.length;
    }

    stopResize() {
        this.resizingNote = null;
    }
}