<script setup lang="ts">
import { computed, inject, reactive, ref } from 'vue';
import { channelManager } from '../../audio/ChannelManager';
import type { MiniSynth, MiniSynthConfig } from '../../audio/synths/MiniSynth';
import type { Waveform, EchoMode } from '../../audio/synths/MiniSynth';
import Knob from '../controls/Knob.vue';
import Slider from '../controls/Slider.vue';
import EnvelopeGraph from '../controls/EnvelopeGraph.vue';
import FilterGraph from '../controls/FilterGraph.vue';

const props = defineProps<{
  channelId: string
}>();

const closeWindow = inject<() => void>('closeWindow');
const resetWindow = inject<() => void>('resetWindow');
const dragWindow = inject<(event: PointerEvent) => void>('dragWindow');

const synth = computed(() => {
  const channel = channelManager.getChannel(props.channelId);
  return channel?.instrument as MiniSynth | null;
});

const waveforms: Waveform[] = ['sine', 'square', 'sawtooth', 'triangle'];
const echoModes: EchoMode[] = ['mono', 'stereo', 'ping-pong'];

const waveform = ref<Waveform>('sawtooth');
const waveformSliderValue = computed(() => waveforms.indexOf(waveform.value) / (waveforms.length - 1));

function onWaveformSlider(value: number) {
  const w = waveforms[Math.round(value * (waveforms.length - 1))]!;
  waveform.value = w;
  synth.value?.setWaveform(w);
}

const echoModeSliderValue = computed(() => echoModes.indexOf(echo.mode) / (echoModes.length - 1));
const echoSliderHeight = 75;

function onEchoModeSlider(value: number) {
  onEcho({ mode: echoModes[Math.round(value * (echoModes.length - 1))] });
}

const master = reactive({ volume: 0.8 });
const adsr = reactive({ attack: 0.01, decay: 0.2, sustain: 0.5, release: 0.3 });
const filter = reactive({ cutoff: 1, resonance: 1 }); // 1 = fully open (20 kHz)
const echo = reactive({ time: 0.3, feedback: 0.4, mix: 0.2, mode: 'mono' as EchoMode });
const chorus = reactive({ rate: 0.5, depth: 0.002, mix: 0.3 });

const filterFreqHz = computed(() => 20 * Math.pow(1000, filter.cutoff));

function onMaster(volume: number) {
  master.volume = volume;
  synth.value?.setMasterVolume(volume);
}

function onADSR(partial: Partial<typeof adsr>) {
  Object.assign(adsr, partial);
  synth.value?.setADSR(partial);
}

function onFilter(partial: Partial<typeof filter>) {
  Object.assign(filter, partial);
  const update: Partial<MiniSynthConfig['filter']> = {};
  if(partial.cutoff !== undefined) update.frequency = 20 * Math.pow(1000, filter.cutoff);
  if(partial.resonance !== undefined) update.resonance = filter.resonance;
  synth.value?.setFilter(update);
}

function onEcho(partial: Partial<typeof echo>) {
  Object.assign(echo, partial);
  synth.value?.setEcho(partial);
}

function onChorus(partial: Partial<typeof chorus>) {
  Object.assign(chorus, partial);
  synth.value?.setChorus(partial);
}
</script>

