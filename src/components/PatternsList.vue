<script setup lang="ts">
import { patterns, togglePattern, addPattern, getNextNum, removePattern } from '../services/patternsListManager'
import ConfirmationModal from './ConfirmationModal.vue'
import { ref, watch, nextTick } from 'vue';

const name = ref('');
const nameInput = ref<HTMLInputElement | null>(null);

const addModalVisible = ref(false);
const deleteModalVisible = ref(false);

const patternToDelete = ref<number | null>(null);

function confirmDelete(num: number) {
  console.log('trigger');
  patternToDelete.value = num;
  deleteModalVisible.value = true;
}

function createPattern() {
  if(!name.value.trim()) return;
  
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
  <div class="patterns-list flex flex-col p-5 bg-black border-5 border-amber-100">
    <div class="flex flex-row mb-2 justify-between items-center gap-1.5">
      <h3 class="font-bold">Patterns</h3>
      <button @click="addModalVisible = true">
        <span class="pi pi-plus"></span>
      </button>
    </div>

    <ul>
      <li v-for="pattern in patterns" :key="pattern.num" @contextmenu.prevent="confirmDelete(pattern.num)">
        <button class="w-full border text-left px-2" @click="togglePattern(pattern.num)">
          {{ pattern.name }}
        </button>
      </li>
    </ul>
  </div>

  <!-- add pattern modal -->
  <ConfirmationModal :visible="addModalVisible" @confirm="createPattern" @cancel="addModalVisible = false; name = ''">
    <input ref="nameInput" v-model="name" @keydown="onKeyDown" :placeholder="`Pattern ${getNextNum()} name`" class="p-2 rounded" autofocus />
  </ConfirmationModal>

  <!-- remove pattern modal -->
  <ConfirmationModal :visible="deleteModalVisible" @confirm="deletePattern" @cancel="deleteModalVisible = false">
    <h3>Delete this pattern?</h3>
  </ConfirmationModal>
</template>