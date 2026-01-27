export function formatGameClock(totalSeconds) {
    const safeTotal = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(safeTotal / 3600);
    const minutes = Math.floor((safeTotal % 3600) / 60);
    const seconds = safeTotal % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

export function clearSpatialIndex(index) {
    index.grid.clear();
}

export function addToSpatialIndex(index, x, y, entity) {
    const cx = Math.floor(x / index.cellSize);
    const cy = Math.floor(y / index.cellSize);
    const key = `${cx},${cy}`;
    let bucket = index.grid.get(key);
    if (!bucket) {
        bucket = [];
        index.grid.set(key, bucket);
    }
    bucket.push(entity);
}

export function querySpatialIndex(index, x, y, radius) {
    const out = [];
    querySpatialIndexInto(index, x, y, radius, out);
    return out;
}

export function querySpatialIndexInto(index, x, y, radius, out) {
    out.length = 0;
    const minCellX = Math.floor((x - radius) / index.cellSize);
    const maxCellX = Math.floor((x + radius) / index.cellSize);
    const minCellY = Math.floor((y - radius) / index.cellSize);
    const maxCellY = Math.floor((y + radius) / index.cellSize);

    for (let cy = minCellY; cy <= maxCellY; cy++) {
        for (let cx = minCellX; cx <= maxCellX; cx++) {
            const bucket = index.grid.get(`${cx},${cy}`);
            if (!bucket || bucket.length === 0) {
                continue;
            }
            out.push(...bucket);
        }
    }
}
