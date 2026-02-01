import { ref } from 'vue';
import { PianoRoll } from '../audio/PianoRoll';
import { Keyboard } from '../audio/Keyboard';
import { focusWindow } from '../services/windowManager';

interface Pattern {
    id: string;
    name: string;
    roll: PianoRoll;
    visible: boolean;
}

const keyboard = new Keyboard(
    { note: 'C', octave: 0},
    { note: 'C', octave: 10}
);

export const patterns = ref<Pattern[]>([]);

export function addPattern(name: string) {
    console.log('pattern added');
    patterns.value.push({
        id: crypto.randomUUID(),
        name,
        visible: false,
        roll: new PianoRoll(keyboard.getRange(), keyboard.getKeyboardInfo())
    });
}

export function closePattern(id: string) {
    const pattern = patterns.value.find(p => p.id === id);
    if(pattern) pattern.visible = false;
}

export function togglePattern(id: string) {
    const pattern = patterns.value.find(p => p.id === id);
    if(!pattern) return;

    if(!pattern.visible) {
        patterns.value.forEach(p => {
            if(p.id !== id) p.visible = false;
        });
        focusWindow(pattern.id);
    }

    pattern.visible = !pattern.visible;
}