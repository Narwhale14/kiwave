<script setup lang="ts">
import { reactive, computed, watch, onMounted, onBeforeUnmount, ref, inject, nextTick } from 'vue';
import { snapDivision, getVisualSnapWidth, dynamicSnapNearest, dynamicSnap } from '../util/snap';
import { getAudioEngine } from '../services/audioEngineManager';
import { playbackMode, registerArrangementCallbacks, unregisterArrangementCallbacks, setPlaybackMode } from '../services/playbackModeManager';
import { patterns, openPattern } from '../services/patternsListManager';
import { arrangement } from '../audio/Arrangement';
import type { ArrangementClip, ArrangementTrack } from '../audio/Arrangement';
import ConfirmationModal from './modals/ConfirmationModal.vue';
import ZoomScrollBar from './controls/ZoomScrollBar.vue';
import { MAX_ZOOM_FACTOR } from '../constants/defaults';
import { clamp } from '../util/math';

const closeWindow = inject<() => void>('closeWindow');
const resetWindow = inject<() => void>('resetWindow');
const dragWindow = inject<(e: PointerEvent) => void>('dragWindow');

interface NoteRect { x: number; y: number; width: number; height: number }
interface ClipPreview { viewBox: string; notes: NoteRect[] }

const engine = getAudioEngine();
const tracks = computed(() => arrangement.getAllTracks());
const playhead = reactive({ col: 0, playing: false });

const arrangementContainer = ref<HTMLDivElement | null>(null);
const workspaceContainer = ref<HTMLDivElement | null>(null);

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
});

