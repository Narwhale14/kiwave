import { reactive } from "vue";
import type { MiniSynth } from "./MiniSynth";
import { markDirty } from '../util/dirty';

export interface Channel {
    id: string;
    name: string;
    instrument: MiniSynth;
    mixerTrack: number; // for routing. 0 = master
    volume: number;
    pan: number;
    muted: boolean;
    solo: boolean;
    // color: string; // visually
}

export class ChannelManager {
    private channels: Channel[] = reactive([]);
    private soloChannelId: string | null = null;
    private nextId = 1;
    onMuteStateChanged: (() => void) | null = null;

    addChannel(instrument: MiniSynth, name?: string): string {
        const id = `channel-${this.nextId}`
        this.channels.push({
            id,
            name: name || `Channel ${this.nextId}`,
            instrument,
            mixerTrack: 0,
            volume: 1,
            pan: 0,
            muted: false,
            solo: false
        });
        this.nextId++;
        markDirty();
        return id;
    }

    removeChannel(id: string) {
        const index = this.channels.findIndex(c => c.id === id);
        if(index !== -1) { this.channels.splice(index, 1); markDirty(); }
    }

    getChannel(id: string): Channel | null {
        return this.channels.find(c => c.id === id) ?? null;
    }

    getAllChannels(): Channel[] {
        return Array.from(this.channels.values());
    }

    getNumChannels(): number {
        return this.channels.length;
    }

    getLatestChannelId(): string | null {
        if(this.channels.length === 0) return null;
        return `channel-${this.nextId - 1}`;
    }

    setMixerRoute(id: string, mixerTrack: number) {
        const channel = this.channels.find(c => c.id === id);
        if(!channel) return;
        channel.mixerTrack = mixerTrack;
        markDirty();
    }

    setVolume(id: string, volume: number) {
        const channel = this.channels.find(c => c.id === id);
        if(!channel) return;
        channel.volume = volume;
        markDirty();
    }

    setPan(id: string, pan: number) {
        const channel = this.channels.find(c => c.id === id);
        if(!channel) return;
        channel.pan = pan;
        markDirty();
    }

    toggleMute(id: string) {
        const channel = this.channels.find(c => c.id === id);
        if(!channel) return;

        if(this.soloChannelId) {
            const soloed = this.channels.find(c => c.id === this.soloChannelId);
            if(soloed) { soloed.solo = false; }
            this.soloChannelId = null;
        }

        channel.muted = !channel.muted;
        this.onMuteStateChanged?.();
        markDirty();
    }

    toggleSolo(id: string) {
        const channel = this.channels.find(c => c.id === id);
        if(!channel) return;

        if(this.soloChannelId === id) {
            channel.solo = false;
            this.soloChannelId = null;
            this.channels.forEach(ch => ch.muted = false);
            this.onMuteStateChanged?.();
            markDirty();
            return;
        }

        if(this.soloChannelId) {
            const previous = this.channels.find(c => c.id === this.soloChannelId);
            if(previous) previous.solo = false;
        }

        channel.solo = true;
        this.soloChannelId = id;
        this.channels.forEach(ch => { ch.muted = ch.id !== id; });
        this.onMuteStateChanged?.();
        markDirty();
    }

    // --- load/save helpers ---

    get nextChannelIdCounter(): number {
        return this.nextId;
    }

    setNextId(n: number) {
        this.nextId = n;
    }

    addChannelWithId(instrument: MiniSynth, id: string, name: string): void {
        this.channels.push({
            id,
            name,
            instrument,
            mixerTrack: 0,
            volume: 1,
            pan: 0,
            muted: false,
            solo: false
        });
    }

    clearAllChannels() {
        this.channels.splice(0, this.channels.length);
        this.soloChannelId = null;
        this.nextId = 1;
    }

    restoreSoloState(id: string | null) {
        this.soloChannelId = id;
    }
}

// singleton instance of channelManager
export const channelManager = new ChannelManager();