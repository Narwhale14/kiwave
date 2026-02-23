<script setup lang="ts">
import { dynamicSnapNearest } from '../../util/snap';
import { getAudioEngine } from '../../services/audioEngineManager';
import { playbackMode, setPlaybackMode, type PlaybackMode } from '../../services/playbackModeManager';
import { computed } from 'vue';

const engine = getAudioEngine();

const props = defineProps<{
  container: HTMLDivElement | null;
  mode: PlaybackMode;
  interval: number;
  count: number;
  playtime: number;
}>();

const labelStep = computed(() => {
  const minLabelSpace = 40;
  let step = 1;

  while((step * props.interval) < minLabelSpace) {
    step *= 2;
  }

  return step;
});

function seekToPointer(event: PointerEvent, container: HTMLDivElement) {
  if(!container) return;
  const rect = container.getBoundingClientRect();
  
  let beat = 0;
  if(event.shiftKey) {
    beat = (event.clientX - rect.left) / props.interval;
  } else {
    beat = dynamicSnapNearest((event.clientX - rect.left) / props.interval, props.interval);
  }

  engine.scheduler.seek(Math.max(0, beat));
}

function handleTimelinePointerDown(event: PointerEvent) {
  if(!props.container) return;
  if(playbackMode.value !== props.mode) setPlaybackMode(props.mode);
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  seekToPointer(event, props.container);
}

function handleTimelineScrub(event: PointerEvent) {
  if(!props.container) return;
  if(!(event.currentTarget as HTMLElement).hasPointerCapture(event.pointerId)) return;
  seekToPointer(event, props.container);
}
</script>

<template>
  <div class="bg-mix-10 flex flex-row items-center h-5 w-full sticky top-0 z-10 border-b-2 border-mix-5" @pointerdown.stop="handleTimelinePointerDown" @pointermove="handleTimelineScrub">
    <div v-for="i in count" :key="i" :style="{ width: `${interval}px` }">
      <span v-if="(i - 1) % labelStep === 0" class="text-xs font-mono absolute -translate-1/2 opacity-50">{{ i }}</span>
    </div>

    <span v-if="playbackMode === props.mode" class="pi pi-sort-down-fill absolute text-sm font-fold -translate-x-1/2 text-(--playhead)" :style="{ left: `${playtime}px` }"></span>
  </div>
</template>