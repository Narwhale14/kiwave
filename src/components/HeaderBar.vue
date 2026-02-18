<script setup lang="ts">
import { snapDivision, snapOptions } from '../util/snap';
import { playbackMode, togglePlaybackMode } from '../services/playbackModeManager';
import { arrangementVisible, mixerVisible } from '../services/windowManager';
import { channelRackVisible } from '../services/windowManager';
import { activePattern, patterns, closePattern } from '../services/patternsListManager';
import { activeWindowId, focusWindow, clearActiveWindow } from '../services/windowManager';
import { headerHeight } from '../services/layoutManager';
import { HEADER_HEIGHT_MIN, HEADER_HEIGHT_MAX } from '../constants/layout';
import { ref, toRef } from 'vue';
import { getAudioEngine } from '../services/audioEngineManager';
import Knob from './controls/Knob.vue';
import { globalVolume, projectName } from '../services/settingsManager';
import { DEFAULT_GLOBAL_VOLUME } from '../constants/defaults';
import { markDirty, isDirty } from '../util/dirty';
import Menu from './modals/Menu.vue';

const engine = getAudioEngine();

const playButtonOn = ref(false);
const bpmInput = ref(engine.scheduler.bpm.toString());

const snapMenu = ref<InstanceType<typeof Menu> | null>(null);

function commitBpm() {
  const val = parseFloat(bpmInput.value);
  if (!isNaN(val) && val > 0 && val <= 999) {
    engine.setBpm(val);
    bpmInput.value = val.toString();
  } else {
    bpmInput.value = engine.scheduler.bpm.toString();
  }
}

function onBpmKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
  if (e.key === 'Escape') {
    bpmInput.value = engine.scheduler.bpm.toString();
    (e.target as HTMLInputElement).blur();
  }
}

function handleModeToggle(event: MouseEvent) {
  togglePlaybackMode();
  (event.target as HTMLButtonElement).blur();
}

function toggleWindow(visible: { value: boolean }, windowId: string, onClose?: () => void) {
  if(visible.value && activeWindowId.value === windowId) {
    // capture fallback before closing (activePattern may change after close)
    const p = activePattern.value;
    const fallbackId = (p && p.id !== windowId) ? p.id
      : (arrangementVisible.value && windowId !== 'arrangement-window') ? 'arrangement-window'
      : null;
    if(onClose) onClose(); else visible.value = false;
    if(fallbackId) focusWindow(fallbackId); else clearActiveWindow();
  } else if(visible.value) {
    focusWindow(windowId);
  } else {
    visible.value = true;
    focusWindow(windowId);
  }
}

function toggleArrangement() {
  toggleWindow(arrangementVisible, 'arrangement-window');
}

function togglePianoRoll() {
  const p = activePattern.value ?? patterns.value[0];
  if (!p) return;
  toggleWindow(toRef(p, 'visible'), p.id, () => closePattern(p.num));
}

function toggleChannelRack() {
  toggleWindow(channelRackVisible, 'channel-rack-window');
}

function toggleMixer() {
  toggleWindow(mixerVisible, 'mixer-window');
}

function startResize(e: PointerEvent) {
  const handle = e.currentTarget as HTMLElement;
  handle.setPointerCapture(e.pointerId);

  function onMove(ev: PointerEvent) {
    headerHeight.value = Math.max(
      HEADER_HEIGHT_MIN,
      Math.min(HEADER_HEIGHT_MAX, ev.clientY)
    );
  }

  function onUp() {
    handle.releasePointerCapture(e.pointerId);
    handle.removeEventListener('pointermove', onMove);
  }

  handle.addEventListener('pointermove', onMove);
  handle.addEventListener('pointerup', onUp, { once: true });
  handle.addEventListener('pointercancel', onUp, { once: true });
}

</script>

