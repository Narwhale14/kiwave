<script setup lang="ts">
import { reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { snapDivision, snap } from '../util/snap';
import { getAudioEngine } from '../services/audioEngineManager';
import { playbackMode, registerArrangementCallbacks, unregisterArrangementCallbacks } from '../services/playbackModeManager';
import { patterns } from '../services/patternsListManager';
import { arrangement } from '../services/arrangementManager';

const engine = getAudioEngine();

// Playhead state
const playhead = reactive({
  col: 0,
  playing: false
});

const trackHeight = 50;  // Height of each track in pixels
const beatWidth = 80;     // Width of one beat in pixels (same as piano roll)
const beatsPerBar = 4;    // 4 beats per bar
const numTracks = 10;      // Number of tracks
const numBars = 32;       // Number of bars to show

const barWidth = beatWidth * beatsPerBar;
const snapWidth = computed(() => beatWidth / snapDivision.value);

function handleKeyDown(event: KeyboardEvent) {
  if (playbackMode.value !== 'arrangement') return;

  const target = event.target as HTMLElement;
  if(['INPUT', 'TEXTAREA'].includes(target.tagName)) return;

  if(event.code === 'Space') {
    event.preventDefault();
    // Compile arrangement before playing
    if (!engine.scheduler.isPlaying) {
      recompileArrangement();
    }
    engine.scheduler.toggle();
    return;
  }

  if(event.code === 'Enter') {
    event.preventDefault();
    engine.scheduler.stop();
    return;
  }
}

function handleDragOver(event: DragEvent) {
  event.preventDefault();
  if(event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy';
  }
}

function handleDrop(event: DragEvent) {
  event.preventDefault();

  const patternId = event.dataTransfer?.getData('pattern-id');
  if(!patternId) return;

  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;

  const startBeat = snap(x / beatWidth);
  const track = Math.floor(y / trackHeight);

  const pattern = patterns.value.find(p => p.id === patternId);
  if(!pattern) return;

  const duration = pattern.roll.getEndBeat(beatsPerBar);

  // create clip with pattern
  arrangement.addClip(patternId, track, startBeat, duration, 0);
  recompileArrangement();
}

function recompileArrangement() {
  const engine = getAudioEngine();
  const patternMap = new Map(patterns.value.map(p => [p.id, p]));
  const compiledNotes = engine.compiler.compile(patternMap, 0, Infinity);
  engine.scheduler.setNotes(compiledNotes);
}

// watch for arrangement changes
watch(() => arrangement.clips, () => {
  if(playbackMode.value === 'arrangement') {
    recompileArrangement();
  }
}, { deep: true });

// watch for pattern edits - _noteData is mutated in place so reference never changes,
// always invalidate all patterns and recompile if in arrangement mode
watch(() => patterns.value.map(p => p.roll._noteData), () => {
  patterns.value.forEach(p => engine.compiler.invalidatePattern(p.id));
  if (playbackMode.value === 'arrangement') recompileArrangement();
}, { deep: true });

// recompile when switching to arrangement mode (picks up edits made in pattern mode)
watch(playbackMode, (newMode) => {
  if (newMode === 'arrangement') recompileArrangement();
});

// Lifecycle
onMounted(() => {
  const playheadCallback = (beat: number) => {
    playhead.col = beat;
  };

  const playStateCallback = (playing: boolean) => {
    playhead.playing = playing;
  };

  registerArrangementCallbacks(playheadCallback, playStateCallback);
  window.addEventListener('keydown', handleKeyDown);

  // Initial compilation when entering arrangement mode
  if (playbackMode.value === 'arrangement') {
    recompileArrangement();
  }
});

onBeforeUnmount(() => {
  unregisterArrangementCallbacks();
  if(playbackMode.value === 'arrangement') {
    engine.scheduler.setNotes([]);
    if(engine.scheduler.isPlaying) {
      engine.scheduler.stop();
    }
  }

  window.removeEventListener('keydown', handleKeyDown);
});
</script>

<template>
  <div class="w-full h-full overflow-auto bg-mix-20">
    <!-- Arrangement workspace -->
    <div
      class="relative arrangement-grid"
      @dragover="handleDragOver"
      @drop="handleDrop"
      :style="{
        '--track-h': `${trackHeight}px`,
        '--beat-w': `${beatWidth}px`,
        '--bar-w': `${barWidth}px`,
        '--snap-w': `${snapWidth}px`,
        width: `${numBars * barWidth}px`,
        height: `${numTracks * trackHeight}px`
      }"
    >
      <!-- Render clips -->
      <div
        v-for="clip in arrangement.clips"
        :key="clip.id"
        class="absolute border-2 border-white/30 bg-blue-500/50 rounded cursor-pointer overflow-hidden"
        :style="{
          left: `${clip.startBeat * beatWidth}px`,
          top: `${clip.track * trackHeight}px`,
          width: `${clip.duration * beatWidth}px`,
          height: `${trackHeight}px`
        }"
      >
        <div class="p-1 text-xs truncate">
          {{ patterns.find(p => p.id === clip.patternId)?.name || 'Pattern' }}
        </div>
      </div>

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