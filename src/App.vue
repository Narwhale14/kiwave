<script setup lang="ts">
import { reactive } from 'vue';
import PianoRoll from './components/PianoRoll.vue';
import Window from './components/Window.vue';

interface WindowState {
  id: string;
  title: string;
  visible: boolean;
  component: any;
}

const windows = reactive<WindowState[]>([
  { id: '1', title: 'pattern', visible: true, component: PianoRoll },
  { id: '2', title: 'pattern', visible: true, component: PianoRoll }
]);

function toggleWindow(id: string, visible: boolean) {
  const win = windows.find(w => w.id === id);
  if(!win) return;
  win.visible = visible;
}
</script>

<template>
  <div class="app-container w-screen h-screen">
    <button @click="toggleWindow('1', true)">press</button>
    <Window v-for="win in windows" :key="win.id" :id="win.id" :title="win.title" :visible="win.visible"
      @close="toggleWindow(win.id, false)"
    >
      <component :is="win.component" v-if="win.visible && win.component" />
    </Window>
  </div>
</template>