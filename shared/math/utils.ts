/** Euclidean distance from dx/dy deltas. */
export function distance(dx: number, dy: number): number {
  return Math.sqrt(dx * dx + dy * dy);
}

/** Squared Euclidean distance (avoids sqrt - use for comparisons). */
export function distanceSq(dx: number, dy: number): number {
  return dx * dx + dy * dy;
}

/** Normalize a 2D vector. Returns [0, 0] for zero-length input. */
export function normalize(dx: number, dy: number): [number, number] {
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return [0, 0];
  return [dx / len, dy / len];
}

/** Linear interpolation between a and b by factor t (0-1). */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Clamp a value between min and max. */
export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
