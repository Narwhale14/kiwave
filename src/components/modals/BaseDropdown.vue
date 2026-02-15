<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';

type Item = Record<string, any>;

const props = withDefaults(defineProps<{
  modelValue: any,
  items: Item[],
  itemLabel?: string,
  itemValue?: string,
  placeholder?: string,
  buttonBg?: string,
  buttonClass?: string,
  buttonStyle?: Record<string, any>
  width?: string,
  display?: 'text' | 'image',
  displayImage?: string
}>(), {
  buttonBg: 'bg-mix-15',
  buttonClass: 'px-3 py-1 text-sm',
  width: '20',
  display: 'text',
  displayImage: ''
});

const emit = defineEmits<{
  (event: 'update:modelValue', value: any): void
}>();

const isOpen = ref(false);
const highlightedIndex = ref(-1);
const root = ref<HTMLElement | null>(null);
const isSelecting = ref(false);
const menuStyle = ref<{ top: string; left: string }>({ top: '0px', left: '0px' });

const labelKey = computed(() => props.itemLabel ?? 'label');
const valueKey = computed(() => props.itemValue ?? 'value');
const selectedItem = computed(() => props.items.find(i => i[valueKey.value] === props.modelValue));

let previousFocus: HTMLElement | null = null;

function toggle() {
  if(isSelecting.value) {
    isSelecting.value = false;
    return;
  }

  if(!isOpen.value && root.value) {
    previousFocus = document.activeElement as HTMLElement;
    const rect = root.value.getBoundingClientRect();
    menuStyle.value = { top: rect.bottom + 'px', left: rect.left + 'px' };
  }
  
  isOpen.value = !isOpen.value;
}

function select(item: Item) {
  isSelecting.value = true;
  emit('update:modelValue', item[valueKey.value]);
  isOpen.value = false;

  if(previousFocus) previousFocus.focus();
  previousFocus = null;

  isSelecting.value = false;
} 

function close() {
  isOpen.value = false;
}

function handleKeyDown(event: KeyboardEvent) {
  if(!isOpen.value && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
    event.preventDefault();
    event.stopPropagation();
    isOpen.value = true;
    highlightedIndex.value = 0;
    return;
  }

  if(!isOpen.value) return;

  switch(event.key) {
    case 'ArrowDown':
      event.preventDefault();
      event.stopPropagation();
      highlightedIndex.value = (highlightedIndex.value + 1) % props.items.length;
      break;
    case 'ArrowUp':
      event.preventDefault();
      event.stopPropagation();
      highlightedIndex.value = (highlightedIndex.value - 1 + props.items.length) % props.items.length;
      break;
    case 'Enter':
      event.preventDefault();
      event.stopPropagation();
      if(highlightedIndex.value >= 0) {
        select(props.items[highlightedIndex.value]!);
      }
      break;
    case 'Escape':
      event.preventDefault();
      event.stopPropagation();
      close();
      break;
  }
}

function handleClickOutside(event: MouseEvent) {
  if(root.value && !root.value.contains(event.target as Node)) {
    close();
  }
}

function handleItemHover(index: number) {
  highlightedIndex.value = index;
}

watch(isOpen, (open) => {
  if(open) {
    highlightedIndex.value = props.items.findIndex(i => i[valueKey.value] === props.modelValue);
    nextTick(() => {
      document.addEventListener('click', handleClickOutside);
    });
  } else {
    document.removeEventListener('click', handleClickOutside);
  }
});
</script>

<template>
  <div ref="root" class="relative inline-block" tabindex="0" @keydown="handleKeyDown">
    <button type="button" @click="toggle" :class="[`dropdown-button dropdown-button flex items-center justify-between gap-1 min-w-${width} rounded transition-colors whitespace-nowrap`, buttonBg, buttonClass]" :style="buttonStyle">
      <template v-if="display === 'text'">
        <span>{{ selectedItem?.[labelKey] ?? placeholder ?? 'Select' }}</span>
      </template>
      
      <template v-else-if="display === 'image'">
        <img :src="displayImage" class="w-3.5 h-3.5 object-contain"/>
      </template>
      <span class="pi pi-chevron-down text-xs transition-transform" :class="{ 'rotate-180': isOpen }" />
    </button>

    <Teleport to="body">
      <div v-if="isOpen" class="fixed w-max bg-mix-20 border border-mix-40 rounded shadow-lg z-9999 max-h-60 overflow-auto" :style="menuStyle">
        <div
          v-for="(item, index) in items"
          :key="item[valueKey]"
          @click.stop="select(item)"
          @mouseenter="handleItemHover(index)"
          class="px-2 py-1 text-xs cursor-pointer transition-colors whitespace-nowrap"
          :class="index === highlightedIndex ? 'bg-mix-35' : 'bg-mix-20 hover:bg-mix-30'"
        >
          <slot name="item" :item="item">
            {{ item[labelKey] }}
          </slot>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.dropdown-button:hover {
  background-color: var(--step-30) !important;
  border-color: var(--step-30);
}
</style>