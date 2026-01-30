import { reactive, ref, computed } from 'vue'

export type Window = {
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

export function beginMove(id: string, event: PointerEvent) {
    if(id !== activeWindowId.value && !activeWindow) return;

    dragState.value = {
        type: 'move',
        offsetX: event.clientX - activeWindow.value!.x,
        offsetY: event.clientY - activeWindow.value!.y
    };
}

export function beginResize(id: string, edge: ResizeEdge, e: PointerEvent) {
    focusWindow(id);
    const win = windows.find(w => w.id === id);
    if(!win) return;

    dragState.value = {
        type: 'resize',
        edge,
        startX: e.clientX,
        startY: e.clientY,
        startW: win.width,
        startH: win.height,
        startWinX: win.x,
        startWinY: win.y
    };
}

window.addEventListener('pointermove', event => {
    if(!activeWindow || !dragState.value) return;

    if(dragState.value.type === 'move') {
        activeWindow.value!.x = event.clientX - dragState.value.offsetX;
        activeWindow.value!.y = event.clientY - dragState.value.offsetY;
    }

    if(dragState.value.type === 'resize') {
        const dx = event.clientX - dragState.value.startX;
        const dy = event.clientY - dragState.value.startY;
        const minW = 200;
        const minH = 100;

        if(dragState.value.edge.includes('right')) {
            activeWindow.value!.width = Math.max(minW, dragState.value.startW + dx);
        }
        if(dragState.value.edge.includes('left')) {
            const newW = Math.max(minW, dragState.value.startW - dx);
            activeWindow.value!.x = dragState.value.startWinX + (dragState.value.startW - newW);
            activeWindow.value!.width = newW;
        }
        if(dragState.value.edge.includes('bottom')) {
            activeWindow.value!.height = Math.max(minH, dragState.value.startH + dy);
        }
        if(dragState.value.edge.includes('top')) {
            const newH = Math.max(minH, dragState.value.startH - dy);
            activeWindow.value!.y = dragState.value.startWinY + (dragState.value.startH - newH);
            activeWindow.value!.height = newH;
        }
    }
});

window.addEventListener('pointerup', () => {
    dragState.value = null;
});