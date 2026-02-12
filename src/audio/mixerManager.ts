import { reactive } from "vue";

export interface MixerTrack {
    id: string;
    name: string;
    route: number; // default 0 for master
    volume: number;
    pan: number;
    muted: boolean;
    solo: boolean;
    // effects: Effect[];
}

export class MixerManager {
    private tracks: Map<string, MixerTrack> = reactive(new Map());
    private nextId = 1;

    constructor() {
        this.tracks.set('master', {
            id: 'master',
            name: 'Master',
            route: -1, // doesnt route anywhere
            volume: 0.8,
            pan: 0,
            muted: false,
            solo: false
        });
    }

    addMixer(name?: string) {
        const id = `mixer-${this.nextId}`;
        this.tracks.set(id, {
            id,
            name: name || `Mixer ${this.nextId}`,
            route: 0,
            volume: 1,
            pan: 0,
            muted: false,
            solo: false
        });

        this.nextId++;
    }

    removeMixer(id: string) {
        this.tracks.delete(id);
    }

    getMixer(id: string): MixerTrack | null {
        const track = this.tracks.get(id);
        if(!track) return null;
        return track;
    }

    getMixers(): MixerTrack[] {
        return Array.from(this.tracks.values());
    }

    setRoute(id: string, route: number) {
        const track = this.tracks.get(id);
        if(!track) return;
        track.route = route;
    }

    setVolume(id: string, volume: number) {
        const track = this.tracks.get(id);
        if(!track) return;
        track.volume = volume;
    }

    setPan(id: string, pan: number) {
        const track = this.tracks.get(id);
        if(!track) return;
        track.pan = pan;
    }

    toggleMute(id: string) {
        const track = this.tracks.get(id);
        if(!track) return;
        track.muted = !track.muted
    }

    toggleSolo(id: string) {
        const track = this.tracks.get(id);
        if(!track) return;
        track.solo = !track.solo
    }
}

// singleton instance of mixerManager
export const mixerManager = new MixerManager();