const clipPreviews = computed(() => {
  const map = new Map<string, ClipPreview>();
  for(const clip of arrangement.clips) {
    const pattern = patterns.value.find(p => p.id === clip.patternId);
    if(!pattern) continue;
    const allNotes = pattern.roll._noteData;
    if(allNotes.length === 0) continue;

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

const trackHeight = 75; // Height of each track in pixels
const colWidth = ref(80); // Width of one beat in pixels (same as piano roll)
const beatsPerBar = 4; // 4 beats per bar
const numTracks = 20; // Number of tracks

const scrollX = ref(0); // pos of horizontal scroll
const barCount = computed(() => Math.ceil(arrangement.getEndBeat() / beatsPerBar) + 7);
const totalWidth = computed(() => barCount.value * beatsPerBar * colWidth.value);

function getWorkspacePos(event: PointerEvent) {
  const rect = workspaceContainer.value!.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function onNativeScroll() {
  if(arrangementContainer.value) {
    scrollX.value = arrangementContainer.value.scrollLeft;
  }
}

function isNearRightEdge(x: number, clip: ArrangementClip): boolean {
  return Math.abs(x - (clip.startBeat + clip.duration) * colWidth.value) <= 12;
}

function finalizeEdit() {
  if(state.draggingClip || state.resizingClip) {
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
    if(changed && clip && playbackMode.value === 'arrangement') {
      engine.compiler.invalidateClip(clip.id);
      recompileArrangement();

      if(engine.scheduler.isPlaying) {
        const beat = engine.scheduler.getCurrentBeat();
        const margin = 4; // beats — covers lookahead + snap granularity
        const oldNear = state.initialBeat < beat + margin && state.initialBeat + clip.duration > beat - margin;
        const newNear = clip.startBeat < beat + margin && clip.startBeat + clip.duration > beat - margin;
        if(oldNear || newNear) engine.scheduler.resetSchedule();
      }
    }
  }

  cursor.value = 'default';
}

function recompileArrangement() {
  if(playbackMode.value !== 'arrangement') return;

  const engine = getAudioEngine();
  const patternMap = new Map(patterns.value.map(p => [p.id, p]));
  const compiledNotes = engine.compiler.compile(patternMap, 0, Infinity);
  engine.scheduler.setNotes(compiledNotes);
  const endBeat = arrangement.getEndBeat();
  engine.scheduler.setLoop(true, 0, Math.ceil(endBeat / beatsPerBar) * beatsPerBar || beatsPerBar);
}

function muteCircleColor(track: ArrangementTrack) {
  if(track.solo) return 'var(--playhead)';
  if(track.muted) return 'var(--step-35)';
  return 'var(--playhead)';
}

// TRACK CREATION

const name = ref('');
const nameInput = ref<HTMLInputElement | null>(null);
const addButtonRef = ref<HTMLButtonElement | null>(null);
const addModalVisible = ref(false);
const addPos = ref({ x: 0, y: 0 });
const nextTrackNum = computed(() => {
  const used = new Set(tracks.value.map(t => parseInt(t.id.replace('track-', ''), 10)));
  let n = 1;
  while(used.has(n)) n++;
  return n;
});

function openAddModal() {
  if(addButtonRef.value) {
    const rect = addButtonRef.value.getBoundingClientRect();
    addPos.value = { x: rect.right, y: rect.top };
  }
  addModalVisible.value = true;
}

function createTrack() {
  arrangement.addTrack(name.value.trim() || undefined);
  name.value = '';
  addModalVisible.value = false;
}

// HANDLERS

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

function handlePointerMove(event: PointerEvent) {
  if(!arrangementContainer.value) return;
  const { x, y } = getWorkspacePos(event);
  const rawBeat = x / colWidth.value;
  const track = Math.floor(y / trackHeight);

  if(state.resizingClip) {
    const newDuration = Math.max(1 / snapDivision.value, dynamicSnapNearest(rawBeat, colWidth.value) - state.resizingClip.startBeat);
    arrangement.resizeClip(state.resizingClip.id, newDuration);
    cursor.value = 'w-resize';
    return;
  }

  if(state.draggingClip) {
    const newBeat = Math.max(0, dynamicSnap(rawBeat - state.dragStart.beat, colWidth.value));
    const newTrack = Math.max(0, Math.min(numTracks - 1, track - state.dragStart.track));
    arrangement.moveClip(state.draggingClip.id, newTrack, newBeat);
    cursor.value = 'grabbing';
    return;
  }

  const hovered = arrangement.getClipAt(track, rawBeat);
  cursor.value = hovered ? (isNearRightEdge(x, hovered) ? 'w-resize' : 'grab') : 'default';
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

  const startBeat = dynamicSnap(x / colWidth.value, colWidth.value);
  const track = Math.floor(y / trackHeight);

  const pattern = patterns.value.find(p => p.id === patternId);
  if(!pattern) return;

  const duration = pattern.roll.getEndBeat(beatsPerBar);

  // create clip with pattern
  arrangement.addClip(patternId, track, startBeat, duration, 0);
  recompileArrangement();
}

function onAddKeyDown(event: KeyboardEvent) {
  if(event.key === 'Enter') {
    event.preventDefault();
    createTrack();
  }
}

function handleDoubleClick(event: MouseEvent) {
  if(!workspaceContainer.value) return;
  const rect = workspaceContainer.value.getBoundingClientRect();
  const rawBeat = (event.clientX - rect.left) / colWidth.value;
  const track = Math.floor((event.clientY - rect.top) / trackHeight);

  const clip = arrangement.getClipAt(track, rawBeat);
  if(!clip) return;

  const pattern = patterns.value.find(p => p.id === clip.patternId);
  if(!pattern) return;
  openPattern(pattern.num);
}

function handlePointerDown(event: PointerEvent) {
  if(event.detail === 2) return;
  if(!arrangementContainer.value) return;
  const { x, y } = getWorkspacePos(event);
  const rawBeat = x / colWidth.value;
  const track = Math.floor(y / trackHeight);

  const clip = arrangement.getClipAt(track, rawBeat);
  if(!clip) return;

  if(event.button === 2) {
    if (selectedClipId.value === clip.id) selectedClipId.value = null;
    arrangement.removeClip(clip.id);
    recompileArrangement();
    return;
  }

  selectedClipId.value = clip.id;
  interacting.value = true;
  if(isNearRightEdge(x, clip)) {
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

function commitTrackName(id: string, event: Event) {
  const input = event.target as HTMLInputElement;

  if(input.value) {
    arrangement.setTrackName(id, input.value);
  } else {
    input.value = arrangement.getTrack(id)?.name ?? 'Unnamed';
  }
}

function onTrackNameKeydown(event: KeyboardEvent) {
  if(event.key === 'Enter') (event.target as HTMLInputElement).blur();
  if(event.key === 'Escape') (event.target as HTMLInputElement).blur();
}

// for wheel keybinds
function handleWheel(event: WheelEvent) {
  const element = arrangementContainer.value;
  if(!element) return;

  // HORIZONTAL ZOOM (Shift + Wheel)
  if(event.shiftKey) {
    event.preventDefault();
  
    const mouseX = event.clientX - element.getBoundingClientRect().left;
    const zoomAnchorPercent = (mouseX + element.scrollLeft) / totalWidth.value;

    const zoomIntensity = 0.15;

    const minColWidth = element.clientWidth / (barCount.value * beatsPerBar);
    const maxColWidth = element.clientWidth / (barCount.value * beatsPerBar * MAX_ZOOM_FACTOR);
    colWidth.value = clamp(colWidth.value * (event.deltaY > 0 ? (1 - zoomIntensity) : (1 + zoomIntensity)), minColWidth, maxColWidth);

    // sync scroll so the mouse stays over the same musical position
    nextTick(() => {
      element.scrollLeft = (zoomAnchorPercent * totalWidth.value) - mouseX;
      scrollX.value = element.scrollLeft;
    });
    return;
  }
}

function handleViewUpdate({ start, width }: { start: number, width: number }) {
  if(!arrangementContainer.value) return;

  colWidth.value = arrangementContainer.value.clientWidth / (width * barCount.value * beatsPerBar);
  arrangementContainer.value.scrollLeft = start * totalWidth.value;
  scrollX.value = arrangementContainer.value.scrollLeft;
}

function seekToPointer(event: PointerEvent) {
  if(!workspaceContainer.value) return;
  const rect = workspaceContainer.value.getBoundingClientRect();
  
  let beat = 0;
  if(event.shiftKey) {
    beat = (event.clientX - rect.left) / colWidth.value;
  } else {
    beat = dynamicSnapNearest((event.clientX - rect.left) / colWidth.value, colWidth.value);
  }

  engine.scheduler.seek(Math.max(0, beat));
}

function handleTimelinePointerDown(event: PointerEvent) {
  if(playbackMode.value !== 'arrangement') setPlaybackMode('arrangement');
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  seekToPointer(event);
}

function handleTimelineScrub(event: PointerEvent) {
  if(!(event.currentTarget as HTMLElement).hasPointerCapture(event.pointerId)) return;
  seekToPointer(event);
}

// WATCHERS

// watch for arrangement changes
watch(() => arrangement.clips, () => {
  if(interacting.value) return;
  if(playbackMode.value === 'arrangement') recompileArrangement();
}, { deep: true });

// watch for pattern edits
watch(() => patterns.value.map(p => ({ id: p.id, version: p.roll._state.version })), (newPatterns, oldPatterns) => {
  if(oldPatterns) {
    for(let i = 0; i < newPatterns.length; i++) {
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

watch(addModalVisible, async (visible) => {
  if(visible) {
    await nextTick();
    nameInput.value?.focus();
  }
});

// LIFECYCLE

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
  <div class="flex flex-col w-full h-full bg-mix-20 overflow-hidden">
    <div class="grid grid-cols-[7.5rem_1fr] shrink-0 border-b-2 border-mix-30">
      <div class="bg-mix-15 border-r-2 border-mix-30" /> <!-- bocks LMFAOOOOO -->

      <div class="flex flex-col">
        <!-- toolbar / drag handle -->
        <div class="window-header bg-mix-15 px-3 shrink-0"
          @pointerdown.stop="dragWindow?.($event)">
          <span class="text-xs font-medium">Arrangement</span>

          <div class="flex justify-center items-center p-1 shrink-0">
            <button ref="addButtonRef" class="util-button flex justify-center items-center w-6" @click="openAddModal" title="Add arrangement track">
              <span class="pi pi-plus text-sm"></span>
            </button>
          </div>

          <!-- separator -->
          <div class="flex-1" />

          <button class="w-6 h-6 rounded util-button flex items-center justify-center" @pointerdown.stop @click="resetWindow?.()" title="Reset position and size">
            <span class="pi pi-refresh text-xs" />
          </button>

          <button class="w-6 h-6 rounded util-button flex items-center justify-center" @pointerdown.stop @click="closeWindow?.()">
            <span class="pi pi-times text-xs" />
          </button>
        </div>

        <ZoomScrollBar :start-percent="scrollX / totalWidth" :view-width-percent="arrangementContainer ? arrangementContainer.clientWidth / totalWidth : 0" @update:view="handleViewUpdate"/>
      </div>
    </div>

    <!-- arrangement body -->
    <div ref="arrangementContainer" class="flex-1 overflow-x-hidden overflow-y-auto grid grid-cols-[7.5rem_1fr]" @scroll="onNativeScroll">
      <!-- track headers -->
      <div class="sticky left-0 z-50 shrink-0 flex flex-col" :style="{ height: `${arrangement.tracks.length * trackHeight + 20}px` }">
        <div class="h-5 bg-mix-15 sticky top-0 z-10 border-r-2 border-mix-30" />

        <div v-for="track in arrangement.tracks" :key="track.id" :style="{ height: `${trackHeight}px` }"
          class="w-30 bg-mix-15 border-y-2 border-r-2 border-mix-30 flex justify-between flex-col"
        >
          <!-- name input box -->
          <div class="flex items-start justify-between px-2 pt-1">
            <input v-model="track.name" class="px2 py-0.5 rounded text-sm font-mono bg-mix-10 focus:outline-none w-full text-center truncate px-1 border-2 border-mix-30"
              @focus="($event.target as HTMLInputElement).select()"
              @blur="commitTrackName(track.id, $event)"
              @keydown="onTrackNameKeydown"
            />
          </div>

          <!-- buttons -->
          <div class="flex justify-between px-2 pb-1 items-center">
            <button @click="arrangement.removeTrack(track.id)" class="flex justify-center w-6">
              <span class="pi pi-times text-sm text-red-400"></span>
            </button>

            <button @click="arrangement.toggleMuteTrack(track.id)" @contextmenu.prevent="arrangement.toggleSoloTrack(track.id)"
              class="flex items-center justify-center w-6 h-6 rounded self-end shrink-0 focus:outline-none"
              :title="track.solo ? 'Solo (right-click to toggle)' : track.muted ? 'Unmute' : 'Mute (right-click to solo)'"
            >
              <span class="w-2 h-2 rounded-full transition-colors" :style="{ backgroundColor: muteCircleColor(track) }" />
            </button>
          </div>
        </div>
      </div>

      <div :style="{ width: `${totalWidth}px`, height: `${arrangement.tracks.length * trackHeight + 20}px` }">
        <!-- timeline -->
        <div class="bg-mix-10 flex flex-row items-center h-5 w-full sticky top-0 z-10" @pointerdown.stop="handleTimelinePointerDown" @pointermove="handleTimelineScrub">
          <!-- markers -->
          <div v-for="i in (barCount * beatsPerBar)" :key="i" :style="{ width: `${colWidth}px` }">
            <span class="text-xs font-mono absolute -translate-1/2 opacity-50">{{ i }}</span>
          </div>

          <!-- playhead indicator -->
          <span v-if="playbackMode === 'arrangement'" class="pi pi-sort-down-fill absolute text-sm -translate-x-1/2 text-(--playhead)" :style="{ left: `${playhead.col * colWidth}px` }"></span>
        </div>

        <!-- workspace -->
        <div ref="workspaceContainer" class="relative shrink-0" :style="{ width: `${totalWidth}px`, height: `${arrangement.tracks.length * trackHeight}px`, cursor: cursor }"
          @pointerdown="handlePointerDown" @dblclick="handleDoubleClick" @pointermove="handlePointerMove" @pointerup="finalizeEdit" @pointerleave="finalizeEdit" @wheel="handleWheel"
          @dragover="handleDragOver" @drop="handleDrop" @contextmenu.prevent
        >
          <!-- 4-bar alternating column backgrounds -->
          <div class="absolute inset-0 pointer-events-none" :style="{
            backgroundImage: 'linear-gradient(to right, rgba(0,0,0,0.15) 50%, transparent 50%)',
            backgroundSize: `${colWidth * beatsPerBar * 8}px 100%`,
            backgroundPosition: `${colWidth * beatsPerBar * 4}px 0`
          }"></div>

          <!-- grid -->
          <div class="absolute inset-0 arrangement-grid pointer-events-none"
            :style="{
              '--track-h': `${trackHeight}px`,
              '--beat-w': `${colWidth}px`,
              '--bar-w': `${colWidth * beatsPerBar}px`,
              '--snap-w': `${getVisualSnapWidth(colWidth)}px`
            }"
          ></div>

          <!-- clips -->
          <div v-for="clip in arrangement.clips" :key="clip.id"
            :class="['absolute border-2 clip-color rounded overflow-hidden pointer-events-none', clip.id === selectedClipId ? 'clip-border-color' : 'clip-border-muted']"
            :style="{
              left: `${clip.startBeat * colWidth}px`,
              top: `${clip.track * trackHeight}px`,
              width: `${clip.duration * colWidth}px`,
              height: `${trackHeight}px`,
            }"
          >
            <svg v-if="clipPreviews.get(clip.id)" class="absolute inset-0 w-full h-full" preserveAspectRatio="none" :viewBox="clipPreviews.get(clip.id)!.viewBox">
              <rect
                v-for="(note, i) in clipPreviews.get(clip.id)!.notes"
                :key="i"
                :x="note.x" :y="note.y"
                :width="note.width" :height="note.height"
                fill="white" opacity="0.6"
              />
            </svg>
            <div class="relative z-10 px-1 pt-0.5 text-xs truncate drop-shadow">
              {{ patterns.find(p => p.id === clip.patternId)?.name || 'Pattern' }}
            </div>
          </div>

          <!-- playhead (only visible in arrangement mode) -->
          <div v-if="playbackMode === 'arrangement' && (playhead.playing || playhead.col > 0)"
            class="absolute w-0.75 pointer-events-none playhead-color  -translate-x-1/2"
            :style="{
              transform: `translateX(${playhead.col * colWidth}px)`,
              top: '0',
              height: `${tracks.length * trackHeight}px`,
              boxShadow: `-1px 0 6px var(--playhead)`
            }"
          ></div>
        </div>
      </div>
    </div>
  </div>

  <!-- fill extra space -->
  <span class="flex-1 bg-mix-15 border-t-2 border-mix-30"/>

  <!-- add mixer modal -->
  <ConfirmationModal :visible="addModalVisible" :x="addPos.x" :y="addPos.y" @confirm="createTrack" @cancel="addModalVisible = false; name = ''">
    <input ref="nameInput" v-model="name" @keydown="onAddKeyDown" :placeholder="`Track ${nextTrackNum} name`" class="bg-mix-25 p-2 rounded-md" />
  </ConfirmationModal>
</template>