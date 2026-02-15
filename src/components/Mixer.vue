<script setup lang="ts">
import { inject, computed, ref } from 'vue';
import { mixerManager, type MixerTrack } from '../audio/mixerManager';
import { gainToDb } from '../util/miscUtil';
import { getAudioEngine } from '../services/audioEngineManager';
import Slider from './buttons/Slider.vue'
import Knob from './buttons/Knob.vue'

const closeWindow = inject<() => void>('closeWindow');
const resetWindow = inject<() => void>('resetWindow');
const dragWindow = inject<(e: PointerEvent) => void>('dragWindow');

const engine = getAudioEngine();
const tracks = computed(() => mixerManager.getAllMixers());
const activeTrackId = ref<string | null>('master');

function muteCircleColor(channel: MixerTrack) {
  if(channel.solo) return 'var(--playhead)';
  if(channel.muted) return 'var(--step-35)';
  return 'var(--playhead)';
}

function commitTrackName(id: string, e: Event) {
  const input = e.target as HTMLInputElement;

  if(input.value) {
    mixerManager.setName(id, input.value);
  } else {
    input.value = mixerManager.getMixer(id)?.name ?? 'Unnamed';
  }
}

function onTrackNameKeydown(e: KeyboardEvent) {
  if(e.key === 'Enter') (e.target as HTMLInputElement).blur();
  if(e.key === 'Escape') (e.target as HTMLInputElement).blur();
}
</script>

<template>
  <div class="flex flex-col h-full w-full bg-mix-15">
    <!-- toolbar / drag handle -->
    <div class="window-header border-b-2 border-mix-30 bg-mix-15 px-3 shrink-0"
      @pointerdown.stop="dragWindow?.($event)">
      <span class="text-xs font-medium flex-1">Mixer</span>
      <button class="w-6 h-6 rounded util-button flex items-center justify-center" @pointerdown.stop @click="resetWindow?.()" title="Reset position and size">
        <span class="pi pi-refresh text-xs" />
      </button>
      <button class="w-6 h-6 rounded util-button flex items-center justify-center" @pointerdown.stop @click="closeWindow?.()">
        <span class="pi pi-times text-xs" />
      </button>
    </div>

    <div class="flex flex-row flex-1 min-w-0 m-h-0 overflow-auto">
      <div v-for="track in tracks" :key="track.id" class="flex flex-col w-28 items-center min-w-0 gap-1 px-2 border-r-3 border-mix-20 hover:bg-mix-20 py-1 transition-colors shrink-0" @pointerdown="activeTrackId = track.id">
        <input 
          v-model="track.name"
          class="px2 py-0.5 rounded text-sm font-mono bg-mix-10 focus:outline-none w-full text-center truncate px-1"
          @focus="($event.target as HTMLInputElement).select()"
          @blur="commitTrackName(track.id, $event)"
          @keydown="onTrackNameKeydown"
        />

        <!-- mute + knob row -->
        <div class="flex flex-row items-center justify-between w-full px-1">
          <button
            @click="engine.toggleMixerMute(track.id)"
            @contextmenu.prevent="engine.toggleMixerSolo(track.id)"
            class="flex items-center justify-center w-6 h-6 rounded shrink-0 focus:outline-none"
            :title="track.solo ? 'Solo (right-click to toggle)' : track.muted ? 'Unmute' : 'Mute (right-click to solo)'"
          >
            <span class="w-2 h-2 rounded-full transition-colors" :style="{ backgroundColor: muteCircleColor(track) }" />
          </button>
          <Knob :model-value="0.5" :size="28" :show-arc="false" title="Pan" />
        </div>

        <!-- volume number -->
        <span class="text-xs text-gray-400">{{ gainToDb(track.volume).toFixed(1) }} dB</span>

        <!-- gain slider -->
        <div class="flex-1 min-h-0 flex items-stretch">
          <Slider :default-value="1" :title="`Volume: ${Math.round(track.volume * 100)}%`" :model-value="track.volume" :active="activeTrackId === track.id" @update:model-value="v => engine.setMixerGain(track.id, v)"/>
        </div>

        <div class="relative flex items-center justify-center mt-auto w-full h-5">
          <span class="absolute left-1 text-xs text-gray-300">
            {{ parseInt(track.id.replace('mixer-', ''), 10) || 'MASTER' }}
          </span>
          <button v-if="track.id !== 'master'" @click="engine.removeMixer(track.id)">
            <span class="pi pi-times text-sm text-red-400"></span>
          </button>
        </div>
      </div>

      <div v-if="tracks.length === 0" class="flex items-center justify-center flex-1 opacity-30 text-xs">
        No tracks
      </div>
    </div>
  </div>
</template>