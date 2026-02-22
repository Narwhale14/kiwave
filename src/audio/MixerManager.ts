import { reactive } from "vue";

export interface MixerTrack {
    id: string;
    name: string;
    route: number; // 0 = master, n = mixer-n, -1 = no route (master only)
    volume: number;
    pan: number;
    muted: boolean;
    solo: boolean;
    peakDbL: number;
    peakDbR: number;
    // effects: Effect[];
}

class MixerManager {
    private mixers: MixerTrack[] = reactive([]);
    private soloMixerId: string | null = null;
    onMuteStateChanged: (() => void) | null = null;

    constructor() {
        this.mixers.push({
            id: 'master',
            name: 'Master',
            route: -1,
            volume: 1,
            pan: 0,
            muted: false,
            solo: false,
            peakDbL: -Infinity,
            peakDbR: -Infinity,
        });
    }

    private getNextMixerNum(): number {
        const used = new Set(this.mixers.filter(m => m.id !== 'master').map(m => parseInt(m.id.replace('mixer-', ''), 10)));
        let n = 1;
        
        while(used.has(n)) n++;
        return n;
    }

    addMixer(name?: string) {
        const num = this.getNextMixerNum();
        const id = `mixer-${num}`;
        this.mixers.push({
            id,
            name: name || `Mixer ${num}`,
            route: 0,
            volume: 1,
            pan: 0,
            muted: false,
            solo: false,
            peakDbL: -Infinity,
            peakDbR: -Infinity,
        });
    }

    removeMixer(id: string) {
        const index = this.mixers.findIndex(m => m.id === id);
        if(index !== -1) this.mixers.splice(index, 1)
    }

    getMixer(id: string): MixerTrack | null {
        return this.mixers.find(m => m.id === id) ?? null;
    }

    getMixerByNumber(n: number): MixerTrack | null {
        const id = n === 0 ? 'master' : `mixer-${n}`;
        return this.mixers.find(m => m.id === id) ?? null;
    }

    getAllMixers(): MixerTrack[] {
        return [...this.mixers].sort((a, b) => {
            if(a.id === 'master') return -1;
            if(b.id === 'master') return 1;
            return parseInt(a.id.replace('mixer-', ''), 10) - parseInt(b.id.replace('mixer-', ''), 10);
        });
    }

    setName(id: string, name: string) {
        const mixer = this.mixers.find(m => m.id === id);
        if(!mixer) return;
        mixer.name = name;
    }

    setRoute(id: string, route: number) {
        const mixer = this.mixers.find(m => m.id === id);
        if(!mixer) return;
        mixer.route = route;
    }

    setVolume(id: string, volume: number) {
        const mixer = this.mixers.find(m => m.id === id);
        if(!mixer) return;
        mixer.volume = volume;
    }

    setPan(id: string, pan: number) {
        const mixer = this.mixers.find(m => m.id === id);
        if(!mixer) return;
        mixer.pan = pan;
    }

    toggleMute(id: string) {
        const mixer = this.mixers.find(m => m.id === id);
        if(!mixer) return;

        if(this.soloMixerId) {
            const soloed = this.mixers.find(m => m.id === this.soloMixerId);
            if(soloed) { soloed.solo = false; }
            this.soloMixerId = null;
        }

        mixer.muted = !mixer.muted;
        this.onMuteStateChanged?.();
    }

    toggleSolo(id: string) {
        const mixer = this.mixers.find(m => m.id === id);
        if(!mixer) return;

        if(this.soloMixerId === id) {
            mixer.solo = false;
            this.soloMixerId = null;
            this.mixers.forEach(m => m.muted = false);
            this.onMuteStateChanged?.();
            return;
        }

        if(this.soloMixerId) {
            const previous = this.mixers.find(m => m.id === this.soloMixerId);
            if(previous) previous.solo = false;
        }

        mixer.solo = true;
        this.soloMixerId = id;
        // mute all others except master (inserts route through it)
        this.mixers.forEach(m => { m.muted = m.id !== id && m.id !== 'master'; });
        this.onMuteStateChanged?.();
    }

    // --- load/save helpers ---

    addMixerWithId(id: string, name: string, route: number) {
        this.mixers.push({
            id,
            name,
            route,
            volume: 1,
            pan: 0,
            muted: false,
            solo: false,
            peakDbL: -Infinity,
            peakDbR: -Infinity,
        });
    }

    clearMixers() {
        const toRemove = this.mixers.filter(m => m.id !== 'master').map(m => m.id);
        for(const id of toRemove) this.removeMixer(id);
        this.soloMixerId = null;
    }

    restoreSoloState(id: string | null) {
        this.soloMixerId = id;
    }
}

// singleton instance of mixerManager
export const mixerManager = new MixerManager();