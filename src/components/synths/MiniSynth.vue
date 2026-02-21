<script setup lang="ts">
import { inject } from 'vue';


const closeWindow = inject<() => void>('closeWindow');
const resetWindow = inject<() => void>('resetWindow');
const dragWindow = inject<(event: PointerEvent) => void>('dragWindow');
</script>

<template>
  <div class="flex flex-col">
    <div class="window-header bg-mix-15 px-3 shrink-0 border-b-2 border-mix-30"
      @pointerdown.stop="dragWindow?.($event)">
      <span class="text-xs font-medium">MiniSynth</span>
      <div class="flex-1" />

      <button class="w-6 h-6 rounded util-button flex items-center justify-center" @pointerdown.stop @click="resetWindow?.()" title="Reset position and size">
        <span class="pi pi-refresh text-xs" />
      </button>

      <button class="w-6 h-6 rounded util-button flex items-center justify-center" @pointerdown.stop @click="closeWindow?.()" title="Close window">
        <span class="pi pi-times text-xs" />
      </button>
    </div>
  </div>
</template>