<script setup lang="ts">
import PatternsList from './components/PatternsList.vue'
import Window from './components/Window.vue';
import PianoRoll from './components/PianoRoll.vue';
import { closePattern, patterns } from './services/patternsListManager';
</script>

<template>
  <div class="w-screen h-screen">
    <PatternsList />

    <Window v-for="pattern in patterns" :key="pattern.id" :id="pattern.id" :title="pattern.name" :visible="pattern.visible" :alterable="false" @close="closePattern(pattern.id)">
      <PianoRoll :roll="pattern.roll"/>
    </Window>
  </div>
</template>