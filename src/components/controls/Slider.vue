<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { clamp } from '../../util/math'

const props = withDefaults(defineProps<{
  modelValue: number,
  defaultValue?: number,
  height?: number,
  trackWidth?: number,
  resistance?: number,
  centerDetent?: boolean,
  active?: boolean,
  steps?: number
}>(), {
  trackWidth: 6,
  resistance: 1,
  centerDetent: false
});

function snap(value: number): number {
  if(props.steps !== undefined && props.steps > 1) {
    return Math.round(value * (props.steps - 1)) / (props.steps - 1);
  }

  return value;
}

const emit = defineEmits<{
  (event: 'update:modelValue', v: number): void
}>();

const containerRef = ref<HTMLElement | null>(null);
const measuredHeight = ref(160);

let ro: ResizeObserver | null = null;

const effectiveHeight = computed(() => props.height ?? measuredHeight.value);

const handleHeight = 18;
const usableHeight = computed(() => effectiveHeight.value - handleHeight);
const handleY = computed(() => usableHeight.value * (1 - props.modelValue));

let startValue = 0;
let startY = 0;
let lastShift = false;

function onPointerDown(event: PointerEvent) {
  if(event.button !== 0) return;

  const target = event.currentTarget as HTMLElement;
  target.setPointerCapture(event.pointerId);

  startValue = props.modelValue;
  startY = event.clientY;
  lastShift = event.shiftKey;

  target.addEventListener('pointermove', onPointerMove);
  target.addEventListener('pointerup', onPointerUp, { once: true });
}

function onPointerMove(event: PointerEvent) {
  // re-anchor when shift is toggled to prevent a value jump
  if(event.shiftKey !== lastShift) {
    const prevFine = lastShift ? 0.25 : 1;
    startValue = clamp(startValue - (event.clientY - startY) * prevFine / (usableHeight.value * props.resistance), 0, 1);
    startY = event.clientY;
    lastShift = event.shiftKey;
  }

  const deltaY = event.clientY - startY;
  const fine = event.shiftKey ? 0.25 : 1;
  const sensitivity = fine / (usableHeight.value * props.resistance);
  let next = startValue - deltaY * sensitivity;

  if(props.centerDetent) {
    if(Math.abs(next - 0.5) < 0.02) {
      next = 0.5;
    }
  }

  emit('update:modelValue', snap(clamp(next, 0, 1)));
}

function onPointerUp(event: PointerEvent) {
  const target = event.currentTarget as HTMLElement;
  target.releasePointerCapture(event.pointerId);
  target.removeEventListener('pointermove', onPointerMove);
}

function onRightClick(event: MouseEvent) {
  event.preventDefault();
  if(props.defaultValue !== undefined) {
    emit('update:modelValue', snap(props.defaultValue));
  }
}

onMounted(() => {
  if(props.height !== undefined) return;

  ro = new ResizeObserver(entries => {
    if(entries[0]) measuredHeight.value = entries[0].contentRect.height;
  });

  if(containerRef.value) ro.observe(containerRef.value);
});

onUnmounted(() => ro?.disconnect());
</script>

<template>
  <div ref="containerRef" class="relative select-none cursor-pointer"
    :style="{ height: props.height !== undefined ? effectiveHeight + 'px' : '100%', width: (trackWidth + 20) + 'px', touchAction: 'none' }"
    @pointerdown="onPointerDown" @contextmenu="onRightClick"
  >
    <div class="absolute left-1/2 -translate-x-1/2 rounded-full bg-mix-25" :style="{ width: trackWidth + 'px', height: effectiveHeight + 'px' }" />
    
    <div v-if="active" class="absolute left-1/2 -translate-x-1/2 rounded-full playhead-color" 
      :style="{ width: trackWidth / 3 + 'px', height: (effectiveHeight - handleY) + 'px', bottom: 0 }" 
    />

    <template v-if="steps !== undefined && steps > 1">
      <div v-for="i in steps" :key="i" class="absolute left-1/2 -translate-x-1/2 rounded-full bg-mix-50 pointer-events-none" 
        :style="{ width: (trackWidth + 6) + 'px', height: '2px', top: (usableHeight * (1 - (i - 1) / (steps - 1)) + handleHeight / 2 - 1) + 'px' }"
      />
    </template>

    <div class="absolute left-1/2 rounded general-white shadow-md" 
      :style="{ width: (trackWidth + 14) + 'px', height: handleHeight + 'px', transform: `translateX(-50%) translateY(${handleY}px)`}"
    />
  </div>
</template>