import { reactive } from "vue";
import type { MiniSynth } from "./MiniSynth";

export interface Channel {
    id: string;
    name: string;
    instrument: MiniSynth;
    mixerTrack: number; // for routing. default SHOULD be 0 (master)
    volume: number;
    pan: number;
    muted: boolean;
    solo: boolean;
    // color: string; // visually
}

export class ChannelManager {
    private channels: Map<string, Channel> = reactive(new Map());
    private nextId = 1;

    addChannel(instrument: MiniSynth, name?: string) {
        // new channel
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
    }

    removeChannel(id: string) {
        this.channels.delete(id);
    }

    getChannel(id: string): Channel | null {
        const channel = this.channels.get(id);
        if(!channel) return null;
        return channel;
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
        channel.muted = !channel.muted;
    }

    toggleSolo(id: string) {
        const channel = this.channels.get(id);
        if(!channel) return;
        channel.solo = !channel.solo;
    }
}

// singleton instance of channelManager
export const channelManager = new ChannelManager();