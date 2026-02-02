<script setup lang="ts">
import { ref, watch, nextTick, onUnmounted } from 'vue';

const props = defineProps<{
  visible: boolean;
  x?: number;
  y?: number;
}>();

const emit = defineEmits<{
  confirm: [];
  cancel: [];
}>();

const modalRef = ref<HTMLElement | null>(null);

function onKeyDown(event: KeyboardEvent) {
  if(event.key === 'Escape') emit('cancel');
  if(event.key === 'Enter') emit('confirm');
}

const pos = ref({ left: '0px', top: '0px' });

watch(() => props.visible, async (visible) => {
  if(visible) window.addEventListener('keydown', onKeyDown);
  else window.removeEventListener('keydown', onKeyDown);

  if(!visible || props.x == null || props.y == null) return;

  const gap = 8;
  let left = props.x + gap;
  let top = props.y;

  await nextTick();
  const el = modalRef.value;
  if(!el) return;

  const rect = el.getBoundingClientRect();
  if(left + rect.width > window.innerWidth) {
    left = props.x - rect.width - gap;
  }
  if(top + rect.height > window.innerHeight) {
    top = window.innerHeight - rect.height;
  }

  pos.value = { left: `${left}px`, top: `${top}px` };
});

onUnmounted(() => window.removeEventListener('keydown', onKeyDown));
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="fixed inset-0 z-40">
      <!-- focuses only on modal -->
      <div class="absolute inset-0" @click.stop />

      <!-- modal -->
      <div ref="modalRef" class="absolute flex flex-col justify-center gap-2 z-50 border-2 p-3 rounded-md bg-mix-20 border-mix-40" :style="x != null ? pos : undefined">
        <slot />

        <div class="flex items-center gap-2.5">
          <button class="w-4 h-4 justify-center rounded util-button" @click="$emit('cancel')">
            <span class="pi pi-times" />
          </button>

          <button class="w-4 h-4 justify-center rounded util-button" @click="$emit('confirm')">
            <span class="pi pi-check" />
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
