<script setup lang="ts">
import { ref, reactive, onMounted, nextTick, onBeforeUnmount, inject, type Ref, computed, watch } from 'vue';
import { PianoRoll, type NoteBlock, type Cell } from '../audio/PianoRoll'
import { noteToMidi } from '../util/midiUtils';
import { isWindowActive } from '../services/windowManager';
import { getAudioEngine } from '../services/audioEngineManager';
import { snap, snapDivision } from '../util/snap';
import { playbackMode, registerPatternCallbacks, unregisterPatternCallbacks } from '../services/playbackModeManager';
import BaseDropdown from './modals/BaseDropdown.vue';
import NoteAutomationOverlay from './features/NoteAutomationOverlay.vue';
import { ALL_PARAMETERS, PARAMETER_MAP } from '../audio/automation/parameter';
import type { AutomationCurve } from '../audio/automation/types';
import { shiftNodeValues } from '../audio/automation/nodeOperations';
import { manipulateColor } from '../util/colorManipulation';

let noteIdCounter = 0;

function generateNoteId(): string {
  return `note-${noteIdCounter++}-${Date.now()}`;
}

// SETUP

const props = defineProps<{
  roll: PianoRoll;
  name: string;
}>();

const engine = getAudioEngine();

const selectedChannelId = ref(engine.channelManager.getLatestChannelId() || '');
const channels = computed(() => engine.channelManager.getAllChannels());
const selectedInstrument = computed(() => engine.channelManager.getChannel(selectedChannelId.value)?.instrument ?? null);

const workSpaceContainer = ref<HTMLDivElement | null>(null);
const pianoRollContainer = ref<HTMLDivElement | null>(null);
const cursor = ref('default');

const notes = props.roll.getKeyboardNotes;

const windowElement = inject<Ref<HTMLElement | null>>('windowElement');
const windowId = inject<string>('windowId');
const closeWindow = inject<() => void>('closeWindow');
const resetWindow = inject<() => void>('resetWindow');
const dragWindow = inject<(e: PointerEvent) => void>('dragWindow');
if(!windowElement) throw new Error('PianoRoll must be in a window');

const state = reactive({
  hoverCell: null as Cell | null,
  hoverNote: null as NoteBlock | null,
  cachedLength: 1,
  resizingNote: null as NoteBlock | null,
  resizeInitialLength: 0,
  draggingNote: null as NoteBlock | null,
  dragStart: { row: 0, col: 0}
});

const playhead = reactive({
  col: 0,
  playing: false
});

const rowHeight = ref(15);
const colWidth = 80;
const beatsPerBar = 4;

// AUTOMATION

const activeAutomationLane = ref<string | null>(null);
const activeLaneDef = computed(() => activeAutomationLane.value ? PARAMETER_MAP.get(activeAutomationLane.value) ?? null : null);

// Curve cache: stores the last-edited curve + source note midi per parameter.
const cachedCurves = reactive(new Map<string, { curve: AutomationCurve; noteMidi: number }>());
const hasCurveCache = computed(() => cachedCurves.size > 0);

function clearCurveCache() {
  cachedCurves.clear();
}

function toggleLane(parameterId: string) {
  if(activeAutomationLane.value === parameterId) {
    activeAutomationLane.value = null;
    return;
  }

  for(const note of props.roll.getNoteData) {
    props.roll.activateLane(note.id, parameterId);
  }

  activeAutomationLane.value = parameterId;
}

function onAutomationUpdate(noteId: string, curve: AutomationCurve) {
  props.roll.updateCurve(noteId, curve);
  const note = props.roll.getNoteData.find(n => n.id === noteId);
  if(note) cachedCurves.set(curve.parameterId, { curve, noteMidi: note.midi });
}

function cacheNoteState(note: NoteBlock) {
  state.cachedLength = note.length;
  for(const [parameterId, curve] of note.automation) {
    cachedCurves.set(parameterId, { curve, noteMidi: note.midi });
  }
}

// parametersWithCurves: only those where at least one note already has a curve.
// Drives the visibility checkboxes — future parameters added at runtime will appear automatically.
const parametersWithCurves = computed(() =>
  ALL_PARAMETERS.filter(p => props.roll.getNoteData.some(n => n.automation.has(p.id)))
);

const visibleCurveLanes = reactive(new Set<string>());

function toggleVisibleLane(id: string) {
  visibleCurveLanes.has(id) ? visibleCurveLanes.delete(id) : visibleCurveLanes.add(id);
}

