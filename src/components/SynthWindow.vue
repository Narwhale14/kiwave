<script setup lang="ts">
import { computed, type Component } from 'vue';
import { channelManager } from '../audio/ChannelManager';
import { activeSynthChannelId } from '../services/synthWindowManager';
import MiniSynth from './synths/MiniSynth.vue';

const synthUIRegistry: Record<string, Component> = {
  minisynth: MiniSynth
};

const activeComponent = computed(() => {
  if(!activeSynthChannelId.value) return null;
  const channel = channelManager.getChannel(activeSynthChannelId.value);
  if(!channel) return null;
  return synthUIRegistry[channel.instrument.id] ?? null;
});
</script>

<template>
  <div class="w-full h-full flex flex-col">
    <component v-if="activeComponent" :is="activeComponent" :channel-id="activeSynthChannelId" class="w-full h-full"/>
  </div>
</template>