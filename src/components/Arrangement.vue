<script setup lang="ts">
import { ref } from 'vue';

// Grid settings
const trackHeight = 100;  // Height of each track in pixels
const beatWidth = 80;     // Width of one beat in pixels (same as piano roll)
const beatsPerBar = 4;    // 4 beats per bar
const numTracks = 10;      // Number of tracks
const numBars = 32;       // Number of bars to show
const snapDivision = ref(4); // 1/4 beat snapping by default

// Calculated widths
const barWidth = beatWidth * beatsPerBar;
const snapWidth = beatWidth / snapDivision.value;
</script>

<template>
  <div class="flex-1 overflow-auto bg-mix-20">
    <!-- Arrangement workspace -->
    <div
      class="arrangement-grid"
      :style="{
        '--track-h': `${trackHeight}px`,
        '--beat-w': `${beatWidth}px`,
        '--bar-w': `${barWidth}px`,
        '--snap-w': `${snapWidth}px`,
        width: `${numBars * barWidth}px`,
        height: `${numTracks * trackHeight}px`
      }"
    >
      <!-- Your clips, playhead, etc. will go here -->
    </div>
  </div>
</template>