function getOverlayLayout(noteRow: number, def = activeLaneDef.value): { heightPx: number; offsetY: number; snapInterval: number | null } {
  if(!def) return { heightPx: rowHeight.value, offsetY: 0, snapInterval: null };

  const rh = rowHeight.value;
  const overlayRows = def.overlayRows;

  if(overlayRows === 'note') {
    return { heightPx: rh, offsetY: 0, snapInterval: def.snapInterval };
  } else if(overlayRows === 'roll') {
    return {
      heightPx: (notes.length - 1) * rh,
      offsetY: noteRow * rh - rh / 2,
      snapInterval: def.snapInterval,
    };
  } else {
    // fixed row count, centered on the note
    const rows = overlayRows as number;
    return {
      heightPx: rows * rh,
      offsetY: ((rows - 1) / 2) * rh,
      snapInterval: def.snapInterval,
    };
  }
}

// LIVE PREVIEW (keyboard sidebar)

async function playNote(midi: number) {
  if(engine.scheduler.isPlaying) return;
  if(!selectedInstrument.value) return;

  await selectedInstrument.value.resume();
  selectedInstrument.value.noteOn(midi);
}

function stopNote(midi: number) {
  selectedInstrument.value?.noteOff(midi);
}

// CONTROLS

function updatePatternLoop() {
  if(playbackMode.value !== 'pattern') return;
  engine.scheduler.setLoop(true, 0, props.roll.getEndBeat(beatsPerBar));
}

// POINTER HANDLING

function getCellFromPointer(event: PointerEvent) {
  if(!workSpaceContainer.value) return { row: 0, col: 0};
  const rect = workSpaceContainer.value.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  return { row: Math.floor(y / rowHeight.value), col: snap(x / colWidth) };
}

function isNearRightEdge(event: PointerEvent, note: NoteBlock) {
  const pianoRoll = workSpaceContainer.value!.getBoundingClientRect();
  const pointerX = event.clientX - pianoRoll.left;
  const noteRightX = (note.col + note.length) * colWidth;

  const region = 20;
  const mult = region > (note.length * colWidth) / 3 ? region * note.length : region;
  return Math.abs(pointerX - noteRightX) <= mult;
}

function handlePointerMove(event: PointerEvent) {
  if(activeLaneDef.value) return;
  if(props.roll.isResizing() && state.resizingNote) {
    const pointerX = event.clientX - workSpaceContainer.value!.getBoundingClientRect().left;
    state.cachedLength = props.roll.resize(pointerX / colWidth);

    engine.scheduler.updateNote(state.resizingNote.id, {
      duration: state.resizingNote.length
    });

    cursor.value = 'w-resize';
    return;
  }

  const cell = getCellFromPointer(event);
  state.hoverCell = cell;

  const hovered = props.roll.getHoveredNote(cell);
  state.hoverNote = hovered?.note ?? null;

  if(hovered?.note && isNearRightEdge(event, hovered.note)) {
    cursor.value = 'w-resize';
  } else {
    cursor.value = 'default';
  }

  if(state.draggingNote) {
    const newCol = cell.col - state.dragStart.col;
    const newRow = cell.row - state.dragStart.row;

    const oldMidi = state.draggingNote.midi;
    props.roll.move(state.draggingNote.id, newRow, newCol);
    props.roll.followNoteMove(state.draggingNote.id, oldMidi, state.draggingNote.midi);
    selectedInstrument.value?.triggerRelease(state.draggingNote.id, selectedInstrument.value.getAudioContext().currentTime); // cancel current

    const noteIndex = notes.length - 1 - newRow;
    engine.scheduler.updateNote(state.draggingNote.id, {
      startTime: newCol,
      pitch: notes[noteIndex]?.midi
    });
  }
}

