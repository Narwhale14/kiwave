<script setup lang="ts">
import PatternsList from './components/PatternsList.vue'
import Window from './components/Window.vue';
import PianoRoll from './components/PianoRoll.vue';
import { closePattern, patterns } from './services/patternsListManager';
import { arrangementVisible } from './services/arrangementManager';
import HeaderBar from './components/HeaderBar.vue';
import Arrangement from './components/Arrangement.vue';
import ChannelRack from './components/ChannelRack.vue';
import { PATTERNS_LIST_WIDTH, HEADER_HEIGHT, PIANO_ROLL_FILL_DEFAULT, ARRANGEMENT_FILL_DEFAULT, CHANNEL_RACK_WIDTH_DEFAULT } from './constants/layout';
import { channelRackVisible } from './services/channelRackManager';

// Layout calculations for default window positions
const availableWidth = window.innerWidth - PATTERNS_LIST_WIDTH;
const availableHeight = window.innerHeight - HEADER_HEIGHT;

// piano roll default position and size
const pianoRollWindow = {
  x: PATTERNS_LIST_WIDTH,
  y: HEADER_HEIGHT,
  width: availableWidth,
  height: Math.floor(availableHeight * PIANO_ROLL_FILL_DEFAULT)
};

// arrangement default position and size
const arrangementWindow = {
  x: PATTERNS_LIST_WIDTH,
  y: HEADER_HEIGHT + pianoRollWindow.height,
  width: availableWidth,
  height: Math.floor(availableHeight * ARRANGEMENT_FILL_DEFAULT)
};

// channel rack default position and size
const channelRackWindow = {
  x: window.innerWidth - CHANNEL_RACK_WIDTH_DEFAULT,
  y: HEADER_HEIGHT,
  width: CHANNEL_RACK_WIDTH_DEFAULT
}
</script>

<template>
  <div class="flex flex-col w-screen h-screen overflow-hidden">
    <HeaderBar />

    <div class="flex flex-1 overflow-hidden">
      <!-- patterns list -->
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