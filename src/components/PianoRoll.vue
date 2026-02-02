<script setup lang="ts">
import { ref, reactive, onMounted, nextTick, onBeforeUnmount, inject, type Ref } from 'vue';
import { MiniSynth } from '../audio/MiniSynth'
import { PianoRoll, type NoteBlock, type Cell } from '../audio/PianoRoll'
import { noteToMidi } from '../audio/midiUtils';
import { isWindowActive } from '../services/windowManager';
import { Scheduler } from '../audio/Scheduler';

let synth: MiniSynth | null = null;
let scheduler: Scheduler | null = null;
let noteIdCounter = 0;

function initAudio() {
  if(synth) return;
  synth = new MiniSynth();
  scheduler = new Scheduler(synth, { bpm: tempo });

  scheduler.onPlayhead((beat) => {
    playhead.col = beat;
  });

  scheduler.onPlayStateChange((playing) => {
    playhead.playing = playing;
  });
}

function generateNoteId(): string {
  return `note-${noteIdCounter++}-${Date.now()}`;
}

// SETUP

const props = defineProps<{
  roll: PianoRoll;
}>();

const workSpaceContainer = ref<HTMLDivElement | null>(null);
const pianoRollContainer = ref<HTMLDivElement | null>(null);

const notes = props.roll.getKeyboardNotes;

const windowElement = inject<Ref<HTMLElement | null>>('windowElement');
const windowId = inject<string>('windowId');
if(!windowElement) throw new Error('PianoRoll must be in a window');

const state = reactive({
  hoverCell: null as Cell | null,
  hoverNote: null as NoteBlock | null,
  cachedLength: 1,
  resizingNote: null as NoteBlock | null,
  draggingNote: null as NoteBlock | null,
  dragStart: { row: 0, col: 0}
});

const playhead = reactive({
  col: 0,
  playing: false
});

const tempo = 120;

const rowHeight = ref(20);
const colWidth = 80;
const beatsPerBar = 4;

// LIVE PREVIEW (keyboard sidebar)

async function playNote(midi: number) {
  if(scheduler?.isPlaying) return;

  await synth!.resume();
  synth!.noteOn(midi);
}

function stopNote(midi: number) {
  synth?.noteOff(midi);
}

// CONTROLS

function stopPlayhead() {
  scheduler!.stop();
}

async function togglePlayhead() {
  await scheduler!.toggle();
}

// POINTER HANDLING

function getCellFromPointer(event: PointerEvent) {
  if(!workSpaceContainer.value) return { row: 0, col: 0};
  const rect = workSpaceContainer.value.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  return { row: Math.floor(y / rowHeight.value), col: props.roll.snap(x / colWidth) };
}

function isNearRightEdge(event: PointerEvent, note: NoteBlock) {
  const pianoRoll = workSpaceContainer.value!.getBoundingClientRect();
  const pointerX = event.clientX - pianoRoll.left;
  const noteRightX = (note.col + note.length) * colWidth;
  return Math.abs(pointerX - noteRightX) <= 15 * note.length;
}

function handlePointerMove(event: PointerEvent) {
  if(props.roll.isResizing() && state.resizingNote) {
    const pointerX = event.clientX - workSpaceContainer.value!.getBoundingClientRect().left;
    state.cachedLength = props.roll.resize(pointerX / colWidth);
    return;
  }

  const cell = getCellFromPointer(event);
  state.hoverCell = cell;

  const hovered = props.roll.getHoveredNote(cell);
  state.hoverNote = hovered?.note ?? null;

  if(state.draggingNote) {
    const newCol = cell.col - state.dragStart.col;
    const newRow = cell.row - state.dragStart.row;

    props.roll.move(state.draggingNote.id, newRow, newCol);

    if(scheduler) {
      scheduler.updateNote(state.draggingNote.id, { startTime: newCol, pitch: notes[newRow]?.midi});
    }
  }
}

function handlePointerLeave() {
  state.hoverCell = null;
  state.hoverNote = null;
}

