<script setup lang="ts">
import PianoRoll from './components/PianoRoll.vue';
import Window from './components/Window.vue';
import { activeWindowId } from './services/windowManager';
</script>

<template>
  <div class="app-container w-screen h-screen" @pointerdown="activeWindowId = null">
    <Window id="1" title="Pattern" :visible="true" @close="console.log('window cleared')">
      <PianoRoll />
    </Window>
  </div>
</template>