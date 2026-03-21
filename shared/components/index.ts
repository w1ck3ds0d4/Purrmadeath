// ─── Component Key Constants ───────────────────────────────────────────────────
// Use C.Position instead of the raw string 'Position' everywhere.
// Prevents typos and makes future renames a single-file change.

export const C = {
  Position:        'Position',
  Velocity:        'Velocity',
  Health:          'Health',
  Stamina:         'Stamina',
  Defense:         'Defense',
  Speed:           'Speed',
  PlayerIndex:     'PlayerIndex',
  PlayerInput:     'PlayerInput',
  // ── Phase 4 ──────────────────────────────────────────────────────────────
  Facing:          'Facing',
  Faction:         'Faction',
  AttackCooldown:  'AttackCooldown',
  KnockbackReceiver: 'KnockbackReceiver',
  Projectile:      'Projectile',
  Portal:          'Portal',
  ResourceNode:    'ResourceNode',
  ItemDrop:        'ItemDrop',
  Resources:       'Resources',
  Downed:          'Downed',
  EnemyVariant:    'EnemyVariant',
  // ── Phase 5 ──────────────────────────────────────────────────────────────
  Building:        'Building',
  Production:      'Production',
  Turret:          'Turret',
  SpikeTrap:       'SpikeTrap',
  Bridge:          'Bridge',
  // ── Phase 6 ──────────────────────────────────────────────────────────────
  EnemyStats:      'EnemyStats',
  GhostState:      'GhostState',
  AssassinDash:    'AssassinDash',
  TitanRally:      'TitanRally',
  LightReveal:     'LightReveal',
  HealAura:        'HealAura',
  BarracksSpawner: 'BarracksSpawner',
  Guard:           'Guard',
  // ── Phase 7 ──────────────────────────────────────────────────────────────
  Class:           'Class',
  DodgeRoll:       'DodgeRoll',
  SkillCooldowns:  'SkillCooldowns',
  ActiveBuffs:     'ActiveBuffs',
  BurnDot:         'BurnDot',
  SlowEffect:      'SlowEffect',
  PoisonDot:       'PoisonDot',
  StunEffect:      'StunEffect',
  HolyMark:        'HolyMark',
  ShadowDrain:     'ShadowDrain',
  ArcaneMark:      'ArcaneMark',
  NatureBlessing:  'NatureBlessing',
  StatusEffects:   'StatusEffects',
  // ── Phase 8 ──────────────────────────────────────────────────────────────
  Civilian:        'Civilian',
  Housing:         'Housing',
  WorkerSlot:      'WorkerSlot',
  // ── Phase 10 ─────────────────────────────────────────────────────────────
  Boss:            'Boss',
  Ruins:           'Ruins',
  // ── Building expansion ──────────────────────────────────────────────────
  LaserBeam:       'LaserBeam',
  TrainingCenter:  'TrainingCenter',
  // ── New buildings ─────────────────────────────────────────────────────
  TeslaCoil:       'TeslaCoil',
  FlameAura:       'FlameAura',
  Moat:            'Moat',
  Radar:           'Radar',
  RepairAura:      'RepairAura',
  Teleporter:      'Teleporter',
  Tavern:          'Tavern',
  // ── Achievement buildings ────────────────────────────────────────────
  SiegeAura:       'SiegeAura',
  Kennel:          'Kennel',
  ArcaneAura:      'ArcaneAura',
  WatchAura:       'WatchAura',
  // ── Heroes ────────────────────────────────────────────────────────────
  Hero:            'Hero',
  // ── Ability system ───────────────────────────────────────────────────
  Freeze:          'Freeze',
  Root:            'Root',
  Fear:            'Fear',
  DamageMark:      'DamageMark',
  ShieldAbsorb:    'ShieldAbsorb',
  Stealth:         'Stealth',
  Channel:         'Channel',
  Transform:       'Transform',
  PersistentZone:  'PersistentZone',
  SummonOwner:     'SummonOwner',
  Bleed:           'Bleed',
  SoulMark:        'SoulMark',
  Taunt:           'Taunt',
  MeteorShower:    'MeteorShower',
} as const;

// ─── Component interfaces ──────────────────────────────────────────────────────

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

