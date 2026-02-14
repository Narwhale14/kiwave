<script setup lang="ts">
import { reactive, computed, watch, onMounted, onBeforeUnmount, ref, inject } from 'vue';
import { snapDivision, snap, snapNearest } from '../util/snap';
import { getAudioEngine } from '../services/audioEngineManager';
import { playbackMode, registerArrangementCallbacks, unregisterArrangementCallbacks } from '../services/playbackModeManager';
import { patterns, openPattern } from '../services/patternsListManager';
import { arrangement } from '../audio/Arrangement';
import type { ArrangementClip } from '../audio/Arrangement';

const closeWindow = inject<() => void>('closeWindow');
const resetWindow = inject<() => void>('resetWindow');
const dragWindow = inject<(e: PointerEvent) => void>('dragWindow');

interface NoteRect { x: number; y: number; width: number; height: number }
interface ClipPreview { viewBox: string; notes: NoteRect[] }

const engine = getAudioEngine();

const playhead = reactive({
  col: 0,
  playing: false
});

const workspaceRef = ref<HTMLDivElement | null>(null);
const cursor = ref('default');
const interacting = ref(false);
const selectedClipId = ref<string | null>(null);
const state = reactive({
  draggingClip: null as ArrangementClip | null,
  resizingClip: null as ArrangementClip | null,
  dragStart: { beat: 0, track: 0 },
  initialBeat: 0,
  initialTrack: 0,
  initialDuration: 0,
})

const clipPreviews = computed(() => {
  const map = new Map<string, ClipPreview>();
  for (const clip of arrangement.clips) {
    const pattern = patterns.value.find(p => p.id === clip.patternId);
    if (!pattern) continue;
    const allNotes = pattern.roll._noteData;
    if (allNotes.length === 0) continue;

    const midiMin = Math.min(...allNotes.map(n => n.midi));
    const midiMax = Math.max(...allNotes.map(n => n.midi));
    const pad = 1; // 1 semitone breathing room above and below
    const viewBoxH = midiMax - midiMin + 2 * pad;

    const clipEnd = clip.offset + clip.duration;
    const notes: NoteRect[] = allNotes
      .filter(n => n.col + n.length > clip.offset && n.col < clipEnd)
      .map(n => ({
        x: Math.max(0, n.col - clip.offset),
        y: midiMax + pad - n.midi,
        width: Math.min(clipEnd, n.col + n.length) - Math.max(clip.offset, n.col),
        height: 1,
      }));

    map.set(clip.id, { viewBox: `0 0 ${clip.duration} ${viewBoxH}`, notes });
  }
  return map;
});

const trackHeight = 50; // Height of each track in pixels
const beatWidth = 80; // Width of one beat in pixels (same as piano roll)
const beatsPerBar = 4; // 4 beats per bar
const numTracks = 20; // Number of tracks
const numBars = 32; // Number of bars to show

const barWidth = beatWidth * beatsPerBar;
const snapWidth = computed(() => beatWidth / snapDivision.value);

