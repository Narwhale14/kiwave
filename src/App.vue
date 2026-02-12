<script setup lang="ts">
import PatternsList from './components/PatternsList.vue'
import Window from './components/Window.vue';
import PianoRoll from './components/PianoRoll.vue';
import { closePattern, patterns } from './services/patternsListManager';
import HeaderBar from './components/HeaderBar.vue';
import Arrangement from './components/Arrangement.vue';
import { computed } from 'vue';
import { PATTERNS_LIST_WIDTH, HEADER_HEIGHT, PIANO_ROLL_FILL_DEFAULT, ARRANGEMENT_FILL_DEFAULT } from './constants/layout';

// Layout calculations for default window positions
const availableWidth = computed(() => window.innerWidth - PATTERNS_LIST_WIDTH);
const availableHeight = computed(() => window.innerHeight - HEADER_HEIGHT);

// arrangement default position and size
const arrangementWindow = computed(() => ({
  x: PATTERNS_LIST_WIDTH,
  y: HEADER_HEIGHT + pianoRollWindow.value.height,
  width: availableWidth.value,
  height: Math.floor(availableHeight.value * ARRANGEMENT_FILL_DEFAULT)
}));

// piano roll default position and size
const pianoRollWindow = computed(() => ({
  x: PATTERNS_LIST_WIDTH,
  y: HEADER_HEIGHT,
  width: availableWidth.value,
  height: Math.floor(availableHeight.value * PIANO_ROLL_FILL_DEFAULT)
}));
</script>

<template>
  <div class="flex flex-col w-screen h-screen overflow-hidden">
    <HeaderBar />

    <div class="flex flex-1 overflow-hidden">
      <!-- patterns list -->
      <PatternsList />

      <!-- arrangement window -->
      <Window
        :visible="true"
        :title="'Arrangement'"
        :id="'arrangement-window'"
        :x="arrangementWindow.x"
        :y="arrangementWindow.y"
        :width="arrangementWindow.width"
        :height="arrangementWindow.height"
      >
        <Arrangement />
      </Window>

      <!-- pattern windows -->
      <Window
        v-for="pattern in patterns"
        :key="pattern.id"
        :id="pattern.id"
        :title="pattern.name"
        :visible="pattern.visible"
        :x="pianoRollWindow.x"
        :y="pianoRollWindow.y"
        :width="pianoRollWindow.width"
        :height="pianoRollWindow.height"
        @close="closePattern(pattern.num)"
      >
        <PianoRoll :roll="pattern.roll"/>
      </Window>
    </div>
  </div>
</template>