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
  <div class="flex flex-col w-50 border-2 bg-mix-15 border-mix-30">
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
        <button @click="togglePattern(pattern.num)"
          :class="[
            'w-full text-left px-2 border-2 rounded-sm h-8',
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
    <input ref="nameInput" v-model="name" @keydown="onKeyDown" :placeholder="`Pattern ${getNextNum()} name`" class="bg-mix-25 p-2 rounded-md" />
  </ConfirmationModal>

  <!-- remove pattern modal -->
  <ConfirmationModal :visible="deleteModalVisible" :x="deletePos.x" :y="deletePos.y" @confirm="deletePattern" @cancel="deleteModalVisible = false">
    <h3>Delete this pattern?</h3>
  </ConfirmationModal>
</template>