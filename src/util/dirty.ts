import { ref } from 'vue';

export const dirty = ref(false);
export function markDirty() { if(!dirty.value) dirty.value = true; }
export function isDirty(): boolean { return dirty.value; }