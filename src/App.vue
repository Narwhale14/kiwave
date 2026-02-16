<script setup lang="ts">
import PatternsList from './components/PatternsList.vue'
import Window from './components/Window.vue';
import PianoRoll from './components/PianoRoll.vue';
import { closePattern, patterns } from './services/patternsListManager';
import { arrangementVisible, mixerVisible, channelRackVisible } from './services/windowManager';
import HeaderBar from './components/HeaderBar.vue';
import Arrangement from './components/Arrangement.vue';
import ChannelRack from './components/ChannelRack.vue';
import Mixer from './components/Mixer.vue';
import { arrangementWindow, channelRackWindow, mixerWindow, pianoRollWindow } from './services/layoutManager';
import { onMounted, onUnmounted } from 'vue';
import { togglePlaybackMode } from './services/playbackModeManager';

function handleKeyDown(event: KeyboardEvent) {
  if(event.key === 'l' || event.key === 'L') {
    togglePlaybackMode();
  }
};

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown);
})

</script>

<template>
  <div class="flex flex-col w-screen h-screen overflow-hidden">
    <HeaderBar />

    <div class="flex flex-1 overflow-hidden">
      <PatternsList />

      <!-- arrangement window -->
      <Window
        :visible="arrangementVisible"
        :id="'arrangement-window'"
        @close="arrangementVisible = false"
        :x="arrangementWindow.x"
        :y="arrangementWindow.y"
        :width="arrangementWindow.width"
        :height="arrangementWindow.height"
        :resizing="{ left: true, right: true, top: true, bottom: true }"
      >
        <Arrangement />
      </Window>

      <Window
        :visible="channelRackVisible"
        @close="channelRackVisible = false"
        :id="'channel-rack-window'"
        :x="channelRackWindow.x"
        :y="channelRackWindow.y"
        :width="channelRackWindow.width"
        :auto-height="true"
        :resizing="{ left: true, right: true }"
      >
        <ChannelRack />
      </Window>

      <Window
        :visible="mixerVisible"
        @close="mixerVisible = false"
        :id="'mixer-window'"
        :x="mixerWindow.x"
        :y="mixerWindow.y"
        :width="mixerWindow.width"
        :height="mixerWindow.height"
        :resizing="{ left: true, right: true, top: true, bottom: true }"
      >
        <Mixer />
      </Window>

      <!-- pattern windows -->
      <Window
        v-for="pattern in patterns"
        :key="pattern.id"
        :id="pattern.id"
        :visible="pattern.visible"
        :x="pianoRollWindow.x"
        :y="pianoRollWindow.y"
        :width="pianoRollWindow.width"
        :height="pianoRollWindow.height"
        @close="closePattern(pattern.num)"
        :resizing="{ left: true, right: true, top: true, bottom: true }"
      >
        <PianoRoll :roll="pattern.roll" :name="pattern.name" />
      </Window>
    </div>
  </div>
</template>