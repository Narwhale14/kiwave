<script setup lang="ts">
export type EditorToolId = string;

export interface EditorTool {
  id: EditorToolId;
  label: string;
  activeColor?: string;
}

const props = withDefaults(defineProps<{
  tools: EditorTool[];
  activeTool: EditorToolId;
  toolSize: number;
}>(), {
  toolSize: 3
});

const emit = defineEmits<{
  'update:activeTool': [id: EditorToolId];
}>();

function select(id: EditorToolId) {
  emit('update:activeTool', id);
}
</script>

<template>
  <div class="flex flex-row items-center gap-0.5 px-0.5">
    <button v-for="tool in tools" :key="tool.id" :title="tool.label"
      class="rounded flex items-center justify-center transition-colors focus:outline-none"
      :class="activeTool === tool.id ? 'bg-blue-500/25 text-blue-300 ring-1 ring-blue-400/60' : 'util-button'"
      :style="{ width: props.toolSize + 'px', height: props.toolSize + 'px' }"
      @pointerdown.stop @click="select(tool.id)"
    >
      <slot :tool="tool" :active="activeTool === tool.id">
        <!-- fallback -->
        <span class="text-xs">[]</span>
      </slot>
    </button>
  </div>
</template>