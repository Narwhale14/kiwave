<script setup lang="ts">
import { computed, onUnmounted } from 'vue'
import { clamp } from '../../util/parameterMapping'

const props = withDefaults(defineProps<{
  modelValue: number,
  defaultValue?: number,
  minAngle?: number,
  maxAngle?: number,
  size: number,
  showArc?: boolean,
  resistance?: number
}>(), {
  minAngle: -135,
  maxAngle: 135,
  size: 40,
  showArc: true,
  resistance: 0.5
});

const emit = defineEmits<{
  (event: 'update:modelValue', v: number): void
}>();

const angle = computed(() => props.minAngle + props.modelValue * (props.maxAngle - props.minAngle));

function polarToCartesian(cx: number, cy: number, radius: number, angle: number) {
  const rad = (angle - 90) * Math.PI / 180;
  return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
}

function describeArc(cx: number, cy: number, radius: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, radius, startAngle);
  const end = polarToCartesian(cx, cy, radius, endAngle);
  const largeArcFlag = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${end.x} ${end.y}`;
}

const bgArcPath = computed(() => describeArc(50, 50, 46, props.minAngle, props.maxAngle));
const arcPath = computed(() => describeArc(50, 50, 46, props.minAngle, angle.value));

function onMouseMove(event: MouseEvent) {
  const base = 0.009 - 0.008 * props.resistance;
  const sensitivity = event.shiftKey ? base * 0.2 : base;
  emit('update:modelValue', clamp(props.modelValue - event.movementY * sensitivity, 0, 1));
}

function startDrag(event: MouseEvent) {
  if(event.button !== 0) return;
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
      <path v-if="showArc" :d="arcPath" stroke="#4ade80" stroke-width="6" fill="none" stroke-linecap="round"/>
      <circle cx="50" cy="50" r="36" fill="#1f1f1f"/>
      <line x1="50" y1="50" x2="50" y2="20" stroke="white" stroke-width="4" stroke-linecap="round" :transform="`rotate(${angle} 50 50)`"/>
    </svg>
  </div>
</template>
