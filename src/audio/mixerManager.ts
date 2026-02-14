import { reactive } from "vue";

export interface MixerTrack {
    id: string;
    name: string;
    route: number; // 0 = master, n = mixer-n, -1 = no route (master only)
    volume: number;
    pan: number;
    muted: boolean;
    solo: boolean;
    // effects: Effect[];
}

export class MixerManager {
    private tracks: MixerTrack[] = reactive([]);
    private soloTrackId: string | null = null;
    private nextId = 1;
    onMuteStateChanged: (() => void) | null = null;

    constructor() {
        this.tracks.push({
            id: 'master',
            name: 'Master',
            route: -1,
            volume: 0.8,
            pan: 0,
            muted: false,
            solo: false
        });
    }

    addMixer(name?: string) {
        const id = `mixer-${this.nextId}`;
        this.tracks.push({
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
        const index = this.tracks.findIndex(t => t.id === id);
        if(index !== -1) this.tracks.splice(index, 1);
    }

    getMixer(id: string): MixerTrack | null {
        return this.tracks.find(t => t.id === id) ?? null;
    }

    getMixerByNumber(n: number): MixerTrack | null {
        const id = n === 0 ? 'master' : `mixer-${n}`;
        return this.tracks.find(t => t.id === id) ?? null;
    }

    getAllMixers(): MixerTrack[] {
        return Array.from(this.tracks.values());
    }

    setName(id: string, name: string) {
        const track = this.tracks.find(t => t.id === id);
        if(!track) return;
        track.name = name;
    }

    setRoute(id: string, route: number) {
        const track = this.tracks.find(t => t.id === id);
        if(!track) return;
        track.route = route;
    }

    setVolume(id: string, volume: number) {
        const track = this.tracks.find(t => t.id === id);
        if(!track) return;
        track.volume = volume;
    }

    setPan(id: string, pan: number) {
        const track = this.tracks.find(t => t.id === id);
        if(!track) return;
        track.pan = pan;
    }

    toggleMute(id: string) {
        const track = this.tracks.find(t => t.id === id);
        if(!track) return;

        if(this.soloTrackId) {
            const soloed = this.tracks.find(t=> t.id === this.soloTrackId);
            if(soloed) { soloed.solo = false; }
            this.soloTrackId = null;
        }

        track.muted = !track.muted;
        this.onMuteStateChanged?.();
    }

    toggleSolo(id: string) {
        const track = this.tracks.find(t => t.id === id);
        if(!track) return;

        if(this.soloTrackId === id) {
            track.solo = false;
            this.soloTrackId = null;
            this.tracks.forEach(t => t.muted = false);
            this.onMuteStateChanged?.();
            return;
        }

        if(this.soloTrackId) {
            const previous = this.tracks.find(t => t.id === this.soloTrackId);
            if(previous) previous.solo = false;
        }

        track.solo = true;
        this.soloTrackId = id;
        // mute all others except master (inserts route through it)
        this.tracks.forEach(t => { t.muted = t.id !== id && t.id !== 'master'; });
        this.onMuteStateChanged?.();
    }
}

// singleton instance of mixerManager
export const mixerManager = new MixerManager();