export interface StaminaComponent {
  current: number;
  max: number;
  regenRate: number;
  /** True after stamina hits 0 while sprinting; cleared when the player releases Sprint. */
  exhausted: boolean;
}

export interface DefenseComponent {
  /** Flat damage subtracted before percent reduction. */
  flat: number;
  /** 0–1 percent damage reduction applied after flat. 0 = no reduction. */
  percent: number;
}

export interface SpeedComponent {
  base: number;
  /** Multiplied by base - modified by buildings/abilities in later phases. */
  multiplier: number;
}

/** Slot index 0–3 - determines player color and spawn order. */
export interface PlayerIndexComponent {
  index: number;
}

/**
 * Transient each-frame input intent - written by InputSystem each tick,
 * consumed by MovementSystem. Reset to 0 when no keys are held.
 */
export interface PlayerInputComponent {
  /** -1 = left, 0 = none, +1 = right */
  dx: number;
  /** -1 = up,   0 = none, +1 = down */
  dy: number;
  /** True while Shift is held and stamina > 0. */
  sprint: boolean;
}

// ── Phase 4 components ────────────────────────────────────────────────────────

/** World-space facing angle in radians. Driven by mouse cursor for players,
 *  velocity direction for enemies. Used for melee arc and directional arrow. */
export interface FacingComponent {
  angle: number;
}

/** Which team an entity belongs to. Determines targetting and rendering. */
export interface FactionComponent {
  type: 'player' | 'enemy' | 'portal' | 'resource' | 'item' | 'building' | 'guard' | 'civilian';
  /** Named enemy faction (e.g. 'bandits', 'undead'). Enemies of different factions fight each other. */
  enemyFaction?: string;
}

/** Tracks remaining cooldown before the entity can attack again. */
export interface AttackCooldownComponent {
  /** Seconds until next attack is allowed. Counts down each tick. */
  remaining: number;
  /** Full cooldown duration reset after each attack. */
  max: number;
}

/**
 * Stores a knockback impulse applied by an attack.
 * Separate from Velocity so that knockback decays independently
 * of movement physics (added on top of movement each frame).
 */
export interface KnockbackReceiverComponent {
  vx: number;
  vy: number;
  /** Knockback resistance 0–1 (card buff). 0 = no resist, 1 = immune. */
  resist?: number;
}

/** Tags an entity as a portal that spawns enemies during a wave. */
export interface PortalComponent {
  /** Which wave this portal belongs to. */
  waveNumber: number;
  /** Seconds until next enemy spawn. */
  spawnTimer: number;
  /** Full spawn interval duration (seconds between enemy spawns). */
  spawnInterval: number;
}

/** Tags an entity as a projectile (arrow, bolt, etc.). */
export interface ProjectileComponent {
  /** Entity ID of the owner who fired this projectile. */
  ownerId: number;
  /** Base damage dealt on hit (before defense reduction). */
  damage: number;
  /** Seconds remaining before the projectile is destroyed. */
  lifetime: number;
  /** If set, projectile deals AOE damage on hit within this radius (cannon turret). */
  aoeRadius?: number;
  /** Mortar target X (cannon turret). When set, projectile flies to target instead of straight-line. */
  targetX?: number;
  /** Mortar target Y (cannon turret). */
  targetY?: number;
  /** Remaining flight time for mortar projectile. Detonates when <= 0. */
  flightTime?: number;
  /** Total flight time (for arc calculation). */
  totalFlightTime?: number;
  /** If true, projectile passes through enemies instead of being destroyed on first hit. */
  pierce?: boolean;
  /** Entity IDs already hit by this piercing projectile (prevents double-hitting). */
  hitEntities?: number[];
  /** If true, projectile homes in on nearest enemy (mage). */
  homing?: boolean;
  /** Per-projectile crit chance from card buffs. */
  critChance?: number;
  /** Per-projectile crit multiplier from card buffs. */
  critMultiplier?: number;
  /** Per-projectile knockback multiplier from card buffs. */
  knockbackMult?: number;
  /** Number of times the projectile can bounce to a new target after hitting. */
  bounceCount?: number;
  /** Max range (px) to search for a bounce target. */
  bounceRange?: number;
  /** Number of child projectiles spawned on hit. */
  splitCount?: number;
  /** Damage dealt by each split child projectile. */
  splitDamage?: number;
  /** Max number of enemies this projectile can pierce through (finite pierce). */
  maxPierces?: number;
  /** Bonus crit damage multiplier vs frozen/slowed targets (frost_crit). */
  frostCritBonus?: number;
  /** Percentage of damage dealt healed back to projectile owner (blood arc). */
  healPercent?: number;
  /** Elemental colors for rendering (e.g., [0xff4400, 0x44aadd]). Client cycles through them. */
  colors?: number[];
  /** Override crit multiplier (e.g., 3.0 for headshot). */
  critMultiplierOverride?: number;
  /** If true, poisoned enemies spread poison on death. */
  toxicSpread?: boolean;
  /** Radius for toxic spread on enemy death. */
  toxicSpreadRadius?: number;
  /** Slow factor applied on hit (0-1, e.g., 0.30 = 30% slow). */
  slowOnHit?: number;
  /** Duration of slow applied on hit (seconds). */
  slowDuration?: number;
  /** Explosion radius for explosive barrage arrows. */
  explosionRadius?: number;
}

