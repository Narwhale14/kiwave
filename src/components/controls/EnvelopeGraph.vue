<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { clamp } from '../../util/math'

const props = withDefaults(defineProps<{
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  maxAttack?: number;
  maxDecay?: number;
  maxRelease?: number;
}>(), {
  maxAttack: 2,
  maxDecay: 2,
  maxRelease: 5,
})

const emit = defineEmits<{
  (event: 'update:attack', value: number): void;
  (event: 'update:decay', value: number): void;
  (event: 'update:sustain', value: number): void;
  (event: 'update:release', value: number): void;
}>()

// SVG coordinate system
const viewWidth = 200;
const viewHeight = 60;
const padding = 5;
const sustainPlateauWidth = 40;
const drawWidth = viewWidth - padding * 2;
const drawHeight = viewHeight - padding * 2;
const yTop = padding;
const yBottom = viewHeight - padding;
const stageAreaWidth = drawWidth - sustainPlateauWidth;

const stages = computed(() => {
  const pixelsPerSecond = stageAreaWidth / (props.maxAttack + props.maxDecay + props.maxRelease)

  const xStart = padding
  const xAttackEnd = xStart + (props.attack * pixelsPerSecond)
  const xDecayEnd = xAttackEnd + (props.decay * pixelsPerSecond)
  const xSustainEnd = xDecayEnd + sustainPlateauWidth
  const xReleaseEnd = xSustainEnd + (props.release * pixelsPerSecond)

  return { xStart, xAttackEnd, xDecayEnd, xSustainEnd, xReleaseEnd }
})

const ySustainLevel = computed(() => yTop + (1 - props.sustain) * drawHeight)

const envelopePath = computed(() => {
  const { xStart, xAttackEnd, xDecayEnd, xSustainEnd, xReleaseEnd } = stages.value
  const ySustain = ySustainLevel.value
  return `M ${xStart},${yBottom} L ${xAttackEnd},${yTop} L ${xDecayEnd},${ySustain} L ${xSustainEnd},${ySustain} L ${xReleaseEnd},${yBottom}`
})

const envelopeFillPath = computed(() => envelopePath.value + ' Z')

// interaction
type DragTarget = 'attack' | 'decay' | 'release'
const dragging = ref<DragTarget | null>(null)
const hovering = ref<DragTarget | null>(null)

const dragSensitivity = 0.005
let skipNextMove = false

function startDrag(event: MouseEvent, target: DragTarget) {
  if(event.button !== 0) return;

  event.stopPropagation();
  skipNextMove = true;
  dragging.value = target;

  (event.currentTarget as Element).requestPointerLock();
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', stopDrag, { once: true });
}

function onMouseMove(event: MouseEvent) {
  if(skipNextMove) { skipNextMove = false; return }
  const sensitivity = event.shiftKey ? dragSensitivity * 0.2 : dragSensitivity;

  if(dragging.value === 'attack') {
    emit('update:attack', clamp(props.attack + event.movementX * sensitivity * props.maxAttack, 0, props.maxAttack));
  } else if (dragging.value === 'decay') {
    emit('update:decay', clamp(props.decay + event.movementX * sensitivity * props.maxDecay, 0, props.maxDecay));
    emit('update:sustain', clamp(props.sustain  - event.movementY * sensitivity, 0, 1));
  } else if (dragging.value === 'release') {
    emit('update:release', clamp(props.release + event.movementX * sensitivity * props.maxRelease, 0, props.maxRelease));
  }
}

function stopDrag() {
  document.exitPointerLock();
  window.removeEventListener('mousemove', onMouseMove);
  dragging.value = null;
}

onUnmounted(stopDrag)
</script>

<template>
  <svg :viewBox="`0 0 ${viewWidth} ${viewHeight}`" class="w-full select-none">

    <!-- background -->
    <rect :x="padding" :y="padding" :width="drawWidth" :height="drawHeight" fill="var(--step-10)" rx="2"/>
    <line v-for="x in [stages.xAttackEnd, stages.xDecayEnd, stages.xSustainEnd]" :key="x" :x1="x" :y1="padding" :x2="x" :y2="yBottom" stroke="var(--step-15)" stroke-width="1.5"/>

    <!-- sustain level guide -->
    <line :x1="padding" :y1="ySustainLevel" :x2="stages.xSustainEnd" :y2="ySustainLevel" stroke="rgba(74,222,128,0.1)" stroke-width="1" stroke-dasharray="2,3"/>

    <!-- envelope curve -->
    <path :d="envelopePath" stroke="var(--playhead)" stroke-width="1.5" fill="none" stroke-linejoin="round" stroke-linecap="round"/>
    <path :d="envelopeFillPath" class="envelope-fill"/>

    <!-- 3 control points -->
    <circle :cx="stages.xAttackEnd" :cy="yTop" :r="2" :fill="hovering === 'attack' ? 'var(--playhead)' : 'rgba(74,222,128,0.5)'" stroke="var(--playhead)" stroke-width="1.5"
      @mousedown="startDrag($event, 'attack')" @pointerenter="hovering = 'attack'" @pointerleave="hovering = null"
    />
    <circle :cx="stages.xDecayEnd" :cy="ySustainLevel" :r="2" :fill="hovering === 'decay' ? 'var(--playhead)' : 'rgba(74,222,128,0.5)'" stroke="var(--playhead)" stroke-width="1.5"
      @mousedown="startDrag($event, 'decay')" @pointerenter="hovering = 'decay'" @pointerleave="hovering = null"
    />
    <circle :cx="stages.xReleaseEnd" :cy="yBottom" :r="2" :fill="hovering === 'release' ? 'var(--playhead)' : 'rgba(74,222,128,0.5)'" stroke="var(--playhead)" stroke-width="1.5"
      @mousedown="startDrag($event, 'release')" @pointerenter="hovering = 'release'" @pointerleave="hovering = null"
    />
  </svg>
</template>