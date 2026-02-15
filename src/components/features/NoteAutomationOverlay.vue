<script setup lang="ts">
import { computed, ref } from 'vue';
import { insertNode, moveNode, setNodeTension, deleteNode, getHandleValue, getPowerHandleValue, evalPowerCurve } from '../../audio/automation/nodeOperations';
import { snapNearest, snapDivision } from '../../util/snap';
import type { AutomationCurve } from '../../audio/automation/types';
import { manipulateColor } from '../../util/colorManipulation';

const LINE_HIT_WIDTH = 16;
const NODE_HIT_RADIUS = 8;
const NODE_VIS_RADIUS = 4;
const TENSION_HIT_RADIUS = 7;
const TENSION_VIS_RADIUS = 3;
const POWER_CURVE_SAMPLES = 48;

const props = defineProps<{
  curve: AutomationCurve;
  noteLength: number;
  widthPx: number;
  heightPx: number;
  offsetY: number; // px above note top where overlay starts
  paramColor: string;
  snapInterval: number | null; // normalized snap step; null = free. Shift bypasses.
  curveStyle?: 'bezier' | 'power'; // default = 'bezier'
  readOnly?: boolean; // path only — no nodes/handles/interaction
}>();

const emit = defineEmits<{
  (event: 'update', curve: AutomationCurve): void
}>();

const hoveredNodeId = ref<string | null>(null);
const hoveredSegmentId = ref<string | null>(null);

const beatToPx = (beat: number) => (beat / props.noteLength) * props.widthPx;
const valueToPy = (value: number) => (1 - value) * props.heightPx;
const pxToBeat = (px: number) => (px / props.widthPx) * props.noteLength;

function applySnap(value: number, shiftHeld: boolean): number {
  if(props.snapInterval === null || shiftHeld) return value;
  return Math.max(0, Math.min(1, Math.round(value / props.snapInterval) * props.snapInterval));
}

const effectiveCurveStyle = computed(() => props.curveStyle ?? 'bezier');

// SVG path — Q (quadratic bezier) for bezier style, polyline for power style.
const curvePath = computed((): string => {
  const nodes = props.curve.nodes;
  if(nodes.length < 2) return '';

  const parts: string[] = [];
  parts.push(`M ${beatToPx(nodes[0]!.beat)},${valueToPy(nodes[0]!.value)}`);

  if(effectiveCurveStyle.value === 'bezier') {
    for(let i = 0; i < nodes.length - 1; i++) {
      const left = nodes[i]!;
      const right = nodes[i + 1]!;
      const x0 = beatToPx(left.beat),  y0 = valueToPy(left.value);
      const x1 = beatToPx(right.beat), y1 = valueToPy(right.value);

      if(Math.abs(left.curveTension) < 1e-4) {
        parts.push(`L ${x1},${y1}`);
      } else {
        const hy = valueToPy(getHandleValue(left.value, right.value, left.curveTension));
        const cpx = (x0 + x1) / 2;
        const cpy = 2 * hy - 0.5 * y0 - 0.5 * y1;
        parts.push(`Q ${cpx},${cpy} ${x1},${y1}`);
      }
    }
  } else {
    // power: sample the curve for accurate rendering
    for(let i = 0; i < nodes.length - 1; i++) {
      const left = nodes[i]!;
      const right = nodes[i + 1]!;
      const x0 = beatToPx(left.beat);
      const x1 = beatToPx(right.beat);

      if(Math.abs(left.curveTension) < 1e-4) {
        parts.push(`L ${x1},${valueToPy(right.value)}`);
      } else {
        for(let s = 1; s <= POWER_CURVE_SAMPLES; s++) {
          const t = s / POWER_CURVE_SAMPLES;
          const v = evalPowerCurve(t, left.value, right.value, left.curveTension);
          const px = x0 + (x1 - x0) * t;
          parts.push(`L ${px},${valueToPy(v)}`);
        }
      }
    }
  }

  return parts.join(' ');
});

