<script setup lang="ts">
import { snapDivision, snapOptions } from '../util/snap';
import { playbackMode, togglePlaybackMode } from '../services/playbackModeManager';
import BaseDropdown from './modals/BaseDropdown.vue';
import { HEADER_HEIGHT } from '../constants/layout';

function handleModeToggle(event: MouseEvent) {
  togglePlaybackMode();
  (event.target as HTMLButtonElement).blur();
}
</script>

<template>
  <div class="flex w-full border-2 bg-mix-15 border-mix-30 px-3 gap-4 items-center" :style="{ height: `${HEADER_HEIGHT}px` }">
    <!-- Playback Mode Toggle -->
    <button @click="handleModeToggle" class="flex justify-center items-center px-2 py-1 w-20 text-xs font-semibold rounded transition-colors playhead-color text-black">
      {{ playbackMode === 'pattern' ? 'Pattern' : 'Song' }}
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