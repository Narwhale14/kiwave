<script setup lang="ts">
import { reactive, ref, onUnmounted } from 'vue';
import { snapNearestGrid } from '../../util/snap';

const dragShiftKey = ref(false);

const emit = defineEmits<{
  complete: [{
    bounds: { x: number; y: number; width: number; height: number };
    shiftKey: boolean ;
  }];
}>();

const props = withDefaults(defineProps<{
  snapX?: number;
  snapY?: number;
}>(), {
  snapX: 0,
  snapY: 0
});

const containerRef = ref<HTMLElement | null>(null);
const isSelecting = ref(false);
const selection = reactive({
  startX: 0,
  startY: 0,
  x: 0,
  y: 0,
  width: 0,
  height: 0
});

function onPointerDown(event: PointerEvent) {
  if(event.button !== 0 || !containerRef.value) return;

  const rect = containerRef.value.getBoundingClientRect();

  const rawX = event.clientX - rect.left;
  const rawY = event.clientY - rect.top;

  const x = props.snapX ? snapNearestGrid(rawX, props.snapX) : rawX;
  const y = props.snapY ? snapNearestGrid(rawY, props.snapY) : rawY;

  isSelecting.value = true;
  dragShiftKey.value = event.shiftKey;

  selection.startX = x;
  selection.startY = y;
  selection.x = x;
  selection.y = y;
  selection.width = 0;
  selection.height = 0;

  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
}

function onPointerMove(event: PointerEvent) {
  if(!isSelecting.value || !containerRef.value) return;

  const rect = containerRef.value.getBoundingClientRect();
  const rawX = event.clientX - rect.left;
  const rawY = event.clientY - rect.top;

  const currentX = props.snapX ? snapNearestGrid(rawX, props.snapX) : rawX;
  const currentY = props.snapY ? snapNearestGrid(rawY, props.snapY) : rawY;

  const minX = Math.min(selection.startX, currentX);
  const maxX = Math.max(selection.startX, currentX);
  const minY = Math.min(selection.startY, currentY);
  const maxY = Math.max(selection.startY, currentY);

  selection.x = minX;
  selection.y = minY;
  selection.width = maxX - minX;
  selection.height = maxY - minY;
}

function onPointerUp() {
  if(!isSelecting.value) return;

  isSelecting.value = false;

  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);

  if(selection.width < 3 && selection.height < 3) return;

  emit('complete', {
    bounds: { x: selection.x, y: selection.y, width: selection.width, height: selection.height },
    shiftKey: dragShiftKey.value
  });
}

onUnmounted(() => {
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
});
</script>

<template>
  <div ref="containerRef" class="absolute inset-0" @pointerdown="onPointerDown">
    <div v-if="isSelecting" class="absolute border-2 border-blue-400 bg-blue-400/20 pointer-events-none rounded-2xl"
      :style="{ left: selection.x + 'px', top: selection.y + 'px', width: selection.width + 'px', height: selection.height + 'px' }"
    />
  </div>
</template>