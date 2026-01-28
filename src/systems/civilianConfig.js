import { CIVILIAN_RADIUS, TILE_SIZE } from '../config/constants.js';

// Civilian system tuning knobs.
// Update these values to change spawn, routing, and anti-stuck behavior without touching core logic.
export const CIVILIAN_TUNING = {
    // Increase to push house spawns farther from entrances.
    SPAWN_FRONT_OFFSET_TILES: 2,
    // Increase separation/passes if civilians overlap under heavy load.
    SEPARATION_PADDING: 2,
    SEPARATION_PASSES: 3,
    STUCK_FRAMES_THRESHOLD: 40,
    STUCK_PROGRESS_EPSILON_SQ: 0.09,
    DYNAMIC_AVOID_RADIUS: CIVILIAN_RADIUS * 2.5,
    DYNAMIC_AVOID_WEIGHT: 1.15,
    // Core economics knob: per-trip carry capacity.
    CARRY_AMOUNT: 5,
    PATROL_RECHECK_FRAMES: 45,
    STUCK_RECOVERY_COOLDOWN_FRAMES: 75,
    REROUTE_COOLDOWN_FRAMES: 30,
    PREEMPTIVE_REROUTE_FRAMES: 20,
    NO_PROGRESS_FRAMES_THRESHOLD: 85,
    MIN_PROGRESS_PER_FRAME: 0.08,
    ASSIGNMENTS_PER_FRAME: 10,
    TARGET_REFRESH_FRAMES: 24,
    TARGET_GRID_SIZE: TILE_SIZE * 10,
    COLLISION_DENSE_THRESHOLD: 45
};

// Spiral-ish offsets used for unstuck fallback search.
export const CIVILIAN_UNSTUCK_SEARCH_OFFSETS = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
    { x: 1, y: 1 },
    { x: 1, y: -1 },
    { x: -1, y: 1 },
    { x: -1, y: -1 },
    { x: 2, y: 0 },
    { x: -2, y: 0 },
    { x: 0, y: 2 },
    { x: 0, y: -2 },
    { x: 2, y: 1 },
    { x: 2, y: -1 },
    { x: -2, y: 1 },
    { x: -2, y: -1 }
];

