<script setup lang="ts">
import { ref } from 'vue'
import { addPattern, patterns, togglePattern } from '../services/patternsListManager';

const name = ref('');

function createPattern() {
  if(!name.value.trim()) return;
  addPattern(name.value.trim());
  name.value = '';
}

function onKeyDown(event: KeyboardEvent) {
  if(event.key === 'Enter') {
    event.preventDefault();
    createPattern();
  }
}
</script>

<template>
  <div class="patterns-list flex flex-col p-5 bg-black border-5 border-amber-100">
    <div class="flex flex-row mb-2 justify-between items-center gap-1.5">
      <h3 class="font-bold">Patterns</h3>
      <input v-model="name" placeholder="New Pattern" @keydown="onKeyDown">
    </div>

    <ul>
      <li v-for="pattern in patterns" :key="pattern.id">
        <button class="w-full border text-left px-2" @click="togglePattern(pattern.id)">
          {{ pattern.name }}
        </button>
      </li>
    </ul>
  </div>
</template>