// ── Phase 4.8+ components ─────────────────────────────────────────────────────

export type ResourceType = 'wood' | 'stone' | 'iron' | 'diamond';

/** Tags an entity as a harvestable resource node (tree, stone deposit, etc.). */
export interface ResourceNodeComponent {
  resourceType: ResourceType;
  /** How much resource this node yields when destroyed. */
  yield: number;
}

/** Tags an entity as an item drop sitting in the world. */
export interface ItemDropComponent {
  /** Resource type or item ID. For card drops, use 'card:<cardId>'. */
  itemType: string;
  quantity: number;
  /** True = auto-pickup on overlap (resources/cards). False = requires E-interact (equipment). */
  autoPickup: boolean;
  /** Seconds until this drop despawns. */
  lifetime: number;
  /** Grace period before the drop can be picked up (seconds). */
  pickupDelay?: number;
  /** If present, this is a card drop. Stores the card definition ID. */
  cardId?: string;
  /** Rarity of the card (for client rendering). */
  cardRarity?: string;
}

/** Per-player resource counters. Attached to player entities on the server. */
export interface ResourcesComponent {
  wood: number;
  stone: number;
  iron: number;
  diamond: number;
  gold: number;
  food: number;
  weapons: number;
}

// ── Phase 4.11 components ────────────────────────────────────────────────────

// ── Phase 5 components ────────────────────────────────────────────────────

export type BuildingType = 'campfire' | 'wall' | 'warehouse' | 'lumbermill' | 'quarry' | 'mine' | 'farm'
  | 'arrow_turret' | 'cannon_turret' | 'spike_trap' | 'bridge'
  | 'light_tower' | 'healing_shrine' | 'barracks' | 'potion_shop'
  | 'cat_house'
  | 'gate' | 'ballista' | 'laser_tower' | 'workshop' | 'training_center'
  | 'tesla_coil' | 'flame_tower' | 'catapult' | 'moat'
  | 'repair_station' | 'storage_shed' | 'teleporter_pad'
  | 'tavern'
  // Achievement-unlocked buildings
  | 'siege_workshop' | 'kennel' | 'arcane_tower' | 'watchtower';

/** Tags an entity as a player-built (or pre-placed) structure. */
export interface BuildingComponent {
  buildingType: BuildingType;
  /** True = cannot be demolished by players (e.g. Campfire). */
  permanent: boolean;
  /** Upgrade tier: 1 = base, up to BUILDING_MAX_LEVEL[type]. */
  upgradeLevel: number;
  /** Rotation: 0 = default orientation, 1 = rotated 90 degrees (swaps width/height). */
  rotation: number;
}

/** Marks a player as downed (HP reached 0). Present only while in downed state. */
export interface DownedComponent {
  /** Seconds remaining before the player fully dies (bleed-out timer). */
  bleedTimer: number;
  /** Seconds of revive progress accumulated so far. */
  reviveProgress: number;
  /** Entity ID of the teammate currently reviving, or -1 if none. */
  reviverId: number;
}

// ── Production & Defense buildings ──────────────────────────────────────────

