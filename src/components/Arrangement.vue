<script setup lang="ts">
import { reactive, computed, watch, onMounted, onBeforeUnmount, ref, inject, nextTick } from 'vue';
import { snapDivision, getVisualSnapWidth, dynamicSnapNearest, dynamicSnap } from '../util/snap';
import { getAudioEngine } from '../services/audioEngineManager';
import { playbackMode, registerArrangementCallbacks, unregisterArrangementCallbacks } from '../services/playbackModeManager';
import { patterns, openPattern } from '../services/patternsListManager';
import { arrangement } from '../audio/Arrangement';
import type { ArrangementClip, ArrangementTrack } from '../audio/Arrangement';
import ConfirmationModal from './modals/ConfirmationModal.vue';
import ZoomScrollBar from './controls/ZoomScrollBar.vue';
import Toolbar from './controls/Toolbar.vue';
import SelectionOverlay from './overlays/SelectionOverlay.vue';
import { MAX_ZOOM_FACTOR } from '../constants/defaults';
import { clamp } from '../util/math';
import Timeline from './meters/Timeline.vue';

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

const state = reactive({
  hoverClip: null as ArrangementClip | null,
  selectedClipIds: new Set<string>(),

  activeAction: null as {
    type: 'drag' | 'resize-right' | 'resize-left',
    anchor: ArrangementClip,
    snapshot: Map<string, { startBeat: number, track: number, duration: number, offset: number }>,
    dragStart: { beat: number, track: number }
  } | null
});

const activeTool = ref('place');
const arrangementTools = [{ id: 'place', label: 'Place/Edit' }, { id: 'select', label: 'Select' }];

