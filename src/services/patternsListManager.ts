import { ref, computed, nextTick, watch } from 'vue';
import { PianoRoll } from '../audio/PianoRoll';
import { Keyboard } from '../audio/Keyboard';
import { focusWindow } from './windowManager';

export interface Pattern {
    id: string;
    num: number;
    name: string;
    roll: PianoRoll;
    visible: boolean;
}

const keyboard = new Keyboard(
    { note: 'C', octave: 0},
    { note: 'C', octave: 10}
);

export const patterns = ref<Pattern[]>([]);
export const activePattern = computed(() => {
    return patterns.value.find(p => p.visible) ?? null;
});

export function getNextNum(): number {
    const used = new Set(patterns.value.map(p => p.num));
    let n = 1;
    while(used.has(n)) n++;
    return n;
}

export function addPattern(name?: string) {
    const num = getNextNum();
    const pattern = {
        id: `pattern-${num}`,
        num,
        name: name || `Pattern ${num}`,
        visible: false,
        roll: new PianoRoll(keyboard.getRange(), keyboard.getKeyboardInfo())
    }

    patterns.value.push(pattern);
}

export function removePattern(num: number) {
    const patternIndex = patterns.value.findIndex(p => p.num === num);
    patterns.value.splice(patternIndex, 1);
}

export function closePattern(num: number) {
    const pattern = patterns.value.find(p => p.num === num);
    if(pattern) pattern.visible = false;
}

export function togglePattern(num: number) {
    const pattern = patterns.value.find(p => p.num === num);
    if(!pattern) return;

    if(!pattern.visible) {
        patterns.value.forEach(p => {
            if(p.num !== num) p.visible = false;
        });
    }

    pattern.visible = !pattern.visible;
}

watch(activePattern, (pattern) => {
    if(pattern && pattern.visible) {
        nextTick(() => focusWindow('pattern-window'));
    }
});