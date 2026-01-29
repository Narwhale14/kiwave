import { reactive } from 'vue';

export type Cell = { row: number; col: number };
export type NoteBlock = { row: number; col: number, length: number, midi: number };

export class PianoRoll {
    private notesBlocks: NoteBlock[] = [];
    private keyboardNotes: { midi: number; note: string; isBlack: boolean }[];
    private resizingNote: NoteBlock | null = null;

    readonly range: { min: number, max: number };

    constructor(range: {min: number, max: number }, keyboardNotes: { midi: number; note: string; isBlack: boolean }[]) {
        if(range.min > range.max)
            throw new Error('Range min cannot be greater than max!');

        this.range = range;
        this.notesBlocks = reactive([]);
        this.keyboardNotes = keyboardNotes;
    }

    public getNoteBlocks(): NoteBlock[] {
        return [...this.notesBlocks];
    }

    public getKeyboardNotes(): { midi: number; note: string; isBlack: boolean }[] {
        return [...this.keyboardNotes];
    }

    public isResizing(): boolean {
        return this.resizingNote !== null;
    }

    public rowToMidi(row: number): number {
        const index = this.keyboardNotes.length - 1 - row;
        return this.keyboardNotes[index] ? this.keyboardNotes[index].midi : -1;
    }

    public getHoveredNote(cell: Cell) {
        const index = this.notesBlocks.findIndex(n => n.row === cell.row && cell.col >= n.col && cell.col < n.col + n.length);
        return index === -1 ? null : { note: this.notesBlocks[index], index };
    }

    public addNote(cell: Cell, length: number): number {
        if(cell.row < 0 || cell.row > (this.range.max - this.range.min))
            return -1;

        const midi = this.rowToMidi(cell.row);
        this.notesBlocks.push({ ...cell, length, midi });
        return midi;
    }

    public deleteNote(index: number) {
        this.notesBlocks.splice(index, 1);
    }

    public startResize(note: NoteBlock) {
        this.resizingNote = note;
    }

    public resize(targetCol: number): number {
        if(!this.resizingNote) return 1; // default length
        this.resizingNote.length = Math.max(1, Math.round(targetCol - this.resizingNote.col));

        return this.resizingNote.length;
    }

    public stopResize() {
        this.resizingNote = null;
    }
}