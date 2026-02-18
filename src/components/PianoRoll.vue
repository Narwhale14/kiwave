<script setup lang="ts">
import { ref, reactive, onMounted, nextTick, onBeforeUnmount, inject, type Ref, computed, watch } from 'vue';
import { PianoRoll, type NoteBlock, type Cell } from '../audio/PianoRoll'
import { noteToMidi } from '../util/midi';
import { getAudioEngine } from '../services/audioEngineManager';
import { getVisualSnapWidth, dynamicSnap } from '../util/snap';
import { playbackMode, registerPatternCallbacks, unregisterPatternCallbacks } from '../services/playbackModeManager';
import BaseDropdown from './modals/BaseDropdown.vue';
import NoteAutomationOverlay from './overlays/NoteAutomationOverlay.vue';
import { ALL_PARAMETERS, PARAMETER_MAP } from '../audio/Automation';
import { shiftNodeValues, type AutomationCurve } from '../audio/Automation';
import { manipulateColor } from '../util/display';
import ZoomScrollBar from './controls/ZoomScrollBar.vue';
import { MAX_ZOOM_FACTOR } from '../constants/defaults';
import { clamp } from '../util/math';

const VELOCITY_SNAP = 0.05;

const props = defineProps<{
  roll: PianoRoll;
  name: string;
  selectedChannelId: string;
}>();

const emit = defineEmits<{ 'update:selectedChannelId': [id: string] }>();

let noteIdCounter = 0;
function generateNoteId(): string {
  return `note-${noteIdCounter++}-${Date.now()}`;
}

// relevant data
const engine = getAudioEngine();
const selectedChannelId = computed({ get: () => props.selectedChannelId, set: (v) => emit('update:selectedChannelId', v) });
const channels = computed(() => engine.channelManager.getAllChannels());
const instrument = computed(() => engine.channelManager.getChannel(selectedChannelId.value)?.instrument ?? null);
const notes = props.roll.getKeyboardNotes;

const workspaceContainer = ref<HTMLDivElement | null>(null);
const pianoRollContainer = ref<HTMLDivElement | null>(null);
const cursor = ref('default');

const windowElement = inject<Ref<HTMLElement | null>>('windowElement');
const closeWindow = inject<() => void>('closeWindow');
const resetWindow = inject<() => void>('resetWindow');
const dragWindow = inject<(event: PointerEvent) => void>('dragWindow');

// dumb but has to be here?
if(!windowElement) throw new Error('PianoRoll must be in a window');

const state = reactive({
  hoverCell: null as Cell | null,
  hoverNote: null as NoteBlock | null,
  cachedLength: 1,
  cachedVelocity: 0.8,
  resizingNote: null as NoteBlock | null,
  resizeInitialLength: 0,
  draggingNote: null as NoteBlock | null,
  dragStart: { row: 0, col: 0}
});

const playhead = reactive({
  col: 0,
  playing: false
});

const rowHeight = ref(15); // height of row (key)
const colWidth = ref(80); // width of col (beat)
const scrollX = ref(0); // pos of horizontal scroll
const beatsPerBar = 4;

const barCount = computed(() => Math.ceil(props.roll.getEndBeat(beatsPerBar) / beatsPerBar) + 7);
const totalWidth = computed(() => barCount.value * beatsPerBar * colWidth.value);

const activeAutomationLane = ref<string | null>(null);
const activeLaneDef = computed(() => activeAutomationLane.value ? PARAMETER_MAP.get(activeAutomationLane.value) ?? null : null);
const parametersWithCurves = computed(() => ALL_PARAMETERS.filter(p => props.roll.getNoteData.some(n => n.automation.has(p.id))));
const visibleCurveLanes = reactive(new Set<string>());
const cachedCurves = reactive(new Map<string, { curve: AutomationCurve; noteMidi: number }>());

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
  state.cachedVelocity = note.velocity;
  for(const [parameterId, curve] of note.automation) {
    cachedCurves.set(parameterId, { curve, noteMidi: note.midi });
  }
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
  if(!instrument.value) return;

  await instrument.value.resume();
  instrument.value.noteOn(midi);
}

