<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';

const props = withDefaults(defineProps<{
  dbL: number;
  dbR: number;
  minDb?: number;
  maxDb?: number;
  muted?: boolean;
  hideLabels?: boolean;
}>(), {
  minDb: -60,
  maxDb: 6,
  muted: false,
  hideLabels: false,
});

// smoothed bar levels (immediate attack, timed decay)
const dispL = ref(-Infinity);
const dispR = ref(-Infinity);

// peak hold levels
const holdL = ref(-Infinity);
const holdR = ref(-Infinity);

let lastTime = 0;
let holdTimeL = 0;
let holdTimeR = 0;
let raf = 0;

const DECAY = 35 / 1000; // 35 dB/s bar fall-off
const HOLD_DECAY = 18 / 1000; // 18 dB/s after hold releases
const HOLD_DURATION = 1100; // ms before peak hold starts dropping

const GRADIENT = 'linear-gradient(to top, #16a34a 0%, #22c55e 72%, #f59e0b 86%, #f97316 91%, #ef4444 95%, #ef4444 100%)';
const MARKS = [-Infinity, -48, -36, -24, -12, -6, -3, 0, 3, 6];

function norm(db: number): number {
  if(!isFinite(db)) return 0;
  const range = props.maxDb - props.minDb;
  return Math.max(0, Math.min(1, (db - props.minDb) / range));
}

function tick(now: number) {
  const dt = lastTime ? now - lastTime : 0;
  lastTime = now;

  // bars — instant attack, smooth decay
  if(isFinite(props.dbL) && props.dbL > dispL.value) {
    dispL.value = props.dbL;
  } else {
    dispL.value = Math.max(props.minDb, (isFinite(dispL.value) ? dispL.value : props.minDb) - DECAY * dt);
  }
  if (isFinite(props.dbR) && props.dbR > dispR.value) {
    dispR.value = props.dbR;
  } else {
    dispR.value = Math.max(props.minDb, (isFinite(dispR.value) ? dispR.value : props.minDb) - DECAY * dt);
  }

  // peak hold
  if (isFinite(props.dbL) && props.dbL >= holdL.value) {
    holdL.value = props.dbL;
    holdTimeL = now;
  } else if (now - holdTimeL > HOLD_DURATION) {
    holdL.value = Math.max(props.minDb, (isFinite(holdL.value) ? holdL.value : props.minDb) - HOLD_DECAY * dt);
  }
  if (isFinite(props.dbR) && props.dbR >= holdR.value) {
    holdR.value = props.dbR;
    holdTimeR = now;
  } else if (now - holdTimeR > HOLD_DURATION) {
    holdR.value = Math.max(props.minDb, (isFinite(holdR.value) ? holdR.value : props.minDb) - HOLD_DECAY * dt);
  }

  raf = requestAnimationFrame(tick);
}

onMounted(() => { raf = requestAnimationFrame(tick); });
onUnmounted(() => cancelAnimationFrame(raf));
</script>

<template>
  <div class="flex flex-row h-full shrink-0" :style="{ width: hideLabels ? '12px' : '38px', gap: '1px' }">

    <!-- dB tick column - left side, label + gap + tick per mark -->
    <div v-if="!hideLabels" class="relative h-full shrink-0" style="width: 24px">
      <div v-for="mark in MARKS" :key="mark"
        class="absolute right-0 flex items-center -translate-y-1/2"
        :style="{ top: ((1 - norm(mark)) * 100) + '%' }"
      >
        <span class="text-[7px] leading-none mr-1" :class="mark >= 0 ? 'text-red-400/80' : 'text-gray-500'">
          {{ isFinite(mark) ? mark : '-Inf' }}
        </span>

        <span class="block h-px" :class="mark >= 0 ? 'bg-red-700/60 w-2' : 'bg-gray-600 w-1.5'"/>
      </div>
    </div>

    <!-- left channel bar -->
    <div class="relative flex-1 h-full overflow-hidden" :style="{ background: GRADIENT }" :class="{ 'grayscale opacity-40': muted }">
      <div class="absolute top-0 left-0 right-0 bg-black" :style="{ height: ((1 - norm(dispL)) * 100) + '%' }" />

      <!-- peak hold marker -->
      <div v-if="isFinite(holdL) && holdL > minDb"
        class="absolute left-0 right-0 h-px bg-white/70"
        :style="{ top: ((1 - norm(holdL)) * 100) + '%' }"
      />
    </div>

    <!-- right channel bar -->
    <div class="relative flex-1 h-full overflow-hidden" :style="{ background: GRADIENT }" :class="{ 'grayscale opacity-40': muted }">
      <div class="absolute top-0 left-0 right-0 bg-black" :style="{ height: ((1 - norm(dispR)) * 100) + '%' }" />
      <div v-if="isFinite(holdR) && holdR > minDb"
        class="absolute left-0 right-0 h-px bg-white/70"
        :style="{ top: ((1 - norm(holdR)) * 100) + '%' }"
      />
    </div>

  </div>
</template>