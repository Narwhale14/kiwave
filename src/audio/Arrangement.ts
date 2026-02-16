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
    solo: boolean;
}

export class Arrangement {
    private _clips: ArrangementClip[] = reactive([]);
    private _tracks: ArrangementTrack[] = reactive([]);
    private soloTrackId: string | null = null;
    private nextClipId = 1;

    constructor() {
        // 4 default tracks
        this.addTrack('Track 1');
        this.addTrack('Track 2');
        this.addTrack('Track 3');
        this.addTrack('Track 4');
    }

    get clips(): ArrangementClip[] {
        return [...this._clips];
    }

    get tracks(): ArrangementTrack[] {
        return [...this._tracks];
    }

    // gets a sorted list of tracks
    getAllTracks(): ArrangementTrack[] {
        return [...this._tracks].sort((a, b) => {
            return parseInt(a.id.replace('track-', ''), 10) - parseInt(b.id.replace('track-', ''), 10);
        });
    }

    // gets the last beat of any clip in the arrangement
    getEndBeat(): number {
        if(this._clips.length === 0) return 0;
        return Math.max(...this._clips.map(c => c.startBeat + c.duration));
    }

    // gets the next ID available for a track. used visually
    private getNextTrackId(): number {
        const used = new Set(this._tracks.map(t => parseInt(t.id.replace('track-', ''), 10)));
        let n = 1;
        
        while(used.has(n)) n++;
        return n;
    }

    // adds a clip
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

    // removes a clip
    removeClip(id: string): void {
        const index = this._clips.findIndex(c => c.id === id);
        if(index === -1) return;
        this._clips.splice(index, 1);
    }

    // generic update clip function
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

    // adds a track
    addTrack(name?: string): void {
        const num = this.getNextTrackId();
        const id = `track-${num}`;
        this._tracks.push({
           id,
           name: name || `Track ${num}`,
           height: 100,
           muted: false,
           solo: false
        });
    }

    // removes a track
    removeTrack(id: string): void {
        const index = this._tracks.findIndex(t => t.id === id);
        if(index === -1) return;
        this._tracks.splice(index, 1);
    }

    // resizes a track
    resizeTrack(id: string, height: number): void {
        const track = this._tracks.find(t => t.id === id);
        if(!track) return;
        track.height = height;
    }

    getClipAt(track: number, beat: number): ArrangementClip | null {
        return this._clips.find(c => c.track === track && beat >= c.startBeat && beat < (c.startBeat + c.duration)) || null;
    }

    // mutes a track
    toggleMuteTrack(id: string) {
        const track = this._tracks.find(t => t.id === id);
        if(!track) return;

        if(this.soloTrackId) {
            const soloed = this._tracks.find(t=> t.id === this.soloTrackId);
            if(soloed) { soloed.solo = false; }
            this.soloTrackId = null;
        }

        track.muted = !track.muted;
    }

    // solos a track
    toggleSoloTrack(id: string) {
        const track = this._tracks.find(t => t.id === id);
        if(!track) return;

        if(this.soloTrackId === id) {
            track.solo = false;
            this.soloTrackId = null;
            this._tracks.forEach(t => t.muted = false);
            return;
        }

        if(this.soloTrackId) {
            const previous = this._tracks.find(t => t.id === this.soloTrackId);
            if(previous) previous.solo = false;
        }

        track.solo = true;
        this.soloTrackId = id;
        this._tracks.forEach(t => { t.muted = t.id !== id });
    }
}

// temp singleton arrangement component
export const arrangement = new Arrangement();