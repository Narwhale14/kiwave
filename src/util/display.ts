export function manipulateColor(color: string, percent: number, alpha = 1) {
    if(color.length !== 7 || !color.startsWith('#')) return;

    let r = 0, g = 0, b = 0;
    r = parseInt(color.slice(1, 3), 16);
    g = parseInt(color.slice(3, 5), 16);
    b = parseInt(color.slice(5, 7), 16);

    r = Math.min(255, Math.round(r + (255 - r) * percent));
    g = Math.min(255, Math.round(g + (255 - g) * percent));
    b = Math.min(255, Math.round(b + (255 - b) * percent));

    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}