function stopNote(midi: number) {
  instrument.value?.noteOff(midi);
}

function updatePatternLoop() {
  if(playbackMode.value !== 'pattern') return;
  engine.scheduler.setLoop(true, 0, props.roll.getEndBeat(beatsPerBar));
}

function getCellFromPointer(event: PointerEvent) {
  if(!workspaceContainer.value) return { row: 0, col: 0};
  const rect = workspaceContainer.value.getBoundingClientRect();

  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;

  let col = x / colWidth.value;
  if(!event.shiftKey) col = dynamicSnap(x / colWidth.value, colWidth.value);

  return { row: Math.floor(y / rowHeight.value), col };
}

// USER CONTROLS

// updating scroll var with native scroll (like trackpad, ig)
function onNativeScroll() {
  if(pianoRollContainer.value) {
    scrollX.value = pianoRollContainer.value.scrollLeft;
  }
}

// for wheel keybinds
function handleWheel(event: WheelEvent) {
  const element = pianoRollContainer.value;
  if(!element) return;

  // VELOCITY EDIT (Ctrl + Hover Note)
  if(event.ctrlKey && state.hoverNote && !activeAutomationLane.value) {
    event.preventDefault();

    const steps = Math.round(state.hoverNote.velocity / VELOCITY_SNAP);
    const newVelocity = clamp(steps + (event.deltaY > 0 ? -1 : 1), 0, 20) * VELOCITY_SNAP;
    props.roll.setVelocity(state.hoverNote.id, newVelocity);
    engine.scheduler.updateNote(state.hoverNote.id, { velocity: newVelocity });
    return;
  }

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

function onPianoRollKeyDown(event: KeyboardEvent) {
  const target = event.target as HTMLElement;
  if(['INPUT', 'TEXTAREA'].includes(target.tagName)) return;

  const element = pianoRollContainer.value;
  if(!element) return;

  const stepSize = colWidth.value / 2;
  const multiplier = event.shiftKey ? 4 : 1;

  switch(event.code) {
    case 'ArrowUp':
      event.preventDefault();
      element.scrollTop -= rowHeight.value * multiplier;
      break;
    case 'ArrowDown':
      event.preventDefault();
      element.scrollTop += rowHeight.value * multiplier;
      break;
    case 'ArrowLeft':
      event.preventDefault();
      // Directly modify the element; onNativeScroll will catch this and update the scrollbar
      element.scrollLeft -= stepSize * multiplier;
      break;
    case 'ArrowRight':
      event.preventDefault();
      element.scrollLeft += stepSize * multiplier;
      break;
    case 'Escape':
      if(activeAutomationLane.value) {
        activeAutomationLane.value = null;
      }
      break;
  }
}

function isNearRightEdge(event: PointerEvent, note: NoteBlock) {
  const pianoRoll = workspaceContainer.value!.getBoundingClientRect();
  const pointerX = event.clientX - pianoRoll.left;
  const noteRightX = (note.col + note.length) * colWidth.value;

  const region = 0.25 * note.length * colWidth.value; // 1 quarter of the note scaled by colWidth
  return Math.abs(pointerX - noteRightX) <= region;
}

function handlePointerMove(event: PointerEvent) {
  if(activeLaneDef.value) return;
  if(props.roll.isResizing() && state.resizingNote) {
    const pointerX = event.clientX - workspaceContainer.value!.getBoundingClientRect().left;
    const rawCol = pointerX / colWidth.value;
    const snappedCol = event.shiftKey ? rawCol : dynamicSnap(rawCol, colWidth.value);
    state.cachedLength = props.roll.resize(snappedCol);

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
    instrument.value?.triggerRelease(state.draggingNote.id, instrument.value.getAudioContext().currentTime); // cancel current

    const noteIndex = notes.length - 1 - newRow;
    engine.scheduler.updateNote(state.draggingNote.id, {
      startTime: Math.max(0, newCol),
      pitch: notes[noteIndex]?.midi
    });
  }
}

// when user left/right clicks on the piano roll
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
    const midi = props.roll.addNote(state.hoverCell, noteId, state.cachedLength, state.cachedVelocity, selectedChannelId.value);

    // add note to scheduler
    if(engine.scheduler) {
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
          velocity: newNote.velocity,
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

function handleViewUpdate({ start, width }: { start: number, width: number }) {
  if(!pianoRollContainer.value) return;

  // start and width are the current position and width percent of the slider's track
  // start = 0 means the slider is at the far left
  // width = 1 means the width is 100% of the slider's track

  colWidth.value = pianoRollContainer.value.clientWidth / (width * barCount.value * beatsPerBar);
  pianoRollContainer.value.scrollLeft = start * totalWidth.value;
  scrollX.value = pianoRollContainer.value.scrollLeft;
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
      velocity: note.velocity,
      channel: note.channelId,
      automation: note.automation,
    });
  });

  updatePatternLoop();
}

