// ─── Core primitives ──────────────────────────────────────────────────────────

/** A unique entity ID - just a number. The ECS World assigns these. */
export type EntityId = number;

/** 2D position or vector in world space (pixels). */
export interface Vec2 {
  x: number;
  y: number;
}

/** Integer grid coordinate for chunk addressing (not pixels, not tiles). */
export interface ChunkCoord {
  cx: number;
  cy: number;
}

/** Integer tile coordinate within a chunk (0 .. CHUNK_SIZE-1). */
export interface TileCoord {
  tx: number;
  ty: number;
}

// ─── Gameplay enums ───────────────────────────────────────────────────────────

/** Who is allied with whom. Used by the combat system to decide valid targets. */
export enum Faction {
  Player = 'Player',
  Enemy = 'Enemy',
  Neutral = 'Neutral',
}

/** Biome IDs - each biome defines its own tile palette, spawn table, and boss. */
export enum BiomeId {
  Grassland = 'Grassland',
  Forest = 'Forest',
  Cave = 'Cave',
  Desert = 'Desert',
  Tundra = 'Tundra',
  Swamp = 'Swamp',
  Volcanic = 'Volcanic',
}

// ─── Component data interfaces ────────────────────────────────────────────────
// Shared between client and server. Import these and cast when calling
// world.getComponent<PositionComponent>(id, 'Position').

export interface PositionComponent {
  x: number;
  y: number;
}

export interface VelocityComponent {
  vx: number;
  vy: number;
}

export interface HealthComponent {
  current: number;
  max: number;
}

export interface FactionComponent {
  faction: Faction;
}

// ─── Network / session types ──────────────────────────────────────────────────

/** A connected player's session info (server-side). */
export interface PlayerSession {
  clientId: string;
  displayName: string;
  entityId: EntityId | null;
  connectedAt: number;
}