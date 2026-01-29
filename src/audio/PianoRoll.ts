import { reactive } from 'vue';

export type Cell = { row: number; col: number };
export type NoteBlock = { row: number; col: number, length: number };

export class PianoRoll {
    private notesBlocks: NoteBlock[] = [];
    private resizingNote: NoteBlock | null = null;

    readonly range: { min: number, max: number };

    constructor(range: {min: number, max: number }) {
        if(range.min > range.max)
            throw new Error('Range min cannot be greater than max!');

        this.range = range;
        this.notesBlocks = reactive([]);
    }

    public getNotes() : NoteBlock[] {
        return [...this.notesBlocks];
    }

    public isResizing(): boolean {
        return this.resizingNote !== null;
    }

    public getHoveredNote(cell: Cell) {
        const index = this.notesBlocks.findIndex(n => n.row === cell.row && cell.col >= n.col && cell.col < n.col + n.length);
        return index === -1 ? null : { note: this.notesBlocks[index], index };
    }

    public addNote(cell: Cell, length: number) {
        if(cell.row < 0 || cell.row > (this.range.max - this.range.min))
            return new Error(`Row ${cell.row} out of range (${this.range.min} to ${this.range.max})`);

        this.notesBlocks.push({ ...cell, length });
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