const renderedNodes = computed(() =>
  props.curve.nodes.map((n, i) => ({
    id: n.id,
    x: beatToPx(n.beat),
    y: valueToPy(n.value),
    isBorder: i === 0 || i === props.curve.nodes.length - 1,
  }))
);

// One tension handle per segment, positioned at the point the curve passes through at x=0.5.
const segmentHandles = computed(() =>
  props.curve.nodes.slice(0, -1).map((n, i) => {
    const next = props.curve.nodes[i + 1]!;
    const hv = effectiveCurveStyle.value === 'power'
      ? getPowerHandleValue(n.value, next.value, n.curveTension)
      : getHandleValue(n.value, next.value, n.curveTension);
    return {
      leftNodeId: n.id,
      x: (beatToPx(n.beat) + beatToPx(next.beat)) / 2,
      y: valueToPy(hv),
    };
  })
);

// --- drag helpers ---

function beginDrag(event: PointerEvent, nodeId: string, startBeat: number, startValue: number) {
  (event.currentTarget as Element).setPointerCapture(event.pointerId);
  const startX = event.clientX;
  const startY = event.clientY;

  function onMove(me: PointerEvent) {
    const deltaNorm = -((me.clientY - startY) / props.heightPx);
    const rawValue = Math.max(0, Math.min(1, startValue + deltaNorm));
    const newValue = applySnap(rawValue, me.shiftKey);
    const rawBeat = startBeat + pxToBeat(me.clientX - startX);
    const newBeat = me.shiftKey ? rawBeat : snapNearest(rawBeat, snapDivision.value);
    emit('update', { ...props.curve, nodes: moveNode(props.curve.nodes, nodeId, newBeat, newValue) });
  }

  function onUp() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  }

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

function onLinePointerDown(event: PointerEvent) {
  if(event.button !== 0) return;

  const svg = (event.currentTarget as SVGElement).closest('svg')!;
  const rect = svg.getBoundingClientRect();
  const atBeat = pxToBeat(event.clientX - rect.left);

  let newNodes = insertNode(props.curve.nodes, atBeat, props.noteLength, effectiveCurveStyle.value);
  let newNode = newNodes.find(n => !props.curve.nodes.some(o => o.id === n.id))!;

  if(props.snapInterval !== null && !event.shiftKey) {
    newNodes = moveNode(newNodes, newNode.id, newNode.beat, applySnap(newNode.value, false));
    newNode = newNodes.find(n => n.id === newNode.id)!;
  }

  emit('update', { ...props.curve, nodes: newNodes });
  beginDrag(event, newNode.id, newNode.beat, newNode.value);
}

function onNodePointerDown(event: PointerEvent, nodeId: string) {
  if(event.button === 2) {
    emit('update', { ...props.curve, nodes: deleteNode(props.curve.nodes, nodeId) });
    return;
  }

  const startNode = props.curve.nodes.find(n => n.id === nodeId)!;
  beginDrag(event, nodeId, startNode.beat, startNode.value);
}

