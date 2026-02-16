<script setup lang="ts">
import { inject, computed, ref, watch, nextTick } from 'vue';
import { mixerManager, type MixerTrack } from '../audio/MixerManager';
import { gainToDb } from '../util/miscUtil';
import { getAudioEngine } from '../services/audioEngineManager';
import Slider from './controls/Slider.vue'
import Knob from './controls/Knob.vue'
import VolumeMeter from './meters/VolumeMeter.vue';
import ConfirmationModal from './modals/ConfirmationModal.vue';

const closeWindow = inject<() => void>('closeWindow');
const resetWindow = inject<() => void>('resetWindow');
const dragWindow = inject<(e: PointerEvent) => void>('dragWindow');

const engine = getAudioEngine();
const mixers = computed(() => mixerManager.getAllMixers());
const activeMixerId = ref<string | null>('master');

const name = ref('');
const nameInput = ref<HTMLInputElement | null>(null);
const addButtonRef = ref<HTMLButtonElement | null>(null);
const addModalVisible = ref(false);
const addPos = ref({ x: 0, y: 0 });

const nextMixerNum = computed(() => {
  const used = new Set(mixers.value.filter(m => m.id !== 'master').map(t => parseInt(t.id.replace('mixer-', ''), 10)));
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

function createMixer() {
  engine.addMixer(name.value.trim() || undefined);
  name.value = '';
  addModalVisible.value = false;
}

function onAddKeyDown(event: KeyboardEvent) {
  if(event.key === 'Enter') {
    event.preventDefault();
    createMixer();
  }
}

watch(addModalVisible, async (visible) => {
  if(visible) {
    await nextTick();
    nameInput.value?.focus();
  }
});

function muteCircleColor(channel: MixerTrack) {
  if(channel.solo) return 'var(--playhead)';
  if(channel.muted) return 'var(--step-35)';
  return 'var(--playhead)';
}

function commitMixerName(id: string, e: Event) {
  const input = e.target as HTMLInputElement;

  if(input.value) {
    mixerManager.setName(id, input.value);
  } else {
    input.value = mixerManager.getMixer(id)?.name ?? 'Unnamed';
  }
}

function onMixerNameKeydown(e: KeyboardEvent) {
  if(e.key === 'Enter') (e.target as HTMLInputElement).blur();
  if(e.key === 'Escape') (e.target as HTMLInputElement).blur();
}

function onRouteKeydown(e: KeyboardEvent) {
  if(e.key === 'Enter') (e.target as HTMLInputElement).blur();
  if(e.key === 'Escape') (e.target as HTMLInputElement).blur();
}

function commitRoute(id: string, event: Event) {
  if(id === 'master') return;
  const input = event.target as HTMLInputElement;
  const val = parseInt(input.value, 10);
  const selfNum = parseInt(id.replace('mixer-', ''), 10);
  if(!isNaN(val) && val >= 0 && val !== selfNum && mixerManager.getMixerByNumber(val)) {
    engine.setMixerRoute(id, val);
    input.value = val.toString();
  } else {
    input.value = (mixerManager.getMixer(id)?.route ?? 0).toString();
  }
}
</script>

<template>
  <div class="flex flex-col h-full w-full bg-mix-15">
    <!-- toolbar / drag handle -->
    <div class="window-header border-b-2 border-mix-30 bg-mix-15 px-3 shrink-0"
      @pointerdown.stop="dragWindow?.($event)">
      <span class="text-xs font-medium">Mixer</span>

      <!-- add mixer -->
      <div class="flex justify-center items-center p-1 shrink-0">
        <button ref="addButtonRef" class="util-button flex justify-center items-center w-6" @click="openAddModal" title="Add mixer track">
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

    <div class="flex flex-row flex-1 h-full overflow-x-auto min-w-0">
      <div v-for="mixer in mixers" :key="mixer.id" class="flex flex-col w-28 items-center min-w-0 gap-1 px-2 border-r-3 border-mix-20 hover:bg-mix-20 py-1 transition-colors shrink-0" @pointerdown="activeMixerId = mixer.id">
        <input v-model="mixer.name" class="px2 py-0.5 rounded text-sm font-mono bg-mix-10 focus:outline-none w-full text-center truncate px-1 border-2 border-mix-30"
          @focus="($event.target as HTMLInputElement).select()"
          @blur="commitMixerName(mixer.id, $event)"
          @keydown="onMixerNameKeydown"
        />

        <!-- mute + knob row -->
        <div class="flex flex-row items-center justify-between w-full px-1 bg-mix-10 rounded p-0.5 border-mix-30 border-2">
          <button @click="engine.toggleMixerMute(mixer.id)" @contextmenu.prevent="engine.toggleMixerSolo(mixer.id)"
            class="flex items-center justify-center w-6 h-6 rounded shrink-0 focus:outline-none"
            :title="mixer.solo ? 'Solo (right-click to toggle)' : mixer.muted ? 'Unmute' : 'Mute (right-click to solo)'"
          >
            <span class="w-2 h-2 rounded-full transition-colors" :style="{ backgroundColor: muteCircleColor(mixer) }" />
          </button>

          <Knob :model-value="mixer.pan" @update:model-value="p => engine.setMixerPan(mixer.id, p)" :min="-1" :max="1" :size="24" :default-value="0" arc="from-center" :colors="['#60a5fa', '#f87171']" title="Pan" />
        </div>

        <!-- volume number -->
        <span class="text-xs text-gray-400">{{ gainToDb(mixer.volume).toFixed(1) }} dB</span>

        <!-- gain slider -->
        <div class="flex-1 min-h-0 flex gap-5 items-stretch">
          <VolumeMeter :db-l="mixer.peakDbL" :db-r="mixer.peakDbR" :muted="mixer.muted" />
          <Slider :default-value="1" :title="`Volume: ${Math.round(mixer.volume * 100)}%`" :model-value="mixer.volume" :active="activeMixerId === mixer.id" @update:model-value="v => engine.setMixerGain(mixer.id, v)"/>
        </div>

        <div class="relative flex items-center mt-auto w-full h-5">
          <span class="absolute left-1 text-xs text-gray-300">
            {{ parseInt(mixer.id.replace('mixer-', ''), 10) || 'MASTER' }}
          </span>

          <!-- mixer track number input -->
          <input v-if="mixer.id !== 'master'" :value="mixer.route" type="text" inputmode="numeric"
            class="bg-mix-10 border border-mix-25 rounded text-center text-xs font-mono font-bold w-8 py-0.5 outline-none shrink-0 absolute left-1/2 -translate-x-1/2"
            @focus="($event.target as HTMLInputElement).select()"
            @blur="commitRoute(mixer.id, $event)"
            @keydown="onRouteKeydown"
          />

          <button v-if="mixer.id !== 'master'" @click="engine.removeMixer(mixer.id)" class="ml-auto">
            <span class="pi pi-times text-sm text-red-400"></span>
          </button>
        </div>
      </div>

      <div v-if="mixers.length === 0" class="flex items-center justify-center flex-1 opacity-30 text-xs">
        No tracks
      </div>
    </div>
  </div>

  <!-- add mixer modal -->
  <ConfirmationModal :visible="addModalVisible" :x="addPos.x" :y="addPos.y" @confirm="createMixer" @cancel="addModalVisible = false; name = ''">
    <input ref="nameInput" v-model="name" @keydown="onAddKeyDown" :placeholder="`Mixer ${nextMixerNum} name`" class="bg-mix-25 p-2 rounded-md" />
  </ConfirmationModal>
</template>