/** Passive resource generator attached to lumbermill, mine, or farm. */
export interface ProductionComponent {
  /** Which resource this building generates. */
  resourceType: 'wood' | 'stone' | 'iron' | 'diamond' | 'food' | 'weapons';
  /** Seconds between each production tick. */
  interval: number;
  /** Accumulator - counts up toward `interval`. */
  timer: number;
  /** Amount produced per tick. */
  amount: number;
  /** Resources stored locally (collected with F if no warehouse). */
  stored: number;
  /** Max resources this building can store locally. */
  maxStored: number;
  /** Optional secondary resource (e.g., mine produces iron primarily, diamond rarely). */
  secondaryResourceType?: 'wood' | 'stone' | 'iron' | 'diamond' | 'food';
  /** Chance (0-1) to produce secondary resource instead of primary. */
  secondaryChance?: number;
}

/** Auto-targeting turret that fires projectiles at nearby enemies. */
export interface TurretComponent {
  /** Max targeting range in world pixels. */
  range: number;
  /** Seconds between shots. */
  cooldown: number;
  /** Current cooldown remaining. */
  cooldownTimer: number;
  /** Damage per projectile. */
  damage: number;
  /** Projectile speed in px/s. */
  projectileSpeed: number;
  /** Siege Workshop bonus: extra damage multiplier applied by nearby Siege Workshop. Reset each tick. */
  siegeBonus?: number;
}

/** Damages enemies that walk over it; takes self-damage each trigger. */
export interface SpikeTrapComponent {
  /** Damage dealt to enemies per trigger. */
  damage: number;
  /** Seconds between triggers on the same enemy. */
  cooldown: number;
  /** Damage the trap takes each time it triggers. */
  selfDamage: number;
  /** Per-enemy cooldown tracking: entityId → seconds remaining. */
  enemyCooldowns: Map<number, number>;
}

/** Marks a building as a bridge tile (placed on water, makes tile walkable). */
export interface BridgeComponent {
  /** Tile X coordinate this bridge occupies. */
  tileX: number;
  /** Tile Y coordinate this bridge occupies. */
  tileY: number;
}

// ── Enemy variants ──────────────────────────────────────────────────────────

export type EnemyVariantType = 'melee' | 'ranger' | 'ghost' | 'giant' | 'assassin' | 'titan';

/** Tags an enemy with its variant type. */
export interface EnemyVariantComponent {
  variant: EnemyVariantType;
}

// ── Phase 6 components ──────────────────────────────────────────────────────

/** Per-entity enemy stats (replaces global constants for wave-scaled enemies). */
export interface EnemyStatsComponent {
  damage: number;
  range: number;
  knockback: number;
  radius: number;
  /** Ranged attack range (0 = melee only). */
  rangedRange: number;
  /** Ranged projectile speed. */
  projectileSpeed: number;
  /** Ranged damage. */
  rangedDamage: number;
  /** Ranged cooldown. */
  rangedCooldown: number;
}

/** Ghost visibility state. */
export interface GhostStateComponent {
  hidden: boolean;
}

/** Assassin dash ability state. */
export interface AssassinDashComponent {
  /** Seconds until next dash is allowed. */
  cooldown: number;
  maxCooldown: number;
  dashSpeed: number;
  dashDuration: number;
  dashing: boolean;
  dashTimer: number;
}

/** Titan rally aura state (activates at 50% HP). */
export interface TitanRallyComponent {
  /** Whether the rally aura is currently active. */
  active: boolean;
  /** Range in px that the rally buff affects. */
  range: number;
  /** Speed multiplier applied to rallied enemies. */
  speedBuff: number;
}

/** Player dodge roll state. */
export interface DodgeRollComponent {
  /** Seconds remaining in the dodge (invincible while > 0). */
  timer: number;
  /** Total dodge duration (for animation progress). */
  duration: number;
  /** Dash velocity direction (normalized). */
  dashVx: number;
  dashVy: number;
  /** Seconds remaining before another dodge is allowed. */
  cooldown: number;
}

/** Light tower ghost-reveal aura. */
export interface LightRevealComponent {
  range: number;
}

/** Healing shrine player-heal aura. */
export interface HealAuraComponent {
  range: number;
  healPerSecond: number;
}