const clipPreviews = computed(() => {
  const map = new Map<string, ClipPreview>();
  for(const clip of arrangement.clips) {
    const pattern = patterns.value.find(p => p.id === clip.patternId);
    if(!pattern) continue;
    const allNotes = pattern.roll._noteData;
    if(allNotes.length === 0) continue;

    const midiMin = Math.min(...allNotes.map(n => n.midi));
    const midiMax = Math.max(...allNotes.map(n => n.midi));
    const pad = 5;
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

const trackHeight = 65;
const colWidth = ref(80);
const beatsPerBar = 4;
const numTracks = 20;

const scrollX = ref(0);
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

function isNearLeftEdge(x: number, clip: ArrangementClip): boolean {
  return Math.abs(x - clip.startBeat * colWidth.value) <= 12;
}

function finalizeEdit() {
  if(state.activeAction) {
    const { snapshot } = state.activeAction;

    let changed = false;
    let nearPlayhead = false;
    const beat = engine.scheduler.getCurrentBeat();
    const margin = 4;

    for(const [id, orig] of snapshot) {
      const clip = arrangement.clips.find(c => c.id === id);
      if(!clip) continue;

      if(clip.startBeat !== orig.startBeat || clip.track !== orig.track || clip.duration !== orig.duration) {
        changed = true;
        engine.compiler.invalidateClip(id);

        const oldNear = orig.startBeat < beat + margin && orig.startBeat + orig.duration > beat - margin;
        const newNear = clip.startBeat < beat + margin && clip.startBeat + clip.duration > beat - margin;

        if(oldNear || newNear) nearPlayhead = true;
      }
    }

    if(changed && playbackMode.value === 'arrangement') {
      recompileArrangement();
      if(engine.scheduler.isPlaying && nearPlayhead) engine.scheduler.resetSchedule();
    }
  }

  state.activeAction = null;
  state.hoverClip = null;
  cursor.value = 'default';
}

function recompileArrangement(resetIfPlaying = false) {
  if(playbackMode.value !== 'arrangement') return;

  const engine = getAudioEngine();
  const patternMap = new Map(patterns.value.map(p => [p.id, p]));
  const compiledNotes = engine.compiler.compile(patternMap, 0, Infinity);
  engine.scheduler.setNotes(compiledNotes);

  if(resetIfPlaying && engine.scheduler.isPlaying) {
    engine.scheduler.resetSchedule();
  }

  const endBeat = arrangement.getEndBeat();
  engine.scheduler.setLoop(true, 0, Math.ceil(endBeat / beatsPerBar) * beatsPerBar || beatsPerBar);
}

let recompileDebounceTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleRecompile() {
  if(recompileDebounceTimer !== null) clearTimeout(recompileDebounceTimer);
  recompileDebounceTimer = setTimeout(() => {
    recompileDebounceTimer = null;
    recompileArrangement(false);
  }, 50);
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

  const element = arrangementContainer.value;
  if(!element) return;

  const stepSize = colWidth.value / 2;
  const multiplier = event.shiftKey ? 4 : 1;

  switch(event.key) {
    case 'ArrowUp':
      event.preventDefault();
      element.scrollTop -= trackHeight * multiplier;
      break;
    case 'ArrowDown':
      event.preventDefault();
      element.scrollTop += trackHeight * multiplier;
      break;
    case 'ArrowLeft':
      event.preventDefault();
      element.scrollLeft -= stepSize * multiplier;
      break;
    case 'ArrowRight':
      event.preventDefault();
      element.scrollLeft += stepSize * multiplier;
      break;
    case ' ':
      event.preventDefault();
      if(playbackMode.value === 'arrangement' && !engine.scheduler.isPlaying) {
        recompileArrangement();
      }

      engine.scheduler.toggle();
      break;
    case 'Enter':
      event.preventDefault();
      engine.scheduler.seek(engine.scheduler.loopStart);
      break;
    case 'Escape':
      event.preventDefault();
      state.selectedClipIds.clear();
      break;;
    case 'p':
      event.preventDefault();
      if(!arrangementTools.some(tool => tool.id === 'place')) break;
      activeTool.value = 'place';
      break;
    case 'e':
      event.preventDefault();
      if(!arrangementTools.some(tool => tool.id === 'select')) break;
      activeTool.value = 'select';
  }
}

function handlePointerMove(event: PointerEvent) {
  if(!workspaceContainer.value) return;
  const { x, y } = getWorkspacePos(event);
  const rawBeat = x / colWidth.value;
  const track = Math.floor(y / trackHeight);

  if(state.activeAction) {
    const { type, anchor, snapshot, dragStart } = state.activeAction;
    const anchorOrig = snapshot.get(anchor.id)!;

    if(type === 'resize-right') {
      const snappedBeat = dynamicSnapNearest(rawBeat, colWidth.value);
      const newAnchorDuration = Math.max(1 / snapDivision.value, snappedBeat - anchorOrig.startBeat);
      const deltaLength = newAnchorDuration - anchorOrig.duration;

      for(const [id, orig] of snapshot) {
        arrangement.resizeClip(id, Math.max(1 / snapDivision.value, orig.duration + deltaLength), orig.offset);
      }

      cursor.value = 'w-resize';
    } else if(type === 'resize-left') {
      const snappedBeat = dynamicSnapNearest(rawBeat, colWidth.value);

      const anchorOldEnd = anchorOrig.startBeat + anchorOrig.duration;
      const anchorMinStart = Math.max(0, anchorOrig.startBeat - anchorOrig.offset);
      const newAnchorStart = clamp(snappedBeat, anchorMinStart, anchorOldEnd - 1 / snapDivision.value);
      const delta = newAnchorStart - anchorOrig.startBeat;

      for(const [id, orig] of snapshot) {
        const oldEnd = orig.startBeat + orig.duration;
        const minStart = Math.max(0, orig.startBeat - orig.offset);
        const newStart = clamp(orig.startBeat + delta, minStart, oldEnd - 1 / snapDivision.value);
        const actualDelta = newStart - orig.startBeat;

        arrangement.updateClip(id, { startBeat: newStart, duration: orig.duration - actualDelta, offset: orig.offset + actualDelta });
      }

      cursor.value = 'w-resize';
    } else {
      const deltaBeat = rawBeat - dragStart.beat;
      const deltaTrack = track - dragStart.track;

      for(const [id, orig] of snapshot) {
        const newBeat = Math.max(0, dynamicSnap(orig.startBeat + deltaBeat, colWidth.value));
        const newTrack = clamp(deltaTrack, 0, numTracks - 1);

        arrangement.moveClip(id, newTrack, newBeat);
      }

      cursor.value = 'grabbing';
    }
    return;
  }

  const hovered = arrangement.getClipAt(track, rawBeat);
  state.hoverClip = hovered;

  if(activeTool.value === 'select' || !hovered) {
    cursor.value = 'default';
  } else if(isNearLeftEdge(x, hovered) || isNearRightEdge(x, hovered)) {
    cursor.value = 'w-resize';
  } else {
    cursor.value = 'grab';
  }
}

function handleDragOver(event: DragEvent) {
  event.preventDefault();
  if(event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
}

function handleDrop(event: DragEvent) {
  event.preventDefault();
  const patternId = event.dataTransfer?.getData('pattern-id');
  if(!patternId) return;

  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const startBeat = dynamicSnap((event.clientX - rect.left) / colWidth.value, colWidth.value);
  const track = Math.floor((event.clientY - rect.top) / trackHeight);

  const pattern = patterns.value.find(p => p.id === patternId);
  if(!pattern) return;

  arrangement.addClip(patternId, track, startBeat, pattern.roll.getEndBeat(beatsPerBar), 0);
  recompileArrangement();
}

function onSelectionComplete(payload: { bounds: { x: number, y: number, width: number, height: number }, shiftKey: boolean }) {
  const startBeat = payload.bounds.x / colWidth.value;
  const endBeat = (payload.bounds.x + payload.bounds.width) / colWidth.value;

  const startTrack = Math.floor(payload.bounds.y / trackHeight);
  const endTrack = Math.floor((payload.bounds.y + payload.bounds.height) / trackHeight);

  if(!payload.shiftKey) {
    state.selectedClipIds.clear();
  }

  for(const clip of arrangement.clips) {
    if(clip.track >= startTrack && clip.track <= endTrack &&
       clip.startBeat < endBeat && clip.startBeat + clip.duration > startBeat) {
      state.selectedClipIds.add(clip.id);
    }
  }
}

function onAddKeyDown(event: KeyboardEvent) {
  if(event.key === 'Enter') { event.preventDefault(); createTrack(); }
}

function handleDoubleClick(event: MouseEvent) {
  if(!workspaceContainer.value) return;
  const rect = workspaceContainer.value.getBoundingClientRect();
  const rawBeat = (event.clientX - rect.left) / colWidth.value;

  const track = Math.floor((event.clientY - rect.top) / trackHeight);
  const clip = arrangement.getClipAt(track, rawBeat);
  if(!clip) return;

  const pattern = patterns.value.find(p => p.id === clip.patternId);
  if(pattern) openPattern(pattern.num);
}

function handlePointerDown(event: PointerEvent) {
  if(event.detail === 2 || !workspaceContainer.value) return;
  const { x, y } = getWorkspacePos(event);
  const rawBeat = x / colWidth.value;
  const track = Math.floor(y / trackHeight);

  const clip = arrangement.getClipAt(track, rawBeat);
  if(!clip) return;

  if(event.button === 2) {
    state.selectedClipIds.delete(clip.id);
    arrangement.removeClip(clip.id);
    recompileArrangement();
    return;
  }

  if(activeTool.value === 'select') {
    // user selecting more notes
    if(event.button === 0) {
      if(event.shiftKey) {
        // add/remove notes to select list
        if(state.selectedClipIds.has(clip.id)) {
          state.selectedClipIds.delete(clip.id);
        } else {
          state.selectedClipIds.add(clip.id);
        }
      } else {
        // replace selection
        state.selectedClipIds.clear();
        state.selectedClipIds.add(clip.id);
      }
    } else {
      if(!event.shiftKey) {
        state.selectedClipIds.clear();
      }
    }

    return;
  }

  if(!state.selectedClipIds.has(clip.id)) {
    state.selectedClipIds.clear();
    state.selectedClipIds.add(clip.id);
  }

  const snapshot = new Map<string, { startBeat: number, track: number, duration: number, offset: number }>();
  for(const c of arrangement.clips) {
    if(state.selectedClipIds.has(c.id)) {
      snapshot.set(c.id, { startBeat: c.startBeat, track: c.track, duration: c.duration, offset: c.offset });
    }
  }

  const dragStart = { beat: rawBeat, track };

  if(isNearLeftEdge(x, clip)) {
    state.activeAction = { type: 'resize-left', anchor: clip, snapshot, dragStart };
    cursor.value = 'w-resize';
  } else if(isNearRightEdge(x, clip)) {
    state.activeAction = { type: 'resize-right', anchor: clip, snapshot, dragStart };
    cursor.value = 'w-resize';
  } else {
    state.activeAction = { type: 'drag', anchor: clip, snapshot, dragStart };
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
  if(event.key === 'Enter' || event.key === 'Escape') (event.target as HTMLInputElement).blur();
}

function handleWheel(event: WheelEvent) {
  const element = arrangementContainer.value;
  if(!element || !event.ctrlKey) return;
  event.preventDefault();

  const mouseX = event.clientX - element.getBoundingClientRect().left;
  const zoomAnchorPercent = (mouseX + element.scrollLeft) / totalWidth.value;
  const zoomIntensity = 0.15;

  const minColWidth = element.clientWidth / (barCount.value * beatsPerBar);
  const maxColWidth = element.clientWidth / (barCount.value * beatsPerBar * MAX_ZOOM_FACTOR);

  colWidth.value = clamp(colWidth.value * (event.deltaY > 0 ? (1 - zoomIntensity) : (1 + zoomIntensity)), minColWidth, maxColWidth);

  nextTick(() => {
    element.scrollLeft = (zoomAnchorPercent * totalWidth.value) - mouseX;
    scrollX.value = element.scrollLeft;
  });
}

function handleViewUpdate({ start, width }: { start: number, width: number }) {
  if(!arrangementContainer.value) return;
  colWidth.value = arrangementContainer.value.clientWidth / (width * barCount.value * beatsPerBar);
  arrangementContainer.value.scrollLeft = start * totalWidth.value;
  scrollX.value = arrangementContainer.value.scrollLeft;
}

// WATCHERS

watch(() => arrangement.clips, () => {
  if(state.activeAction) return;
  if(playbackMode.value === 'arrangement') recompileArrangement();
}, { deep: true });

watch(() => patterns.value.map(p => ({ id: p.id, version: p.roll._state.version })), (newPatterns, oldPatterns) => {
  if(oldPatterns) {
    for(let i = 0; i < newPatterns.length; i++) {
      const np = newPatterns[i];
      const op = oldPatterns[i];
      if(np && op && np.version !== op.version) engine.compiler.invalidatePattern(np.id);
    }
  }

  if(playbackMode.value === 'arrangement') scheduleRecompile();
});

watch(playbackMode, (newMode) => {
  if(newMode === 'arrangement') recompileArrangement();
});

watch(addModalVisible, async (visible) => {
  if(visible) { await nextTick(); nameInput.value?.focus(); }
});

// LIFECYCLE

onMounted(() => {
  registerArrangementCallbacks(
    (beat: number) => { playhead.col = beat; },
    (playing: boolean) => { playhead.playing = playing; }
  );

  window.addEventListener('keydown', handleKeyDown);
  if(playbackMode.value === 'arrangement') recompileArrangement();
});

onBeforeUnmount(() => {
  unregisterArrangementCallbacks();
  
  if(playbackMode.value === 'arrangement') {
    engine.scheduler.setNotes([]);
    if(engine.scheduler.isPlaying) engine.scheduler.stop();
  }

  window.removeEventListener('keydown', handleKeyDown);
});
</script>

<template>
  <div class="flex flex-col w-full h-full bg-mix-20 overflow-hidden">
    <div class="grid grid-cols-[7.5rem_1fr] shrink-0 border-b-2 border-mix-30">
      <div class="bg-mix-15 border-r-2 border-mix-30" />

      <div class="flex flex-col">
        <!-- toolbar / drag handle -->
        <div class="window-header bg-mix-15 px-3 shrink-0" @pointerdown.stop="dragWindow?.($event)">
          <span class="text-xs font-medium">Arrangement</span>

          <div class="flex justify-center items-center p-1 shrink-0">
            <button ref="addButtonRef" class="util-button flex justify-center items-center w-6" @click="openAddModal" title="Add arrangement track">
              <span class="pi pi-plus text-sm"></span>
            </button>
          </div>

          <!-- lil separator -->
          <div class="w-0.5 h-5 bg-mix-30 mx-1"></div>

          <Toolbar :tools="arrangementTools" v-model:activeTool="activeTool" :tool-size="18" class="gap-1.5 px-1.5">
            <template #default="{ tool }">
              <span v-if="tool.id === 'place'" class="pi pi-pencil text-sm" />
              <span v-else-if="tool.id === 'select'" class="pi pi-expand text-sm" />
            </template>
          </Toolbar>

          <div class="w-0.5 h-5 bg-mix-30 mx-1"></div>

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
        <div class="h-5 bg-mix-15 sticky top-0 z-10 border-r-2 border-b-2 border-mix-30" />

        <div v-for="track in arrangement.tracks" :key="track.id" :style="{ height: `${trackHeight}px` }"
          class="w-30 bg-mix-15 border-y-2 border-r-2 border-mix-30 flex justify-between flex-col"
        >
          <div class="flex items-start justify-between px-2 pt-1">
            <input v-model="track.name" class="px2 py-0.5 rounded text-sm font-mono bg-mix-10 focus:outline-none w-full text-center truncate px-1 border-2 border-mix-30"
              @focus="($event.target as HTMLInputElement).select()"
              @blur="commitTrackName(track.id, $event)"
              @keydown="onTrackNameKeydown"
            />
          </div>

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
        <Timeline :container="workspaceContainer" :mode="'arrangement'" :interval="colWidth" :count="barCount * beatsPerBar" :playtime="playhead.col * colWidth"/>

        <!-- workspace -->
        <div ref="workspaceContainer" class="relative shrink-0" :style="{ width: `${totalWidth}px`, height: `${arrangement.tracks.length * trackHeight}px`, cursor: cursor }"
          @pointerdown="handlePointerDown" @dblclick="handleDoubleClick" @pointermove="handlePointerMove"
          @pointerup="finalizeEdit" @pointerleave="finalizeEdit" @wheel="handleWheel"
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
            :class="['absolute border-2 clip-color rounded overflow-hidden pointer-events-none', state.selectedClipIds.has(clip.id) ? 'clip-border-color' : 'clip-border-muted']"
            :style="{
              left: `${clip.startBeat * colWidth}px`,
              top: `${clip.track * trackHeight}px`,
              width: `${clip.duration * colWidth}px`,
              height: `${trackHeight}px`,
            }"
          >
            <svg v-if="clipPreviews.get(clip.id)" class="absolute inset-0 w-full h-full" preserveAspectRatio="none" :viewBox="clipPreviews.get(clip.id)!.viewBox">
              <rect v-for="(note, i) in clipPreviews.get(clip.id)!.notes" :key="i"
                :x="note.x" :y="note.y" :width="note.width" :height="note.height"
                fill="white" opacity="0.6"
              />
            </svg>
            <div class="relative z-10 px-1 pt-0.5 text-xs truncate drop-shadow">
              {{ patterns.find(p => p.id === clip.patternId)?.name || 'Pattern' }}
            </div>
          </div>

          <!-- playhead -->
          <div v-if="playbackMode === 'arrangement' && (playhead.playing || playhead.col > 0)"
            class="absolute w-0.75 pointer-events-none playhead-color -translate-x-1/2"
            :style="{
              transform: `translateX(${playhead.col * colWidth}px)`,
              top: '0',
              height: `${tracks.length * trackHeight}px`,
              boxShadow: `-1px 0 6px var(--playhead)`
            }"
          ></div>

          <!-- selection overlay -->
          <SelectionOverlay v-if="activeTool === 'select'" :snap-y="trackHeight" :snap-x="colWidth / snapDivision" @complete="onSelectionComplete" />
        </div>
      </div>
    </div>
  </div>

  <!-- fill extra space -->
  <span class="flex-1 bg-mix-15 border-t-2 border-mix-30"/>

  <!-- add track modal -->
  <ConfirmationModal :visible="addModalVisible" :x="addPos.x" :y="addPos.y" @confirm="createTrack" @cancel="addModalVisible = false; name = ''">
    <input ref="nameInput" v-model="name" @keydown="onAddKeyDown" :placeholder="`Track ${nextTrackNum} name`" class="bg-mix-25 p-2 rounded-md" />
  </ConfirmationModal>
</template>