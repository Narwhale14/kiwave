<script setup lang="ts">
import { reactive, computed, onMounted, onBeforeUnmount } from 'vue';
import { snapDivision } from '../util/snap';
import { getAudioEngine } from '../services/audioEngineManager';
import { playbackMode, registerArrangementCallbacks, unregisterArrangementCallbacks } from '../services/playbackModeManager';

const engine = getAudioEngine();

// Playhead state
const playhead = reactive({
  col: 0,
  playing: false
});

// Grid settings
const trackHeight = 100;  // Height of each track in pixels
const beatWidth = 80;     // Width of one beat in pixels (same as piano roll)
const beatsPerBar = 4;    // 4 beats per bar
const numTracks = 10;      // Number of tracks
const numBars = 32;       // Number of bars to show

// Calculated widths (reactive)
const barWidth = beatWidth * beatsPerBar;
const snapWidth = computed(() => beatWidth / snapDivision.value);

// Keyboard handler
function handleKeyDown(event: KeyboardEvent) {
  // Only respond to keyboard if in arrangement mode
  if (playbackMode.value !== 'arrangement') return;

  const target = event.target as HTMLElement;
  if(['INPUT', 'TEXTAREA'].includes(target.tagName)) return;

  if(event.code === 'Space') {
    event.preventDefault();
    // TODO: Compile arrangement and set notes
    // For now, just toggle the scheduler (it will play whatever notes are loaded)
    engine.scheduler.toggle();
    return;
  }

  if(event.code === 'Enter') {
    event.preventDefault();
    engine.scheduler.stop();
    return;
  }
}

// Lifecycle
onMounted(() => {
  // Define callbacks for arrangement mode
  const playheadCallback = (beat: number) => {
    playhead.col = beat;
  };

  const playStateCallback = (playing: boolean) => {
    playhead.playing = playing;
  };

  // Register callbacks with the mode manager
  registerArrangementCallbacks(playheadCallback, playStateCallback);

  // Add keyboard listener
  window.addEventListener('keydown', handleKeyDown);
});

onBeforeUnmount(() => {
  // Unregister callbacks
  unregisterArrangementCallbacks();

  // Clear notes if we're in arrangement mode
  if (playbackMode.value === 'arrangement') {
    engine.scheduler.setNotes([]);
    if(engine.scheduler.isPlaying) {
      engine.scheduler.stop();
    }
  }

  // Remove keyboard listener
  window.removeEventListener('keydown', handleKeyDown);
});
</script>

<template>
  <div class="flex-1 overflow-auto bg-mix-20">
    <!-- Arrangement workspace -->
    <div
      class="relative arrangement-grid"
      :style="{
        '--track-h': `${trackHeight}px`,
        '--beat-w': `${beatWidth}px`,
        '--bar-w': `${barWidth}px`,
        '--snap-w': `${snapWidth}px`,
        width: `${numBars * barWidth}px`,
        height: `${numTracks * trackHeight}px`
      }"
    >
      <!-- Playhead (only visible in arrangement mode) -->
      <div v-if="playbackMode === 'arrangement' && (playhead.playing || playhead.col > 0)"
        class="absolute w-0.75 pointer-events-none playhead-color"
        :style="{
          transform: `translateX(${playhead.col * beatWidth}px)`,
          top: '0',
          height: `${numTracks * trackHeight}px`,
          boxShadow: `-1px 0 6px var(--playhead)`
        }"
      ></div>
    </div>
  </div>
</template>