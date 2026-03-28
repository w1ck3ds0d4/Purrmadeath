// ─── Save System Data Structures ─────────────────────────────────────────────
// Defines the format for auto-save data (3 host-owned slots per player UUID).

export interface SaveData {
  formatVersion: number;
  seed: number;
  currentWave: number;
  wavePhase?: 'idle' | 'prep' | 'active' | 'cleared';
  prepTimeRemaining?: number;
  warehousePool: { wood: number; stone: number; iron: number; diamond: number; gold: number; food: number; weapons?: number };
  spawnOrigin: { x: number; y: number };
  processedChunks: string[];
  enemiesKilled: number;
  elapsedTime: number;
  buildings: SavedBuilding[];
  players: SavedPlayer[];
  enemies?: SavedEnemy[];
  portals?: SavedPortal[];
  resourceNodes?: SavedResourceNode[];
  /** Resource nodes waiting to respawn (destroyed but timer not yet expired). */
  resourceRespawnQueue?: { x: number; y: number; type: string; timer: number }[];
  /** Cached resource nodes in unloaded chunks (chunk key -> node states). */
  resourceNodeCache?: Record<string, { x: number; y: number; type: string; hp: number; maxHp: number }[]>;
  /** POI entities currently loaded (saved as entities). */
  pois?: { x: number; y: number; poiType: string; consumed: boolean; buffType?: string }[];
  /** Cached POI data from unloaded chunks. */
  poiCache?: Record<string, { x: number; y: number; poiType: string; consumed: boolean; buffType?: string }[]>;
  /** Chunks that have had POIs generated. */
  processedPOIChunks?: string[];
  itemDrops?: SavedItemDrop[];
  civilians?: SavedCivilian[];
  /** Session-wide card debuffs from trap cards. */
  cardDebuffs?: {
    playerDamageMult: number; enemySpeedMult: number; enemyDamageMult: number;
    playerStaminaRegenMult?: number; playerMaxHpPenalty?: number; playerAttackSpeedMult?: number;
    enemyKnockbackMult?: number; buildingDamageMult?: number; buildingRegenRate?: number;
    turretCooldownMult?: number; productionIntervalMult?: number;
    lootMultiplier?: number; goldDropMult?: number; guaranteedTitans?: number;
    dodgeCooldownMult?: number;
  };
  /** Day/night: remaining day timer (seconds). */
  dayTimeRemaining?: number;
  /** Day/night: permanent night flag (W50 milestone). */
  permanentNight?: boolean;
  heroes?: SavedHero[];
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
  /** Building rotation: 0 = default, 1 = rotated 90 degrees. */
  rotation?: number;
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
  workerSlot?: {
    workerId: number | null;
  };
  housing?: {
    capacity: number;
  };
  teslaCoil?: {
    range: number;
    cooldown: number;
    damage: number;
    chainCount: number;
    chainRange: number;
  };
  flameAura?: {
    range: number;
    dps: number;
    arcRadians: number;
  };
  moat?: {
    slowFactor: number;
  };
  radar?: {
    revealRadius: number;
  };
  repairAura?: {
    repairPerTick: number;
    interval: number;
  };
  teleporter?: {
    pairedId: number | null;
  };
  tavern?: {
    maxHeroes: number;
    roster: string[];
  };
}

export interface SavedPlayer {
  playerId: string;
  displayName: string;
  slot: number;
  resources: { wood: number; stone: number; iron: number; diamond: number; gold: number; food: number; weapons?: number };
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
  /** Ability-to-hotbar-slot assignments [Q, E, R]. */
  slotAssignments?: [string | null, string | null, string | null];
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
  /** Ability cooldowns (abilityId -> seconds remaining). */
  abilityCooldowns?: Record<string, number>;
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

export interface SavedCivilian {
  x: number;
  y: number;
  name: string;
  currentHp: number;
  maxHp: number;
  hunger: number;
  state: string;
  /** Waves spent working at each building type. */
  experience?: Record<string, number>;
  /** Building type the civilian is specialized in, or null. */
  specialty?: string | null;
}

export interface SavedHero {
  x: number;
  y: number;
  heroId: string;
  tavernId: number;
  currentHp: number;
  maxHp: number;
  abilityCooldowns: Record<string, number>;
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
