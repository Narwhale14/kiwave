<script setup lang="ts">
import { channelManager, type Channel } from '../audio/channelManager';
import { mixerManager } from '../audio/mixerManager';
import { getAudioEngine } from '../services/audioEngineManager';
import { computed, inject, onBeforeUnmount, ref, watch } from 'vue';

const engine = getAudioEngine();
const showSynthPicker = ref(false);
const addButtonRef = ref<HTMLButtonElement | null>(null);
const pickerRef = ref<HTMLDivElement | null>(null);
const pickerStyle = ref({ top: '0px', left: '0px' });

const closeWindow = inject<() => void>('closeWindow');
const resetWindow = inject<() => void>('resetWindow');
const dragWindow = inject<(e: PointerEvent) => void>('dragWindow');

const channels = computed(() => channelManager.getAllChannels());

function openPicker() {
  if (!addButtonRef.value) return;
  const rect = addButtonRef.value.getBoundingClientRect();
  pickerStyle.value = {
    top: `${rect.bottom + 4}px`,
    left: `${rect.left + rect.width / 2}px`,
  };
  showSynthPicker.value = !showSynthPicker.value;
}

function selectSynth(id: string) {
  engine.addChannel(id);
  showSynthPicker.value = false;
}

function onPointerDown(e: PointerEvent) {
  if (!pickerRef.value?.contains(e.target as Node) && !addButtonRef.value?.contains(e.target as Node))
    showSynthPicker.value = false;
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') showSynthPicker.value = false;
}

function onMixerTrackKeydown(e: KeyboardEvent) {
  if(e.key === 'Enter') (e.target as HTMLInputElement).blur();
  if(e.key === 'Escape') (e.target as HTMLInputElement).blur();
}

function commitMixerTrack(id: string, e: Event) {
  const input = e.target as HTMLInputElement;
  const val = parseInt(input.value, 10);
  if(!isNaN(val) && val >= 0 && mixerManager.getMixerByNumber(val)) {
    engine.setChannelRoute(id, val);
    input.value = val.toString();
  } else {
    input.value = (channelManager.getChannel(id)?.mixerTrack ?? 0).toString();
  }
}

function muteCircleColor(channel: Channel) {
  if(channel.solo) return 'var(--playhead)';
  if(channel.muted) return 'var(--step-35)';
  return 'var(--playhead)';
}

watch(showSynthPicker, open => {
  if (open) {
    document.addEventListener('pointerdown', onPointerDown, { capture: true });
    document.addEventListener('keydown', onKeyDown);
  } else {
    document.removeEventListener('pointerdown', onPointerDown, { capture: true });
    document.removeEventListener('keydown', onKeyDown);
  }
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onPointerDown, { capture: true });
  document.removeEventListener('keydown', onKeyDown);
});
</script>

<template>
  <div class="flex flex-col w-full bg-mix-15">
    <!-- toolbar / drag handle -->
    <div class="window-header border-b-2 border-mix-30 bg-mix-15 px-3 shrink-0"
      @pointerdown.stop="dragWindow?.($event)">
      <span class="text-xs font-medium flex-1">Channel Rack</span>
      <button class="w-6 h-6 rounded util-button flex items-center justify-center" @pointerdown.stop @click="resetWindow?.()" title="Reset position and size">
        <span class="pi pi-refresh text-xs" />
      </button>
      <button class="w-6 h-6 rounded util-button flex items-center justify-center" @pointerdown.stop @click="closeWindow?.()">
        <span class="pi pi-times text-xs" />
      </button>
    </div>

    <div>
      <div v-for="channel in channels" :key="channel.id" class="flex flex-row items-center gap-2 px-2 border-b border-mix-20 hover:bg-mix-15 py-1 transition-colors shrink-0">
        <!-- mute toggle (left click) / solo toggle (right click) -->
        <button
          @click="engine.toggleChannelMute(channel.id)"
          @contextmenu.prevent="engine.toggleChannelSolo(channel.id)"
          class="flex items-center justify-center w-6 h-6 rounded shrink-0 focus:outline-none"
          :title="channel.solo ? 'Solo (right-click to toggle)' : channel.muted ? 'Unmute' : 'Mute (right-click to solo)'"
        >
          <span class="w-2 h-2 rounded-full transition-colors" :style="{ backgroundColor: muteCircleColor(channel) }" />
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
        <button class="flex-1 text-left px-2 py-0.5 rounded text-sm font-mono bg-mix-10 border border-mix-25 hover:bg-mix-20 transition-colors truncate min-w-0">
          {{ channel.name }}
        </button>

        <button @click="engine.removeChannel(channel.id)">
          <span class="pi pi-times text-sm text-red-400"></span>
        </button>
      </div>

      <div v-if="channels.length === 0" class="flex items-center justify-center flex-1 opacity-30 text-xs">
        No channels
      </div>
    </div>

    <div class="flex justify-center items-center p-1">
      <button ref="addButtonRef" class="flex justify-center items-center w-10 h-7 bg-mix-10 rounded-lg" @click="openPicker">
        <span class="pi pi-plus text-sm"></span>
      </button>
    </div>

    <Teleport to="body">
      <div v-if="showSynthPicker" ref="pickerRef" class="fixed z-9999 -translate-x-1/2 bg-mix-20 border border-mix-40 rounded shadow-lg py-0.5 min-w-max"
        :style="pickerStyle">
        <button
          v-for="synth in engine.availableSynths"
          :key="synth.id"
          class="px-2 py-0.5 text-xs cursor-pointer w-full text-left hover:bg-mix-30 transition-colors whitespace-nowrap"
          @click="selectSynth(synth.id)"
        >{{ synth.displayName }}</button>
      </div>
    </Teleport>
  </div>
</template>
