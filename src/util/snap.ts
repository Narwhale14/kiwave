import { ref } from 'vue';

// global snap div
export const snapDivision = ref(4);

export const snapOptions = [
  { label: '1/1 beat', value: 1 },
  { label: '1/2 beat', value: 2 },
  { label: '1/4 beat', value: 4 },
  { label: '1/8 beat', value: 8 },
  { label: '1/16 beat', value: 16 },
  { label: '1/32 beat', value: 32 }
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