<template>
  <div class="flex flex-col overflow-auto">
    <!-- header -->
    <div class="window-header bg-mix-15 px-3 shrink-0 border-b-2 border-mix-30"
      @pointerdown.stop="dragWindow?.($event)">
      <span class="text-xs font-medium">MiniSynth</span>

      <div class="flex-1" />

      <button class="w-6 h-6 rounded util-button flex items-center justify-center" @pointerdown.stop @click="resetWindow?.()" title="Reset position and size">
        <span class="pi pi-refresh text-xs" />
      </button>

      <button class="w-6 h-6 rounded util-button flex items-center justify-center" @pointerdown.stop @click="closeWindow?.()" title="Close window">
        <span class="pi pi-times text-xs" />
      </button>
    </div>

    <!-- synth body -->
    <div class="flex flex-col gap-2 p-3 font-mono min-w-200 h-full min-h-128">
      <div class="flex flex-row items-center gap-2 h-full flex-1">
        <!-- body box -->
        <div class="box-container border-4 border-mix-10">
          <div class="border-b-4 border-mix-10 px-2 shrink-0">
            <span class="header-text">BODY CONTROLS</span>
          </div>

          <div class="section-content">
            <div class="knob-container">
              <Knob :model-value="master.volume" :size="60" @update:model-value="value => onMaster(value)"/>
              <span class="knob-text">Vol</span>
            </div>

            <div class="flex flex-row gap-1">
              <Slider :model-value="waveformSliderValue" :steps="4" :height="72" @update:model-value="onWaveformSlider" />
              <div class="flex flex-col justify-between">
                <span v-for="w in [...waveforms].reverse()" :key="w" class="text-[9px] leading-none capitalize" :class="waveform === w ? 'opacity-90' : 'opacity-30'">
                  {{ w }}
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- chorus box -->
        <div class="box-container border-4 border-mix-10">
          <div class="border-b-4 border-mix-10 px-2 shrink-0">
            <span class="header-text">CHORUS CONTROLS</span>
          </div>

          <div class="section-content">
            <div class="knob-container">
              <Knob :model-value="chorus.rate" :size="60" :min="0.1" :max="3" :resistance="0.8" @update:model-value="v => onChorus({ rate: v })" />
              <span class="knob-text">Rate</span>
            </div>
            <div class="knob-container">
              <Knob :model-value="chorus.depth" :size="60" :min="0.0001" :max="0.005" :resistance="0.85" @update:model-value="v => onChorus({ depth: v })" />
              <span class="knob-text">Depth</span>
            </div>
            <div class="knob-container">
              <Knob :model-value="chorus.mix" :size="60" @update:model-value="v => onChorus({ mix: v })" />
              <span class="knob-text">Mix</span>
            </div>
          </div>
        </div>

        <!-- delay box -->
        <div class="box-container border-4 border-mix-10">
          <div class="border-b-4 border-mix-10 px-2 shrink-0">
            <span class="header-text">DELAY CONTROLS</span>
          </div>

          <div class="section-content">
            <div class="flex items-start gap-1.5">
              <Slider :model-value="echoModeSliderValue" :steps="3" :height="echoSliderHeight" @update:model-value="onEchoModeSlider" />
              <div class="flex flex-col justify-between" :style="{ height: echoSliderHeight + 'px' }">
                <span v-for="m in [...echoModes].reverse()" :key="m" class="text-[9px] leading-none capitalize" :class="echo.mode === m ? 'opacity-90' : 'opacity-30'">
                  {{ m }}
                </span>
              </div>
            </div>

            <div class="knob-container">
              <Knob :model-value="echo.time" :size="60" :min="0" :max="2" @update:model-value="v => onEcho({ time: v })" />
              <span class="knob-text">Time</span>
            </div>
            <div class="knob-container">
              <Knob :model-value="echo.feedback" :size="60" :min="0" :max="0.95" @update:model-value="v => onEcho({ feedback: v })" />
              <span class="knob-text">FB</span>
            </div>
            <div class="knob-container">
              <Knob :model-value="echo.mix" :size="60" @update:model-value="v => onEcho({ mix: v })" />
              <span class="knob-text">Mix</span>
            </div>
          </div>
        </div>
      </div>

      <div class="flex flex-row items-center gap-2 h-full flex-2">
        <!-- ADSR box-->
        <div class="box-container border-4 border-mix-10">
          <div class="border-b-4 border-mix-10 px-2 shrink-0">
            <span class="header-text">ADSR CONTROLS</span>
          </div>

          <div class="flex flex-col flex-1 min-h-0">
            <EnvelopeGraph
              :attack="adsr.attack" :max-attack="2" :decay="adsr.decay" :max-decay="2" :sustain="adsr.sustain" :release="adsr.release" :max-release="5"
              @update:attack="v => onADSR({ attack: v })" @update:decay="v => onADSR({ decay: v })" @update:sustain="v => onADSR({ sustain: v })" @update:release="v => onADSR({ release: v })"
            />

            <div class="section-content-graph">
              <div class="knob-container">
                <Knob :model-value="adsr.attack" :size="60" :min="0" :max="2" @update:model-value="v => onADSR({ attack: v })" />
                <span class="knob-text">Attack</span>
              </div>
              <div class="knob-container">
                <Knob :model-value="adsr.decay" :size="60" :min="0" :max="2" @update:model-value="v => onADSR({ decay: v })" />
                <span class="knob-text">Decay</span>
              </div>
              <div class="knob-container">
                <Knob :model-value="adsr.sustain" :size="60" @update:model-value="v => onADSR({ sustain: v })" />
                <span class="knob-text">Sustain</span>
              </div>
              <div class="knob-container">
                <Knob :model-value="adsr.release" :size="60" :min="0" :max="5" @update:model-value="v => onADSR({ release: v })" />
                <span class="knob-text">Release</span>
              </div>
            </div>
          </div>
        </div>

        <!-- filter box -->
        <div class="box-container border-4 border-mix-10">
          <div class="border-b-4 border-mix-10 px-2 shrink-0">
            <span class="header-text">FILTER CONTROLS</span>
          </div>

          <div class="flex flex-col flex-1 min-h-0">
            <FilterGraph class="min-h-0" :frequency="filterFreqHz" :resonance="filter.resonance" />

            <div class="section-content-graph">
              <div class="knob-container">
                <Knob :model-value="filter.cutoff" :size="60" :resistance="0.75" @update:model-value="v => onFilter({ cutoff: v })" />
                <span class="knob-text">Cutoff</span>
              </div>
              <div class="knob-container">
                <Knob :model-value="filter.resonance" :size="60" :min="0.1" :max="20" @update:model-value="v => onFilter({ resonance: v })" />
                <span class="knob-text">Res</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.box-container {
  display: flex;
  flex-direction: column;
  flex: 1;
  width: 100%;
  height: 100%;
  background-color: var(--step-17);
}

.header-text {
  font-size: var(--text-xs);
  font-weight: var(--font-weight-semibold);
  letter-spacing: var(--tracking-widest);
  opacity: 50%;
}

.section-content {
  display: flex;
  justify-content: center;
  flex: 1;
  align-items: center;
  gap: 0.75rem; /* gap-3 */
  padding: 0.75rem; /* p-3 */
}

.section-content-graph {
  display: flex;
  justify-content: center;
  flex: 1;
  align-items: center;
  gap: 2.5rem;
  padding: 0.75rem;
}

.knob-text {
  font-size: 12px;
  opacity: 40%;
  margin-top: 10px
}

.knob-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.125rem;
}
</style>