<script setup lang="ts">
import PianoRoll from './components/PianoRoll.vue';
import Window from './components/Window.vue';
</script>

<template>
  <div class="app-container">
    <Window id="pianoRoll" title="Piano Roll" :visible="true" @close="console.log('window cleared')">
      <PianoRoll />
    </Window>
  </div>
</template>