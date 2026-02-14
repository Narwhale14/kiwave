import { reactive } from "vue";

export interface ArrangementClip {
    id: string,
    patternId: string; // which pattern the clip has
    track: number; // timeline track, not mixer track
    startBeat: number;
    duration: number;
    offset: number; // for trim from start
    muted: boolean;
}

export interface ArrangementTrack {
    id: string;
    name: string;
    height: number;
    muted: boolean;
}

export class Arrangement {
    private _clips: ArrangementClip[] = reactive([]);
    private _tracks: ArrangementTrack[] = reactive([]);
    private nextClipId = 1;
    private nextTrackId = 1;

    constructor() {
        this.addTrack('Track 1');
        this.addTrack('Track 2');
        this.addTrack('Track 3');
    }

    get clips(): ArrangementClip[] {
        return [...this._clips];
    }

    get tracks(): ArrangementTrack[] {
        return [...this._tracks];
    }

    getEndBeat(): number {
        if(this._clips.length === 0) return 0;
        return Math.max(...this._clips.map(c => c.startBeat + c.duration));
    }

    addClip(patternId: string, track: number, startBeat: number, duration: number, offset: number = 0): void {
        const id = `clip-${this.nextClipId}`;
        this._clips.push({
            id,
            patternId,
            track,
            startBeat,
            duration,
            offset,
            muted: false
        });

        this.nextClipId++;
    }

    removeClip(id: string): void {
        const index = this._clips.findIndex(c => c.id === id);
        if(index === -1) return;
        this._clips.splice(index, 1);
    }

    updateClip(id: string, updates: Partial<ArrangementClip>): void {
        const clip = this._clips.find(c => c.id === id);
        if(!clip) return;
        Object.assign(clip, updates);
    }

    // convenience method for moving
    moveClip(id: string, newTrack: number, newStartBeat: number): void {
        this.updateClip(id, { track: newTrack, startBeat: newStartBeat });
    }

    // convenience method for resizing
    resizeClip(id: string, newDuration: number, newOffset: number = 0): void {
        this.updateClip(id, { duration: newDuration, offset: newOffset });
    }

    addTrack(name?: string): void {
        const id = `track-${this.nextClipId}`;
        this._tracks.push({
           id,
           name: name || `Track ${this.nextClipId}`,
           height: 100,
           muted: false 
        });

        this.nextTrackId++;
    }

    removeTrack(id: string): void {
        const index = this._tracks.findIndex(t => t.id === id);
        if(index === -1) return;
        this._tracks.splice(index, 1);
    }

    resizeTrack(id: string, height: number): void {
        const track = this._tracks.find(t => t.id === id);
        if(!track) return;
        track.height = height;
    }

    getClipsInRange(startBeat: number, endBeat: number): ArrangementClip[] {
        return this._clips.filter(c => c.startBeat < endBeat && (c.startBeat + c.duration) > startBeat);
    }

    getClipsOnTrack(trackNumber: number): ArrangementClip[] {
        return this._clips.filter(c => c.track === trackNumber);
    }

    getClipAt(track: number, beat: number): ArrangementClip | null {
        return this._clips.find(c => c.track === track && beat >= c.startBeat && beat < (c.startBeat + c.duration)) || null;
    }
}

// temp singleton arrangement component
export const arrangement = new Arrangement();