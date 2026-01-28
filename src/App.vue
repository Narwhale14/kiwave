<script setup lang="ts">
import { ref, reactive, onMounted, nextTick } from 'vue';
import { MiniSynth } from './audio/MiniSynth'
import { resumeAudioContext } from './audio/audio';
import { Keyboard } from './audio/Keyboard';

const synth = new MiniSynth();
const keyboard = new Keyboard({note: 'C', octave: 0}, {note: 'C', octave: 10});
const notes = keyboard.getKeyboardInfo();

async function playNote(midi: number) {
  await resumeAudioContext();
  synth.noteOn(midi);
}

function stopNote(midi: number) {
  synth.noteOff(midi);
}

const rowHeight = ref(24);
const colWidth = 80;
const beatsPerBar = 4;

type NoteBlock = { row: number; col: number, length: number };

const state = reactive({
  noteBlocks: [] as NoteBlock[],

  hoverCell: null as { row: number; col: number } | null,
  hoverNote: null as NoteBlock | null,

  resizingNote: null as NoteBlock | null
});

const pianoKeysContainer = ref<HTMLDivElement | null>(null);
const pianoRollContainer = ref<HTMLDivElement | null>(null);

onMounted(async () => {
  await nextTick();
  if(pianoKeysContainer.value) {
    const firstKey = pianoKeysContainer.value.querySelector('button');
    if(firstKey) rowHeight.value = firstKey.getBoundingClientRect().height;
  }
});

// grid managers
function getCellFromPointer(event: PointerEvent, container: HTMLElement) {
  const rect = container.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  return { row: Math.floor(y / rowHeight.value), col: Math.floor(x / colWidth) };
}

function isNearRightEdge(event: PointerEvent, note: NoteBlock) {
  const pianoRoll = pianoRollContainer.value!.getBoundingClientRect();
  const pointerX = event.clientX - pianoRoll.left;
  const noteRightX = (note.col + note.length) * colWidth;
  return Math.abs(pointerX - noteRightX) <= 15;
}

function getHoveredNote(cell: {row: number; col: number}) {
  const index = state.noteBlocks!.findIndex(n => n.row === cell.row && cell.col >= n.col && cell.col < n.col + n.length);
  return index === -1 ? null : { note: state.noteBlocks[index], index }
}

// mouse events
function handlePointerMove(event: PointerEvent) {
  if(state.resizingNote) {
    state.hoverCell = null;
    return;
  }

  const cell = getCellFromPointer(event, pianoRollContainer.value!);
  state.hoverCell = cell;

  const hovered = getHoveredNote(cell);
  state.hoverNote = hovered?.note ?? null;
}

function handlePointerLeave() {
  if(!state.resizingNote) state.hoverCell = null;
}

function handlePointerDown(event: PointerEvent) {
  if(!state.hoverCell) return;
  const hovered = getHoveredNote(state.hoverCell);

  // place
  if(!hovered?.note) {
    state.noteBlocks.push({ ...state.hoverCell, length: 1 });
    return;
  }

  // pend resize
  if(isNearRightEdge(event, hovered.note)) {
    startResizing(hovered.note);
    return;
  }

  state.noteBlocks.splice(hovered.index, 1);
}

function startResizing(note: NoteBlock) {
  state.resizingNote = note;
  window.addEventListener('pointermove', handleResize);
  window.addEventListener('pointerup', stopResizing);
}

function handleResize(event: PointerEvent) {
  if(!state.resizingNote) return;
  const pointerX = event.clientX - pianoRollContainer.value!.getBoundingClientRect().left;
  state.resizingNote.length = Math.max(1, Math.round(pointerX / colWidth - state.resizingNote.col));
}

function stopResizing() {
  state.resizingNote = null;
  window.removeEventListener('pointermove', handleResize);
  window.removeEventListener('pointerup', stopResizing);
}
</script>

<template>
  <!-- piano roll -->
  <div class="h-screen w-screen overflow-y-auto grid grid-cols-[64px_1fr] overflow-hidden">
    <!-- notes column -->
    <div class="flex flex-col-reverse" ref="pianoKeysContainer">
      <button v-for="key in notes" :key="key.midi" 
        @pointerdown="playNote(key.midi)"
        @pointerup="stopNote(key.midi)"
        @pointerleave="stopNote(key.midi)"
        :class="[
          'w-full text-sm border select-none',
          key.isBlack ? 'bg-[#1a1a1a] text-white' : 'bg-[#f5f5f5] text-black'
        ]"> 
        {{ key.note }} 
      </button>
    </div>

    <!-- workspace -->
    <div class="relative piano-roll-grid" ref="pianoRollContainer"
      @pointermove="handlePointerMove"
      @pointerleave="handlePointerLeave"
      @pointerdown="handlePointerDown"
      :style="{
        height: `${notes.length * rowHeight}px`,
        '--row-h': `${rowHeight}px`,
        '--col-w': `${colWidth}px`,
        '--bar-w': `${colWidth * beatsPerBar}px`
      }"
    >
      <!-- notes -->
      <div v-for="(block, i) in state.noteBlocks" :key="i" class="absolute bg-blue-500 opacity-80 rounded-lg"
        :style="{
          top: `${block.row * rowHeight}px`,
          left: `${block.col * colWidth}px`,
          width: `${block.length * colWidth}px`,
          height: `${rowHeight}px`
        }"
      ></div>

      <!-- hover cell -->
      <div v-if="state.hoverCell" class="absolute border-2 border-blue-400 opacity-50 pointer-events-none rounded-lg"
        :style="{
          top: `${state.hoverCell.row * rowHeight}px`,
          left: `${state.hoverCell.col * colWidth}px`,
          width: `${colWidth}px`,
          height: `${rowHeight}px`
        }"
      ></div>

      <!-- hover note -->
      <div v-if="state.hoverNote" class="absolute border-2 border-blue-400 opacity-50 pointer-events-none rounded-lg"
        :style="{
          top: `${state.hoverNote.row * rowHeight}px`,
          left: `${state.hoverNote.col * colWidth}px`,
          width: `${state.hoverNote.length * colWidth}px`,
          height: `${rowHeight}px`
        }"
      ></div>
    </div>
  </div>
</template>