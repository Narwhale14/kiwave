import { ref } from 'vue';
import { stepReduceByInterval } from './math';

// global snap div
export const snapDivision = ref(4);

export const snapOptions = [
  { label: '1/1 step', action: () => (snapDivision.value = 1) },
  { label: '1/2 step', action: () => (snapDivision.value = 2) },
  { label: '1/3 step', action: () => (snapDivision.value = 3)},
  { label: '1/4 step', action: () => (snapDivision.value = 4) },
  { label: '1/6 step', action: () => (snapDivision.value = 6)},
  { label: '1/8 step', action: () => (snapDivision.value = 8) },
  { label: '1/16 step', action: () => (snapDivision.value = 16) }
];

const SNAP_COALESCE_THRESHOLD_1 = 45;
const SNAP_COALESCE_THRESHOLD_2 = 30;

export function snap(value: number, division: number = snapDivision.value): number {
    if(division === 0) return value;
    return Math.floor(value * division) / division;
}

export function dynamicSnap(value: number, width: number) {
    const division = getDynamicSnapDivision(width);
    return snap(value, division);
}

export function snapNearest(value: number, division: number = snapDivision.value): number {
    if(division === 0) return value;
    return Math.round(value * division) / division;
}

export function snapNearestGrid(value: number, division: number): number {
    if(division === 0) return value;
    return Math.round(value / division) * division
}

export function dynamicSnapNearest(value: number, width: number) {
    const division = getDynamicSnapDivision(width);
    return snapNearest(value, division);
}

export function getSnapSize(division: number = snapDivision.value): number {
    return division > 0 ? 1 / division : 1 / 32; // minimum 1/32
}

function getDynamicSnapDivision(width: number) {
    if(width < SNAP_COALESCE_THRESHOLD_1) {
        if(width < SNAP_COALESCE_THRESHOLD_2) {
            return stepReduceByInterval(snapDivision.value, 2, 2);
        }
        return stepReduceByInterval(snapDivision.value, 2, 1);
    }

    return snapDivision.value;
}

export function getVisualSnapWidth(width: number) {
    if(width < SNAP_COALESCE_THRESHOLD_1) {
        if(width < SNAP_COALESCE_THRESHOLD_2) {
            return width / stepReduceByInterval(snapDivision.value, 2, 2);
        }
        return width / stepReduceByInterval(snapDivision.value, 2, 1);
    }

    return width / snapDivision.value;
}