/** Barracks guard spawner. */
export interface BarracksSpawnerComponent {
  maxGuards: number;
  spawnTimer: number;
  spawnInterval: number;
  guardIds: number[];
}

/** Tags an entity as a barracks/training center guard or wolf companion. */
export interface GuardComponent {
  barracksId: number;
  patrolRadius: number;
  /** Guard role for training center guards. undefined = generic barracks guard. */
  guardRole?: 'warrior' | 'ranger' | 'mage';
  /** If set, this guard follows a player entity instead of patrolling a fixed point. */
  followEntityId?: number;
  /** Lifetime in seconds. When <= 0 the entity is destroyed. -1 = permanent. */
  lifetime?: number;
  /** Wolf companion variant (for rendering). */
  variant?: 'wolf';
}

/** Laser tower continuous-beam component. */
export interface LaserBeamComponent {
  /** Max targeting range in world pixels. */
  range: number;
  /** Damage dealt per second to the locked target. */
  damagePerSecond: number;
  /** Entity ID of the current target, or null if idle. */
  targetId: number | null;
  /** Internal counter for throttling beam VFX broadcasts. */
  broadcastTimer?: number;
  /** Internal counter for throttling HIT message broadcasts. */
  hitTimer?: number;
}

/** Training center component - trains civilians into role-specific guards. */
export interface TrainingCenterComponent {
  /** Max trained guards this building supports at current level. */
  maxGuards: number;
  /** Entity IDs of guards trained by this building. */
  guardIds: number[];
}

// ── Phase 7 ──────────────────────────────────────────────────────────────────

/** Player class identity (warrior, ranger, mage). */
export interface ClassComponent {
  classType: string;
}

/** Per-player active ability cooldown tracking. */
export interface SkillCooldownsComponent {
  /** abilityId → seconds remaining. */
  cooldowns: Record<string, number>;
}

/** Temporary timed buffs from active abilities (Shield Wall, War Cry, etc.). */
export interface ActiveBuffsComponent {
  buffs: Array<{
    id: string;
    remaining: number;
    effect: Record<string, number>;
  }>;
}

/** Burn damage-over-time applied by pyromancer attacks. */
export interface BurnDotComponent {
  /** Damage per second. */
  dps: number;
  /** Seconds remaining. */
  remaining: number;
  /** Source entity ID (for kill credit). */
  sourceId: number;
}

/** Temporary slow effect applied by frost/trapper attacks. */
export interface SlowEffectComponent {
  /** Speed multiplier reduction (e.g. 0.20 = 20% slower). */
  factor: number;
  /** Seconds remaining. */
  remaining: number;
}

/** Poison damage-over-time (longer duration, lower dps than burn). */
export interface PoisonDotComponent {
  dps: number;
  remaining: number;
  sourceId: number;
}

/** Brief stun effect - prevents movement and attacks. */
export interface StunEffectComponent {
  remaining: number;
  sourceId: number;
}

/** Holy mark - enemies take bonus damage if undead. */
export interface HolyMarkComponent {
  bonusDamage: number;
  remaining: number;
  sourceId: number;
}

/** Shadow drain - heals the attacker on tick. */
export interface ShadowDrainComponent {
  dps: number;
  remaining: number;
  sourceId: number;
}

/** Arcane mark - slows enemy attack speed. */
export interface ArcaneMarkComponent {
  attackSlowFactor: number;
  remaining: number;
}

/** Nature blessing - heals nearby allies in radius. */
export interface NatureBlessingComponent {
  healPerSecond: number;
  radius: number;
  remaining: number;
  sourceId: number;
}

/** Client-side only: bitmask of active status effects for rendering. */
export interface StatusEffectsComponent {
  bitmask: number;
}

// ── Phase 8 components ──────────────────────────────────────────────────────

export type CivilianState = 'idle' | 'working' | 'fleeing' | 'wandering' | 'delivering';

