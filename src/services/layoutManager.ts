import { ref, computed } from 'vue';
import { ARRANGEMENT_HEIGHT_FILL_DEFAULT, CHANNEL_RACK_WIDTH_DEFAULT, MIXER_HEIGHT_FILL_DEFAULT, PIANO_ROLL_HEIGHT_FILL_DEFAULT, PATTERNS_LIST_WIDTH, HEADER_HEIGHT, ARRANGEMENT_WIDTH_FILL_DEFAULT, MIXER_WIDTH_FILL_DEFAULT, SYNTH_WIDTH_FILL_DEFAULT, SYNTH_HEIGHT_FILL_DEFAULT } from '../constants/layout';

export const patternsListWidth = ref(PATTERNS_LIST_WIDTH);
export const headerHeight = ref(HEADER_HEIGHT);

// space for malleable windows
export const availableSpace = computed(() => ({
  x: patternsListWidth.value,
  y: headerHeight.value,
  width: window.innerWidth - patternsListWidth.value,
  height: window.innerHeight - headerHeight.value,
}));

// default window values

export const pianoRollWindow = computed(() => ({
  x: availableSpace.value.x,
  y: availableSpace.value.y,
  width: availableSpace.value.width,
  height: Math.floor(availableSpace.value.height * PIANO_ROLL_HEIGHT_FILL_DEFAULT)
}));

export const arrangementWindow = computed(() => ({
  x: availableSpace.value.x,
  y: availableSpace.value.y + Math.floor(availableSpace.value.height * PIANO_ROLL_HEIGHT_FILL_DEFAULT),
  width: Math.floor(availableSpace.value.width * ARRANGEMENT_WIDTH_FILL_DEFAULT),
  height: Math.floor(availableSpace.value.height * ARRANGEMENT_HEIGHT_FILL_DEFAULT)
}));

export const channelRackWindow = computed(() => ({
  x: window.innerWidth - Math.floor(CHANNEL_RACK_WIDTH_DEFAULT * 4 / 3),
  y: availableSpace.value.y + Math.floor(CHANNEL_RACK_WIDTH_DEFAULT * 0.25),
  width: CHANNEL_RACK_WIDTH_DEFAULT,
}));

export const mixerWindow = computed(() => ({
  x: availableSpace.value.x + arrangementWindow.value.width,
  y: availableSpace.value.y + pianoRollWindow.value.height,
  width: Math.floor(availableSpace.value.width * MIXER_WIDTH_FILL_DEFAULT),
  height: Math.floor(availableSpace.value.height * MIXER_HEIGHT_FILL_DEFAULT)
}));

export const synthWindow = computed(() => ({
  x: availableSpace.value.x + (pianoRollWindow.value.width / 3),
  y: availableSpace.value.y + (pianoRollWindow.value.height / 5),
  width: Math.floor(availableSpace.value.width * SYNTH_WIDTH_FILL_DEFAULT),
  height: Math.floor(availableSpace.value.height * SYNTH_HEIGHT_FILL_DEFAULT)
}));