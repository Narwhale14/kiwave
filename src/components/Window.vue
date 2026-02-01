<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch, nextTick, provide } from 'vue';
import { registerWindow, beginResize, beginMove, windows, unregisterWindow, activeWindowId } from '../services/windowManager';

const props = withDefaults(defineProps<{
  id: string;
  title: string;
  visible: boolean;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}>(), { x: 100, y: 100, width: 1200, height: 600 });

const emit = defineEmits<{
  (event: 'close'): void
}>();

const rootElement = ref<HTMLElement | null>(null);
provide('windowElement', rootElement);
provide('windowId', props.id);

watch(activeWindowId, id => {
  if(id === props.id)
    nextTick(() => rootElement.value?.focus());
});

onMounted(() => {
  registerWindow({
    id: props.id,
    x: props.x,
    y: props.x,
    width: props.width,
    height: props.height,
    z: 0
  });
});

onBeforeUnmount(() => {
  unregisterWindow(props.id);
});
</script>

<template>
  <div ref="rootElement" v-if="visible" tabindex="0" class="fixed bg-[#1e1e1e] text-white flex flex-col overflow-visible select-none focus:outline-none" 
    :style="{
      left: windows.find(w => w.id === id)?.x + 'px',
      top: windows.find(w => w.id === id)?.y + 'px',
      width: windows.find(w => w.id === id)?.width + 'px',
      height: windows.find(w => w.id === id)?.height + 'px',
      zIndex: windows.find(w => w.id === id)?.z
    }"
  >
    <!-- title bar -->
    <div class="titlebar flex justify-between items-center px-2 " 
      @pointerdown.stop="beginMove(props.id, $event)">
      <div class="flex items-center gap-2 min-w-0">
        <span class="text-sm font-medium truncate">{{ title }}</span>
        <slot name="header-left" />
      </div>
      <div class="flex items-center gap-1">
        <slot name="header-right" />
      </div>

      <button class="w-6 h-6 text-gray-400 hover:text-white hover:bg-red-600 rounded" @pointerdown.stop @click="emit('close')">✕</button>
    </div>

    <!-- content -->
    <div class="flex-1 overflow-y-auto overflow-x-hidden p-3">
      <slot />
    </div>

    <div>
      <!-- resize edges -->
      <div class="absolute inset-y-0 -left-1 w-2 cursor-w-resize" @pointerdown.stop="beginResize(id, 'left', $event)" />
      <div class="absolute inset-y-0 -right-1 w-2 cursor-e-resize" @pointerdown.stop="beginResize(id, 'right', $event)" />
      <div class="absolute inset-x-0 -top-1 h-2 cursor-n-resize" @pointerdown.stop="beginResize(id, 'top', $event)" />
      <div class="absolute inset-x-0 -bottom-1 h-2 cursor-s-resize" @pointerdown.stop="beginResize(id, 'bottom', $event)" />

      <!-- resize corners -->
      <div class="absolute -top-1 -left-1 w-3 h-3 cursor-nw-resize" @pointerdown.stop="beginResize(id, 'top-left', $event)" />
      <div class="absolute -top-1 -right-1 w-3 h-3 cursor-ne-resize" @pointerdown.stop="beginResize(id, 'top-right', $event)" />
      <div class="absolute -bottom-1 -left-1 w-3 h-3 cursor-sw-resize" @pointerdown.stop="beginResize(id, 'bottom-left', $event)" />
      <div class="absolute -bottom-1 -right-1 w-3 h-3 cursor-se-resize" @pointerdown.stop="beginResize(id, 'bottom-right', $event)" />
    </div>
  </div>
</template>