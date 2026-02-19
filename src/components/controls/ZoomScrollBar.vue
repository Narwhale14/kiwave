<script setup lang="ts">
import { ref } from 'vue';
import { MAX_ZOOM_FACTOR } from '../../constants/defaults';
import { clamp } from '../../util/math';

const props = defineProps<{
  startPercent: number;
  viewWidthPercent: number;
}>();

const emit = defineEmits(['update:view', 'pan']);
const container = ref<HTMLDivElement | null>(null);

function startDrag(event: PointerEvent, mode: 'pan' | 'left' | 'right', initialStartPercent: number) {
  if(!container.value) return;
  const rect = container.value!.getBoundingClientRect();
  const initalX = event.clientX;
  const initialWidthPercent = props.viewWidthPercent;

  const move = (eventMove: PointerEvent) => {
    const delta = (eventMove.clientX - initalX) / rect?.width;
    let nextStartPercent = initialStartPercent;
    let nextWidthPercent = initialWidthPercent;

    if(mode === 'pan') {
      // only has to change start pos
      nextStartPercent = clamp(initialStartPercent + delta, 0, 1 - initialWidthPercent); // 0% < newpos < 100% - oldpos
    } else if(mode === 'left') {
      // has to change start pos and width
      nextStartPercent = clamp(initialStartPercent + delta, 0, initialStartPercent + initialWidthPercent - MAX_ZOOM_FACTOR); // 0% < newpos < as far as right end is
      nextWidthPercent = initialWidthPercent - (nextStartPercent - initialStartPercent); // diff in pos
    } else if(mode === 'right') {
      // has to change width
      nextWidthPercent = clamp(initialWidthPercent + delta, MAX_ZOOM_FACTOR, 1 - initialStartPercent);
    }

    emit('update:view', { start: nextStartPercent, width: nextWidthPercent });
  }

  const stop = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', stop);
  }

  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', stop);
}

function onTrackClick(event: PointerEvent) {
  if(!container.value) return;
  const rect = container.value!.getBoundingClientRect();
  const newStart = clamp(((event.clientX - rect.left) / rect.width) - (props.viewWidthPercent / 2), 0, 1 - props.viewWidthPercent);
  
  emit('update:view', {
    start: newStart,
    width: props.viewWidthPercent
  });

  startDrag(event, 'pan', newStart);
}
</script>

<template>
  <div ref="container" class="h-5 bg-mix-13 relative border-t-2 border-mix-30 select-none overflow-hidden touch-none" @pointerdown="onTrackClick">
    <div class="flex flex-row justify-between absolute bg-mix-40 border border-mix-60 group hover:bg-mix-50 inset-y-0"
      :style="{ left: `${props.startPercent * 100}%`, width: `${props.viewWidthPercent * 100}%` }"
      @pointerdown.stop="startDrag($event, 'pan', props.startPercent)"
    >
      <div class="w-2 cursor-w-resize -ml-1" @pointerdown.stop="startDrag($event, 'left', props.startPercent)"></div>
      <div class="w-2 cursor-e-resize -mr-1" @pointerdown.stop="startDrag($event, 'right', props.startPercent)"></div>
    </div>
  </div>
</template>