import { reactive } from 'vue';
import { snapDivision, getSnapSize } from '../util/snap'
import { PARAMETER_MAP } from './Automation';
import { createDefaultCurve, resizeNodes, shiftNodeValues, type AutomationCurve } from './Automation';
import { markDirty } from '../util/dirty';

export type Cell = { row: number; col: number };
export type NoteBlock = {
    id: string,
    row: number,
    col: number,
    length: number,
    velocity: number,
    channelId: string,
    midi: number,
    automation: Map<string, AutomationCurve>
};

export class PianoRoll {
    readonly _noteData: NoteBlock[] = [];
    readonly _keyboardNotes: { midi: number; note: string; isBlack: boolean }[];
    readonly _state = reactive({ version: 0 });
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

    get version(): number {
        return this._state.version;
    }

    incrementState() {
        this._state.version++;
        markDirty();
    }

    loadNote(saved: Omit<NoteBlock, 'automation'> & { automation: AutomationCurve[] }): void {
        const automation = new Map(saved.automation.map(curve => [curve.parameterId, curve]));
        this._noteData.push({ ...saved, automation });
        this.incrementState();
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

    addNote(cell: Cell, id: string, length: number, velocity: number, channelId: string): number {
        if(cell.row < 0 || cell.row > (this.range.max - this.range.min))
            return -1;

        const midi = this.rowToMidi(cell.row);
        this._noteData.push({ id, ...cell, length, velocity, channelId, midi, automation: new Map() });
        this.incrementState();
        return midi;
    }

    deleteNote(index: number) {
        this._noteData.splice(index, 1);
        this.incrementState();
    }

    setVelocity(noteId: string, velocity: number) {
        const note = this._noteData.find(n => n.id === noteId);
        if(!note) return;
        note.velocity = velocity;
        this.incrementState();
    }

    startResize(note: NoteBlock) {
        this.resizingNote = note;
    }

    getResizingNoteCol(): number {
        return this.resizingNote?.col ?? 0;
    }

    resize(targetCol: number): number {
        if(!this.resizingNote) return getSnapSize();
        this.resizingNote.length = Math.max(getSnapSize(), targetCol - this.resizingNote.col);
        this.incrementState();
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
        this.incrementState();
    }

    // AUTOMATION

    activateLane(noteId: string, parameterId: string): AutomationCurve {
        const note = this._noteData.find(n => n.id === noteId);
        if(!note) throw new Error(`Note ${noteId} not found`);

        if(note.automation.has(parameterId)) {
            return note.automation.get(parameterId)!;
        }

        const def = PARAMETER_MAP.get(parameterId)!;
        const defaultNorm = def.getDefaultNormalized?.(note.midi) ?? def.defaultNormalized;
        const curve = createDefaultCurve(parameterId, note.length, defaultNorm);
        note.automation.set(parameterId, curve);
        this.incrementState();
        return curve;
    }

    updateCurve(noteId: string, curve: AutomationCurve): void {
        const note = this._noteData.find(n => n.id === noteId);
        if(!note) return;
        note.automation.set(curve.parameterId, curve);
        this.incrementState();
    }

    deactivateLane(noteId: string, parameterId: string): void {
        const note = this._noteData.find(n => n.id === noteId);
        note?.automation.delete(parameterId);
        this.incrementState();
    }

    followNoteMove(noteId: string, oldMidi: number, newMidi: number): void {
        if(oldMidi === newMidi) return;
        const note = this._noteData.find(n => n.id === noteId);
        if(!note) return;

        for(const [parameterId, curve] of note.automation) {
            const def = PARAMETER_MAP.get(parameterId);
            if(!def?.followNote || !def.getDefaultNormalized) continue;

            const delta = def.getDefaultNormalized(newMidi) - def.getDefaultNormalized(oldMidi);
            note.automation.set(parameterId, { ...curve, nodes: shiftNodeValues(curve.nodes, delta) });
        }

        this.incrementState();
    }

    updateAutomationForResize(noteId: string, oldLength: number, newLength: number): void {
        const note = this._noteData.find(n => n.id === noteId);
        if(!note) return;

        for(const [id, curve] of note.automation) {
            note.automation.set(id, { ...curve, nodes: resizeNodes(curve.nodes, oldLength, newLength) });
        }

        this.incrementState();
    }
}