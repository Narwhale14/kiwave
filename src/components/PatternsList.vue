<script setup lang="ts">
import { patterns, togglePattern, addPattern, getNextNum, removePattern, activePattern } from '../services/patternsListManager'
import ConfirmationModal from './ConfirmationModal.vue'
import { ref, watch, nextTick } from 'vue';

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

watch(addModalVisible, async (visible) => {
  if(visible) {
    await nextTick()
    nameInput.value?.focus()
  }
});

</script>

<template>
  <div class="flex flex-col w-55 bg-gray-600 border-5 border-gray-500">
    <div class="flex flex-row justify-between items-center p-5 border-b-5 border-gray-500">
      <h2 class="font-bold">Patterns</h2>
      <button ref="addButton" @click="openAddModal">
        <span class="pi pi-plus"></span>
      </button>
    </div>

    <ul class="overflow-x-auto p-2.5 space-y-2.5">
      <li v-for="pattern in patterns" :key="pattern.num" class="relative" @contextmenu.prevent="confirmDelete($event, pattern.num)">
        <button class="w-full text-left px-2 bg-gray-700 border-2 border-gray-800 rounded-md" @click="togglePattern(pattern.num)">
          {{ pattern.name }}
        </button>

        <div v-if="pattern.num === activePattern?.num" class="absolute top-1/2 -translate-y-1/2 -left-2">
          <span class="pi pi-angle-right text-white-600 font-bold" />
        </div>
      </li>
    </ul>
  </div>

  <!-- add pattern modal -->
  <ConfirmationModal :visible="addModalVisible" :x="addPos.x" :y="addPos.y" @confirm="createPattern" @cancel="addModalVisible = false; name = ''">
    <input ref="nameInput" v-model="name" @keydown="onKeyDown" :placeholder="`Pattern ${getNextNum()} name`" class="p-2 rounded" autofocus />
  </ConfirmationModal>

  <!-- remove pattern modal -->
  <ConfirmationModal :visible="deleteModalVisible" :x="deletePos.x" :y="deletePos.y" @confirm="deletePattern" @cancel="deleteModalVisible = false">
    <h3>Delete this pattern?</h3>
  </ConfirmationModal>
</template>