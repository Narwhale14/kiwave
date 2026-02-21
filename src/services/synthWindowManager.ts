import { ref } from 'vue';
import { focusWindow } from './windowManager';

export const synthWindowVisible = ref(false);
export const activeSynthChannelId = ref<string | null>(null);

export function toggleSynthWindow(channelId: string) {
    focusWindow('synth-window');
    if(activeSynthChannelId.value) {
        activeSynthChannelId.value = null;
    } else {
        activeSynthChannelId.value = channelId;
    }
    
    synthWindowVisible.value = !synthWindowVisible.value;
}

export function closeSynthWindow() {
    synthWindowVisible.value = false;
    activeSynthChannelId.value = null;
}