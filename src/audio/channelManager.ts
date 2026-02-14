import { reactive } from "vue";
import type { MiniSynth } from "./MiniSynth";

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
    private channels: Map<string, Channel> = reactive(new Map());
    private soloChannelId: string | null = null;
    private nextId = 1;
    onMuteStateChanged: (() => void) | null = null;

    addChannel(instrument: MiniSynth, name?: string): string {
        const id = `channel-${this.nextId}`
        this.channels.set(id, {
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
        return id;
    }

    removeChannel(id: string) {
        this.channels.delete(id);
    }

    getChannel(id: string): Channel | null {
        return this.channels.get(id) ?? null;
    }

    getAllChannels(): Channel[] {
        return Array.from(this.channels.values());
    }

    getNumChannels(): number {
        return this.channels.size;
    }

    getLatestChannelId(): string | null {
        if(this.channels.size === 0) return null;
        return `channel-${this.nextId - 1}`;
    }

    setMixerRoute(id: string, mixerTrack: number) {
        const channel = this.channels.get(id);
        if(!channel) return;
        channel.mixerTrack = mixerTrack;
    }

    setVolume(id: string, volume: number) {
        const channel = this.channels.get(id);
        if(!channel) return;
        channel.volume = volume;
    }

    setPan(id: string, pan: number) {
        const channel = this.channels.get(id);
        if(!channel) return;
        channel.pan = pan;
    }

    toggleMute(id: string) {
        const channel = this.channels.get(id);
        if(!channel) return;

        if(this.soloChannelId) {
            const soloed = this.channels.get(this.soloChannelId);
            if(soloed) { soloed.solo = false; }
            this.soloChannelId = null;
        }

        channel.muted = !channel.muted;
        this.onMuteStateChanged?.();
    }

    toggleSolo(id: string) {
        const channel = this.channels.get(id);
        if(!channel) return;

        if(this.soloChannelId === id) {
            channel.solo = false;
            this.soloChannelId = null;
            this.channels.forEach(ch => ch.muted = false);
            this.onMuteStateChanged?.();
            return;
        }

        if(this.soloChannelId) {
            const previous = this.channels.get(this.soloChannelId);
            if(previous) previous.solo = false;
        }

        channel.solo = true;
        this.soloChannelId = id;
        this.channels.forEach(ch => { ch.muted = ch.id !== id; });
        this.onMuteStateChanged?.();
    }
}

// singleton instance of channelManager
export const channelManager = new ChannelManager();
