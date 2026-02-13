<script setup lang="ts">
import { patterns, togglePattern, addPattern, getNextPatternNum, removePattern, activePattern, type Pattern } from '../services/patternsListManager'
import ConfirmationModal from './modals/ConfirmationModal.vue'
import { ref, watch, nextTick } from 'vue';
import { PATTERNS_LIST_WIDTH } from '../constants/layout';

const name = ref('');
const nameInput = ref<HTMLInputElement | null>(null);
const addButton = ref<HTMLElement | null>(null);

const addModalVisible = ref(false);
const addPos = ref({ x: 0, y: 0 });
const deleteModalVisible = ref(false);
const deletePos = ref({ x: 0, y: 0 });

const patternToDelete = ref<number | null>(null);

function openAddModal() {
  if (addButton.value) {
    const rect = addButton.value.getBoundingClientRect();
    addPos.value = { x: rect.right, y: rect.top };
  }
  addModalVisible.value = true;
}

function confirmDelete(event: MouseEvent, num: number) {
  const el = event.currentTarget as HTMLElement;
  const rect = el.getBoundingClientRect();
  deletePos.value = { x: rect.right, y: rect.top };
  patternToDelete.value = num;
  deleteModalVisible.value = true;
}

function createPattern() {
  addPattern(name.value.trim());
  name.value = '';
  addModalVisible.value = false;
}

function deletePattern() {
  if(patternToDelete.value) removePattern(patternToDelete.value);
  deleteModalVisible.value = false;
}

function onKeyDown(event: KeyboardEvent) {
  if(event.key === 'Enter') {
    event.preventDefault();
    createPattern();
  }
}

function onPatternToggle(patternNum: number, event: MouseEvent) {
  togglePattern(patternNum);
  (event.target as HTMLButtonElement).blur();
}

function handleDragStart(pattern: Pattern, event: DragEvent) {
  if(!event.dataTransfer) return;

  event.dataTransfer.effectAllowed = 'copy';
  event.dataTransfer.setData('pattern-id', pattern.id);
  event.dataTransfer.setData('pattern-name', pattern.name);
}

watch(addModalVisible, async (visible) => {
  if(visible) {
    await nextTick()
    nameInput.value?.focus()
  }
});

</script>

<template>
  <div class="flex flex-col border-2 bg-mix-15 border-mix-30" :style="{ width: `${PATTERNS_LIST_WIDTH}px` }">
    <!-- header -->
    <div class="flex flex-row justify-between items-center p-2.5 border-b-2 border-mix-30">
      <h2 class="font-bold">Patterns</h2>
      <button ref="addButton" @click="openAddModal">
        <span class="pi pi-plus util-button"></span>
      </button>
    </div>

    <!-- list of patterns in list -->
    <ul class="overflow-x-auto p-1 space-y-1">
      <li v-for="pattern in patterns" :key="pattern.num" class="relative" @contextmenu.prevent="confirmDelete($event, pattern.num)">
        <button 
          @click="onPatternToggle(pattern.num, $event)"
          draggable="true"
          @dragstart="handleDragStart(pattern, $event)"
          :class="[
            'w-full text-left px-2 border-2 rounded-sm h-8 hover:border-[#646cff]! transition-colors',
            pattern.num === activePattern?.num
              ? 'bg-mix-40 border-mix-80'
              : 'bg-mix-25 border-mix-50 text-white'
          ]"
        >
          <span class="truncate w-full">{{ pattern.name }}</span>

          <div v-if="pattern.num === activePattern?.num">
            <span class="pi pi-circle text-white-600 font-bold p-1 opacity-50" />
          </div>
        </button>
      </li>
    </ul>
  </div>

  <!-- add pattern modal -->
  <ConfirmationModal :visible="addModalVisible" :x="addPos.x" :y="addPos.y" @confirm="createPattern" @cancel="addModalVisible = false; name = ''">
    <input ref="nameInput" v-model="name" @keydown="onKeyDown" :placeholder="`Pattern ${getNextPatternNum()} name`" class="bg-mix-25 p-2 rounded-md" />
  </ConfirmationModal>

  <!-- remove pattern modal -->
  <ConfirmationModal :visible="deleteModalVisible" :x="deletePos.x" :y="deletePos.y" @confirm="deletePattern" @cancel="deleteModalVisible = false">
    <h3>Delete this pattern?</h3>
  </ConfirmationModal>
</template>
