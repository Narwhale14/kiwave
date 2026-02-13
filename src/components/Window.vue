<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch, nextTick, provide } from 'vue';
import { registerWindow, beginResize, beginMove, windows, unregisterWindow, activeWindowId, focusWindow, positionWindow } from '../services/windowManager';

const props = withDefaults(defineProps<{
  id: string;
  visible: boolean;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  autoHeight?: boolean;
  dragging?: boolean;
  resizing?: {
    left?: boolean;
    right?: boolean;
    top?: boolean;
    bottom?: boolean;
  };
}>(), { x: 100, y: 100, width: 1200, height: 600, dragging: true });

const emit = defineEmits<{
  (event: 'close'): void
}>();

const rootElement = ref<HTMLElement | null>(null);
provide('windowElement', rootElement);
provide('windowId', props.id);
provide('closeWindow', () => emit('close'));
provide('resetWindow', () => positionWindow(props.id, props.x!, props.y!, props.width!, props.height!));
provide('dragWindow', (e: PointerEvent) => {
  if (props.dragging) beginMove(props.id, e);
});

watch(activeWindowId, id => {
  if(id === props.id) {
    nextTick(() => rootElement.value?.focus());
  }
});

watch(() => props.width, w => {
  const win = windows.find(w => w.id === props.id);
  if (win && w !== undefined) win.width = w;
});

watch(() => props.height, h => {
  const win = windows.find(w => w.id === props.id);
  if (win && h !== undefined) win.height = h;
});

let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
  registerWindow({
    id: props.id,
    x: props.x!,
    y: props.y!,
    width: props.width!,
    height: props.height!,
    z: 0
  });

  if(props.autoHeight && rootElement.value) {
    resizeObserver = new ResizeObserver(entries => {
      const win = windows.find(w => w.id === props.id);
      if(win && entries[0]) win.height = entries[0].contentRect.height;
    });
    
    resizeObserver.observe(rootElement.value);
  }
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  unregisterWindow(props.id);
});
</script>

<template>
  <div ref="rootElement" v-if="visible" tabindex="0"
    class="fixed text-white overflow-visible select-none focus:outline-none border-2 bg-mix-15 border-mix-30"
    @pointerdown="focusWindow(id)"
    :style="{
      left: windows.find(w => w.id === id)?.x + 'px',
      top: windows.find(w => w.id === id)?.y + 'px',
      width: windows.find(w => w.id === id)?.width + 'px',
      height: autoHeight ? 'fit-content' : windows.find(w => w.id === id)?.height + 'px',
      zIndex: windows.find(w => w.id === id)?.z
    }"
  >
    <slot />

    <!-- resize edges -->
    <div v-if="resizing?.left"   class="absolute inset-y-0 -left-1 w-2 cursor-w-resize"  @pointerdown.stop="beginResize(id, 'left',   $event)" />
    <div v-if="resizing?.right"  class="absolute inset-y-0 -right-1 w-2 cursor-e-resize" @pointerdown.stop="beginResize(id, 'right',  $event)" />
    <div v-if="!autoHeight && resizing?.top"    class="absolute inset-x-0 -top-1 h-2 cursor-n-resize"   @pointerdown.stop="beginResize(id, 'top',    $event)" />
    <div v-if="!autoHeight && resizing?.bottom" class="absolute inset-x-0 -bottom-1 h-2 cursor-s-resize" @pointerdown.stop="beginResize(id, 'bottom', $event)" />

    <!-- resize corners (only when both adjacent sides are enabled) -->
    <div v-if="!autoHeight && resizing?.top    && resizing?.left"  class="absolute -top-1 -left-1 w-3 h-3 cursor-nw-resize" @pointerdown.stop="beginResize(id, 'top-left',     $event)" />
    <div v-if="!autoHeight && resizing?.top    && resizing?.right" class="absolute -top-1 -right-1 w-3 h-3 cursor-ne-resize" @pointerdown.stop="beginResize(id, 'top-right',    $event)" />
    <div v-if="!autoHeight && resizing?.bottom && resizing?.left"  class="absolute -bottom-1 -left-1 w-3 h-3 cursor-sw-resize" @pointerdown.stop="beginResize(id, 'bottom-left',  $event)" />
    <div v-if="!autoHeight && resizing?.bottom && resizing?.right" class="absolute -bottom-1 -right-1 w-3 h-3 cursor-se-resize" @pointerdown.stop="beginResize(id, 'bottom-right', $event)" />
  </div>
</template>
