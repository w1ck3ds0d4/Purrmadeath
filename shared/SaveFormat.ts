// ─── Save System Data Structures ─────────────────────────────────────────────
// Defines the format for auto-save data (3 host-owned slots per player UUID).

export interface SaveData {
  formatVersion: number;
  seed: number;
  currentWave: number;
  wavePhase?: 'idle' | 'prep' | 'active' | 'cleared';
  prepTimeRemaining?: number;
  warehousePool: { wood: number; stone: number; iron: number; diamond: number; gold: number; food: number };
  spawnOrigin: { x: number; y: number };
  processedChunks: string[];
  enemiesKilled: number;
  elapsedTime: number;
  buildings: SavedBuilding[];
  players: SavedPlayer[];
  enemies?: SavedEnemy[];
  portals?: SavedPortal[];
  resourceNodes?: SavedResourceNode[];
  itemDrops?: SavedItemDrop[];
  /** Session-wide card debuffs from trap cards. */
  cardDebuffs?: {
    playerDamageMult: number; enemySpeedMult: number; enemyDamageMult: number;
    playerStaminaRegenMult?: number; playerMaxHpPenalty?: number; playerAttackSpeedMult?: number;
    enemyKnockbackMult?: number; buildingDamageMult?: number; buildingRegenRate?: number;
    turretCooldownMult?: number; productionIntervalMult?: number;
    lootMultiplier?: number; goldDropMult?: number; guaranteedTitans?: number;
    dodgeCooldownMult?: number;
  };
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
  lightReveal?: {
    range: number;
  };
  healAura?: {
    range: number;
    healPerSecond: number;
  };
  barracksSpawner?: {
    maxGuards: number;
    spawnInterval: number;
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
  /** Player class (defaults to 'warrior' for old saves). */
  playerClass?: string;
  /** Allocated skill node IDs (defaults to empty for old saves). */
  skillNodes?: string[];
  /** Unspent skill points (defaults to 0 for old saves). */
  skillPoints?: number;
  /** Card buff state (defaults to empty for old saves). */
  cardBuffs?: {
    damageMultiplier: number;
    speedMultiplier: number;
    maxHpBonus: number;
    hpRegen: number;
    abilities: string[];
    critChance?: number; critMultiplier?: number; reviveHpBonus?: number;
    defenseBonus?: number; staminaRegenMult?: number; maxStaminaBonus?: number;
    knockbackMult?: number; knockbackResist?: number;
    selfRevives?: number; thornsDamage?: number; pickupRadiusMult?: number;
  };
  /** IDs of cards picked by this player. */
  pickedCards?: string[];
  /** Potion system state. */
  potionState?: {
    equippedPotion: string | null;
    unlockedPotions: string[];
    charges: number;
    maxCharges: number;
  };
}

export interface SavedEnemy {
  x: number;
  y: number;
  variant: string;
  currentHp: number;
  maxHp: number;
  damage: number;
  range: number;
  knockback: number;
  radius: number;
  rangedRange: number;
  projectileSpeed: number;
  rangedDamage: number;
  rangedCooldown: number;
  speedBase: number;
  speedMultiplier: number;
  ghostHidden?: boolean;
}

export interface SavedPortal {
  x: number;
  y: number;
  waveNumber: number;
  currentHp: number;
  maxHp: number;
  spawnTimer: number;
  spawnInterval: number;
}

export interface SavedResourceNode {
  x: number;
  y: number;
  resourceType: string;
  yield: number;
  currentHp: number;
  maxHp: number;
}

export interface SavedItemDrop {
  x: number;
  y: number;
  itemType: string;
  quantity: number;
  autoPickup: boolean;
  lifetime: number;
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
