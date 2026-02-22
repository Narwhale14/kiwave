<script setup lang="ts">
import { computed } from 'vue'
import { clamp } from '../../util/math';

const props = withDefaults(defineProps<{
  frequency: number
  resonance: number
  type?: BiquadFilterType
}>(), {
  type: 'lowpass',
});

const SAMPLE_RATE = 44100;

const viewWidth = 200;
const viewHeight = 68;
const paddingX = 6;
const paddingTop = 6;
const paddingBottom = 14; // space for frequency labels
const drawWidth = viewWidth  - paddingX * 2;
const drawHeight = viewHeight - paddingTop - paddingBottom;
const yResponseBottom = paddingTop + drawHeight;
const yLabelBaseline = viewHeight - 7;

const freqRange = { min: 20, max: 20000 };
const logFreqRange = Math.log(freqRange.max / freqRange.min);

const decibelsMax = 20;
const decibelsMin = -40;
const decibelsRange = decibelsMax - decibelsMin;
const yZeroDecibels = paddingTop + (decibelsMax / decibelsRange) * drawHeight;

function freqToX(frequency: number): number {
  return paddingX + (Math.log(Math.max(freqRange.min, frequency) / freqRange.min) / logFreqRange) * drawWidth;
}

function decibelToY(decibels: number): number {
  return paddingTop + ((decibelsMax - decibels) / decibelsRange) * drawHeight;
}

function buildCoefficients(type: BiquadFilterType, cutoffFrequency: number, resonance: number) {
  const omega = 2 * Math.PI * Math.min(cutoffFrequency, SAMPLE_RATE * 0.499) / SAMPLE_RATE;

  const sinOmega = Math.sin(omega);
  const cosOmega = Math.cos(omega);
  const alpha = sinOmega / (2 * resonance);

  let b0: number, b1: number, b2: number; // numerator coefficients
  let a0: number, a1: number, a2: number; // demoninator coefficients

  switch(type) {
    case 'lowpass':
      b0 = (1 - cosOmega) / 2;
      b1 = 1 - cosOmega;
      b2 = (1 - cosOmega) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cosOmega;
      a2 = 1 - alpha;
      break;
    case 'highpass':
      b0 = (1 + cosOmega) / 2;
      b1 = -(1 + cosOmega);
      b2 = (1 + cosOmega) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cosOmega;
      a2 = 1 - alpha;
      break;
    case 'bandpass':
      b0 = sinOmega / 2;
      b1 = 0;
      b2 = -sinOmega / 2;
      a0 = 1 + alpha;
      a1 = -2 * cosOmega;
      a2 = 1 - alpha;
      break;
    case 'notch':
      b0 = 1;
      b1 = -2 * cosOmega;
      b2 = 1;
      a0 = 1 + alpha;
      a1 = -2 * cosOmega;
      a2 = 1 - alpha;
      break;
    case 'peaking': {
      const shelfGain = Math.pow(10, 0 / 40)
      b0 = 1 + alpha * shelfGain;
      b1 = -2 * cosOmega;
      b2 = 1 - alpha * shelfGain;
      a0 = 1 + alpha / shelfGain;
      a1 = -2 * cosOmega;
      a2 = 1 - alpha / shelfGain;
      break;
    }
    case 'lowshelf': {
      const shelfGain = Math.pow(10, 0 / 40)
      const sqrtShelfGain = Math.sqrt(shelfGain)
      b0 = shelfGain * ((shelfGain + 1) - (shelfGain-  1) * cosOmega + 2 * sqrtShelfGain * alpha)
      b1 = 2 * shelfGain * ((shelfGain - 1) - (shelfGain + 1) * cosOmega)
      b2 = shelfGain * ((shelfGain + 1) - (shelfGain - 1) * cosOmega - 2 * sqrtShelfGain * alpha)
      a0 = (shelfGain + 1) + (shelfGain - 1) * cosOmega + 2 * sqrtShelfGain * alpha
      a1 = -2 * ((shelfGain - 1) + (shelfGain + 1) * cosOmega)
      a2 = (shelfGain + 1) + (shelfGain - 1) * cosOmega - 2 * sqrtShelfGain * alpha
      break;
    }
    case 'highshelf': {
      const shelfGain     = Math.pow(10, 0 / 40)
      const sqrtShelfGain = Math.sqrt(shelfGain)
      b0 = shelfGain * ((shelfGain+1) + (shelfGain-1)*cosOmega + 2*sqrtShelfGain*alpha)
      b1 = -2 * shelfGain * ((shelfGain-1) + (shelfGain+1)*cosOmega)
      b2 = shelfGain * ((shelfGain+1) + (shelfGain-1)*cosOmega - 2*sqrtShelfGain*alpha)
      a0 = (shelfGain+1) - (shelfGain-1)*cosOmega + 2*sqrtShelfGain*alpha
      a1 = 2 * ((shelfGain-1) - (shelfGain+1)*cosOmega)
      a2 = (shelfGain+1) - (shelfGain-1)*cosOmega - 2*sqrtShelfGain*alpha
      break;
    }
    default: // allpass
      b0 = 1 - alpha;
      b1 = -2 * cosOmega;
      b2 = 1 + alpha;
      a0 = 1 + alpha;
      a1 = -2 * cosOmega;
      a2 = 1 - alpha;
  }

  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 }
}

