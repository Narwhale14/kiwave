import { reactive, ref, computed } from 'vue'
import { PATTERNS_LIST_WIDTH, HEADER_HEIGHT } from '../constants/layout'

/**
 * interface of a general window object to hold contents. used for manipulatable windows like piano roll
 */
export interface Window {
    id: string,
    x: number,
    y: number,
    width: number,
    height: number,
    z: number
};

export const windows = reactive<Window[]>([]);
export const activeWindowId = ref<string | null>(null);
const activeWindow = computed(() => windows.find(w => w.id === activeWindowId.value) ?? null);

export type ResizeEdge = 'left' | 'right' | 'top' | 'bottom' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
type DragState = { type: 'move'; offsetX: number; offsetY: number } | { type: 'resize'; edge: ResizeEdge; startX: number; startY: number; startW: number; startH: number; startWinX: number; startWinY: number };
const dragState = ref<DragState | null>(null);

let zCounter = 1;

export function registerWindow(window: Window) {
    window.z = zCounter++;
    windows.push(window);
}

export function unregisterWindow(id: string) {
    const i = windows.findIndex(w => w.id === id);
    if(i !== -1) windows.splice(i, 1);
}

export function focusWindow(id: string) {
    const win = windows.find(w => w.id === id);
    if(!win) return;

    activeWindowId.value = id;
    win.z = zCounter++;
}

export function positionWindow(id: string, x: number, y: number, width: number, height: number) {
    const win = windows.find(w => w.id === id);
    if(!win) return;

    win.x = x;
    win.y = y;
    win.width = width;
    win.height = height;
}

export function beginMove(id: string, event: PointerEvent) {
    focusWindow(id);

    dragState.value = {
        type: 'move',
        offsetX: event.clientX - activeWindow.value!.x,
        offsetY: event.clientY - activeWindow.value!.y
    };
}

export function beginResize(id: string, edge: ResizeEdge, event: PointerEvent) {
    focusWindow(id);

    const win = windows.find(w => w.id === id);
    if(!win) return;

    dragState.value = {
        type: 'resize',
        edge,
        startX: event.clientX,
        startY: event.clientY,
        startW: win.width,
        startH: win.height,
        startWinX: win.x,
        startWinY: win.y
    };
}

export function isWindowActive(id: string) {
    return activeWindowId.value === id;
}

window.addEventListener('pointermove', event => {
    if(!dragState.value) return;

    if(dragState.value.type === 'move') {
        const win = activeWindow.value!;
        win.x = Math.max(PATTERNS_LIST_WIDTH, Math.min(window.innerWidth - win.width, event.clientX - dragState.value.offsetX));
        win.y = Math.max(HEADER_HEIGHT, Math.min(window.innerHeight - win.height, event.clientY - dragState.value.offsetY));
    }

    if(dragState.value.type === 'resize') {
        const dx = event.clientX - dragState.value.startX;
        const dy = event.clientY - dragState.value.startY;
        const minW = 200;
        const minH = 100;
        const win = activeWindow.value!;

        if(dragState.value.edge.includes('right')) {
            const maxW = window.innerWidth - win.x;
            win.width = Math.max(minW, Math.min(maxW, dragState.value.startW + dx));
        }
        if(dragState.value.edge.includes('left')) {
            const maxW = dragState.value.startW + (dragState.value.startWinX - PATTERNS_LIST_WIDTH);
            const newW = Math.max(minW, Math.min(maxW, dragState.value.startW - dx));
            win.x = dragState.value.startWinX + (dragState.value.startW - newW);
            win.width = newW;
        }
        if(dragState.value.edge.includes('bottom')) {
            const maxH = window.innerHeight - win.y;
            win.height = Math.max(minH, Math.min(maxH, dragState.value.startH + dy));
        }
        if(dragState.value.edge.includes('top')) {
            const maxH = dragState.value.startH + (dragState.value.startWinY - HEADER_HEIGHT);
            const newH = Math.max(minH, Math.min(maxH, dragState.value.startH - dy));
            win.y = dragState.value.startWinY + (dragState.value.startH - newH);
            win.height = newH;
        }
    }
});

window.addEventListener('pointerup', () => {
    dragState.value = null;
});