// LIFECYCLE

onMounted(async () => {
  await nextTick();
  if(!props.selectedChannelId) emit('update:selectedChannelId', engine.channelManager.getLatestChannelId() || '');

  // define callbacks for pattern mode
  const playheadCallback = (beat: number) => {
    playhead.col = beat;
    if(!pianoRollContainer.value) return;

    if(beat < 1 && pianoRollContainer.value.scrollLeft > 0) {
      pianoRollContainer.value.scrollLeft = 0;
      return;
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

  if(playbackMode.value === 'pattern') {
    engine.scheduler.setNotes([]);
    if(engine.scheduler.isPlaying) {
      engine.scheduler.stop();
    }
  }
});
</script>

<template>
  <div class="flex flex-col w-full h-full">
    <!-- toolbar / drag handle -->
    <div class="window-header border-b-2 border-mix-30 bg-mix-15 px-3 shrink-0"
      @pointerdown.stop="dragWindow?.($event)">
      <span class="text-xs font-medium">{{ props.name }} - </span>

      <BaseDropdown title="Instrument"
        v-model="selectedChannelId"
        :items="channels"
        item-label="name"
        item-value="id"
        button-class="px-2 py-0.5 font-mono font-bold min-w-0"
        width="30"
      />

      <BaseDropdown title="Automation Lane"
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

      <button v-if="cachedCurves.size > 0" class="w-5 h-5 rounded flex items-center justify-center text-red-400 hover:text-red-300 shrink-0" @pointerdown.stop @click="cachedCurves.clear();" title="Clear automation curve cache">
        <span class="pi pi-times text-xs" />
      </button>

      <!-- curve visibility toggles -->
      <div v-if="parametersWithCurves.length > 0" class="flex flex-row gap-2 justify-center items-center">
        <div class="w-px h-4 bg-mix-30 ml-1 shrink-0" />
        <div v-for="param in parametersWithCurves" :key="`vis-${param.id}`"
          class="w-3 h-3 rounded-sm border-2 cursor-pointer shrink-0 transition-colors"
          :title="`${visibleCurveLanes.has(param.id) ? 'Hide' : 'Show'} ${param.label} curves`"
          :style="{ borderColor: param.color, backgroundColor: visibleCurveLanes.has(param.id) ? param.color : 'transparent' }"
          @pointerdown.stop
          @click="visibleCurveLanes.has(param.id) ? visibleCurveLanes.delete(param.id) : visibleCurveLanes.add(param.id)"
        />
      </div>

      <!-- separator -->
      <div class="flex-1" />

      <button class="w-6 h-6 rounded util-button flex items-center justify-center" @pointerdown.stop @click="resetWindow?.()" title="Reset position and size">
        <span class="pi pi-refresh text-xs" />
      </button>

      <button class="w-6 h-6 rounded util-button flex items-center justify-center" @pointerdown.stop @click="closeWindow?.()" title="Close window">
        <span class="pi pi-times text-xs" />
      </button>
    </div>

    <ZoomScrollBar :start-percent="scrollX / totalWidth" :view-width-percent="pianoRollContainer ? pianoRollContainer.clientWidth / totalWidth : 0" @update:view="handleViewUpdate"/>

    <!-- piano roll -->
    <div ref="pianoRollContainer" class="flex-1 overflow-y-auto overflow-x-hidden grid grid-cols-[50px_1fr]" @scroll="onNativeScroll">
      <!-- notes column -->
      <div class="flex flex-col-reverse sticky left-0 z-50 shrink-0" ref="pianoKeysContainer" :style="{ height: `${notes.length * rowHeight}px` }">
        <button v-for="key in notes" :key="key.midi" @pointerdown="playNote(key.midi)" @pointerup="stopNote(key.midi)" @pointerleave="stopNote(key.midi)"
          :class="[ 'w-full text-sm select-none border-2 border-transparent hover:key border-rounded', key.isBlack ? 'key-black' : 'key-white']"
          :style="{ height: rowHeight + 'px' }"
        > 
          {{ key.note }} 
        </button>
      </div>

      <!-- workspace -->
      <div class="relative" ref="workspaceContainer" :style="{ cursor: cursor, height: `${notes.length * rowHeight}px`, width: `${totalWidth}px`}"
        @pointermove="handlePointerMove" @pointerleave="finalizeEdit" @pointerdown="handlePointerDown" @pointerup="finalizeEdit" @wheel="handleWheel" @contextmenu.prevent
      >
        <!-- 4-bar alternating column backgrounds -->
        <div class="absolute inset-0 pointer-events-none" :style="{
          backgroundImage: 'linear-gradient(to right, rgba(0,0,0,0.15) 50%, transparent 50%)',
          backgroundSize: `${colWidth * beatsPerBar * 8}px 100%`,
          backgroundPosition: `${colWidth * beatsPerBar * 4}px 0`
        }"></div>

        <!-- grid -->
        <div class="absolute inset-0 piano-roll-grid pointer-events-none"
          :style="{ 
            '--row-h': `${rowHeight}px`,
            '--beat-w': `${colWidth}px`,
            '--bar-w': `${colWidth * beatsPerBar}px`,
            '--snap-w': `${getVisualSnapWidth(colWidth)}px`,
          }"
        ></div>

        <!-- row backgrounds -->
        <div v-for="(key, i) in notes" :key="key.midi" class="absolute w-full pointer-events-none"
          :style="{
            top: `${(notes.length - 1 - i) * rowHeight}px`,
            height: `${rowHeight}px`,
            backgroundColor: key.isBlack ? 'transparent' : 'rgba(255,255,255,0.04)'
          }"
        ></div>

        <!-- notes -->
        <template v-for="(block, i) in roll.getNoteData" :key="i">
          <!-- visual layer: clipped to note bounds for fills/label -->
          <div class="absolute opacity-80 rounded-sm overflow-hidden pointer-events-none"
            :style="{
              top: `${block.row * rowHeight}px`,
              left: `${block.col * colWidth}px`,
              width: `${block.length * colWidth}px`,
              height: `${rowHeight}px`
            }"
          >
            <!-- dim background (empty velocity) -->
            <div class="absolute inset-0 note-color opacity-30" />

            <!-- velocity fill from bottom -->
            <div v-if="block.velocity >= VELOCITY_SNAP + 1e-4" class="absolute bottom-0 left-0 w-full note-color" :style="{ height: `${block.velocity * 100}%` }" />
            
              <!-- velocity label on hover -->
            <div v-if="state.hoverNote?.id === block.id"
              class="absolute inset-y-0 left-0 flex items-center pl-1 z-10">
              <span class="text-white font-mono leading-none select-none" style="font-size: 9px;">
                {{ Math.round(block.velocity * 100) }}%
              </span>
            </div>
          </div>

          <!-- overlay layer: not clipped, for automation overlays -->
          <div class="absolute"
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
              :defaultValue="activeLaneDef.getDefaultNormalized ? activeLaneDef.getDefaultNormalized(block.midi) : activeLaneDef.defaultNormalized"
              @update="(c) => onAutomationUpdate(block.id, c)"
            />

            <!-- read-only curve previews -->
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
        </template>

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
        <div v-if="state.hoverNote && !activeLaneDef" class="absolute border-2 opacity-25 pointer-events-none rounded-sm note-outline-color"
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