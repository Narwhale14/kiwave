<script setup lang="ts">
import { ref, reactive, watch, nextTick, onBeforeUnmount, provide, readonly } from 'vue';
import SubMenu from './SubMenu.vue';

export interface MenuItem {
  label?: string;
  action?: () => void;
  disabled?: boolean;
  subMenu?: MenuItem[];
  separator?: boolean;
  title?: string;
}

const props = defineProps<{
  items: MenuItem[];
  width?: number;
}>();

const isOpen = ref(false);
const anchor = ref<HTMLElement | null>(null);
const menuEl = ref<HTMLElement | null>(null);
const position = reactive({ top: 0, left: 0, width: 0 });

const closeMenu = () => {
  isOpen.value = false;
  document.removeEventListener('click', handleClickOutside);
};

provide('menuContext', {
  closeMenu,
  rootOpen: readonly(isOpen)
});

watch(isOpen, async (open) => {
  if(!open || !anchor.value) return;
  const rect = anchor.value.getBoundingClientRect();

  // initial position: below anchor, left-aligned
  position.top = rect.bottom + 4;
  position.left = rect.left;
  position.width = props.width ?? rect.width;

  await nextTick();
  if(!menuEl.value) return;
  const menuRect = menuEl.value.getBoundingClientRect();

  // shift left if overflowing right edge
  if(position.left + menuRect.width > window.innerWidth) {
    position.left = Math.max(4, window.innerWidth - menuRect.width - 4);
  }

  // open upward if overflowing bottom edge
  if(position.top + menuRect.height > window.innerHeight) {
    position.top = Math.max(4, rect.top - menuRect.height - 4);
  }
});

function open(element: HTMLElement) {
  anchor.value = element;
  isOpen.value = true;
  nextTick(() => document.addEventListener('click', handleClickOutside));
}

function toggle(event: MouseEvent) {
  const element = event.currentTarget as HTMLElement;
  if(isOpen.value && anchor.value === element) {
    closeMenu();
  } else {
    open(element);
  }
}

function handleClickOutside(event: MouseEvent) {
  if(!anchor.value) return;
  const target = event.target as Node;
  if(anchor.value.contains(target)) return;
  closeMenu();
}

onBeforeUnmount(() => {
  document.removeEventListener('click', handleClickOutside);
});

defineExpose({ toggle, open, close: closeMenu, isOpen });
</script>

<template>
  <Teleport to="body">
    <div ref="menuEl" v-if="isOpen && anchor"
      class="fixed z-9999 rounded bg-mix-20 border border-mix-40 shadow-xl overflow-hidden"
      :style="{
        top: position.top + 'px',
        left: position.left + 'px',
        width: position.width + 'px'
      }"
      @click.stop
    >
      <SubMenu :items="items" :width="position.width" />
    </div>
  </Teleport>
</template>