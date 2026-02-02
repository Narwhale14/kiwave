<script setup lang="ts">
import PatternsList from './components/PatternsList.vue'
import Window from './components/Window.vue';
import PianoRoll from './components/PianoRoll.vue';
import { closePattern, patterns } from './services/patternsListManager';
</script>

<template>
  <div class="flex w-screen h-screen">
    <!-- patterns list -->
    <PatternsList />

    <!-- all patterns -->
    <Window v-for="pattern in patterns" :key="pattern.num" 
      :id="pattern.id" 
      :title="pattern.name" 
      :visible="pattern.visible" 
      :alterable="true" 
      @close="closePattern(pattern.num)"
    >
      <PianoRoll :roll="pattern.roll"/>
    </Window>
  </div>
</template>