async function handlePointerDown(event: PointerEvent) {
  if(!state.hoverCell) return;
  if(activeAutomationLane.value) return; // note editing disabled while a lane is active

  const hovered = props.roll.getHoveredNote(state.hoverCell);

  // right click delete
  if(hovered?.note) {
    if(event.button === 2) {
      const noteToDelete = hovered.note;
      props.roll.deleteNote(hovered.index);

      if(engine.scheduler) {
        engine.scheduler.removeNote(noteToDelete.id);
        updatePatternLoop();
      }
    }

    // copy state on any left-click (click, drag, or resize)
    if(event.button === 0) cacheNoteState(hovered.note);

    // resize
    if(isNearRightEdge(event, hovered.note)) {
      state.resizingNote = hovered.note;
      state.resizeInitialLength = hovered.note.length;
      props.roll.startResize(hovered.note);
      return;
    }

    // drag
    state.draggingNote = hovered.note;
    state.dragStart = {
      row: state.hoverCell.row - hovered.note.row,
      col: state.hoverCell.col - hovered.note.col
    }

    return;
  }

  // place
  if(event.button === 0 && !hovered?.note) {
    const noteId = generateNoteId();
    const midi = props.roll.addNote(state.hoverCell, noteId, state.cachedLength, 0.8, selectedChannelId.value);

    // add note to scheduler
    if(engine.scheduler) {
      // converting note to scheduler note
      const noteBlocks = props.roll.getNoteData;
      const newNote = noteBlocks[noteBlocks.length - 1];
      if(newNote) {
        // apply cached curves, scaling beats to new length and shifting values to new note's pitch
        for(const [parameterId, { curve: cachedCurve, noteMidi: cachedMidi }] of cachedCurves) {
          props.roll.activateLane(newNote.id, parameterId);
          const originalLength = cachedCurve.nodes[cachedCurve.nodes.length - 1]!.beat;
          const scale = originalLength > 0 ? newNote.length / originalLength : 1;
          let nodes = cachedCurve.nodes.map(n => ({ ...n, beat: n.beat * scale }));
          const def = PARAMETER_MAP.get(parameterId);
          if(def?.followNote && def.getDefaultNormalized) {
            const delta = def.getDefaultNormalized(newNote.midi) - def.getDefaultNormalized(cachedMidi);
            nodes = shiftNodeValues(nodes, delta);
          }
          props.roll.updateCurve(newNote.id, { ...cachedCurve, nodes });
        }

        engine.scheduler.addNote({
          id: newNote.id,
          pitch: newNote.midi,
          startTime: newNote.col,
          duration: newNote.length,
          velocity: 0.8,
          channel: newNote.channelId,
          automation: newNote.automation,
        });

        state.draggingNote = newNote;
        state.dragStart = {
          row: state.hoverCell.row - newNote.row,
          col: state.hoverCell.col - newNote.col
        }
      }

      updatePatternLoop();
    }

    // preview note
    await playNote(midi);
    setTimeout(() => stopNote(midi), 150);

    return;
  }
}

function finalizeEdit() {
  if(props.roll.isResizing() && state.resizingNote) {
    const note = state.resizingNote;
    const oldLength = state.resizeInitialLength;
    props.roll.stopResize();

    if(note.automation.size > 0 && note.length !== oldLength) {
      props.roll.updateAutomationForResize(note.id, oldLength, note.length);
    }

    updatePatternLoop();
    state.resizingNote = null;
  }

  if(state.draggingNote) {
    updatePatternLoop();
    state.draggingNote = null;
    state.dragStart = { row: 0, col: 0 };
  }

  state.hoverCell = null;
  state.hoverNote = null;
  cursor.value = 'default';
}

function onPianoRollKeyDown(event: KeyboardEvent) {
  if(!isWindowActive(windowId!)) return;

  const target = event.target as HTMLElement;
  if(['INPUT', 'TEXTAREA'].includes(target.tagName)) return;

  const element = pianoRollContainer.value;
  if(!element) return;

  const stepInterval = 0.5;
  const fastScrollMult = event.shiftKey ? 8 : 1;
  switch(event.code) {
    case 'ArrowUp':
      event.preventDefault();
      element.scrollTop -= rowHeight.value * fastScrollMult;
      break;
    case 'ArrowDown':
      event.preventDefault();
      element.scrollTop += rowHeight.value * fastScrollMult;
      break;
    case 'ArrowLeft':
      event.preventDefault();
      element.scrollLeft -= colWidth * stepInterval * fastScrollMult;
      break;
    case 'ArrowRight':
      event.preventDefault();
      element.scrollLeft += colWidth * stepInterval * fastScrollMult;
      break;
    case 'Escape':
      if(activeAutomationLane.value) {
        activeAutomationLane.value = null;
      }
  }
}

// load pattern notes into scheduler (only when in pattern mode)
function loadPatternNotes() {
  if (playbackMode.value !== 'pattern') return;

  engine.scheduler.setNotes([]);

  const existingNotes = props.roll.getNoteData;
  existingNotes.forEach(note => {
    engine.scheduler.addNote({
      id: note.id,
      pitch: note.midi,
      startTime: note.col,
      duration: note.length,
      velocity: 0.8,
      channel: note.channelId,
      automation: note.automation,
    });
  });

  updatePatternLoop();
}

// LIFECYCLE

