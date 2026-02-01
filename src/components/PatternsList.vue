<script setup lang="ts">
import { ref } from 'vue'
import { addPattern, patterns, togglePattern } from '../state/patterns';

const name = ref('');

function createPattern() {
  if(!name.value.trim()) return;
  addPattern(name.value.trim());
  name.value = '';
}
</script>

<template>
  <div class="patterns-list">
    <h3 class="font-bold mb-2">Patterns</h3>

    <ul>
      <li v-for="pattern in patterns" :key="pattern.id" class="">
        <button class="" @click="togglePattern(pattern.id)">
          {{ pattern.name }}
        </button>
      </li>
    </ul>

    <input v-model="name" placeholder="New Pattern" class="">
    <button class="" @click="createPattern">Add</button>
  </div>
</template>