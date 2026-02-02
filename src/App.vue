<script setup lang="ts">
import PatternsList from './components/PatternsList.vue'
import Window from './components/Window.vue';
import PianoRoll from './components/PianoRoll.vue';
import { closePattern, activePattern } from './services/patternsListManager';
</script>

<template>
  <div class="flex w-screen h-screen">
    <!-- patterns list -->
    <PatternsList />

    <!-- active pattern -->
    <Window
      id="pattern-window"
      :title="activePattern?.name ?? ''"
      :visible="activePattern !== null"
      @close="closePattern(activePattern!.num)"
    >
      <PianoRoll v-if="activePattern" :roll="activePattern.roll"/>
    </Window>
  </div>
</template>