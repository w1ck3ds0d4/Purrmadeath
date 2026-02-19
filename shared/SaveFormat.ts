// ─── Save System Data Structures ─────────────────────────────────────────────
// Defines the format for auto-save data (3 host-owned slots per player UUID).

export interface SaveData {
  formatVersion: number;
  seed: number;
  currentWave: number;
  warehousePool: { wood: number; stone: number; iron: number; diamond: number; gold: number; food: number };
  spawnOrigin: { x: number; y: number };
  processedChunks: string[];
  enemiesKilled: number;
  elapsedTime: number;
  buildings: SavedBuilding[];
  players: SavedPlayer[];
  hostPlayerId: string;
  timestamp: number;
}

export interface SavedBuilding {
  x: number;
  y: number;
  buildingType: string;
  permanent: boolean;
  upgradeLevel: number;
  currentHp: number;
  maxHp: number;
  production?: {
    resourceType: string;
    interval: number;
    timer: number;
    amount: number;
    stored: number;
    maxStored: number;
    secondaryResourceType?: string;
    secondaryChance?: number;
  };
  turret?: {
    range: number;
    cooldown: number;
    damage: number;
    projectileSpeed: number;
  };
  spikeTrap?: {
    damage: number;
    cooldown: number;
    selfDamage: number;
  };
  bridge?: {
    tileX: number;
    tileY: number;
  };
}

export interface SavedPlayer {
  playerId: string;
  displayName: string;
  slot: number;
  resources: { wood: number; stone: number; iron: number; diamond: number; gold: number; food: number };
  hp: number;
  maxHp: number;
  x: number;
  y: number;
}

export interface SaveSlotInfo {
  slot: number;
  exists: boolean;
  wave?: number;
  elapsedTime?: number;
  enemiesKilled?: number;
  playerCount?: number;
  timestamp?: number;
}
