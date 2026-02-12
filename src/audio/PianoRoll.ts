import { reactive } from 'vue';

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
    private static _snapDivision = 4; // cannot surpass 1/32.

    readonly range: { min: number, max: number };

    constructor(range: {min: number, max: number }, keyboardNotes: { midi: number; note: string; isBlack: boolean }[]) {
        if(range.min > range.max)
            throw new Error('Range min cannot be greater than max!');

        this.range = range;
        this._noteData = reactive([]);
        this._keyboardNotes = keyboardNotes;
    }

    get snapDivision(): number {
        return PianoRoll._snapDivision;
    }

    set snapDivision(value: number) {
        PianoRoll._snapDivision = Math.max(0, value);
    }

    // lowest possible 1/32
    get snapSize(): number {
        return PianoRoll._snapDivision > 0 ? 1 / PianoRoll._snapDivision : 1 / 32;
    }

    // snap a value down to the current grid (for placement)
    snap(value: number, to: number = PianoRoll._snapDivision): number {
        if(to === 0) return value;
        return Math.floor(value * to) / to;
    }

    // snap a value to the nearest grid line (for resize edges)
    snapRound(value: number): number {
        if(PianoRoll._snapDivision === 0) return value;
        return Math.round(value * PianoRoll._snapDivision) / PianoRoll._snapDivision;
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
        const gridCol = Math.round(cell.col * PianoRoll._snapDivision);
        const index = this._noteData.findIndex(n => {
            if(n.row !== cell.row) return false;

            const noteStart = Math.round(n.col * PianoRoll._snapDivision);
            const noteEnd = Math.round((n.col + n.length) * PianoRoll._snapDivision);

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
        if(!this.resizingNote) return this.snapSize;
        const snappedTarget = this.snapRound(targetCol);
        this.resizingNote.length = Math.max(this.snapSize, snappedTarget - this.resizingNote.col);

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