/** Tags an entity as a cat civilian NPC. */
export interface CivilianComponent {
  name: string;
  state: CivilianState;
  /** Entity ID of the production building this civilian is assigned to, or null. */
  assignedBuildingId: number | null;
  /** Hunger level 0–100. At 100, civilian takes starvation damage. */
  hunger: number;
  /** Accumulator counting toward next hunger tick. */
  hungerTimer: number;
  /** Current speech bubble text, or null if none. */
  speechBubble: string | null;
  /** Seconds remaining for the current speech bubble. */
  speechTimer: number;
  /** Resource type being carried to the warehouse, or null. */
  carryResource: string | null;
  /** Amount of resource being carried. */
  carryAmount: number;
  /** Waves spent working at each building type (for specialization). */
  experience: Record<string, number>;
  /** Building type the civilian is specialized in, or null. */
  specialty: string | null;
}

/** Attached to housing buildings (cat_house) and campfire. */
export interface HousingComponent {
  /** Max civilians this building can house. */
  capacity: number;
  /** Entity IDs of civilians currently housed here. */
  residentIds: number[];
}

/** Attached to production buildings - tracks assigned worker. */
export interface WorkerSlotComponent {
  /** Entity ID of the assigned civilian worker, or null if unoccupied. */
  workerId: number | null;
}

// ── Building Ruins ────────────────────────────────────────────────────────────

/** Tags a destroyed building as ruins that can be repaired. */
export interface RuinsComponent {
  /** Original building type before destruction. */
  originalType: BuildingType;
  /** Upgrade level the building was at when destroyed. */
  originalLevel: number;
  /** Seconds remaining for the burning phase (visual fire). */
  burnTimer: number;
  /** Seconds remaining before ruins crumble and disappear. */
  decayTimer: number;
}

// ── Phase 10: Boss System ────────────────────────────────────────────────────

/** Tags an enemy entity as a boss with special mechanics. */
export interface BossComponent {
  bossId: string;
  /** Current phase index (0-based). */
  phaseIndex: number;
  /** Per-ability cooldown timers keyed by ability id. */
  abilityCooldowns: Record<string, number>;
  /** True when HP drops below enrage threshold (legacy compat + speed boost applied). */
  enraged: boolean;
  /** Cooldown timer for boss special attack (seconds) - legacy, use abilityCooldowns. */
  specialCooldown: number;
  /** Bone shield HP remaining (Necromancer). */
  boneShieldHp?: number;
  /** Bone shield regen timer (seconds until it regenerates). */
  boneShieldRegen?: number;
  /** Whether boss is currently burrowed (Broodmother). */
  burrowed?: boolean;
  /** Burrow timer - time remaining underground. */
  burrowTimer?: number;
  /** Shatter flag - Ancient Golem phase 3 on-hit shards. */
  shatterActive?: boolean;
  /** Fire trail timer - tracks last trail drop position. */
  lastTrailX?: number;
  lastTrailY?: number;
  /** Blizzard channel timer (Frost Warden). */
  channelTimer?: number;
  /** Whether currently channeling. */
  channeling?: boolean;
}

// ── New Building Components ─────────────────────────────────────────────────

/** Tesla coil - chain lightning defense tower. */
export interface TeslaCoilComponent {
  range: number;
  cooldown: number;
  cooldownTimer: number;
  damage: number;
  /** Number of enemies the chain arcs to after the primary target. */
  chainCount: number;
  /** Max distance (px) for chain arc between enemies. */
  chainRange: number;
}

/** Flame tower - continuous cone AOE fire damage. */
export interface FlameAuraComponent {
  range: number;
  dps: number;
  /** Cone half-angle in radians. */
  arcRadians: number;
  /** Current facing direction (auto-rotates to nearest enemy). */
  facing: number;
}

/** Moat - ground tile that slows enemies walking over it. */
export interface MoatComponent {
  slowFactor: number;
}

/** Radar tower - extends minimap reveal radius for all players. */
export interface RadarComponent {
  revealRadius: number;
}

/** Repair station - worker-staffed building that repairs damaged buildings. */
export interface RepairAuraComponent {
  repairPerTick: number;
  interval: number;
  timer: number;
}

/** Teleporter pad - paired with another pad for instant player transport. */
export interface TeleporterComponent {
  /** Entity ID of the paired teleporter, or null if unpaired. */
  pairedId: number | null;
}

