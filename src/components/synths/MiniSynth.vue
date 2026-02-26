<script setup lang="ts">
import { computed, inject, reactive, ref } from 'vue';
import { channelManager } from '../../audio/ChannelManager';
import { MINISYNTH_ECHO_MODES, MINISYNTH_NOISE_MODES, MINISYNTH_WAVEFORM_MODES, type MiniSynth, type MiniSynthConfig, type NoiseMode } from '../../audio/synths/MiniSynth';
import Knob from '../controls/Knob.vue';
import Slider from '../controls/Slider.vue';
import EnvelopeGraph from '../controls/EnvelopeGraph.vue';
import FilterGraph from '../controls/FilterGraph.vue';
import { hzToNormalized } from '../../util/audio';
import Menu from '../modals/Menu.vue';

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

const rawState = synth.value?.getState() ?? {} as MiniSynthConfig;
const state = reactive({
  ...rawState,
  filter: { ...rawState.filter, frequency: hzToNormalized(rawState.filter?.frequency ?? 20000) },
} as MiniSynthConfig);

const noiseMenu = ref<InstanceType<typeof Menu> | null>(null);
const noiseMenuItems = MINISYNTH_NOISE_MODES.map(mode => ({
  label: mode.charAt(0).toUpperCase() + mode.slice(1),
  action: () => setNoiseMode(mode)
}));

function setNoiseMode(mode: NoiseMode) {
  state.noiseMode = mode;
  synth.value?.setNoiseMode(mode);
}

const waveformSliderValue = computed(() => MINISYNTH_WAVEFORM_MODES.indexOf(state.waveform) / (MINISYNTH_WAVEFORM_MODES.length - 1));

function onWaveformSlider(value: number) {
  const w = MINISYNTH_WAVEFORM_MODES[Math.round(value * (MINISYNTH_WAVEFORM_MODES.length - 1))]!;
  state.waveform = w;
  synth.value?.setWaveform(w);
}

const echoModeSliderValue = computed(() => MINISYNTH_ECHO_MODES.indexOf(state.echo.mode) / (MINISYNTH_ECHO_MODES.length - 1));
const sliderHeight = 75;


function onEchoModeSlider(value: number) {
  onEcho({ mode: MINISYNTH_ECHO_MODES[Math.round(value * (MINISYNTH_ECHO_MODES.length - 1))] });
}

const filterFreqHz = computed(() => 20 * Math.pow(1000, state.filter.frequency));

function onMaster(volume: number) {
  state.masterVolume = volume;
  synth.value?.setMasterVolume(volume);
}

function onADSR(partial: Partial<typeof state.adsr>) {
  Object.assign(state.adsr, partial);
  synth.value?.setADSR(partial);
}

function onFilter(partial: Partial<typeof state.filter>) {
  Object.assign(state.filter, partial);
  const update: Partial<MiniSynthConfig['filter']> = {};
  if(partial.frequency !== undefined) update.frequency = 20 * Math.pow(1000, state.filter.frequency);
  if(partial.resonance !== undefined) update.resonance = state.filter.resonance;
  synth.value?.setFilter(update);
}

function onEcho(partial: Partial<typeof state.echo>) {
  Object.assign(state.echo, partial);
  synth.value?.setEcho(partial);
}