onMounted(async () => {
  await nextTick();

  // define callbacks for pattern mode
  const playheadCallback = (beat: number) => {
    playhead.col = beat;
    if(!pianoRollContainer.value) return;

    const playheadPos = beat * colWidth;
    const viewWidth = pianoRollContainer.value.clientWidth;
    const threshold = colWidth * 4;

    if(beat < 1 && pianoRollContainer.value.scrollLeft > 0) {
      pianoRollContainer.value.scrollLeft = 0;
      return;
    }

    const viewEndpoint = pianoRollContainer.value.scrollLeft + viewWidth;

    if(playheadPos > viewEndpoint - threshold) {
      pianoRollContainer.value.scrollLeft = playheadPos - pianoRollContainer.value.clientWidth + threshold;
    }
  };

  const playStateCallback = (playing: boolean) => {
    playhead.playing = playing;
  };

  registerPatternCallbacks(playheadCallback, playStateCallback);
  loadPatternNotes();

  watch(playbackMode, (newMode) => {
    if (newMode === 'pattern') {
      loadPatternNotes();
    }
  });

  windowElement.value?.addEventListener('keydown', onPianoRollKeyDown);

  if(pianoRollContainer.value) {
    const centerMidi = noteToMidi('C', 5); // start note of piano roll
    const index = notes.findIndex(n => n.midi === centerMidi);
    const row = notes.length - 1 - index;
    pianoRollContainer.value.scrollTop = row * rowHeight.value - pianoRollContainer.value.clientHeight / 2;
  }
});

onBeforeUnmount(() => {
  windowElement.value?.removeEventListener('keydown', onPianoRollKeyDown);
  unregisterPatternCallbacks();

  if (playbackMode.value === 'pattern') {
    engine.scheduler.setNotes([]);
    if(engine.scheduler.isPlaying) {
      engine.scheduler.stop();
    }
  }
})
</script>