/** Tavern - allows hiring hero NPCs. */
export interface TavernComponent {
  /** Max active heroes this tavern supports at its current level. */
  maxHeroes: number;
  /** Entity IDs of currently active heroes hired from this tavern. */
  heroIds: number[];
  /** Available hero definition IDs in this tavern's roster. */
  roster: string[];
}

// ── Achievement Building Components ─────────────────────────────────────────

/** Siege Workshop - buffs all turret damage within range. */
export interface SiegeAuraComponent {
  /** Buff radius in world pixels. */
  range: number;
  /** Damage multiplier applied to turrets in range (e.g., 0.25 = +25%). */
  damageBonus: number;
}

/** Kennel - auto-spawns wolf guard entities on a timer. */
export interface KennelComponent {
  /** Seconds between wolf spawns. */
  spawnInterval: number;
  /** Current spawn timer countdown. */
  spawnTimer: number;
  /** Max wolves this kennel can have alive simultaneously. */
  maxWolves: number;
  /** Entity IDs of currently alive wolves from this kennel. */
  wolfIds: number[];
}

/** Arcane Tower - amplifies player ability range when nearby. */
export interface ArcaneAuraComponent {
  /** Buff radius in world pixels. */
  range: number;
  /** Ability range multiplier (e.g., 0.50 = +50%). */
  rangeBonus: number;
}

/** Watchtower - extends minimap reveal radius and gives early wave warnings. */
export interface WatchAuraComponent {
  /** Reveal radius in world pixels (added to base minimap range). */
  revealRadius: number;
  /** Seconds of advance warning before wave starts. */
  warningTime: number;
}

// ── Ability System Components ────────────────────────────────────────────────

/** Freeze effect - entity is completely immobilized. */
export interface FreezeComponent { remaining: number; breaksOnDamage: boolean; }

/** Root effect - entity cannot move but can still attack. */
export interface RootComponent { remaining: number; }

/** Fear effect - entity flees away from the source position. */
export interface FearComponent { remaining: number; sourceX: number; sourceY: number; }

/** Damage mark - delayed damage that detonates after a duration. */
export interface DamageMarkComponent { remaining: number; damage: number; sourceId: number; }

/** Shield absorb - absorbs incoming damage until depleted or expired. */
export interface ShieldAbsorbComponent { remaining: number; amount: number; }

/** Stealth - entity is invisible; next attack deals bonus damage. */
export interface StealthComponent { remaining: number; nextAttackMultiplier: number; }

/** Channel - entity is channeling an ability over time. */
export interface ChannelComponent { abilityId: string; remaining: number; tickDamage: number; radius: number; }

/** Transform - entity is in a transformed state with stat bonuses. */
export interface TransformComponent { remaining: number; speedBonus: number; damageBonus: number; defenseBonus: number; }

/** Persistent zone - area effect that persists on the ground. */
export interface PersistentZoneComponent { x: number; y: number; radius: number; remaining: number; dps: number; healPerSec: number; ownerId: number; }

/** Summon owner - tags a summoned entity with its owner and expiry. */
export interface SummonOwnerComponent { ownerId: number; expireTime: number; }

/** Stacking bleed damage over time. */
export interface BleedComponent { dps: number; remaining: number; stacks: number; maxStacks: number; sourceId: number; }

/** Damage amplification debuff - target takes bonus damage from all sources. */
export interface SoulMarkComponent { damageAmp: number; remaining: number; sourceId: number; }

/** Taunt - forces enemy to attack the source player. */
export interface TauntComponent { sourceId: number; remaining: number; }

/** Meteor shower zone - spawns individual meteor impacts over time. */
export interface MeteorShowerComponent {
  x: number; y: number;
  radius: number;
  remaining: number;
  meteorTimer: number;
  meteorInterval: number;
  damagePerMeteor: number;
  impactRadius: number;
  ownerId: number;
}

/** Tags an entity as a hired hero NPC. */
export interface HeroComponent {
  /** Hero definition ID (e.g. 'knight', 'wizard'). */
  heroId: string;
  /** Entity ID of the tavern this hero was hired from. */
  tavernId: number;
  /** Patrol radius around campfire (px). */
  patrolRadius: number;
  /** Per-ability cooldown timers keyed by ability id. */
  abilityCooldowns: Record<string, number>;
}