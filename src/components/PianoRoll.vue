<script setup lang="ts">
import { ref, reactive, onMounted, nextTick } from 'vue';
import { MiniSynth } from '../audio/MiniSynth'
import { resumeAudioContext } from '../audio/audio';
import { Keyboard } from '../audio/Keyboard';
import { PianoRoll, type NoteBlock, type Cell } from '../audio/PianoRoll'
import { noteToMidi } from '../audio/midiUtils';

const synth = new MiniSynth();
const keyboard = new Keyboard({note: 'C', octave: 0}, {note: 'C', octave: 10});
const roll = new PianoRoll(keyboard.getRange(), keyboard.getKeyboardInfo());
const notes = roll.getKeyboardNotes();

const state = reactive({
  hoverCell: null as Cell | null,
  hoverNote: null as NoteBlock | null,
  cachedLength: 1 // default note length
});

const workSpaceContainer = ref<HTMLDivElement | null>(null);
const pianoRollContainer = ref<HTMLDivElement | null>(null);

const rowHeight = ref(25);
const colWidth = 80;
const beatsPerBar = 4;

async function playNote(midi: number) {
  await resumeAudioContext();
  synth.noteOn(midi);
}

function stopNote(midi: number) {
  synth.noteOff(midi);
}

function getCellFromPointer(event: PointerEvent) {
  if(!workSpaceContainer.value) return { row: 0, col: 0};
  const rect = workSpaceContainer.value.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  return { row: Math.floor(y / rowHeight.value), col: Math.floor(x / colWidth) };
}

function isNearRightEdge(event: PointerEvent, note: NoteBlock) {
  const pianoRoll = workSpaceContainer.value!.getBoundingClientRect();
  const pointerX = event.clientX - pianoRoll.left;
  const noteRightX = (note.col + note.length) * colWidth;
  return Math.abs(pointerX - noteRightX) <= 15 * note.length;
}

function handlePointerMove(event: PointerEvent) {
  if(roll.isResizing()) {
    const pointerX = event.clientX - workSpaceContainer.value!.getBoundingClientRect().left;
    const newLength = pointerX / colWidth;

    if(newLength > state.cachedLength)
      state.cachedLength = roll.resize(Math.ceil(newLength));
    else
      state.cachedLength = roll.resize(Math.floor(newLength));
    return;
  }

  const cell = getCellFromPointer(event);
  state.hoverCell = cell;

  const hovered = roll.getHoveredNote(cell);
  state.hoverNote = hovered?.note ?? null;
}

function handlePointerLeave() {
  state.hoverCell = null;
  state.hoverNote = null;
}

function handlePointerDown(event: PointerEvent) {
  if(!state.hoverCell) return;
  const hovered = roll.getHoveredNote(state.hoverCell);

  // place
  if(!hovered?.note) {
    const midi = roll.addNote(state.hoverCell, state.cachedLength);
    playNote(midi);
    setTimeout(() => stopNote(midi), 200);
    return;
  }

  // resize
  if(isNearRightEdge(event, hovered.note)) {
    roll.startResize(hovered.note);
    return;
  }

  roll.deleteNote(hovered.index);
}

function handlePointerUp() {
  roll.stopResize();
}

onMounted(async () => {
  await nextTick();

  if(pianoRollContainer.value) {
    const centerMidi = noteToMidi('C', 5); // start note of piano roll
    const index = notes.findIndex(n => n.midi === centerMidi);
    const row = notes.length - 1 - index;
    pianoRollContainer.value.scrollTop = row * rowHeight.value - pianoRollContainer.value.clientHeight / 2;
  }
});
</script>

<template>
  <!-- piano roll -->
  <div ref="pianoRollContainer" class="w-full h-full overflow-auto grid grid-cols-[64px_1fr]">
    <!-- notes column -->
    <div class="flex flex-col-reverse" ref="pianoKeysContainer">
      <button v-for="key in notes" :key="key.midi" 
        @pointerdown="playNote(key.midi)"
        @pointerup="stopNote(key.midi)"
        @pointerleave="stopNote(key.midi)"
        :class="[
          'w-full text-sm border select-none flex items-center justify-center',
          key.isBlack ? 'bg-[#1a1a1a] text-white' : 'bg-[#f5f5f5] text-black'
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
      :style="{
        height: `${notes.length * rowHeight}px`,
        width: `${128 * beatsPerBar * colWidth}px`,
        '--row-h': `${rowHeight}px`,
        '--col-w': `${colWidth}px`,
        '--bar-w': `${colWidth * beatsPerBar}px`
      }"
    >
      <!-- notes -->
      <div v-for="(block, i) in roll.getNoteBlocks()" :key="i" class="absolute bg-blue-500 opacity-80 rounded-lg"
        :style="{
          top: `${block.row * rowHeight}px`,
          left: `${block.col * colWidth}px`,
          width: `${block.length * colWidth}px`,
          height: `${rowHeight}px`
        }"
      ></div>

      <!-- hover cell -->
      <div v-if="state.hoverCell && !state.hoverNote" class="absolute border-2 border-blue-400 opacity-50 pointer-events-none rounded-lg"
        :style="{
          top: `${state.hoverCell.row * rowHeight}px`,
          left: `${state.hoverCell.col * colWidth}px`,
          width: `${colWidth * state.cachedLength}px`,
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