function onChorus(partial: Partial<typeof state.chorus>) {
  Object.assign(state.chorus, partial);
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
      <div class="flex flex-row items-center gap-2 h-full flex-2">
        <!-- body box -->
        <div class="box-container border-4 border-mix-10">
          <div class="border-b-4 border-mix-10 px-2 shrink-0">
            <span class="header-text">BODY CONTROLS</span>
          </div>

          <div class="section-content relative">
            <div class="knob-container knob-row">
              <Knob :model-value="state.masterVolume" :size="60" :resistance="1" :default-value="0.8" @update:model-value="value => onMaster(value)"/>
              <span class="knob-text">Vol</span>
            </div>

            <div class="relative flex flex-row gap-1">
              <button v-if="state.waveform === 'noise'" class="absolute bottom-full left-0 mb-2.5 flex border-2 border-mix-25 rounded bg-mix-10 px-2 py-0.5 hover:bg-mix-20 text-xs font-mono font-bold capitalize w-full justify-center"
                @click="noiseMenu?.toggle($event)"
              >
                {{ state.noiseMode ?? 'retro' }}
              </button>

              <Menu ref="noiseMenu" :items="noiseMenuItems" />

              <Slider :model-value="waveformSliderValue" :steps="MINISYNTH_WAVEFORM_MODES.length" :height="sliderHeight" @update:model-value="onWaveformSlider" />
              
              <div class="flex flex-col justify-between">
                <span v-for="w in [...MINISYNTH_WAVEFORM_MODES].reverse()" :key="w" class="text-[9px] leading-none capitalize" :class="state.waveform === w ? 'opacity-90' : 'opacity-30'">
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
            <div class="knob-row">
              <div class="knob-container">
                <Knob :model-value="state.chorus.rate" :size="60" :max="3" :resistance="1" :default-value="0" @update:model-value="v => onChorus({ rate: v })" />
                <span class="knob-text">Rate</span>
              </div>
              <div class="knob-container">
                <Knob :model-value="state.chorus.depth" :size="60" :max="0.005" :resistance="1" :default-value="0" @update:model-value="v => onChorus({ depth: v })" />
                <span class="knob-text">Depth</span>
              </div>
              <div class="knob-container">
                <Knob :model-value="state.chorus.mix" :size="60" :resistance="1" :default-value="0" @update:model-value="v => onChorus({ mix: v })" />
                <span class="knob-text">Mix</span>
              </div>
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
              <Slider :model-value="echoModeSliderValue" :steps="3" :height="sliderHeight" @update:model-value="onEchoModeSlider" />
              <div class="flex flex-col justify-between" :style="{ height: sliderHeight + 'px' }">
                <span v-for="m in [...MINISYNTH_ECHO_MODES].reverse()" :key="m" class="text-[9px] leading-none capitalize" :class="state.echo.mode === m ? 'opacity-90' : 'opacity-30'">
                  {{ m }}
                </span>
              </div>
            </div>

            <div class="knob-row">
              <div class="knob-container">
                <Knob :model-value="state.echo.time" :size="60" :max="2" :resistance="1" :default-value="0" @update:model-value="v => onEcho({ time: v })" />
                <span class="knob-text">Time</span>
              </div>
              <div class="knob-container">
                <Knob :model-value="state.echo.feedback" :size="60" :max="0.95" :resistance="1" :default-value="0" @update:model-value="v => onEcho({ feedback: v })" />
                <span class="knob-text">Feedback</span>
              </div>
              <div class="knob-container">
                <Knob :model-value="state.echo.mix" :size="60" :resistance="1" :default-value="0" @update:model-value="v => onEcho({ mix: v })" />
                <span class="knob-text">Mix</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="flex flex-row items-center gap-2 h-full flex-3">
        <!-- ADSR box-->
        <div class="box-container border-4 border-mix-10">
          <div class="border-b-4 border-mix-10 px-2 shrink-0">
            <span class="header-text">ADSR CONTROLS</span>
          </div>

          <div class="flex flex-col flex-1 min-h-0">
            <EnvelopeGraph
              :attack="state.adsr.attack" :max-attack="2" :decay="state.adsr.decay" :max-decay="2" :sustain="state.adsr.sustain" :release="state.adsr.release" :max-release="5"
              @update:attack="v => onADSR({ attack: v })" @update:decay="v => onADSR({ decay: v })" @update:sustain="v => onADSR({ sustain: v })" @update:release="v => onADSR({ release: v })"
            />

            <div class="section-content-graph">
              <div class="knob-row">
                <div class="knob-container">
                  <Knob :model-value="state.adsr.attack" :size="60" :max="2" :resistance="1" :default-value="0" @update:model-value="v => onADSR({ attack: v })" />
                  <span class="knob-text">Attack</span>
                </div>
                <div class="knob-container">
                  <Knob :model-value="state.adsr.decay" :size="60" :max="2" :resistance="1" :default-value="0" @update:model-value="v => onADSR({ decay: v })" />
                  <span class="knob-text">Decay</span>
                </div>
                <div class="knob-container">
                  <Knob :model-value="state.adsr.sustain" :size="60" :resistance="1" :default-value="1" @update:model-value="v => onADSR({ sustain: v })" />
                  <span class="knob-text">Sustain</span>
                </div>
                <div class="knob-container">
                  <Knob :model-value="state.adsr.release" :size="60" :max="5" :resistance="1" :default-value="0" @update:model-value="v => onADSR({ release: v })" />
                  <span class="knob-text">Release</span>
                </div>
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
            <FilterGraph class="min-h-0" :frequency="filterFreqHz" :resonance="state.filter.resonance" />

            <div class="section-content-graph">
              <div class="knob-row">
                <div class="knob-container">
                  <Knob :model-value="state.filter.frequency" :size="60" :resistance="1" :default-value="1" @update:model-value="v => onFilter({ frequency: v })" />
                  <span class="knob-text">Cutoff</span>
                </div>
                <div class="knob-container">
                  <Knob :model-value="state.filter.resonance" :size="60" :min="0.1" :max="20" :default-value="0.1" @update:model-value="v => onFilter({ resonance: v })" />
                  <span class="knob-text">Resonance</span>
                </div>
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
  gap: 0.75rem;
  padding: 0.75rem;
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

.knob-row {
  display: inherit;
  justify-content: inherit;
  flex: inherit;
  align-items: inherit;
  gap: inherit;
  padding: inherit;

  background-color: var(--step-15);
  border-radius: var(--radius-2xl);
  border: 4px solid var(--step-13);
}

.knob-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.125rem;
}
</style>