function onTensionHandlePointerDown(event: PointerEvent, leftNodeId: string) {
  if(event.button !== 0) return;

  const li = props.curve.nodes.findIndex(n => n.id === leftNodeId);
  const lv = props.curve.nodes[li]!.value;
  const rv = props.curve.nodes[li + 1]!.value;

  if(effectiveCurveStyle.value === 'bezier') {
    (event.currentTarget as Element).setPointerCapture(event.pointerId);

    const startY = event.clientY;
    const startHandleValue = getHandleValue(lv, rv, props.curve.nodes[li]!.curveTension);

    function onMove(me: PointerEvent) {
      const deltaValue = -((me.clientY - startY) / props.heightPx);
      const newHandleValue = Math.max(0, Math.min(1, startHandleValue + deltaValue));
      const newTension = Math.max(-1, Math.min(1, newHandleValue - (lv + rv) / 2));
      emit('update', { ...props.curve, nodes: setNodeTension(props.curve.nodes, leftNodeId, newTension) });
    }

    function onUp() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  } else {
    // Power style: pointer lock + tanh dial for smooth easing near bounds
    const startTension = props.curve.nodes[li]!.curveTension;
    const startH = (startTension + 1) / 2;
    // atanh clipped to avoid ±Infinity at exact 0/1
    let dialValue = Math.atanh(Math.max(-0.9999, Math.min(0.9999, (startH - 0.5) * 2)));
    // dragging up should raise the handle regardless of ascending/descending curve
    const direction = rv >= lv ? 1 : -1;

    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    document.body.style.cursor = 'none';

    function onMove(me: PointerEvent) {
      dialValue -= direction * me.movementY / 100;
      const h = Math.max(1e-4, Math.min(1 - 1e-4, 0.5 + 0.5 * Math.tanh(dialValue)));
      const newTension = h * 2 - 1; // back to [-1, 1]
      emit('update', { ...props.curve, nodes: setNodeTension(props.curve.nodes, leftNodeId, newTension) });
    }

    function onUp() {
      document.body.style.cursor = '';
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }
}
</script>


<template>
  <svg class="automation-overlay" :width="widthPx" :height="heightPx" :style="`position:absolute; left:0; top:-${offsetY}px; overflow:visible; pointer-events:none`">
    <!-- fat transparent hit area for inserting nodes (interactive only) -->
    <path v-if="!readOnly" :d="curvePath" fill="none" stroke="transparent" :stroke-width="LINE_HIT_WIDTH" stroke-linecap="round" style="pointer-events:stroke; cursor:crosshair" @pointerdown.stop="onLinePointerDown"/>

    <!-- visible curve path -->
    <path :d="curvePath" fill="none" :stroke="paramColor" :stroke-width="readOnly ? 1 : 1.5" :opacity="readOnly ? 0.45 : 1" stroke-linecap="round" style="pointer-events:none"/>

    <template v-if="!readOnly">
      <!-- tension handle hit circles (between nodes) -->
      <circle v-for="h in segmentHandles" :key="`tension-hit-${h.leftNodeId}`"
        :cx="h.x" :cy="h.y" :r="TENSION_HIT_RADIUS" fill="transparent"
        :stroke="hoveredSegmentId === h.leftNodeId ? manipulateColor(paramColor, 0.6) : 'transparent'"
        style="pointer-events:all; cursor:ns-resize"
        @pointerdown.stop="(e) => onTensionHandlePointerDown(e, h.leftNodeId)"
        @mouseenter="hoveredSegmentId = h.leftNodeId"
        @mouseleave="hoveredSegmentId = null"
      />

      <!-- tension handle visible dots -->
      <circle v-for="h in segmentHandles" :key="`tension-vis-${h.leftNodeId}`"
        :cx="h.x" :cy="h.y" :r="TENSION_VIS_RADIUS"
        :fill="manipulateColor(paramColor, 0.35)" style="pointer-events:none"
      />

      <!-- main node hit circles -->
      <circle v-for="node in renderedNodes" :key="`hit-${node.id}`" :cx="node.x" :cy="node.y" :r="NODE_HIT_RADIUS" fill="transparent"
        :stroke="hoveredNodeId === node.id ? manipulateColor(paramColor, 0.80) : 'transparent'" :style="`pointer-events:all; cursor:${node.isBorder ? 'ns-resize' : 'move'}`"
        @pointerdown.stop="(e) => onNodePointerDown(e, node.id)"
        @mouseenter="hoveredNodeId = node.id"
        @mouseleave="hoveredNodeId = null"
      />

      <!-- main node visible circles -->
      <circle v-for="node in renderedNodes" :key="`vis-${node.id}`" :cx="node.x" :cy="node.y" :r="NODE_VIS_RADIUS"
        :fill="manipulateColor(paramColor, 0.5)"
        :stroke="paramColor" stroke-width="1.5" style="pointer-events:none"
      />
    </template>
  </svg>
</template>
