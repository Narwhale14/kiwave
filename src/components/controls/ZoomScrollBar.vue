<script setup lang="ts">
import { ref } from 'vue';
import { clamp } from '../../util/miscUtil';

const props = defineProps<{
  startPercent: number;
  viewWidthPercent: number;
}>();

const emit = defineEmits(['update:view', 'pan']);
const container = ref<HTMLDivElement | null>(null);

function startDrag(event: PointerEvent, mode: 'pan' | 'left' | 'right', initialStart: number) {
  if(!container.value) return;
  const rect = container.value!.getBoundingClientRect();
  const initalX = event.clientX;
  const initialWidth = props.viewWidthPercent;

  const move = (eventMove: PointerEvent) => {
    const delta = (eventMove.clientX - initalX) / rect?.width;
    let nextStart = initialStart;
    let nextWidth = initialWidth;

    if(mode === 'pan') {
      nextStart = clamp(initialStart + delta, 0, 1 - initialWidth);
    } else if(mode === 'left') {
      nextStart = clamp(initialStart + delta, 0, initialStart + initialWidth - 0.05);
      nextWidth = initialWidth - (nextStart - initialStart);
    } else if(mode === 'right') {
      nextWidth = clamp(initialWidth + delta, 0.05, 1 - initialStart);
      nextStart = initialStart;
    }

    emit('update:view', { start: nextStart, width: nextWidth });
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
  <div ref="container" class="h-5 bg-mix-15 border-b-2 border-mix-30 relative select-none overflow-hidden touch-none" @pointerdown="onTrackClick">
    <div class="flex flex-row justify-between absolute bg-mix-40 border border-mix-60 group hover:bg-mix-50 inset-y-0"
      :style="{ left: `${props.startPercent * 100}%`, width: `${props.viewWidthPercent * 100}%` }"
      @pointerdown.stop="startDrag($event, 'pan', props.startPercent)"
    >
      <div class="w-2 cursor-w-resize -ml-1" @pointerdown.stop="startDrag($event, 'left', props.startPercent)"></div>
      <div class="w-2 cursor-e-resize -mr-1" @pointerdown.stop="startDrag($event, 'right', props.startPercent)"></div>
    </div>
  </div>
</template>