// |H(e^jω)|^2
function responseDecibels(b0: number, b1: number, b2: number, a1: number, a2: number, frequency: number): number {
  const omega = 2 * Math.PI * frequency / SAMPLE_RATE;

  const cosOmega = Math.cos(omega);
  const sinOmega = Math.sin(omega);

  const cos2Omega = Math.cos(2 * omega);
  const sin2Omega = Math.sin(2 * omega);

  const numeratorReal = b0 + b1 * cosOmega + b2 * cos2Omega;
  const numeratorImag = -(b1 * sinOmega + b2 * sin2Omega);
  const denominatorReal = 1  + a1 * cosOmega + a2 * cos2Omega;
  const denominatorImag = -(a1 * sinOmega + a2 * sin2Omega);

  const magnitudeSquared = (numeratorReal ** 2 + numeratorImag ** 2) / (denominatorReal ** 2 + denominatorImag ** 2);

  if(!isFinite(magnitudeSquared) || magnitudeSquared <= 0) return decibelsMin;
  return 10 * Math.log10(magnitudeSquared);
}

const curveResolution = 300;
const paths = computed(() => {
  const { b0, b1, b2, a1, a2 } = buildCoefficients(props.type, props.frequency, props.resonance)

  const curvePoints = Array.from({ length: curveResolution }, (_, i) => {
    const frequency = freqRange.min * Math.exp((i / (curveResolution - 1)) * logFreqRange);
    const decibels = responseDecibels(b0, b1, b2, a1, a2, frequency);
    const x = freqToX(frequency);
    const y = clamp(decibelToY(decibels), paddingTop, yResponseBottom);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  const curve = `M ${curvePoints.join(' L ')}`;
  const fill = `M ${freqToX(freqRange.min).toFixed(2)},${yResponseBottom} L ${curvePoints.join(' L ')} L ${freqToX(freqRange.max).toFixed(2)},${yResponseBottom} Z`;
  return { curve, fill };
});

const cutoffFrequencyX = computed(() => freqToX(clamp(props.frequency, freqRange.min, freqRange.max)));

const gridFrequencyTicks = [
  { frequency: 20, label: '20' },
  { frequency: 50, label: '50' },
  { frequency: 100, label: '100' },
  { frequency: 500, label: '500' },
  { frequency: 1000, label: '1k' },
  { frequency: 2000, label: '2k' },
  { frequency: 5000, label: '5k' },
  { frequency: 10000, label: '10k' },
  { frequency: 20000, label: '20k' }
];
</script>

<template>
  <svg :viewBox="`0 0 ${viewWidth} ${viewHeight}`" class="w-full select-none">
    <!-- Background -->
    <rect :x="paddingX" :y="paddingTop" :width="drawWidth" :height="drawHeight" fill="rgba(0,0,0,0.3)" rx="2"/>

    <!-- 0 dB reference line -->
    <line :x1="paddingX" :y1="yZeroDecibels" :x2="paddingX + drawWidth" :y2="yZeroDecibels" stroke="rgba(255,255,255,0.12)" stroke-width="1.5" stroke-dasharray="3,3"/>

    <!-- fill area -->
    <path :d="paths.fill" fill="rgba(34,197,94,0.1)"/>

    <!-- frequency response curve -->
    <path :d="paths.curve" stroke="#4ade80" stroke-width="1.5" fill="none" stroke-linejoin="round"/>

    <!-- cutoff frequency marker -->
    <line :x1="cutoffFrequencyX" :y1="paddingTop" :x2="cutoffFrequencyX" :y2="yResponseBottom" stroke="rgba(74,222,128,0.35)" stroke-width="1.5" stroke-dasharray="2,2"/>

    <!-- frequency tick labels -->
    <g v-for="tick in gridFrequencyTicks" :key="tick.frequency">
      <line :x1="freqToX(tick.frequency)" :y1="paddingTop" :x2="freqToX(tick.frequency)" :y2="yResponseBottom" stroke="rgba(255,255,255,0.05)" stroke-width="1.5"/>
      <line :x1="freqToX(tick.frequency)" :y1="yResponseBottom" :x2="freqToX(tick.frequency)" :y2="yResponseBottom + 2" stroke="rgba(255,255,255,0.2)" stroke-width="1.5"/>
      <text :x="freqToX(tick.frequency)" :y="yLabelBaseline" font-size="4.5" fill="rgba(255,255,255,0.25)" text-anchor="middle" font-family="monospace">
        {{ tick.label }}
      </text>
    </g>
  </svg>
</template>