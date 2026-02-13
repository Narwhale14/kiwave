import { ref } from 'vue';

// global snap div
export const snapDivision = ref(4);

export const snapOptions = [
  { label: '1/1 step', value: 1 },
  { label: '1/2 step', value: 2 },
  { label: '1/3 step', value: 3},
  { label: '1/4 step', value: 4 },
  { label: '1/6 step', value: 6},
  { label: '1/8 step', value: 8 },
  { label: '1/16 step', value: 16 },
  { label: '1/32 step', value: 32 }
];

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