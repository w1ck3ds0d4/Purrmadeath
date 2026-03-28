/**
 * World constants - resource nodes, item drops, card drops.
 */

// ─── Resource Nodes ─────────────────────────────────────────────────────

/** Collision/render radius of a resource node in world pixels. */
export const RESOURCE_NODE_RADIUS = 14;

/** Flat damage all classes deal to resource nodes (normalizes gathering speed). */
export const GATHERING_DAMAGE = 15;

export const TREE_MAX_HEALTH = 30;
export const TREE_WOOD_YIELD = 5;
export const STONE_MAX_HEALTH = 50;
export const STONE_YIELD = 3;
export const IRON_MAX_HEALTH = 80;
export const IRON_YIELD = 2;
export const DIAMOND_MAX_HEALTH = 120;
export const DIAMOND_YIELD = 1;

/** Chunks around spawn origin to populate with resource nodes. */
export const RESOURCE_SPAWN_RADIUS_CHUNKS = 5;
/** Performance cap on total resource node entities. */
export const MAX_RESOURCE_NODES = 1500;

/** Seconds before a destroyed resource node respawns at its original position. */
export const RESOURCE_RESPAWN_TIME = 120;
/** Extra seconds added randomly (0 to this value) to stagger respawns. */
export const RESOURCE_RESPAWN_JITTER = 30;

// ─── Item Drops ─────────────────────────────────────────────────────────

/** Render radius of an item drop in world pixels. */
export const ITEM_DROP_RADIUS = 8;
/** Seconds before an uncollected item drop despawns. */
export const ITEM_DROP_LIFETIME = 60;
/** Auto-pickup radius in world pixels. */
export const ITEM_DROP_PICKUP_RADIUS = 52;
/** E-interact pickup radius in world pixels. */
export const ITEM_DROP_INTERACT_RADIUS = 40;
/** Initial scatter velocity when an item drop spawns (px/s). */
export const ITEM_DROP_SCATTER_SPEED = 120;
/** Friction decay rate for item drop scatter velocity. */
export const ITEM_DROP_FRICTION = 6;

// ─── Card Drops ─────────────────────────────────────────────────────────

/** Render radius of a card drop in world pixels (larger than item drops). */
export const CARD_DROP_RADIUS = 12;
/** Seconds before an uncollected card drop despawns. */
export const CARD_DROP_LIFETIME = 120;
/** Auto-pickup radius for card drops in world pixels. */
export const CARD_DROP_PICKUP_RADIUS = 32;