async function handlePointerDown(event: PointerEvent) {
  if(!state.hoverCell) return;
  const hovered = props.roll.getHoveredNote(state.hoverCell);

  // right click delete
  if(hovered?.note) {
    if(event.button === 2) {
      const noteToDelete = hovered.note;
      props.roll.deleteNote(hovered.index);

      if(scheduler) {
        scheduler.removeNote(noteToDelete.id);
      }
    }

    // resize
    if(isNearRightEdge(event, hovered.note)) {
      state.resizingNote = hovered.note;
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
    const midi = props.roll.addNote(state.hoverCell, state.cachedLength, noteId);

    // add note to scheduler
    if(scheduler) {
      const noteBlocks = props.roll.getNoteData;
      const newNote = noteBlocks[noteBlocks.length - 1];
      if (newNote) {
        scheduler.addNote({
          id: newNote.id,
          pitch: newNote.midi,
          startTime: newNote.col,
          duration: newNote.length,
          velocity: 0.8,
        });
      }
    }

    // preview note
    await playNote(midi);
    setTimeout(() => stopNote(midi), 150);
    return;
  }
}

function handlePointerUp() {
  if(props.roll.isResizing() && state.resizingNote) {
    props.roll.stopResize();

    // update note duration in scheduler
    if(scheduler) {
      scheduler.updateNote(state.resizingNote.id, {
        duration: state.resizingNote.length
      });
    }

    state.resizingNote = null;
  }

  if(state.draggingNote) {
    state.draggingNote = null;
    state.dragStart = { row: 0, col: 0 };
  }
}

function onPianoRollKeyDown(event: KeyboardEvent) {
  if(!isWindowActive(windowId!)) return;

  const target = event.target as HTMLElement;
  if(['INPUT', 'TEXTAREA'].includes(target.tagName)) return;

  if(event.code === 'Space') {
    event.preventDefault();
    togglePlayhead();
    return;
  }

  if(event.code === 'Enter') {
    event.preventDefault();
    stopPlayhead();
    return;
  }

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
  }
}

// LIFECYCLE

onMounted(async () => {
  await nextTick();
  initAudio();

  // Add existing notes from PianoRoll to scheduler
  if(scheduler) {
    const existingNotes = props.roll.getNoteData;
    existingNotes.forEach(note => {
      scheduler!.addNote({
        id: note.id,
        pitch: note.midi,
        startTime: note.col,
        duration: note.length,
        velocity: 0.8,
      });
    });
  }

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
  scheduler?.dispose();
  synth?.dispose();
})
</script>

<template>
  <!-- piano roll -->
  <div ref="pianoRollContainer" class="w-full h-full overflow-auto grid grid-cols-[64px_1fr]"
  >
    <!-- notes column -->
    <div class="flex flex-col-reverse sticky left-0" ref="pianoKeysContainer">
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
      @pointerleave="handlePointerLeave"
      @pointerdown="handlePointerDown"
      @pointerup="handlePointerUp"
      @contextmenu.prevent
      :style="{
        height: `${notes.length * rowHeight}px`,
        width: `${128 * beatsPerBar * colWidth}px`,
        '--row-h': `${rowHeight}px`,
        '--col-w': `${colWidth}px`,
        '--bar-w': `${colWidth * beatsPerBar}px`,
        '--snap-w': `${roll.snapDivision > 0 ? colWidth / roll.snapDivision : 0}px`
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
      <div v-for="(block, i) in roll.getNoteData" :key="i" class="absolute opacity-80 rounded-lg note-color"
        :style="{
          top: `${block.row * rowHeight}px`,
          left: `${block.col * colWidth}px`,
          width: `${block.length * colWidth}px`,
          height: `${rowHeight}px`
        }"
      ></div>

      <!-- hover cell -->
      <div v-if="state.hoverCell && !state.hoverNote" class="absolute border-2 opacity-50 pointer-events-none rounded-lg note-outline-color"
        :style="{
          top: `${state.hoverCell.row * rowHeight}px`,
          left: `${state.hoverCell.col * colWidth}px`,
          width: `${colWidth * state.cachedLength}px`,
          height: `${rowHeight}px`
        }"
      ></div>

      <!-- hover note -->
      <div v-if="state.hoverNote" class="absolute border-2 opacity-50 pointer-events-none rounded-lg note-outline-color"
        :style="{
          top: `${state.hoverNote.row * rowHeight}px`,
          left: `${state.hoverNote.col * colWidth}px`,
          width: `${state.hoverNote.length * colWidth}px`,
          height: `${rowHeight}px`
        }"
      ></div>

      <!-- playhead -->
      <div v-if="playhead.playing || playhead.col > 0"
        class="absolute w-0.75 z-50 pointer-events-none playhead-color"
        :style="{
          transform: `translateX(${playhead.col * colWidth}px)`,
          top: '0',
          height: `${notes.length * rowHeight}px`,
          boxShadow: `-1px 0 6px var(--playhead)`
        }"
      ></div>
    </div>
  </div>
</template>