<template>
  <div class="flex flex-col w-full h-full">
    <!-- toolbar / drag handle -->
    <div class="window-header border-b-2 border-mix-30 bg-mix-15 px-3 shrink-0"
      @pointerdown.stop="dragWindow?.($event)">
      <span class="text-xs font-medium">{{ props.name }} - </span>

      <BaseDropdown
        v-model="selectedChannelId"
        :items="channels"
        item-label="name"
        item-value="id"
        button-class="px-2 py-0.5 font-mono font-bold min-w-0"
        width="30"
      />

      <BaseDropdown
        :model-value="activeAutomationLane"
        :items="ALL_PARAMETERS"
        item-label="label"
        item-value="id"
        button-class="px-2 py-0.5 font-mono font-bold min-w-0"
        width="30"
        display="image"
        display-image="/icons/automation-icon-white.png"
        :button-style="activeLaneDef ? { backgroundColor: manipulateColor(activeLaneDef.color, 0, 0.5)} : {}"
        @update:model-value="toggleLane"
      />

      <button v-if="hasCurveCache" class="w-5 h-5 rounded flex items-center justify-center text-red-400 hover:text-red-300 shrink-0" @pointerdown.stop @click="clearCurveCache()" title="Clear automation curve cache">
        <span class="pi pi-times text-xs" />
      </button>

      <!-- curve visibility toggles -->
      <template v-if="parametersWithCurves.length > 0">
        <div class="w-px h-4 bg-mix-30 mx-1 shrink-0" />
        <div v-for="param in parametersWithCurves" :key="`vis-${param.id}`"
          class="w-3 h-3 rounded-sm border-2 cursor-pointer shrink-0 transition-colors"
          :title="`${visibleCurveLanes.has(param.id) ? 'Hide' : 'Show'} ${param.label} curves`"
          :style="{ borderColor: param.color, backgroundColor: visibleCurveLanes.has(param.id) ? param.color : 'transparent' }"
          @pointerdown.stop
          @click="toggleVisibleLane(param.id)"
        />
      </template>

      <!-- separator -->
      <div class="flex-1" />

      <button class="w-6 h-6 rounded util-button flex items-center justify-center" @pointerdown.stop @click="resetWindow?.()" title="Reset position and size">
        <span class="pi pi-refresh text-xs" />
      </button>

      <button class="w-6 h-6 rounded util-button flex items-center justify-center" @pointerdown.stop @click="closeWindow?.()" title="Close window">
        <span class="pi pi-times text-xs" />
      </button>
    </div>

    <!-- piano roll -->
    <div ref="pianoRollContainer" class="flex-1 overflow-auto grid grid-cols-[50px_1fr]">
      <!-- notes column -->
      <div class="flex flex-col-reverse sticky left-0 z-50" ref="pianoKeysContainer" :style="{ height: `${notes.length * rowHeight}px` }">
        <button v-for="key in notes" :key="key.midi" 
          @pointerdown="playNote(key.midi)"
          @pointerup="stopNote(key.midi)"
          @pointerleave="stopNote(key.midi)"
          :class="[
            'w-full text-sm select-none border-2 border-transparent hover:border-[#646cff]',
            key.isBlack ? 'key-black' : 'key-white'
          ]"
          :style="{ height: rowHeight + 'px' }"> 
          {{ key.note }} 
        </button>
      </div>

      <!-- workspace -->
      <div class="relative piano-roll-grid" ref="workSpaceContainer"
        @pointermove="handlePointerMove"
        @pointerleave="finalizeEdit"
        @pointerdown="handlePointerDown"
        @pointerup="finalizeEdit"
        @contextmenu.prevent
        :style="{
          cursor: cursor,
          height: `${notes.length * rowHeight}px`,
          width: `${128 * beatsPerBar * colWidth}px`,
          '--row-h': `${rowHeight}px`,
          '--col-w': `${colWidth}px`,
          '--bar-w': `${colWidth * beatsPerBar}px`,
          '--snap-w': `${snapDivision > 1 ? colWidth / snapDivision : colWidth}px`
        }"
      >
        <!-- row backgrounds -->
        <div v-for="(key, i) in notes" :key="key.midi" class="absolute w-full pointer-events-none"
          :style="{
            top: `${(notes.length - 1 - i) * rowHeight}px`,
            height: `${rowHeight}px`,
            backgroundColor: key.isBlack ? 'transparent' : 'rgba(255,255,255,0.04)'
          }"
        ></div>

        <!-- notes -->
        <div v-for="(block, i) in roll.getNoteData" :key="i" class="absolute opacity-80 rounded-sm note-color"
          :style="{
            top: `${block.row * rowHeight}px`,
            left: `${block.col * colWidth}px`,
            width: `${block.length * colWidth}px`,
            height: `${rowHeight}px`
          }"
        >
          <NoteAutomationOverlay v-if="activeLaneDef && block.automation.has(activeLaneDef.id)" v-bind="getOverlayLayout(block.row)"
            :curve="block.automation.get(activeLaneDef.id)!"
            :noteLength="block.length"
            :widthPx="block.length * colWidth"
            :paramColor="activeLaneDef.color"
            :curveStyle="activeLaneDef.curveStyle ?? 'bezier'"
            @update="(c) => onAutomationUpdate(block.id, c)"
          />
          <!-- read-only curve previews (visible when lane is toggled on but not actively being edited) -->
          <template v-for="paramId in visibleCurveLanes" :key="`ro-${paramId}`">
            <NoteAutomationOverlay
              v-if="block.automation.has(paramId) && PARAMETER_MAP.get(paramId) && (!activeLaneDef || activeLaneDef.id !== paramId)"
              v-bind="getOverlayLayout(block.row, PARAMETER_MAP.get(paramId))"
              :curve="block.automation.get(paramId)!"
              :noteLength="block.length"
              :widthPx="block.length * colWidth"
              :paramColor="PARAMETER_MAP.get(paramId)!.color"
              :curveStyle="PARAMETER_MAP.get(paramId)!.curveStyle ?? 'bezier'"
              :snapInterval="null"
              :readOnly="true"
            />
          </template>
        </div>

        <!-- hover cell -->
        <div v-if="state.hoverCell && !state.hoverNote && !activeLaneDef" class="absolute border-2 opacity-50 pointer-events-none rounded-sm note-outline-color"
          :style="{
            top: `${state.hoverCell.row * rowHeight}px`,
            left: `${state.hoverCell.col * colWidth}px`,
            width: `${colWidth * state.cachedLength}px`,
            height: `${rowHeight}px`
          }"
        ></div>

        <!-- hover note -->
        <div v-if="state.hoverNote && !activeLaneDef" class="absolute border-2 opacity-50 pointer-events-none rounded-sm note-outline-color"
          :style="{
            top: `${state.hoverNote.row * rowHeight}px`,
            left: `${state.hoverNote.col * colWidth}px`,
            width: `${state.hoverNote.length * colWidth}px`,
            height: `${rowHeight}px`
          }"
        ></div>

        <!-- playhead (only visible in pattern mode) -->
        <div v-if="playbackMode === 'pattern' && (playhead.playing || playhead.col > 0)"
          class="absolute w-0.75 pointer-events-none playhead-color"
          :style="{
            transform: `translateX(${playhead.col * colWidth}px)`,
            top: '0',
            height: `${notes.length * rowHeight}px`,
            boxShadow: `-1px 0 6px var(--playhead)`
          }"
        ></div>
      </div>
    </div>
  </div>
</template>