function getWorkspacePos(event: PointerEvent) {
  const rect = workspaceRef.value!.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function isNearRightEdge(x: number, clip: ArrangementClip): boolean {
  return Math.abs(x - (clip.startBeat + clip.duration) * beatWidth) <= 12;
}

function handlePointerMove(event: PointerEvent) {
  if (!workspaceRef.value) return;
  const { x, y } = getWorkspacePos(event);
  const rawBeat = x / beatWidth;
  const track = Math.floor(y / trackHeight);

  if (state.resizingClip) {
    const newDuration = Math.max(1 / snapDivision.value, snapNearest(rawBeat) - state.resizingClip.startBeat);
    arrangement.resizeClip(state.resizingClip.id, newDuration);
    cursor.value = 'w-resize';
    return;
  }

  if (state.draggingClip) {
    const newBeat = Math.max(0, snap(rawBeat - state.dragStart.beat));
    const newTrack = Math.max(0, Math.min(numTracks - 1, track - state.dragStart.track));
    arrangement.moveClip(state.draggingClip.id, newTrack, newBeat);
    cursor.value = 'grabbing';
    return;
  }

  const hovered = arrangement.getClipAt(track, rawBeat);
  cursor.value = hovered ? (isNearRightEdge(x, hovered) ? 'w-resize' : 'grab') : 'default';
}

function finalizeEdit() {
  if (state.draggingClip || state.resizingClip) {
    const clip = state.draggingClip || state.resizingClip;
    const changed = state.draggingClip
      ? state.draggingClip.startBeat !== state.initialBeat || state.draggingClip.track !== state.initialTrack
      : state.resizingClip
        ? state.resizingClip.duration !== state.initialDuration
        : false;
    state.draggingClip = null;
    state.resizingClip = null;
    state.dragStart = { beat: 0, track: 0 };
    interacting.value = false;
    if (changed && clip && playbackMode.value === 'arrangement') {
      engine.compiler.invalidateClip(clip.id);
      recompileArrangement();

      if (engine.scheduler.isPlaying) {
        const beat = engine.scheduler.getCurrentBeat();
        const margin = 4; // beats — covers lookahead + snap granularity
        const oldNear = state.initialBeat < beat + margin && state.initialBeat + clip.duration > beat - margin;
        const newNear = clip.startBeat < beat + margin && clip.startBeat + clip.duration > beat - margin;
        if (oldNear || newNear) engine.scheduler.resetSchedule();
      }
    }
  }
  cursor.value = 'default';
}

// global playback toggling
function handleKeyDown(event: KeyboardEvent) {
  const target = event.target as HTMLElement;
  if(['INPUT', 'TEXTAREA'].includes(target.tagName)) return;

  if(event.code === 'Space') {
    event.preventDefault();

    // recompile if on arrangement mode + not playing
    if (playbackMode.value === 'arrangement' && !engine.scheduler.isPlaying) {
      recompileArrangement();
    }
    
    engine.toggle();
    return;
  }

  if(event.code === 'Enter') {
    event.preventDefault();
    engine.stop();
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
  if (playbackMode.value !== 'arrangement') return;

  const engine = getAudioEngine();
  const patternMap = new Map(patterns.value.map(p => [p.id, p]));
  const compiledNotes = engine.compiler.compile(patternMap, 0, Infinity);
  engine.scheduler.setNotes(compiledNotes);
  const endBeat = arrangement.getEndBeat();
  engine.scheduler.setLoop(true, 0, Math.ceil(endBeat / beatsPerBar) * beatsPerBar || beatsPerBar);
}

function handleDoubleClick(event: MouseEvent) {
  if (!workspaceRef.value) return;
  const rect = workspaceRef.value.getBoundingClientRect();
  const rawBeat = (event.clientX - rect.left) / beatWidth;
  const track = Math.floor((event.clientY - rect.top) / trackHeight);

  const clip = arrangement.getClipAt(track, rawBeat);
  if (!clip) return;

  const pattern = patterns.value.find(p => p.id === clip.patternId);
  if (!pattern) return;
  openPattern(pattern.num);
}

function handlePointerDown(event: PointerEvent) {
  if (event.detail === 2) return;
  if (!workspaceRef.value) return;
  const { x, y } = getWorkspacePos(event);
  const rawBeat = x / beatWidth;
  const track = Math.floor(y / trackHeight);

  const clip = arrangement.getClipAt(track, rawBeat);
  if (!clip) return;

  if (event.button === 2) {
    if (selectedClipId.value === clip.id) selectedClipId.value = null;
    arrangement.removeClip(clip.id);
    recompileArrangement();
    return;
  }

  selectedClipId.value = clip.id;
  interacting.value = true;
  if (isNearRightEdge(x, clip)) {
    state.resizingClip = clip;
    state.initialDuration = clip.duration;
    cursor.value = 'w-resize';
  } else {
    state.draggingClip = clip;
    state.dragStart = { beat: rawBeat - clip.startBeat, track: track - clip.track };
    state.initialBeat = clip.startBeat;
    state.initialTrack = clip.track;
    cursor.value = 'grabbing';
  }
}

// watch for arrangement changes (skip during drag/resize — finalizeEdit recompiles)
watch(() => arrangement.clips, () => {
  if (interacting.value) return;
  if (playbackMode.value === 'arrangement') recompileArrangement();
}, { deep: true });

// watch for pattern edits - compare version counters to only invalidate changed patterns
watch(() => patterns.value.map(p => ({ id: p.id, version: p.roll._state.version })), (newPatterns, oldPatterns) => {
  if (oldPatterns) {
    for (let i = 0; i < newPatterns.length; i++) {
      const np = newPatterns[i];
      const op = oldPatterns[i];
      if (np && op && np.version !== op.version) {
        engine.compiler.invalidatePattern(np.id);
      }
    }
  }
  if (playbackMode.value === 'arrangement') recompileArrangement();
});

// recompile when switching to arrangement mode (picks up edits made in pattern mode)
watch(playbackMode, (newMode) => {
  if(newMode === 'arrangement') recompileArrangement();
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
  <div class="w-full h-full flex flex-col bg-mix-20">
    <!-- toolbar / drag handle -->
    <div class="window-header border-b-2 border-mix-30 bg-mix-15 px-3 shrink-0"
      @pointerdown.stop="dragWindow?.($event)">
      <span class="text-xs font-medium flex-1">Arrangement</span>
      <button class="w-6 h-6 rounded util-button flex items-center justify-center" @pointerdown.stop @click="resetWindow?.()" title="Reset position and size">
        <span class="pi pi-refresh text-xs" />
      </button>
      <button class="w-6 h-6 rounded util-button flex items-center justify-center" @pointerdown.stop @click="closeWindow?.()">
        <span class="pi pi-times text-xs" />
      </button>
    </div>

    <!-- workspace -->
    <div class="flex-1 overflow-auto">
      <div ref="workspaceRef" class="relative arrangement-grid"
        @pointerdown="handlePointerDown"
        @dblclick="handleDoubleClick"
        @pointermove="handlePointerMove"
        @pointerup="finalizeEdit"
        @pointerleave="finalizeEdit"
        @dragover="handleDragOver"
        @drop="handleDrop"
        @contextmenu.prevent
        :style="{
          '--track-h': `${trackHeight}px`,
          '--beat-w': `${beatWidth}px`,
          '--bar-w': `${barWidth}px`,
          '--snap-w': `${snapWidth}px`,
          width: `${numBars * barWidth}px`,
          height: `${numTracks * trackHeight}px`,
          cursor: cursor
        }"
      >
        <!-- clips -->
        <div v-for="clip in arrangement.clips" :key="clip.id"
          :class="['absolute border-2 clip-color rounded overflow-hidden pointer-events-none', clip.id === selectedClipId ? 'clip-border-color' : 'clip-border-muted']"
          :style="{
            left: `${clip.startBeat * beatWidth}px`,
            top: `${clip.track * trackHeight}px`,
            width: `${clip.duration * beatWidth}px`,
            height: `${trackHeight}px`,
          }"
        >
          <!-- note preview -->
          <svg v-if="clipPreviews.get(clip.id)" class="absolute inset-0 w-full h-full" preserveAspectRatio="none" :viewBox="clipPreviews.get(clip.id)!.viewBox">
            <rect
              v-for="(note, i) in clipPreviews.get(clip.id)!.notes"
              :key="i"
              :x="note.x" :y="note.y"
              :width="note.width" :height="note.height"
              fill="white" opacity="0.6"
            />
          </svg>
          <!-- pattern name -->
          <div class="relative z-10 px-1 pt-0.5 text-xs truncate drop-shadow">
            {{ patterns.find(p => p.id === clip.patternId)?.name || 'Pattern' }}
          </div>
        </div>

        <!-- playhead (only visible in arrangement mode) -->
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
  </div>
</template>