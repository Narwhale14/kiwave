import { ref } from 'vue';

// global snap div
export const snapDivision = ref(4);

export function snap(value: number, division: number = snapDivision.value): number {
    if(division === 0) return value;
    return Math.floor(value * division) / division;
}

export function snapNearest(value: number, division: number = snapDivision.value): number {
    if(division === 0) return value;
    return Math.round(value * division) / division;
}

export function getSnapSize(division: number = snapDivision.value): number {
    return division > 0 ? 1 / division : 1 / 32; // minimum 1/32
}