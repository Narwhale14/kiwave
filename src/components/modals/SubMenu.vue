<script setup lang="ts">
import { ref, inject } from 'vue';
import type { MenuItem } from './Menu.vue';

const props = defineProps<{
  items: MenuItem[];
  width?: number;
}>();

const { closeMenu } = inject('menuContext') as { closeMenu: () => void };

const hoveredIndex = ref<number | null>(null);
const openSubmenuIndex = ref<number | null>(null);
const itemRefs = ref<HTMLElement[]>([]);
const submenuPosition = ref({ top: 0, left: 0 });

let hoverTimer: number | null = null;

const setItemRef = (element: any, index: number) => {
  if(element) itemRefs.value[index] = element as HTMLElement;
};

function onMouseEnter(index: number, item: MenuItem) {
  hoveredIndex.value = index;

  if(hoverTimer) clearTimeout(hoverTimer);
  
  // close other sibling submenus immediately
  if(openSubmenuIndex.value !== index) {
    openSubmenuIndex.value = null;
  }

  if(item.subMenu) {
    hoverTimer = window.setTimeout(() => {
      calculateSubmenuPosition(index);
      openSubmenuIndex.value = index;
    }, 150);
  }
}

function onMouseLeave(index: number) {
  hoveredIndex.value = null;
  
  if(hoverTimer) clearTimeout(hoverTimer);

  hoverTimer = window.setTimeout(() => {
     if (openSubmenuIndex.value === index) {
        openSubmenuIndex.value = null;
     }
  }, 200);
}

function onSubmenuEnter() {
  if(hoverTimer) clearTimeout(hoverTimer);
}

function handleClick(item: MenuItem) {
  if(item.disabled || item.separator) return;

  if(item.action) {
    item.action();
    closeMenu();
  }
}

function calculateSubmenuPosition(index: number) {
  if(!itemRefs.value[index]) return;
  const rect = itemRefs.value[index].getBoundingClientRect();
  
  // default open to the right
  let left = rect.right;
  let top = rect.top - 4;

  if(left + 150 > window.innerWidth) {
    left = rect.left - 150;
  }

  submenuPosition.value = { top, left };
}
</script>

<template>
  <div class="py-1 flex flex-col justify-center items-center" :style="{ width: width ? width + 'px' : 'auto' }">
    <template v-for="(item, index) in items" :key="index">
      <div v-if="item.separator" class="my-1 h-px bg-mix-40"></div>

      <div v-else :ref="(element) => setItemRef(element, index)" 
        class="relative flex items-center justify-between px-1.5 py-0.5 text-xs font-mono font-bold transition-colors"
        :class="[
          item.disabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-mix-25 cursor-pointer',
          (hoveredIndex === index || openSubmenuIndex === index) && !item.disabled ? 'bg-mix-25' : ''
        ]"
        @mouseenter="onMouseEnter(index, item)" 
        @mouseleave="onMouseLeave(index)" 
        @click="handleClick(item)"
      >
        <span class="truncate pr-1">{{ item.label }}</span>
        
        <span v-if="item.subMenu" class="shrink-0 ml-auto text-xs pi pi-caret-right"/>

        <Teleport to="body">
          <div v-if="item.subMenu && openSubmenuIndex === index" 
            class="fixed z-9999 rounded bg-mix-20 border border-mix-40 shadow-xl overflow-hidden"
            :style="{ 
              top: submenuPosition.top + 'px', 
              left: submenuPosition.left + 'px',
              width: width ? width + 'px' : 'auto'
            }"
            @mouseenter="onSubmenuEnter" @mouseleave="onMouseLeave(index)" @click.stop 
          >
             <SubMenu :items="item.subMenu" :width="width" />
          </div>
        </Teleport>
      </div>
    </template>
  </div>
</template>