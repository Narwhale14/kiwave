<script setup lang="ts">
import { snapDivision, snapOptions } from '../util/snap';
import { playbackMode, togglePlaybackMode } from '../services/playbackModeManager';
import { arrangementVisible } from '../services/arrangementManager';
import { activePattern, patterns, closePattern } from '../services/patternsListManager';
import { activeWindowId, focusWindow } from '../services/windowManager';
import BaseDropdown from './modals/BaseDropdown.vue';
import { HEADER_HEIGHT } from '../constants/layout';

function handleModeToggle(event: MouseEvent) {
  togglePlaybackMode();
  (event.target as HTMLButtonElement).blur();
}

function toggleArrangement() {
  if (activeWindowId.value === 'arrangement-window') {
    arrangementVisible.value = false;
    const p = activePattern.value ?? patterns.value[0];
    if (p) { p.visible = true; focusWindow(p.id); }
  } else {
    arrangementVisible.value = true;
    focusWindow('arrangement-window');
  }
}

function togglePianoRoll() {
  const p = activePattern.value ?? patterns.value[0];
  if (!p) return;
  if (activeWindowId.value === p.id) {
    closePattern(p.num);
    arrangementVisible.value = true;
    focusWindow('arrangement-window');
  } else {
    p.visible = true;
    focusWindow(p.id);
  }
}
</script>

<template>
  <div class="flex w-full border-2 bg-mix-15 border-mix-30 px-3 gap-4 items-center" :style="{ height: `${HEADER_HEIGHT}px` }">
    <!-- Playback Mode Toggle -->
    <button @click="handleModeToggle" class="flex justify-center items-center px-2 py-1 w-20 text-xs font-semibold rounded transition-colors playhead-color text-black">
      {{ playbackMode === 'pattern' ? 'Pattern' : 'Song' }}
    </button>

    <!-- arrangement toggle -->
    <button
      @click="toggleArrangement"
      class="flex items-center justify-center w-8 h-8 rounded transition-colors hover:bg-mix-40"
      :class="arrangementVisible ? 'bg-mix-35' : 'bg-mix-30'"
      title="Toggle Arrangement"
    >
      <span class="pi pi-table text-sm"></span>
    </button>

    <!-- piano roll toggle -->
    <button
      @click="togglePianoRoll"
      class="flex items-center justify-center w-8 h-8 rounded transition-colors hover:bg-mix-40"
      :class="activePattern ? 'bg-mix-35' : 'bg-mix-30'"
      title="Toggle Piano Roll"
    >
      <img src="/icons/piano-icon-white.png" class="w-5 h-5 object-contain" />
    </button>

    <!-- Snap Division -->
    <label class="flex items-center gap-2 text-xs">
        <BaseDropdown
          v-model="snapDivision"
          :items="snapOptions"
          item-label="label"
          item-value="value"
          button-bg="bg-mix-25"
          width="20"
        />
      </label>
  </div>
</template>