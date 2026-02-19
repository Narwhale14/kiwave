<script setup lang="ts">
import { ref, nextTick, onBeforeUnmount, provide, readonly } from 'vue';
import SubMenu from './SubMenu.vue';

export interface MenuItem {
  label?: string;
  action?: () => void;
  disabled?: boolean;
  subMenu?: MenuItem[];
  separator?: boolean;
}

const props = defineProps<{
  items: MenuItem[];
  width?: number;
}>();

const isOpen = ref(false);
const anchor = ref<HTMLElement | null>(null);

const closeMenu = () => {
  isOpen.value = false;
  document.removeEventListener('click', handleClickOutside);
};

provide('menuContext', {
  closeMenu,
  rootOpen: readonly(isOpen)
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
    <div v-if="isOpen && anchor" class="fixed z-9999 rounded bg-mix-20 border border-mix-40 shadow-xl"
      :style="{
        top: anchor.getBoundingClientRect().bottom + 4 + 'px',
        left: anchor.getBoundingClientRect().left + 'px',
        width: width ? width + 'px' : anchor.getBoundingClientRect().width + 'px'
      }"
      @click.stop 
    >
      <SubMenu :items="items" />
    </div>
  </Teleport>
</template>