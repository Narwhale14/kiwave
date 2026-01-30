<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue';
import { registerWindow, focusWindow, beginMove, beginResize, type Window, windows, unregisterWindow } from '../services/windowManager';

const props = defineProps<{
  id: string;
  title: string;
  visible: boolean
}>();

const emit = defineEmits<{
  (event: 'close'): void
}>();

function onTitlePointerDown(event: PointerEvent) {
  focusWindow(props.id);
  beginMove(props.id, event);
}

onMounted(() => {
  const window: Window = {
    id: props.id,
    x: 100,
    y: 100,
    width: 400,
    height: 300,
    z: 0
  }

  registerWindow(window);

  console.log(windows.find(w => w.id === props.id)?.x);
  console.log(windows.find(w => w.id === props.id)?.y);
  console.log(windows.find(w => w.id === props.id)?.width);
  console.log(windows.find(w => w.id === props.id)?.height);
  console.log(windows.find(w => w.id === props.id)?.z);
});

onBeforeUnmount(() => {
  unregisterWindow(props.id);
});
</script>

<template>
  <div v-if="visible" class="fixed bg-[#1e1e1e] text-white flex flex-col overflow-visible select-none" 
    :style="{
      left: windows.find(w => w.id === id)?.x + 'px',
      top: windows.find(w => w.id === id)?.y + 'px',
      width: windows.find(w => w.id === id)?.width + 'px',
      height: windows.find(w => w.id === id)?.height + 'px',
      zIndex: windows.find(w => w.id === id)?.z
    }"
    @pointerdown.prevent="focusWindow(id)"
  >

    <!-- title bar -->
    <div class="titlebar flex justify-between items-center px-2" @pointerdown.stop="onTitlePointerDown">
      {{ title }}
      <button class="text-gray-400 hover:text-white" @click="emit('close')">✕</button>
    </div>

    <!-- content -->
    <div class="flex-1 overflow-y-auto overflow-x-hidden p-3">
      <slot />
    </div>

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
</template>