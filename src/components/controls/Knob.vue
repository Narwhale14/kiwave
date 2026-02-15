<script setup lang="ts">
import { computed, onUnmounted } from 'vue'
import { clamp } from '../../util/miscUtil'

const props = withDefaults(defineProps<{
  modelValue: number,
  defaultValue?: number,
  min?: number,
  max?: number,
  minAngle?: number,
  maxAngle?: number,
  size?: number,
  showArc?: boolean,
  resistance?: number,
  arc?: 'from-start' | 'from-center' | 'from-end',
  colors?: string[],
}>(), {
  min: 0,
  max: 1,
  minAngle: -135,
  maxAngle: 135,
  size: 40,
  showArc: true,
  resistance: 0.5,
  arc: 'from-start',
  colors: () => ['#4ade80'],
});

const emit = defineEmits<{
  (event: 'update:modelValue', v: number): void
}>();

const normalized = computed(() => (props.modelValue - props.min) / (props.max - props.min));
const angle = computed(() => props.minAngle + normalized.value * (props.maxAngle - props.minAngle));
const centerAngle = computed(() => (props.minAngle + props.maxAngle) / 2);

function polarToCartesian(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg - 90) * Math.PI / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function describeArc(startDeg: number, endDeg: number) {
  const s = polarToCartesian(50, 50, 46, startDeg);
  const e = polarToCartesian(50, 50, 46, endDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${s.x} ${s.y} A 46 46 0 ${large} 1 ${e.x} ${e.y}`;
}

const bgArcPath = computed(() => describeArc(props.minAngle, props.maxAngle));

const arcPaths = computed(() => {
  const a = angle.value;
  const ca = centerAngle.value;
  const c0 = props.colors[0] ?? '#4ade80';
  const c1 = props.colors[1] ?? c0;

  switch(props.arc) {
    case 'from-start':
      return [{ d: describeArc(props.minAngle, a), color: c0 }];
    case 'from-end':
      return [{ d: describeArc(a, props.maxAngle), color: c0 }];
    case 'from-center':
      if(a < ca) return [{ d: describeArc(a, ca), color: c0 }];
      if(a > ca) return [{ d: describeArc(ca, a), color: c1 }];
      return [];
  }
});

let skipNextMove = false;

function onMouseMove(event: MouseEvent) {
  if(skipNextMove) { skipNextMove = false; return; }
  const base = 0.009 - 0.008 * props.resistance;
  const sensitivity = event.shiftKey ? base * 0.2 : base;
  const range = props.max - props.min;
  emit('update:modelValue', clamp(props.modelValue - event.movementY * sensitivity * range, props.min, props.max));
}

function startDrag(event: MouseEvent) {
  if(event.button !== 0) return;
  skipNextMove = true;
  (event.currentTarget as Element).requestPointerLock();
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', stopDrag, { once: true });
}

function stopDrag() {
  document.exitPointerLock();
  window.removeEventListener('mousemove', onMouseMove);
}

function onRightClick(event: MouseEvent) {
  event.preventDefault();
  if(props.defaultValue !== undefined) emit('update:modelValue', props.defaultValue);
}

onUnmounted(stopDrag);
</script>

<template>
  <div :style="{ width: size + 'px' }" class="select-none">
    <svg viewBox="0 0 100 100" class="w-full cursor-pointer" @mousedown="startDrag" @contextmenu="onRightClick">
      <path v-if="showArc" :d="bgArcPath" stroke="#2f2f2f" stroke-width="6" fill="none" stroke-linecap="round"/>
      <template v-if="showArc">
        <path v-for="seg in arcPaths" :key="seg.color" :d="seg.d" :stroke="seg.color" stroke-width="6" fill="none" stroke-linecap="round"/>
      </template>
      <circle cx="50" cy="50" r="36" fill="#1f1f1f"/>
      <line x1="50" y1="50" x2="50" y2="20" stroke="white" stroke-width="4" stroke-linecap="round" :transform="`rotate(${angle} 50 50)`"/>
    </svg>
  </div>
</template>