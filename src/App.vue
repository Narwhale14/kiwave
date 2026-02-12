<script setup lang="ts">
import PatternsList from './components/PatternsList.vue'
import Window from './components/Window.vue';
import PianoRoll from './components/PianoRoll.vue';
import { closePattern, patterns } from './services/patternsListManager';
import HeaderBar from './components/HeaderBar.vue';
import Arrangement from './components/Arrangement.vue';
</script>

<template>
  <div class="flex flex-col w-screen h-screen overflow-hidden">
    <HeaderBar />

    <div class="flex flex-1 overflow-hidden">
      <!-- patterns list -->
      <PatternsList />

      <Arrangement />

      <!-- pattern windows (one per pattern) -->
      <Window
        v-for="pattern in patterns"
        :key="pattern.id"
        :id="pattern.id"
        :title="pattern.name"
        :visible="pattern.visible"
        @close="closePattern(pattern.num)"
      >
        <PianoRoll :roll="pattern.roll"/>
      </Window>
    </div>
  </div>
</template>