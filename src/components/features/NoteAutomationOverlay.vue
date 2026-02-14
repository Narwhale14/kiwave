<script setup lang="ts">
import { computed } from 'vue';
import { applyTension, deriveSegments, insertNode, setNodeValue, setNodeTension, deleteNode } from '../../audio/automation/nodeOperations';
import type { AutomationCurve } from '../../audio/automation/types';

const CURVE_SAMPLES = 32;
const TENSION_SCROLL_SPEED = 0.05;
const LINE_HIT_WIDTH = 16;
const NODE_HIT_RADIUS = 8;
const NODE_VIS_RADIUS = 4;

const props = defineProps<{
  curve: AutomationCurve;
  noteLength: number;
  widthPx: number;
  heightPx: number;
  offsetY: number; // px above note top where overlay starts
  paramColor: string;
  snapInterval: number | null; // normalized snap step; null = free. Shift bypasses.
}>();

const emit = defineEmits<{ 
  (event: 'update', curve: AutomationCurve): void 
}>();

const beatToPx  = (beat: number)  => (beat  / props.noteLength) * props.widthPx;
const valueToPy = (value: number) => (1 - value) * props.heightPx;
const pxToBeat  = (px: number)    => (px   / props.widthPx)   * props.noteLength;

function applySnap(value: number, shiftHeld: boolean): number {
  if(props.snapInterval === null || shiftHeld) return value;
  return Math.max(0, Math.min(1, Math.round(value / props.snapInterval) * props.snapInterval));
}

const curvePath = computed((): string => {
  const nodes = props.curve.nodes;
  if(nodes.length < 2) return '';

  const segments = deriveSegments(nodes);
  const parts: string[] = [];

  parts.push(`M ${beatToPx(nodes[0]!.beat)},${valueToPy(nodes[0]!.value)}`);

  for(const seg of segments) {
    const x0 = beatToPx(seg.startBeat);
    const x1 = beatToPx(seg.endBeat);
    const dx = x1 - x0;

    if(Math.abs(seg.curveTension) < 1e-4) {
      parts.push(`L ${x1},${valueToPy(seg.endValue)}`);
    } else {
      for(let i = 1; i <= CURVE_SAMPLES; i++) {
        const t      = i / CURVE_SAMPLES;
        const curved = applyTension(t, seg.curveTension);
        const v      = seg.startValue + (seg.endValue - seg.startValue) * curved;
        parts.push(`L ${x0 + dx * t},${valueToPy(v)}`);
      }
    }
}

  return parts.join(' ');
});

const renderedNodes = computed(() =>
  props.curve.nodes.map(n => ({
    id: n.id,
    x:  beatToPx(n.beat),
    y:  valueToPy(n.value),
  }))
);

function onLineClick(e: PointerEvent) {
  const svg    = (e.currentTarget as SVGElement).closest('svg')!;
  const rect   = svg.getBoundingClientRect();
  const atBeat = pxToBeat(e.clientX - rect.left);

  let newNodes = insertNode(props.curve.nodes, atBeat, props.noteLength);

  // snap the newly inserted node's value if snap is active
  if(props.snapInterval !== null && !e.shiftKey) {
    const newNode = newNodes.find(n => !props.curve.nodes.some(o => o.id === n.id));
    if(newNode) {
      newNodes = setNodeValue(newNodes, newNode.id, applySnap(newNode.value, false));
    }
  }

  emit('update', { ...props.curve, nodes: newNodes });
}

function onNodePointerDown(e: PointerEvent, nodeId: string) {
  (e.currentTarget as Element).setPointerCapture(e.pointerId);
  const startY    = e.clientY;
  const startNode = props.curve.nodes.find(n => n.id === nodeId)!;

  function onMove(me: PointerEvent) {
    const deltaNorm = -((me.clientY - startY) / props.heightPx);
    const rawValue  = Math.max(0, Math.min(1, startNode.value + deltaNorm));
    const newValue  = applySnap(rawValue, me.shiftKey);
    emit('update', { ...props.curve, nodes: setNodeValue(props.curve.nodes, nodeId, newValue) });
  }
  function onUp() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  }
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

function onNodeScroll(e: WheelEvent, nodeId: string) {
  const node       = props.curve.nodes.find(n => n.id === nodeId)!;
  const delta      = e.deltaY > 0 ? -TENSION_SCROLL_SPEED : TENSION_SCROLL_SPEED;
  const newTension = Math.max(-1, Math.min(1, node.curveTension + delta));
  emit('update', { ...props.curve, nodes: setNodeTension(props.curve.nodes, nodeId, newTension) });
}

function onNodeDoubleClick(nodeId: string) {
  emit('update', { ...props.curve, nodes: deleteNode(props.curve.nodes, nodeId) });
}
</script>


<template>
  <svg class="automation-overlay" :width="widthPx" :height="heightPx" :style="`position:absolute; left:0; top:-${offsetY}px; overflow:visible; pointer-events:none`">
    <!-- fat transparent hit area -->
    <path :d="curvePath" fill="none" stroke="transparent" :stroke-width="LINE_HIT_WIDTH" stroke-linecap="round" style="pointer-events:stroke; cursor:crosshair" @pointerdown.stop="onLineClick"/>

    <!-- visible curve path -->
    <path :d="curvePath" fill="none" :stroke="paramColor" stroke-width="1.5" stroke-linecap="round" style="pointer-events:none"/>

    <!-- invisible hit circles per node — handles drag, scroll, dblclick -->
    <circle v-for="node in renderedNodes" :key="`hit-${node.id}`" :cx="node.x" :cy="node.y" :r="NODE_HIT_RADIUS" fill="transparent" stroke="none" style="pointer-events:all; cursor:ns-resize"
      @pointerdown.stop="(e) => onNodePointerDown(e, node.id)"
      @wheel.stop.prevent="(e) => onNodeScroll(e, node.id)"
      @dblclick.stop="() => onNodeDoubleClick(node.id)"
    />

    <!-- visible node circles (purely decorative) -->
    <circle v-for="node in renderedNodes" :key="`vis-${node.id}`" :cx="node.x" :cy="node.y" :r="NODE_VIS_RADIUS" fill="white" :stroke="paramColor" stroke-width="1.5" style="pointer-events:none"/>
  </svg>
</template>