<template>
  <div class="relative flex w-full border-2 bg-mix-15 border-mix-30 px-3 gap-2 items-center" :style="{ height: `${headerHeight}px` }">
    <Knob v-model="globalVolume" @update:model-value="v => engine.setGlobalVolume(v)" :min="0" :max="1" :default-value="DEFAULT_GLOBAL_VOLUME" :size="headerHeight - 10" arc="from-start" title="Master Volume" :resistance="1"/>

    <!-- playback controls -->
    <div class="flex flex-row items-stretch">
      <div class="flex flex-col border-2 border-mix-25 overflow-hidden text-[9px] font-semibold rounded-l">
        <button
          @click="handleModeToggle($event)"
          class="flex flex-1 justify-center items-center transition-all"
          :class="playbackMode === 'arrangement' ? 'playhead-color text-black' : 'bg-mix-10 opacity-40 hover:opacity-70'"
        >SONG</button>
        <div class="h-px bg-mix-25"></div>
        <button
          @click="handleModeToggle($event)"
          class="flex-1 px-2 transition-all"
          :class="playbackMode === 'pattern' ? 'playhead-color text-black' : 'bg-mix-10 opacity-40 hover:opacity-70'"
        >PAT</button>
      </div>

      <button @click="() => { engine.toggle(); playButtonOn = !playButtonOn; }" class="flex items-center justify-center w-8 h-8 transition-colors bg-mix-10 hover:bg-mix-15 border-2 border-l-0 border-mix-25">
        <span class="pi text-sm" :class="[playButtonOn ? 'pi-pause' : 'pi-play']"></span>
      </button>

      <button @click="() => { engine.stop(); playButtonOn = false; }" class="flex items-center justify-center w-8 h-8 rounded-r transition-colors bg-mix-10 hover:bg-mix-15 border-2 border-l-0 border-mix-25">
        <span class="pi text-sm pi-stop"></span>
      </button>
    </div>

    <!-- tempo -->
    <div class="flex flex-col items-center border-2 border-mix-25 rounded bg-mix-10 px-2 py-0.5">
      <span class="text-[8px] font-bold tracking-widest opacity-50 leading-none">BPM</span>
      <input v-model="bpmInput" type="text" inputmode="decimal" class="bg-transparent text-center text-sm font-mono font-bold w-12 outline-none leading-tight" 
        @focus="($event.target as HTMLInputElement).select()" @blur="commitBpm" @keydown="onBpmKeydown"
      />
    </div>

    <!-- snap div -->
    <button class="flex flex-col items-center border-2 border-mix-25 rounded bg-mix-10 px-2 py-0.5 hover:bg-mix-20"
      @click="snapMenu?.toggle($event)"
    >
      <span class="text-xs font-mono font-bold">1/{{ snapDivision }} step</span>
    </button>
    <Menu ref="snapMenu" :items="snapOptions" :width="120" />

    <!-- arrangement toggle -->
    <button class="flex items-center justify-center w-8 h-8 rounded transition-colors hover:bg-mix-35" :class="arrangementVisible ? 'bg-mix-30' : 'bg-mix-20'"
      @click="toggleArrangement" :title="'Toggle Arrangement'"
    >
      <span class="pi pi-table text-sm"></span>
    </button>

    <!-- piano roll toggle -->
    <button class="flex items-center justify-center w-8 h-8 rounded transition-colors hover:bg-mix-35" :class="activePattern ? 'bg-mix-30' : 'bg-mix-20'"
      @click="togglePianoRoll" :title="'Toggle Piano Roll'"
    >
      <img src="/icons/piano-icon-white.png" class="w-5 h-5 object-contain" />
    </button>

    <!-- channel rack toggle -->
    <button class="flex items-center justify-center w-8 h-8 rounded transition-colors hover:bg-mix-35" :class="channelRackVisible ? 'bg-mix-30' : 'bg-mix-20'"
      @click="toggleChannelRack" :title="'Toggle Channel Rack'"
    >
      <span class="pi pi-book text-sm"></span>
    </button>

    <!-- mixer toggle -->
    <button class="flex items-center justify-center w-8 h-8 rounded transition-colors hover:bg-mix-35" :class="mixerVisible ? 'bg-mix-30' : 'bg-mix-20'"
      @click="toggleMixer" :title="'Toggle Mixer'"
    >
      <span class="pi pi-sliders-v text-sm"></span>
    </button>

    <div class="ml-auto"></div>

    <!-- autosave indicator -->
    <span class="w-2 h-2 rounded-full transition-colors duration-500" :class="isDirty() ? 'bg-mix-80' : 'playhead-color opacity-40'"/>

    <!-- project name -->
    <div class="flex flex-row items-center border-2 border-mix-25 rounded bg-mix-10 px-2 py-0.5">
      <input v-model="projectName" type="text" class="bg-transparent text-center text-sm font-mono font-bold w-28 outline-none leading-tight"
        @focus="($event.target as HTMLInputElement).select()"
        @keydown.enter="($event.target as HTMLInputElement).blur(); markDirty()"
        @keydown.escape="($event.target as HTMLInputElement).blur()"
      />
    </div>

    <!-- bottom resize handle -->
    <div class="absolute inset-x-0 -bottom-1 h-2 cursor-s-resize z-10" @pointerdown="startResize" />
  </div>
</template>