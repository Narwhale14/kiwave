<script setup lang="ts">
import { channelManager } from '../audio/channelManager';
import { computed } from 'vue';

const channels = computed(() => channelManager.getAllChannels());
const anySoloed = computed(() => channels.value.some(c => c.solo));

function muteCircleColor(channel: { muted: boolean; solo: boolean }) {
  if(anySoloed.value) return channel.solo ? 'var(--playhead)' : 'var(--step-35)';
  return channel.muted ? 'var(--step-35)' : 'var(--playhead)';
}

function onMixerTrackKeydown(e: KeyboardEvent) {
  if(e.key === 'Enter') (e.target as HTMLInputElement).blur();
  if(e.key === 'Escape') (e.target as HTMLInputElement).blur();
}

function commitMixerTrack(id: string, e: Event) {
  const input = e.target as HTMLInputElement;
  const val = parseInt(input.value, 10);
  if(!isNaN(val) && val >= 0) {
    channelManager.setMixerRoute(id, val);
    input.value = val.toString();
  } else {
    input.value = (channelManager.getChannel(id)?.mixerTrack ?? 0).toString();
  }
}
</script>

<template>
  <div class="flex flex-col w-full h-full bg-mix-10 overflow-y-auto">
    <div
      v-for="channel in channels"
      :key="channel.id"
      class="flex flex-row items-center gap-2 px-2 py-1 border-b border-mix-20 hover:bg-mix-15 transition-colors"
    >
      <!-- mute toggle (left click) / solo toggle (right click) -->
      <button
        @click="channelManager.toggleMute(channel.id)"
        @contextmenu.prevent="channelManager.toggleSolo(channel.id)"
        class="flex items-center justify-center w-6 h-6 rounded shrink-0 focus:outline-none"
        :title="channel.solo ? 'Solo (right-click to toggle)' : channel.muted ? 'Unmute' : 'Mute (right-click to solo)'"
      >
        <span
          class="w-3 h-3 rounded-full transition-colors"
          :style="{ backgroundColor: muteCircleColor(channel) }"
        ></span>
      </button>

      <!-- mixer track number input -->
      <input
        :value="channel.mixerTrack"
        type="text"
        inputmode="numeric"
        class="bg-mix-10 border border-mix-25 rounded text-center text-xs font-mono font-bold w-8 py-0.5 outline-none shrink-0"
        @focus="($event.target as HTMLInputElement).select()"
        @blur="commitMixerTrack(channel.id, $event)"
        @keydown="onMixerTrackKeydown"
      />

      <!-- channel name button -->
      <button
        class="flex-1 text-left px-2 py-0.5 rounded text-sm font-mono bg-mix-15 border border-mix-25 hover:bg-mix-25 transition-colors truncate min-w-0"
      >
        {{ channel.name }}
      </button>
    </div>

    <div v-if="channels.length === 0" class="flex items-center justify-center flex-1 opacity-30 text-xs">
      No channels
    </div>
  </div>
</template>
