/**
 * Renders all visible entities in world space: players, enemies, portals, resource
 * nodes, item drops, buildings, guards, and civilians. Each entity is drawn as colored
 * geometric shapes (circles, rectangles) with overlays for status effects, hit flashes,
 * attack arcs, health bars, production tags, and building icons.
 *
 * Uses a dirty-flag system to skip expensive geometry rebuilds when only position changed.
 * Viewport culling skips off-screen entities entirely.
 */
import { Container, Graphics, Text } from 'pixi.js';
import { World, EntityId } from '@shared/ecs/World';
import {
  C,
  PositionComponent,
  PlayerIndexComponent,
  FactionComponent,
  HealthComponent,
  ResourceNodeComponent,
  ItemDropComponent,
  BuildingComponent,
  ProductionComponent,
  EnemyVariantComponent,
  GhostStateComponent,
  EnemyStatsComponent,
  DodgeRollComponent,
  StatusEffectsComponent,
  BossComponent,
  RuinsComponent,
  GuardComponent,
} from '@shared/components';
import { PLAYER_RADIUS, PLAYER_COLORS, MELEE_RANGE, MELEE_ARC, ENEMY_MELEE_RANGE, PORTAL_RADIUS, RESOURCE_NODE_RADIUS, ITEM_DROP_RADIUS, CARD_DROP_RADIUS, buildingHalfExtent, buildingExtent, buildingExclusionExtent, ARROW_TURRET_RANGE, CANNON_TURRET_RANGE, BALLISTA_RANGE, UPGRADE_LIGHT_RANGE, UPGRADE_LASER_RANGE, UPGRADE_HEAL_RANGE, TESLA_COIL_RANGE, UPGRADE_FLAME_RANGE, CATAPULT_RANGE, STATUS_BURN, STATUS_POISON, STATUS_SLOW, STATUS_STUN, STATUS_HOLY, STATUS_SHADOW, STATUS_ARCANE, STATUS_NATURE } from '@shared/constants';
import { FACTION_COLORS, type EnemyFaction } from '@shared/definitions/EnemyVariants';

/** Turret type → base range in pixels. */
const TURRET_RANGES: Record<string, number> = {
  arrow_turret: ARROW_TURRET_RANGE,
  cannon_turret: CANNON_TURRET_RANGE,
  ballista: BALLISTA_RANGE,
  laser_tower: UPGRADE_LASER_RANGE[0],
  tesla_coil: TESLA_COIL_RANGE,
  flame_tower: UPGRADE_FLAME_RANGE[0],
  catapult: CATAPULT_RANGE,
};

/** Building type → range color for the selection indicator. */
const RANGE_COLORS: Record<string, number> = {
  arrow_turret: 0x44aaff,
  cannon_turret: 0x44aaff,
  ballista: 0x44aaff,
  laser_tower: 0xff4444,
  light_tower: 0xffdd44,
  healing_shrine: 0x44ff88,
  tesla_coil: 0x66ddff,
  flame_tower: 0xff6622,
  catapult: 0xcc8844,
};

// Enemy body colors by variant
const ENEMY_COLOR = 0xcc3333;          // melee (default)
const ENEMY_RANGER_COLOR = 0xdd7722;   // ranger
const ENEMY_GHOST_COLOR = 0x44cccc;    // ghost (teal/cyan)
const ENEMY_GIANT_COLOR = 0x664422;    // giant (dark brown)
const ENEMY_ASSASSIN_COLOR = 0xcc44cc; // assassin (purple-pink)
const ENEMY_TITAN_COLOR = 0xaa2200;    // titan (dark crimson)
// Portal colors
const PORTAL_OUTER_COLOR = 0x9933ff;
const PORTAL_CORE_COLOR  = 0x6600cc;
// Resource node colors by type
const RESOURCE_COLORS: Record<string, { body: number; core: number }> = {
  wood:    { body: 0x2d8a4e, core: 0x6b3a1f },
  stone:   { body: 0x888888, core: 0x555555 },
  iron:    { body: 0x8a5a3a, core: 0xbbaa88 },
  diamond: { body: 0x44ccdd, core: 0x88eeff },
};
// Item drop colors by type
const ITEM_DROP_COLORS: Record<string, number> = {
  wood:    0x8a6a3a,
  stone:   0x888888,
  iron:    0x8a5a3a,
  diamond: 0x44ccdd,
  gold:    0xe0c030,
};
// Card rarity colors
const CARD_RARITY_COLORS: Record<string, number> = {
  common:    0xb4b4b4,
  rare:      0x4a90d9,
  epic:      0xaa44ff,
  legendary: 0xe8c96a,
};
// Building colors by type
const BUILDING_COLORS: Record<string, { body: number; border: number }> = {
  campfire:       { body: 0xcc5500, border: 0xff8800 },
  wall:           { body: 0x8a8a8a, border: 0xbbbbbb },
  warehouse:      { body: 0x8a6a3a, border: 0xc49a4a },
  lumbermill:     { body: 0x5a8a3a, border: 0x7aaa5a },
  quarry:         { body: 0x6a6a7a, border: 0x9a9aaa },
  mine:           { body: 0x4a3a2a, border: 0x7a5a3a },
  farm:           { body: 0x8aaa4a, border: 0xaacc6a },
  arrow_turret:   { body: 0x7a7a9a, border: 0xaaaacc },
  cannon_turret:  { body: 0x5a5a6a, border: 0x8888aa },
  spike_trap:     { body: 0x8a3a3a, border: 0xcc5555 },
  bridge:         { body: 0x8a6a3a, border: 0xaa8a5a },
  light_tower:    { body: 0xeedd44, border: 0xccbb22 },
  healing_shrine: { body: 0x44cc66, border: 0x228844 },
  barracks:       { body: 0x886644, border: 0x664422 },
  potion_shop:    { body: 0x9944aa, border: 0x772288 },
  cat_house:      { body: 0xc49a4a, border: 0xa07a30 },
  ballista:       { body: 0x6a5a4a, border: 0x9a8a6a },
  laser_tower:    { body: 0xcc3333, border: 0xee5555 },
  gate:           { body: 0x8a7a5a, border: 0xaa9a7a },
  workshop:       { body: 0x7a6a4a, border: 0xaa9a6a },
  training_center:{ body: 0x5a6a8a, border: 0x7a8aaa },
  tesla_coil:     { body: 0x4488ff, border: 0x66aaff },
  flame_tower:    { body: 0xff6622, border: 0xff8844 },
  catapult:       { body: 0x886644, border: 0xaa8866 },
  moat:           { body: 0x3366aa, border: 0x5588cc },
  repair_station: { body: 0x44aa44, border: 0x66cc66 },
  teleporter_pad: { body: 0xaa44ff, border: 0xcc66ff },
  tavern:         { body: 0xccaa44, border: 0xeecc66 },
  storage_shed:   { body: 0x8a7a5a, border: 0xaa9a7a },
};
// Production resource tag colors
const PRODUCTION_TAG_COLORS: Record<string, number> = {
  wood:  0x8a6a3a,
  stone: 0x888888,
  iron:  0x8a5a3a,
  diamond: 0x44ccdd,
  food:  0x44aa44,
  weapons: 0xaa6644,
};
// Duration of the white hit-flash in seconds
const HIT_FLASH_DURATION = 0.15;
// Duration of the attack arc animation in seconds
const ARC_DURATION = 0.3;
// Facing triangle dimensions (local player only)
const TRI_DIST = PLAYER_RADIUS + 2; // center of triangle from entity center
const TRI_SIZE = 6;                 // half-width of triangle base
// Health bar dimensions
const BAR_W = PLAYER_RADIUS * 2 + 4;
const BAR_H = 4;
const BAR_Y = -(PLAYER_RADIUS + 10); // above the entity circle

/** Linear interpolation between two packed RGB hex colors. */
function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  const r  = Math.round(ar + (br - ar) * t);
  const g  = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}
function darkenColor(c: number, amount: number): number { return lerpColor(c, 0x000000, amount); }
function lightenColor(c: number, amount: number): number { return lerpColor(c, 0xffffff, amount); }

/**
 * Draws all visible entities (players and enemies) as colored circles
 * with directional arrows, health bars (enemies), and attack arc animations.
 *
 * Local player:   arrow always points toward the mouse cursor.
 * Remote players: arrow points in velocity direction (hidden when still).
 * Enemies:        red circle, arrow points in velocity direction, health bar above.
 *
 * Phase 9: replace with sprite atlas.
 */
export class PlayerRendererSystem {
  private sprites     = new Map<EntityId, Graphics>();
  private hitTimers   = new Map<EntityId, number>();  // remaining flash seconds
  private attackArcs  = new Map<EntityId, { facing: number; elapsed: number; range?: number }>();
  private downedEntities = new Set<EntityId>();
  private reviveProgress = new Map<EntityId, number>(); // entityId → 0..1
  private bossLabels = new Map<EntityId, Text>();
  /** Currently selected building entity ID (for highlight rendering). */
  selectedBuildingId: number | null = null;
  /** Dedicated layer for all health bars - renders above entities/buildings. */
  private healthBarGfx: Graphics;
  /** Production building resource tags (Text objects managed per-entity). */
  private productionTags = new Map<EntityId, { bg: Graphics; text: Text }>();
  private housingTags = new Map<EntityId, { bg: Graphics; text: Text }>();
  civilianSpawn?: { nextSpawnSeconds: number; population: number; capacity: number };
  private civilianTags = new Map<EntityId, { bg: Graphics; text: Text }>();
  private speechBubbles = new Map<EntityId, { bg: Graphics; text: Text }>();
  private tagContainer: Container;
  /** Per-entity dirty flags: true when geometry needs rebuild, false when just position update suffices. */
  private dirty = new Map<EntityId, boolean>();
  // Reusable entity classification sets (cleared and refilled each frame to avoid GC pressure)
  private _playerIds   = new Set<EntityId>();
  private _enemyIds    = new Set<EntityId>();
  private _portalIds   = new Set<EntityId>();
  private _resourceIds = new Set<EntityId>();
  private _itemIds     = new Set<EntityId>();
  private _buildingIds = new Set<EntityId>();
  private _guardIds    = new Set<EntityId>();
  private _civilianIds = new Set<EntityId>();
  private _living      = new Set<EntityId>();
  /** Per-entity: was entity flashing last frame? */
  private wasFlashing = new Map<EntityId, boolean>();
  /** Per-entity: was ghost hidden last frame? */
  private wasGhostHidden = new Map<EntityId, boolean>();
  /** Per-entity: was entity downed last frame? */
  private wasDowned = new Map<EntityId, boolean>();
  /** Per-entity: last revive progress value. */
  private lastReviveProg = new Map<EntityId, number>();
  /** Per-entity: was entity dodging last frame? */
  private wasDodging = new Map<EntityId, boolean>();
  /** Last selected building ID (to detect selection changes). */
  private lastSelectedId: number | null = null;

  constructor(private readonly worldContainer: Container) {
    this.healthBarGfx = new Graphics();
    this.healthBarGfx.zIndex = 9; // above entities, below projectiles (10)
    this.worldContainer.addChild(this.healthBarGfx);

    this.tagContainer = new Container();
    this.tagContainer.zIndex = 9;
    this.worldContainer.addChild(this.tagContainer);
  }

  /** Triggers a 150ms white flash on the struck entity. */
  notifyHit(entityId: EntityId): void {
    this.hitTimers.set(entityId, HIT_FLASH_DURATION);
  }

  /** Triggers a sword-arc animation (220ms) originating from the attacker. */
  notifyAttack(entityId: EntityId, facing: number, rangeOverride?: number): void {
    this.attackArcs.set(entityId, { facing, elapsed: 0, range: rangeOverride });
  }

  /** Mark a player entity as downed (dark tint, X overlay). */
  notifyDowned(entityId: EntityId): void {
    this.downedEntities.add(entityId);
  }

  /** Update revive progress bar for a downed entity (0 = none, 0..1 = bar). */
  notifyReviveProgress(entityId: EntityId, progress: number): void {
    if (progress <= 0) {
      this.reviveProgress.delete(entityId);
    } else {
      this.reviveProgress.set(entityId, progress);
    }
  }

  /** Clear downed state for a revived player. */
  notifyRevived(entityId: EntityId): void {
    this.downedEntities.delete(entityId);
    this.reviveProgress.delete(entityId);
  }

  /** Clear downed state on full death. */
  notifyDeath(entityId: EntityId): void {
    this.downedEntities.delete(entityId);
    this.reviveProgress.delete(entityId);
  }

  /** Clear downed state on respawn. */
  notifyRespawned(entityId: EntityId): void {
    this.downedEntities.delete(entityId);
    this.reviveProgress.delete(entityId);
  }

  /**
   * @param localEntityId  ECS id of the local player (null = not yet spawned).
   * @param localFacing    World-space angle (radians) from local player to mouse.
   * @param dt             Frame delta in seconds (for animation timers).
   */
  update(
    world: World,
    localEntityId: number | null = null,
    localFacing: number | null = null,
    dt = 0,
    smoothX = 0,
    smoothY = 0,
    cameraX = 0,
    cameraY = 0,
    zoom = 1,
    screenW = 1920,
    screenH = 1080,
  ): void {
    // Viewport culling bounds (world-space)
    const cullHalfW = screenW / (2 * zoom) + 200; // 200px margin for large entities
    const cullHalfH = screenH / (2 * zoom) + 200;
    // -- Entity Classification --
    // Classify all entities into type buckets. Reuse class-level Sets to avoid per-frame GC.
    const playerIds = this._playerIds;    playerIds.clear();
    const enemyIds = this._enemyIds;      enemyIds.clear();
    const portalIds = this._portalIds;    portalIds.clear();
    const resourceIds = this._resourceIds; resourceIds.clear();
    const itemIds = this._itemIds;        itemIds.clear();
    const buildingIds = this._buildingIds; buildingIds.clear();
    const guardIds = this._guardIds;      guardIds.clear();
    const civilianIds = this._civilianIds; civilianIds.clear();
    const living = this._living;          living.clear();

    for (const id of world.query(C.Position, C.PlayerIndex)) {
      playerIds.add(id);
      living.add(id);
    }
    for (const id of world.query(C.Position, C.Faction)) {
      const f = world.getComponent<FactionComponent>(id, C.Faction)!;
      if (f.type === 'enemy') { enemyIds.add(id); living.add(id); }
      else if (f.type === 'portal') { portalIds.add(id); living.add(id); }
      else if (f.type === 'resource') { resourceIds.add(id); living.add(id); }
      else if (f.type === 'item') { itemIds.add(id); living.add(id); }
      else if (f.type === 'building') { buildingIds.add(id); living.add(id); }
      else if (f.type === 'guard') { guardIds.add(id); living.add(id); }
      else if (f.type === 'civilian') { civilianIds.add(id); living.add(id); }
    }

    // -- Sprite Cleanup --
    // Remove sprites for entities that no longer exist; clean up all timers
    for (const [id, gfx] of this.sprites) {
      if (!living.has(id)) {
        this.worldContainer.removeChild(gfx);
        gfx.destroy();
        this.sprites.delete(id);
        this.hitTimers.delete(id);
        this.attackArcs.delete(id);
        this.dirty.delete(id);
        this.wasFlashing.delete(id);
        this.wasGhostHidden.delete(id);
        this.wasDowned.delete(id);
        this.wasDodging.delete(id);
        this.lastReviveProg.delete(id);
        const bossLabel = this.bossLabels.get(id);
        if (bossLabel) {
          this.worldContainer.removeChild(bossLabel);
          bossLabel.destroy();
          this.bossLabels.delete(id);
        }
      }
    }

    // Detect selection change (marks old and new selected buildings as dirty)
    if (this.selectedBuildingId !== this.lastSelectedId) {
      // Reset old selection zIndex
      if (this.lastSelectedId !== null) {
        this.dirty.set(this.lastSelectedId, true);
        const oldGfx = this.sprites.get(this.lastSelectedId);
        if (oldGfx) oldGfx.zIndex = 0;
      }
      // Raise new selection zIndex above other buildings
      if (this.selectedBuildingId !== null) {
        this.dirty.set(this.selectedBuildingId, true);
        const newGfx = this.sprites.get(this.selectedBuildingId);
        if (newGfx) newGfx.zIndex = 5;
      }
      this.lastSelectedId = this.selectedBuildingId;
    }

    for (const id of living) {
      const pos     = world.getComponent<PositionComponent>(id, C.Position)!;
      const pIdx    = world.getComponent<PlayerIndexComponent>(id, C.PlayerIndex);
      const hp      = world.getComponent<HealthComponent>(id, C.Health);
      const isEnemy    = enemyIds.has(id);
      const isPortal   = portalIds.has(id);
      const isResource = resourceIds.has(id);
      const isItem     = itemIds.has(id);

      let isNew = false;
      if (!this.sprites.has(id)) {
        const gfx = new Graphics();
        this.worldContainer.addChild(gfx);
        this.sprites.set(id, gfx);
        isNew = true;
      }

      const gfx = this.sprites.get(id)!;

      // ── Viewport culling: skip drawing off-screen entities ────────────────
      const isLocal = id === localEntityId;
      const offScreen = !isLocal &&
        (pos.x < cameraX - cullHalfW || pos.x > cameraX + cullHalfW ||
         pos.y < cameraY - cullHalfH || pos.y > cameraY + cullHalfH);
      if (offScreen) {
        gfx.visible = false;
        continue;
      }
      // Force redraw if entity was hidden (off-screen) and is now visible
      if (!gfx.visible || isNew) {
        this.dirty.set(id, true);
      }
      gfx.visible = true;

      // ── Timers ────────────────────────────────────────────────────────────────

      // Tick down hit flash
      const flashRemaining = this.hitTimers.get(id) ?? 0;
      if (flashRemaining > 0) this.hitTimers.set(id, Math.max(0, flashRemaining - dt));
      const flashT = Math.min(1, flashRemaining / HIT_FLASH_DURATION); // 1 → 0

      // -- Dirty Flag System --
      // Only rebuild geometry when visual state actually changed (flash, downed, dodge, etc.)
      // Position-only updates just move the Graphics object without clearing/redrawing.
      const isFlashing = flashT > 0;
      const prevFlashing = this.wasFlashing.get(id) ?? false;
      const hasArc = this.attackArcs.has(id);
      const isDowned = this.downedEntities.has(id) || world.hasComponent(id, C.Downed);
      const prevDowned = this.wasDowned.get(id) ?? false;
      const revProg = this.reviveProgress.get(id) ?? -1;
      const prevRevProg = this.lastReviveProg.get(id) ?? -1;

      // Always-animated entities need per-frame redraw
      const hasBurningRuins = buildingIds.has(id) && world.getComponent<RuinsComponent>(id, C.Ruins)?.burnTimer! > 0;
      const alwaysAnimated = isPortal || isItem || civilianIds.has(id) || id === localEntityId || this.selectedBuildingId === id || hasBurningRuins;

      let needsRedraw = isNew || alwaysAnimated
        || isFlashing || prevFlashing !== isFlashing
        || hasArc
        || isDowned !== prevDowned
        || revProg !== prevRevProg
        || this.dirty.get(id) === true;

      // Ghost visibility change
      if (isEnemy) {
        const gs = world.getComponent<GhostStateComponent>(id, C.GhostState);
        const hidden = gs?.hidden ?? false;
        const prevHidden = this.wasGhostHidden.get(id) ?? false;
        if (hidden !== prevHidden) needsRedraw = true;
        this.wasGhostHidden.set(id, hidden);
      }

      // Dodge roll visual change
      const dodgeRoll = world.getComponent<DodgeRollComponent>(id, C.DodgeRoll);
      const isDodging = dodgeRoll != null && dodgeRoll.timer > 0;
      const prevDodging = this.wasDodging.get(id) ?? false;
      if (isDodging !== prevDodging) needsRedraw = true;
      this.wasDodging.set(id, isDodging);

      // Update tracking state
      this.wasFlashing.set(id, isFlashing);
      this.wasDowned.set(id, isDowned);
      this.lastReviveProg.set(id, revProg);
      this.dirty.delete(id);

      if (!needsRedraw) {
        // Just update position - skip expensive geometry rebuild
        if (id === localEntityId) {
          gfx.position.set(pos.x + smoothX, pos.y + smoothY);
        } else {
          gfx.position.set(pos.x, pos.y);
        }
        continue;
      }

      gfx.clear();

      if (isPortal) {
        // -- Portal Rendering --
        // Pulsing faction-colored glow ring with dark core. Color tinted by enemy faction.
        const pr = PORTAL_RADIUS;
        const portalFactionComp = world.getComponent<FactionComponent>(id, C.Faction);
        const portalFaction = (portalFactionComp?.enemyFaction as EnemyFaction | undefined);
        const factionColor = portalFaction ? (FACTION_COLORS[portalFaction] ?? PORTAL_OUTER_COLOR) : PORTAL_OUTER_COLOR;
        const coreColor = darkenColor(factionColor, 0.45);
        const rimColor = lightenColor(factionColor, 0.3);

        // Pulsing glow ring
        const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 400);
        const glowColor = flashT > 0 ? lerpColor(factionColor, 0xffffff, flashT * 0.6) : factionColor;

        // Large ambient glow (visible in dark)
        gfx.circle(0, 0, pr + 20);
        gfx.fill({ color: factionColor, alpha: 0.08 * pulse });

        // Outer glow ring
        gfx.circle(0, 0, pr + 6);
        gfx.fill({ color: glowColor, alpha: 0.18 * pulse });

        // Main body
        gfx.circle(0, 0, pr);
        gfx.fill({ color: glowColor, alpha: 0.7 });

        // Darker core
        gfx.circle(0, 0, pr * 0.5);
        gfx.fill({ color: coreColor, alpha: 0.9 });

        // Outline
        gfx.circle(0, 0, pr);
        gfx.stroke({ color: rimColor, alpha: 0.6 * pulse, width: 2 });

      } else if (isResource) {
        // ── Resource node rendering ──────────────────────────────────────────
        const rn = world.getComponent<ResourceNodeComponent>(id, C.ResourceNode);
        const resType = rn?.resourceType ?? 'wood';
        const colors = RESOURCE_COLORS[resType] ?? RESOURCE_COLORS.wood;
        const rr = RESOURCE_NODE_RADIUS;

        // Tick down hit flash
        const rFlash = this.hitTimers.get(id) ?? 0;
        if (rFlash > 0) this.hitTimers.set(id, Math.max(0, rFlash - dt));
        const rFlashT = Math.min(1, rFlash / HIT_FLASH_DURATION);
        const bodyColor = rFlashT > 0 ? lerpColor(colors.body, 0xffffff, rFlashT * 0.6) : colors.body;

        // Outer body (square)
        gfx.rect(-rr, -rr, rr * 2, rr * 2);
        gfx.fill({ color: bodyColor, alpha: 0.9 });

        // Inner core (square)
        const cr = rr * 0.45;
        gfx.rect(-cr, -cr, cr * 2, cr * 2);
        gfx.fill({ color: colors.core, alpha: 0.8 });

        // Outline (square)
        gfx.rect(-rr, -rr, rr * 2, rr * 2);
        gfx.stroke({ color: 0x000000, alpha: 0.35, width: 1.5 });


      } else if (buildingIds.has(id)) {
        // -- Building Rendering --
        // Each building type has a unique icon drawn inside a colored rectangle.
        // Selection shows pulsing yellow border + turret range circle.
        const bldg = world.getComponent<BuildingComponent>(id, C.Building);
        const bType = bldg?.buildingType ?? 'wall';
        const bColors = BUILDING_COLORS[bType] ?? BUILDING_COLORS.wall;
        const bRot = bldg?.rotation ?? 0;
        const { hx: bHx, hy: bHy } = buildingExtent(bType, bRot);
        // All buildings render below entities so ghosts/players appear on top
        gfx.zIndex = bType === 'bridge' ? -9 : -5;

        const bFlash = this.hitTimers.get(id) ?? 0;
        if (bFlash > 0) this.hitTimers.set(id, Math.max(0, bFlash - dt));
        const bFlashT = Math.min(1, bFlash / HIT_FLASH_DURATION);
        const bodyColor = bFlashT > 0 ? lerpColor(bColors.body, 0xffffff, bFlashT * 0.6) : bColors.body;
        const borderColor = bFlashT > 0 ? lerpColor(bColors.border, 0xffffff, bFlashT * 0.4) : bColors.border;

        // Thick border width scales with building size
        const borderW = bType === 'wall' ? 2.5 : 4;

        if (bType === 'wall' || bType === 'gate') {
          // Walls/gates: visual upgrade tiers
          const wLvl = bldg?.upgradeLevel ?? 1;
          const wallBody = bType === 'gate' ? 0x997755 : (wLvl >= 2 ? 0xcccccc : 0x8a8a8a);
          const wallFill = bFlashT > 0 ? lerpColor(wallBody, 0xffffff, bFlashT * 0.6) : wallBody;
          gfx.rect(-bHx, -bHy, bHx * 2, bHy * 2);
          gfx.fill({ color: wallFill, alpha: 0.95 });
          if (bType === 'wall' && wLvl >= 3) {
            // Reinforced iron: grey diagonal lines
            for (let i = -1; i <= 1; i++) {
              const off = i * 8;
              gfx.moveTo(-bHx + Math.max(0, off), -bHy + Math.max(0, -off));
              gfx.lineTo(bHx + Math.min(0, off), bHy + Math.min(0, -off));
            }
            gfx.stroke({ color: 0x888888, alpha: 0.5, width: 1 });
          }
          gfx.rect(-bHx, -bHy, bHx * 2, bHy * 2);
          gfx.stroke({ color: 0x000000, alpha: 0.75, width: 1.5 });
        } else {
          // All other buildings: inset padding + black border
          const pad = 3;
          gfx.rect(-bHx + pad, -bHy + pad, (bHx - pad) * 2, (bHy - pad) * 2);
          gfx.fill({ color: bodyColor, alpha: 0.95 });
          gfx.rect(-bHx + pad, -bHy + pad, (bHx - pad) * 2, (bHy - pad) * 2);
          gfx.stroke({ color: 0x000000, alpha: 0.75, width: 1.5 });
        }

        // Campfire: flame icon
        if (bType === 'campfire') {
          gfx.circle(0, 0, 5);
          gfx.fill({ color: 0xffcc00, alpha: 0.85 });
        }

        // Warehouse: inner crate outline + cross
        if (bType === 'warehouse') {
          const ih = 10;
          gfx.rect(-ih, -ih, ih * 2, ih * 2);
          gfx.stroke({ color: 0xffeedd, alpha: 0.6, width: 2 });
          gfx.moveTo(-ih, 0); gfx.lineTo(ih, 0);
          gfx.moveTo(0, -ih); gfx.lineTo(0, ih);
          gfx.stroke({ color: 0xffeedd, alpha: 0.4, width: 1.5 });
        }

        // Lumbermill: X cross
        if (bType === 'lumbermill') {
          const ih = 8;
          gfx.moveTo(-ih, -ih); gfx.lineTo(ih, ih);
          gfx.moveTo(ih, -ih); gfx.lineTo(-ih, ih);
          gfx.stroke({ color: 0xddeedd, alpha: 0.8, width: 2.5 });
        }

        // Quarry: triangle
        if (bType === 'quarry') {
          const ih = 8;
          gfx.poly([0, -ih, ih, ih, -ih, ih]);
          gfx.stroke({ color: 0xccccdd, alpha: 0.8, width: 2 });
        }

        // Mine: pickaxe shape
        if (bType === 'mine') {
          const ih = 8;
          gfx.moveTo(-ih, -ih); gfx.lineTo(ih, ih);
          gfx.moveTo(-ih + 2, -ih + 5); gfx.lineTo(-ih, -ih); gfx.lineTo(-ih + 5, -ih + 2);
          gfx.stroke({ color: 0xccaa77, alpha: 0.8, width: 2 });
        }

        // Farm: wheat vertical lines
        if (bType === 'farm') {
          const ih = 8;
          for (let lx = -ih + 3; lx <= ih - 3; lx += 5) {
            gfx.moveTo(lx, -ih); gfx.lineTo(lx, ih);
          }
          gfx.stroke({ color: 0xeedd66, alpha: 0.7, width: 1.5 });
        }

        // Arrow turret: crosshair icon
        if (bType === 'arrow_turret') {
          const ih = 6;
          gfx.circle(0, 0, ih);
          gfx.stroke({ color: 0xddddef, alpha: 0.8, width: 1.5 });
          gfx.moveTo(-ih - 2, 0); gfx.lineTo(ih + 2, 0);
          gfx.moveTo(0, -ih - 2); gfx.lineTo(0, ih + 2);
          gfx.stroke({ color: 0xddddef, alpha: 0.6, width: 1.5 });
        }

        // Ballista: horizontal bolt icon
        if (bType === 'ballista') {
          // Bolt shaft
          gfx.moveTo(-8, 0); gfx.lineTo(8, 0);
          gfx.stroke({ color: 0xddccaa, alpha: 0.9, width: 2 });
          // Bolt head (arrowhead)
          gfx.poly([8, 0, 4, -3, 4, 3]);
          gfx.fill({ color: 0xddccaa, alpha: 0.9 });
          // Crossbow arms
          gfx.moveTo(-4, -6); gfx.lineTo(-2, 0); gfx.lineTo(-4, 6);
          gfx.stroke({ color: 0xbbaa88, alpha: 0.7, width: 1.5 });
        }

        // Cannon turret: circle + filled dot
        if (bType === 'cannon_turret') {
          const ih = 8;
          gfx.circle(0, 0, ih);
          gfx.stroke({ color: 0xccccdd, alpha: 0.7, width: 2 });
          gfx.circle(0, 0, 3);
          gfx.fill({ color: 0xccccdd, alpha: 0.9 });
        }

        // Spike trap: small triangle spikes in a grid pattern
        if (bType === 'spike_trap') {
          const s = 4; // spike half-width
          const h = 5; // spike height
          // 3x3 grid of upward-pointing triangles
          for (let row = -1; row <= 1; row++) {
            for (let col = -1; col <= 1; col++) {
              const cx = col * (s * 2 + 1);
              const cy = row * (h + 2) + 1;
              gfx.poly([cx, cy - h, cx + s, cy + 1, cx - s, cy + 1]);
              gfx.fill({ color: 0xddaaaa, alpha: 0.9 });
              gfx.poly([cx, cy - h, cx + s, cy + 1, cx - s, cy + 1]);
              gfx.stroke({ color: 0xff6666, alpha: 0.8, width: 1 });
            }
          }
        }

        // Bridge: filled plank rectangle above water tiles
        if (bType === 'bridge') {
          gfx.rect(-bHx, -bHy, bHx * 2, bHy * 2);
          gfx.fill({ color: 0x8a6a3a, alpha: 0.9 });
          // Plank lines across the bridge
          for (let ly = -bHy + 4; ly < bHy; ly += 6) {
            gfx.moveTo(-bHx + 2, ly); gfx.lineTo(bHx - 2, ly);
          }
          gfx.stroke({ color: 0xddcc99, alpha: 0.6, width: 1.5 });
          gfx.rect(-bHx, -bHy, bHx * 2, bHy * 2);
          gfx.stroke({ color: 0x6a4a2a, alpha: 0.8, width: 1 });
        }

        // Light tower: radiating light rays
        if (bType === 'light_tower') {
          const rayCount = 8;
          const rayLen = 8;
          for (let i = 0; i < rayCount; i++) {
            const a = (i / rayCount) * Math.PI * 2;
            gfx.moveTo(Math.cos(a) * 3, Math.sin(a) * 3);
            gfx.lineTo(Math.cos(a) * rayLen, Math.sin(a) * rayLen);
          }
          gfx.stroke({ color: 0xffee88, alpha: 0.8, width: 1.5 });
          gfx.circle(0, 0, 3);
          gfx.fill({ color: 0xffee88, alpha: 0.9 });
        }

        // Laser tower: concentric rings icon
        if (bType === 'laser_tower') {
          gfx.circle(0, 0, 7);
          gfx.stroke({ color: 0xff6666, alpha: 0.8, width: 1.5 });
          gfx.circle(0, 0, 4);
          gfx.stroke({ color: 0xff4444, alpha: 0.7, width: 1 });
          gfx.circle(0, 0, 2);
          gfx.fill({ color: 0xff2222, alpha: 0.9 });
        }

        // Healing shrine: cross/plus symbol
        if (bType === 'healing_shrine') {
          const cw = 3, ch = 8;
          gfx.rect(-cw, -ch, cw * 2, ch * 2);
          gfx.fill({ color: 0xeeffee, alpha: 0.8 });
          gfx.rect(-ch, -cw, ch * 2, cw * 2);
          gfx.fill({ color: 0xeeffee, alpha: 0.8 });
        }

        // Barracks: shield icon
        if (bType === 'barracks') {
          const sw = 7, sh = 9;
          gfx.poly([0, -sh, sw, -sh + 3, sw, sh - 3, 0, sh, -sw, sh - 3, -sw, -sh + 3]);
          gfx.stroke({ color: 0xddccaa, alpha: 0.8, width: 2 });
        }
        // Cat house: house silhouette
        if (bType === 'cat_house') {
          gfx.poly([0, -8, 7, -2, 7, 6, -7, 6, -7, -2]);
          gfx.stroke({ color: 0xeeddbb, alpha: 0.8, width: 1.5 });
        }
        // Workshop: anvil icon
        if (bType === 'workshop') {
          // Anvil shape
          gfx.poly([-6, 3, -4, -3, 4, -3, 6, 3]);
          gfx.fill({ color: 0xddccaa, alpha: 0.8 });
          gfx.rect(-8, 3, 16, 3);
          gfx.fill({ color: 0xbbaa88, alpha: 0.8 });
        }
        // Training center: sword + shield
        if (bType === 'training_center') {
          // Sword
          gfx.moveTo(0, -9); gfx.lineTo(0, 5);
          gfx.stroke({ color: 0xddddee, alpha: 0.9, width: 2 });
          gfx.moveTo(-4, -3); gfx.lineTo(4, -3);
          gfx.stroke({ color: 0xddddee, alpha: 0.8, width: 1.5 });
          // Shield outline (right side)
          gfx.poly([4, -6, 9, -4, 9, 2, 6, 5, 4, 2]);
          gfx.stroke({ color: 0xaabbcc, alpha: 0.7, width: 1.5 });
        }
        // Gate: vertical bars pattern
        if (bType === 'gate') {
          const barCount = 5;
          const spacing = (Math.min(bHx, bHy) * 2) / (barCount + 1);
          const isHorizontal = bHx > bHy;
          for (let i = 1; i <= barCount; i++) {
            if (isHorizontal) {
              const bx = -bHx + i * (bHx * 2 / (barCount + 1));
              gfx.moveTo(bx, -bHy * 0.7);
              gfx.lineTo(bx, bHy * 0.7);
            } else {
              const by = -bHy + i * (bHy * 2 / (barCount + 1));
              gfx.moveTo(-bHx * 0.7, by);
              gfx.lineTo(bHx * 0.7, by);
            }
          }
          gfx.stroke({ color: 0xccbb99, alpha: 0.8, width: 2 });
        }

        // ── Ruins overlay (darkened tint + fire particles when burning) ──
        const ruinsComp = world.getComponent<RuinsComponent>(id, C.Ruins);
        if (ruinsComp) {
          // Dark charred overlay
          gfx.rect(-bHx, -bHy, bHx * 2, bHy * 2);
          gfx.fill({ color: 0x000000, alpha: 0.55 });

          // Burn marks (diagonal slash lines)
          const ruinHalf = Math.min(bHx, bHy);
          for (let i = -1; i <= 1; i++) {
            const off = i * (ruinHalf * 0.5);
            gfx.moveTo(-ruinHalf * 0.6 + off, -ruinHalf * 0.6);
            gfx.lineTo(ruinHalf * 0.6 + off, ruinHalf * 0.6);
          }
          gfx.stroke({ color: 0x332200, alpha: 0.4, width: 2 });

          if (ruinsComp.burnTimer > 0) {
            // Animated fire particles (flickering orange/red dots)
            const t = performance.now() / 200;
            for (let fi = 0; fi < 4; fi++) {
              const fx = Math.sin(t + fi * 1.7) * bHx * 0.5;
              const fy = -Math.abs(Math.cos(t * 0.8 + fi * 2.3)) * bHy * 0.6 - 2;
              const fSize = 2 + Math.sin(t * 1.2 + fi) * 1;
              const fireColor = fi % 2 === 0 ? 0xff6622 : 0xffaa00;
              gfx.circle(fx, fy, fSize);
              gfx.fill({ color: fireColor, alpha: 0.7 + Math.sin(t + fi) * 0.2 });
            }
            // Glow halo
            gfx.circle(0, -bHy * 0.3, ruinHalf * 0.7);
            gfx.fill({ color: 0xff4400, alpha: 0.08 + Math.sin(t * 0.5) * 0.04 });
          }
        }

        // Selection highlight: pulsing yellow border + turret range circle
        if (this.selectedBuildingId === id) {
          const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 300);
          gfx.rect(-bHx - 2, -bHy - 2, (bHx + 2) * 2, (bHy + 2) * 2);
          gfx.stroke({ color: 0xffdd44, alpha: 0.5 + 0.4 * pulse, width: 2.5 });

          // Range circle (turrets, light tower, healing shrine)
          const bType = bldg?.buildingType ?? '';
          let range = TURRET_RANGES[bType];
          if (bType === 'laser_tower') range = UPGRADE_LASER_RANGE[(bldg?.upgradeLevel ?? 1) - 1] ?? UPGRADE_LASER_RANGE[0];
          if (!range && bType === 'light_tower') range = UPGRADE_LIGHT_RANGE[(bldg?.upgradeLevel ?? 1) - 1] ?? UPGRADE_LIGHT_RANGE[0];
          if (!range && bType === 'healing_shrine') range = UPGRADE_HEAL_RANGE[(bldg?.upgradeLevel ?? 1) - 1] ?? UPGRADE_HEAL_RANGE[0];
          if (range) {
            const color = RANGE_COLORS[bType] ?? 0x44aaff;
            gfx.circle(0, 0, range);
            gfx.fill({ color, alpha: 0.06 });
            gfx.circle(0, 0, range);
            gfx.stroke({ color, alpha: 0.25, width: 1 });
          }

          // Exclusion zone outline
          const excl = buildingExclusionExtent(bType, bRot);
          if (excl.hx > bHx || excl.hy > bHy) {
            gfx.rect(-excl.hx, -excl.hy, excl.hx * 2, excl.hy * 2);
            gfx.stroke({ color: 0xffaa44, alpha: 0.35, width: 1 });
          }
        }

        // Upgrade pips are drawn in the health bar overlay pass (above all entities)

      } else if (isItem) {
        // ── Item drop rendering ──────────────────────────────────────────────
        const drop = world.getComponent<ItemDropComponent>(id, C.ItemDrop);
        const dropType = drop?.itemType ?? 'wood';
        const isCard = dropType.startsWith('card:');

        // Gentle vertical bob
        const bob = Math.sin(performance.now() / 600 + id * 1.7) * 2;
        // Pulsing glow
        const pulse = 0.4 + 0.3 * Math.sin(performance.now() / 800 + id);

        if (isCard) {
          // Card drop: rounded rectangle with rarity coloring
          const cardColor = CARD_RARITY_COLORS[drop?.cardRarity ?? 'common'] ?? 0xb4b4b4;
          const cr = CARD_DROP_RADIUS;
          const cw = cr * 1.4;  // card width
          const ch = cr * 1.8;  // card height

          // Outer glow
          gfx.circle(0, bob, cr + 6);
          gfx.fill({ color: cardColor, alpha: 0.15 * pulse });

          // Card body (rounded rect)
          gfx.roundRect(-cw / 2, bob - ch / 2, cw, ch, 3);
          gfx.fill({ color: cardColor, alpha: 0.9 });

          // Inner highlight
          gfx.roundRect(-cw / 2 + 2, bob - ch / 2 + 2, cw - 4, ch - 4, 2);
          gfx.stroke({ color: 0xffffff, alpha: 0.4, width: 1 });

          // Card border
          gfx.roundRect(-cw / 2, bob - ch / 2, cw, ch, 3);
          gfx.stroke({ color: 0xffffff, alpha: 0.5, width: 1.5 });
        } else {
          // Regular item drop: diamond shape
          const dropColor = ITEM_DROP_COLORS[dropType] ?? 0xcccccc;
          const ir = ITEM_DROP_RADIUS;

          // Glow ring
          gfx.circle(0, bob, ir + 3);
          gfx.fill({ color: dropColor, alpha: 0.12 * pulse });

          // Diamond shape
          gfx.poly([0, bob - ir, ir * 0.7, bob, 0, bob + ir, -ir * 0.7, bob]);
          gfx.fill({ color: dropColor, alpha: 0.9 });

          // Outline
          gfx.poly([0, bob - ir, ir * 0.7, bob, 0, bob + ir, -ir * 0.7, bob]);
          gfx.stroke({ color: 0xffffff, alpha: 0.3, width: 1 });
        }

      } else {
        // -- Player / Enemy / Guard Rendering --
        // Colored circle body, optional attack arc, facing triangle (local player only),
        // status effect overlays (burn, poison, frost, stun, etc.), boss aura rings.

        // Tick down attack arc
        const arc = this.attackArcs.get(id);
        if (arc) {
          arc.elapsed += dt;
          if (arc.elapsed >= ARC_DURATION) this.attackArcs.delete(id);
        }

        const isGuard = guardIds.has(id);
        const isCivilian = civilianIds.has(id);
        const ev = isEnemy ? world.getComponent<EnemyVariantComponent>(id, C.EnemyVariant) : undefined;
        const ghostState = isEnemy ? world.getComponent<GhostStateComponent>(id, C.GhostState) : undefined;
        const enemyStats = isEnemy ? world.getComponent<EnemyStatsComponent>(id, C.EnemyStats) : undefined;
        const factionComp = isEnemy ? world.getComponent<FactionComponent>(id, C.Faction) : undefined;

        // Variant-specific colors
        let baseColor: number;
        if (isCivilian) {
          baseColor = 0xf5c06a; // warm orange for cat civilians
        } else if (isGuard) {
          const gComp = world.getComponent<GuardComponent>(id, C.Guard);
          const gRole = gComp?.guardRole;
          baseColor = gRole === 'warrior' ? 0xcc4444 : gRole === 'ranger' ? 0x44cc44 : gRole === 'mage' ? 0x6644ff : 0x4488cc;
        } else if (!isEnemy) {
          baseColor = PLAYER_COLORS[pIdx?.index ?? 0] ?? PLAYER_COLORS[0];
        } else {
          switch (ev?.variant) {
            case 'ranger':   baseColor = ENEMY_RANGER_COLOR; break;
            case 'ghost':    baseColor = ENEMY_GHOST_COLOR; break;
            case 'giant':    baseColor = ENEMY_GIANT_COLOR; break;
            case 'assassin': baseColor = ENEMY_ASSASSIN_COLOR; break;
            case 'titan':    baseColor = ENEMY_TITAN_COLOR; break;
            default:         baseColor = ENEMY_COLOR;
          }
          // Apply faction tint (blend 25% toward faction color for non-bandit factions)
          const eFaction = factionComp?.enemyFaction as EnemyFaction | undefined;
          if (eFaction && eFaction !== 'bandits') {
            const fColor = FACTION_COLORS[eFaction];
            if (fColor !== undefined) baseColor = lerpColor(baseColor, fColor, 0.25);
          }
        }
        const color = flashT > 0 ? lerpColor(baseColor, 0xffffff, flashT * 0.6) : baseColor;
        // Use per-entity radius (giants are 2x), default to PLAYER_RADIUS
        const r = isCivilian ? 8 : (enemyStats?.radius && enemyStats.radius !== 10) ? enemyStats.radius : PLAYER_RADIUS;
        // Ghost hidden: render barely visible shimmer
        const ghostAlpha = (ghostState?.hidden) ? 0.06 : 1;

        // ── Attack arc (drawn first, appears behind the entity body) ──────────

        if (arc && arc.elapsed < ARC_DURATION) {
          const t        = arc.elapsed / ARC_DURATION;
          const arcAlpha = (1 - t) * 0.45;
          const halfArc  = MELEE_ARC / 2;
          const startA   = arc.facing - halfArc;
          const endA     = arc.facing + halfArc;
          const STEPS    = 10;
          const arcRange = isEnemy ? ENEMY_MELEE_RANGE : (arc.range ?? MELEE_RANGE);
          const arcColor = isEnemy ? 0xff6666 : 0xffffaa;

          const pts: number[] = [0, 0];
          for (let i = 0; i <= STEPS; i++) {
            const a = startA + (endA - startA) * (i / STEPS);
            pts.push(Math.cos(a) * arcRange, Math.sin(a) * arcRange);
          }
          gfx.poly(pts);
          gfx.fill({ color: arcColor, alpha: arcAlpha });
        }

        // ── Body ────────────────────────────────────────────────────────────────

        if (isDowned) {
          // Downed: dark tint + reduced alpha
          gfx.circle(0, 0, r);
          gfx.fill({ color: lerpColor(color, 0x111111, 0.5), alpha: 0.55 });

          gfx.circle(0, 0, r);
          gfx.stroke({ color: 0xff3333, alpha: 0.5, width: 2 });

          // Red X overlay
          const xr = r * 0.6;
          gfx.moveTo(-xr, -xr); gfx.lineTo(xr, xr);
          gfx.moveTo(xr, -xr); gfx.lineTo(-xr, xr);
          gfx.stroke({ color: 0xff3333, alpha: 0.8, width: 3 });

          // Revive progress bar (below entity)
          const revProg = this.reviveProgress.get(id);
          if (revProg !== undefined && revProg > 0) {
            const progBarW = BAR_W;
            const progBarY = r + 6;
            gfx.rect(-progBarW / 2, progBarY, progBarW, BAR_H + 1);
            gfx.fill({ color: 0x222222, alpha: 0.8 });
            gfx.rect(-progBarW / 2, progBarY, progBarW * revProg, BAR_H + 1);
            gfx.fill({ color: 0x44ccff, alpha: 1 });
          }
        } else {
          // Boss aura (pulsing ring, thicker outline)
          const bossComp = isEnemy ? world.getComponent<BossComponent>(id, C.Boss) : undefined;
          if (bossComp) {
            const bpulse = 0.4 + Math.sin(Date.now() / 300) * 0.2;
            const bossColor = bossComp.enraged ? 0xff2200 : 0xff8800;
            // Outer aura glow
            gfx.circle(0, 0, r + 16);
            gfx.fill({ color: bossColor, alpha: bpulse * 0.15 });
            gfx.circle(0, 0, r + 16);
            gfx.stroke({ color: bossColor, alpha: bpulse * 0.6, width: 3 });
            // Inner aura
            gfx.circle(0, 0, r + 8);
            gfx.stroke({ color: bossColor, alpha: bpulse * 0.4, width: 2 });
          }
          // Titan rally aura (pulsing ring when below 50% HP)
          else if (ev?.variant === 'titan' && hp && hp.current > 0 && hp.current <= hp.max * 0.5) {
            const pulse = 0.3 + Math.sin(Date.now() / 200) * 0.15;
            gfx.circle(0, 0, r + 12);
            gfx.fill({ color: 0xff4400, alpha: pulse * 0.2 });
            gfx.circle(0, 0, r + 12);
            gfx.stroke({ color: 0xff4400, alpha: pulse, width: 2 });
          }

          gfx.circle(0, 0, r);
          gfx.fill({ color, alpha: ghostAlpha });

          gfx.circle(0, 0, r);
          gfx.stroke({ color: 0x000000, alpha: 0.45 * ghostAlpha, width: 2 });
        }

        // -- Status Effect Overlays --
        // Bitmask-based rendering: each status bit triggers a unique visual ring/particles.
        const statusFx = world.getComponent<StatusEffectsComponent>(id, C.StatusEffects);
        if (statusFx && statusFx.bitmask && !isDowned) {
          const now = Date.now();
          const mask = statusFx.bitmask;

          // Fire: flickering orange ring
          if (mask & STATUS_BURN) {
            const fa = 0.4 + 0.3 * Math.sin(now / 100);
            gfx.circle(0, 0, r + 3);
            gfx.stroke({ color: 0xff6622, alpha: fa, width: 2 });
          }

          // Poison: green ring + small bubbles
          if (mask & STATUS_POISON) {
            gfx.circle(0, 0, r + 3);
            gfx.stroke({ color: 0x44dd44, alpha: 0.5, width: 1.5 });
            for (let bi = 0; bi < 3; bi++) {
              const by = -r - 4 - ((now / 300 + bi * 40) % 12);
              const bx = Math.sin(now / 400 + bi * 2.1) * 4;
              gfx.circle(bx, by, 1.5);
              gfx.fill({ color: 0x44dd44, alpha: 0.6 });
            }
          }

          // Ice: blue frost ring
          if (mask & STATUS_SLOW) {
            gfx.circle(0, 0, r + 2);
            gfx.stroke({ color: 0x44aaff, alpha: 0.6, width: 2.5 });
            // Frost sparkle dots
            for (let fi = 0; fi < 4; fi++) {
              const a = (now / 800 + fi * Math.PI / 2) % (Math.PI * 2);
              gfx.circle(Math.cos(a) * (r + 2), Math.sin(a) * (r + 2), 1.5);
              gfx.fill({ color: 0xcceeFF, alpha: 0.7 });
            }
          }

          // Thunder: brief yellow flash + sparks
          if (mask & STATUS_STUN) {
            const sa = 0.5 + 0.4 * Math.sin(now / 60);
            gfx.circle(0, 0, r + 5);
            gfx.fill({ color: 0xffdd44, alpha: sa * 0.25 });
            // Spark lines
            for (let si = 0; si < 3; si++) {
              const a = (now / 150 + si * 2.1) % (Math.PI * 2);
              const len = r + 4 + Math.sin(now / 80 + si) * 3;
              gfx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
              gfx.lineTo(Math.cos(a) * len, Math.sin(a) * len);
              gfx.stroke({ color: 0xffdd44, alpha: 0.8, width: 1.5 });
            }
          }

          // Holy: soft gold glow ring
          if (mask & STATUS_HOLY) {
            const ha = 0.3 + 0.15 * Math.sin(now / 300);
            gfx.circle(0, 0, r + 5);
            gfx.fill({ color: 0xffe866, alpha: ha * 0.2 });
            gfx.circle(0, 0, r + 5);
            gfx.stroke({ color: 0xffe866, alpha: ha, width: 1.5 });
          }

          // Shadow: dark purple wisps
          if (mask & STATUS_SHADOW) {
            for (let wi = 0; wi < 4; wi++) {
              const a = (now / 500 + wi * 1.57) % (Math.PI * 2);
              const wr = r + 2 + Math.sin(now / 300 + wi) * 3;
              const wx = Math.cos(a) * wr;
              const wy = Math.sin(a) * wr;
              const wa = 0.4 + 0.2 * Math.sin(now / 200 + wi);
              gfx.moveTo(wx, wy);
              gfx.lineTo(wx + Math.cos(a + 0.5) * 4, wy + Math.sin(a + 0.5) * 4);
              gfx.stroke({ color: 0x9944dd, alpha: wa, width: 1.5 });
            }
          }

          // Arcane: magenta pulsing ring
          if (mask & STATUS_ARCANE) {
            const aa = 0.3 + 0.3 * Math.sin(now / 200);
            gfx.circle(0, 0, r + 4);
            gfx.stroke({ color: 0xdd44ff, alpha: aa, width: 2 });
          }

          // Nature: small green particles floating up
          if (mask & STATUS_NATURE) {
            for (let ni = 0; ni < 3; ni++) {
              const ny = -r - 3 - ((now / 400 + ni * 30) % 10);
              const nx = Math.sin(now / 500 + ni * 2.5) * 5;
              const na = 0.5 + 0.3 * Math.sin(now / 300 + ni);
              // Tiny leaf-like diamond
              gfx.moveTo(nx, ny - 2);
              gfx.lineTo(nx + 1.5, ny);
              gfx.lineTo(nx, ny + 2);
              gfx.lineTo(nx - 1.5, ny);
              gfx.closePath();
              gfx.fill({ color: 0x66cc44, alpha: na });
            }
          }
        }

        // ── Civilian state indicators ─────────────────────────────────────────

        if (isCivilian && !isDowned) {
          const civComp = world.getComponent<import('@shared/components').CivilianComponent>(id, C.Civilian);
          if (civComp?.state === 'working') {
            // Animated work dots
            const t = performance.now() / 400;
            for (let di = 0; di < 3; di++) {
              const dotBob = Math.sin(t + di * 1.2) * 3;
              gfx.circle(-5 + di * 5, -r - 8 + dotBob, 2.5);
              gfx.fill({ color: 0xffdd44, alpha: 0.9 });
            }
          } else if (civComp?.state === 'delivering') {
            // Resource square above head to show carrying
            const bob = Math.sin(performance.now() / 500) * 2;
            gfx.rect(-4, -r - 12 + bob, 8, 8);
            gfx.fill({ color: 0x88cc44, alpha: 0.9 });
            gfx.rect(-4, -r - 12 + bob, 8, 8);
            gfx.stroke({ color: 0xffffff, alpha: 0.5, width: 1 });
          }
        }

        // ── Facing triangle (local player only, skip when downed) ────────────────

        if (id === localEntityId && localFacing !== null && !isDowned) {
          const tipX = Math.cos(localFacing) * (TRI_DIST + TRI_SIZE);
          const tipY = Math.sin(localFacing) * (TRI_DIST + TRI_SIZE);
          const perpX = -Math.sin(localFacing) * TRI_SIZE;
          const perpY =  Math.cos(localFacing) * TRI_SIZE;
          const baseX = Math.cos(localFacing) * TRI_DIST;
          const baseY = Math.sin(localFacing) * TRI_DIST;
          gfx.poly([tipX, tipY, baseX + perpX, baseY + perpY, baseX - perpX, baseY - perpY]);
          gfx.fill({ color: 0xffffff, alpha: 0.85 });
        }

      }

      // Dodge roll ghost effect: reduce alpha when dodging
      gfx.alpha = isDodging ? 0.4 : 1;

      // Apply smooth offset to local player sprite so corrections don't cause
      // visible backward jerks (the camera already uses the same offset).
      if (id === localEntityId) {
        gfx.position.set(pos.x + smoothX, pos.y + smoothY);
      } else {
        gfx.position.set(pos.x, pos.y);
      }
    }

    // -- Health Bar Overlay Pass --
    // Drawn on a separate Graphics layer so bars render above all entity sprites.
    const hb = this.healthBarGfx;
    hb.clear();

    // -- Persistent Laser Beam Rendering --
    // Laser towers maintain continuous beams drawn as pulsing red lines.
    for (const lid of world.query(C.LaserBeam, C.Position)) {
      const lb = world.getComponent<import('@shared/components').LaserBeamComponent>(lid, C.LaserBeam);
      if (!lb || lb.targetId === null) continue;
      const lpos = world.getComponent<PositionComponent>(lid, C.Position);
      const tgtPos = world.getComponent<PositionComponent>(lb.targetId, C.Position);
      if (!lpos || !tgtPos) continue;

      const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 100);
      // Outer glow
      hb.moveTo(lpos.x, lpos.y);
      hb.lineTo(tgtPos.x, tgtPos.y);
      hb.stroke({ color: 0xff2222, alpha: 0.15 * pulse, width: 6 });
      // Core beam
      hb.moveTo(lpos.x, lpos.y);
      hb.lineTo(tgtPos.x, tgtPos.y);
      hb.stroke({ color: 0xff4444, alpha: 0.7 * pulse, width: 2 });
      // Bright center
      hb.moveTo(lpos.x, lpos.y);
      hb.lineTo(tgtPos.x, tgtPos.y);
      hb.stroke({ color: 0xffaaaa, alpha: 0.9 * pulse, width: 1 });
    }

    for (const id of living) {
      const pos = world.getComponent<PositionComponent>(id, C.Position)!;

      // Viewport culling for health bars
      if (id !== localEntityId &&
        (pos.x < cameraX - cullHalfW || pos.x > cameraX + cullHalfW ||
         pos.y < cameraY - cullHalfH || pos.y > cameraY + cullHalfH)) continue;

      const hp  = world.getComponent<HealthComponent>(id, C.Health);
      if (!hp || hp.max <= 0) continue;

      const isEnemy    = enemyIds.has(id);
      const isPortal   = portalIds.has(id);
      const isResource = resourceIds.has(id);
      const isBuilding = buildingIds.has(id);

      // Determine bar parameters per entity type
      let barW: number, barH: number, barY: number, alwaysShow: boolean;
      let wx: number, wy: number;

      if (id === localEntityId) {
        wx = pos.x + smoothX;
        wy = pos.y + smoothY;
      } else {
        wx = pos.x;
        wy = pos.y;
      }

      if (isPortal) {
        const pr = PORTAL_RADIUS;
        barW = pr * 2 + 8; barH = BAR_H; barY = -(pr + 12); alwaysShow = true;
      } else if (isResource) {
        const rr = RESOURCE_NODE_RADIUS;
        barW = rr * 2 + 4; barH = BAR_H; barY = -(rr + 10); alwaysShow = false;
      } else if (isBuilding) {
        const bldg = world.getComponent<BuildingComponent>(id, C.Building);
        const bExt = buildingExtent(bldg?.buildingType ?? 'wall', bldg?.rotation ?? 0);
        barW = Math.min(bExt.hx * 2, 36); barH = 3; barY = -(bExt.hy + 8); alwaysShow = false;
      } else if (isEnemy) {
        // Skip health bars for hidden ghosts
        const gs = world.getComponent<GhostStateComponent>(id, C.GhostState);
        if (gs?.hidden) continue;
        const ev = world.getComponent<EnemyVariantComponent>(id, C.EnemyVariant);
        const boss = world.getComponent<BossComponent>(id, C.Boss);
        if (boss) {
          // Boss HP bar: extra wide, tall, positioned higher
          const bossR = (world.getComponent<EnemyStatsComponent>(id, C.EnemyStats)?.radius ?? 30);
          barW = 80; barH = 7; barY = -(bossR + 18); alwaysShow = true;
        } else if (ev?.variant === 'titan') {
          // Titan HP bar: wider, taller, positioned higher
          barW = 60; barH = 6; barY = -(30 + 14); alwaysShow = true;
        } else {
          barW = BAR_W; barH = BAR_H; barY = BAR_Y; alwaysShow = true;
        }
      } else if (guardIds.has(id)) {
        barW = BAR_W; barH = BAR_H; barY = BAR_Y; alwaysShow = false;
      } else if (civilianIds.has(id)) {
        barW = 20; barH = 3; barY = -14; alwaysShow = false;
      } else {
        continue; // players don't show health bars (HUD instead)
      }

      // Only-when-damaged check
      if (!alwaysShow && hp.current >= hp.max) continue;

      const ratio    = Math.max(0, hp.current / hp.max);
      const barColor = ratio > 0.5 ? 0x44cc44 : ratio > 0.25 ? 0xddaa22 : 0xcc3333;

      hb.rect(wx - barW / 2, wy + barY, barW, barH);
      hb.fill({ color: 0x222222, alpha: 0.8 });
      if (ratio > 0) {
        hb.rect(wx - barW / 2, wy + barY, barW * ratio, barH);
        hb.fill({ color: barColor, alpha: 1 });
      }

      // Boss name label above HP bar
      if (isEnemy) {
        const bossC = world.getComponent<BossComponent>(id, C.Boss);
        if (bossC) {
          const bossName = this.getBossDisplayName(bossC.bossId);
          let label = this.bossLabels.get(id);
          if (!label) {
            label = new Text({ text: bossName, style: { fontFamily: 'monospace', fontSize: 11, fill: 0xff8800, fontWeight: 'bold', stroke: { color: 0x000000, width: 3 } } });
            label.anchor.set(0.5, 1);
            this.worldContainer.addChild(label);
            this.bossLabels.set(id, label);
          }
          label.position.set(wx, wy + barY - 3);
          label.visible = true;
        }
      }
    }

    // ── Upgrade level pips (drawn on health bar layer so they render above all buildings) ──
    // Walls use visual tier changes instead of pips
    for (const id of buildingIds) {
      if (!living.has(id)) continue;
      const bldg = world.getComponent<BuildingComponent>(id, C.Building);
      const level = bldg?.upgradeLevel ?? 1;
      if (level <= 1) continue;
      if (bldg?.buildingType === 'wall') continue;
      const pos = world.getComponent<PositionComponent>(id, C.Position)!;
      const bExtPip = buildingExtent(bldg?.buildingType ?? 'wall', bldg?.rotation ?? 0);
      const pipY = pos.y + bExtPip.hy + 6;
      const pipSpacing = 8;
      const totalW = (level - 1) * pipSpacing;
      const startX = pos.x - totalW / 2;
      for (let i = 0; i < level; i++) {
        const px = startX + i * pipSpacing;
        hb.poly([px, pipY - 3, px + 3, pipY, px, pipY + 3, px - 3, pipY]);
        hb.fill({ color: 0xffdd44, alpha: 0.9 });
      }
    }

    // -- Production Tags --
    // Pill-shaped labels above production buildings showing stored/max resources.
    const activeProductionIds = new Set<EntityId>();

    for (const id of living) {
      const prod = world.getComponent<ProductionComponent>(id, C.Production);
      if (!prod || prod.stored <= 0) continue;

      activeProductionIds.add(id);
      const pos = world.getComponent<PositionComponent>(id, C.Position)!;
      const bldg = world.getComponent<BuildingComponent>(id, C.Building);
      const bExtTag = buildingExtent(bldg?.buildingType ?? 'wall', bldg?.rotation ?? 0);
      const tagColor = PRODUCTION_TAG_COLORS[prod.resourceType] ?? 0xaaaaaa;

      let tag = this.productionTags.get(id);
      if (!tag) {
        const bg = new Graphics();
        const text = new Text({
          text: '',
          style: { fontSize: 10, fill: 0xffffff, fontFamily: 'monospace', fontWeight: 'bold' },
        });
        text.anchor.set(0.5, 0.5);
        this.tagContainer.addChild(bg);
        this.tagContainer.addChild(text);
        tag = { bg, text };
        this.productionTags.set(id, tag);
      }

      const label = `${prod.stored}/${prod.maxStored}`;
      tag.text.text = label;
      // Position above the building, above the HP bar
      const tagY = pos.y - (bExtTag.hy + 18);
      const tagW = Math.max(24, tag.text.width + 20);
      const tagH = 14;

      tag.bg.clear();
      // Background pill
      tag.bg.roundRect(pos.x - tagW / 2, tagY - tagH / 2, tagW, tagH, 4);
      tag.bg.fill({ color: 0x111111, alpha: 0.75 });
      // Resource color dot
      tag.bg.circle(pos.x - tagW / 2 + 7, tagY, 3);
      tag.bg.fill({ color: tagColor, alpha: 1 });

      tag.text.position.set(pos.x + 5, tagY);
    }

    // Remove tags for entities that no longer have stored resources
    for (const [id, tag] of this.productionTags) {
      if (!activeProductionIds.has(id)) {
        this.tagContainer.removeChild(tag.bg);
        this.tagContainer.removeChild(tag.text);
        tag.bg.destroy();
        tag.text.destroy();
        this.productionTags.delete(id);
      }
    }

    // -- Housing Spawn Timer --
    // Circular pie-chart indicator above campfires/cat houses showing civilian spawn progress.
    const activeHousingIds = new Set<EntityId>();
    const SPAWN_INTERVAL = 60; // must match CIVILIAN_SPAWN_TIMER_INTERVAL

    if (this.civilianSpawn) {
      const spawn = this.civilianSpawn;
      for (const id of living) {
        const bldg = world.getComponent<BuildingComponent>(id, C.Building);
        if (!bldg || (bldg.buildingType !== 'campfire' && bldg.buildingType !== 'cat_house')) continue;

        activeHousingIds.add(id);
        const pos = world.getComponent<PositionComponent>(id, C.Position)!;
        const bExt = buildingExtent(bldg.buildingType, bldg.rotation);

        let tag = this.housingTags.get(id);
        if (!tag) {
          const bg = new Graphics();
          const text = new Text({ text: '', style: { fontSize: 0, fill: 0 } }); // unused but kept for type compat
          this.tagContainer.addChild(bg);
          tag = { bg, text };
          this.housingTags.set(id, tag);
        }

        const cx = pos.x;
        const cy = pos.y - (bExt.hy + 14);
        const r = 6;

        tag.bg.clear();

        if (spawn.population >= spawn.capacity) {
          // At capacity - red filled circle
          tag.bg.circle(cx, cy, r);
          tag.bg.fill({ color: 0xcc4444, alpha: 0.6 });
          tag.bg.circle(cx, cy, r);
          tag.bg.stroke({ color: 0xcc4444, alpha: 0.8, width: 1.5 });
        } else if (spawn.nextSpawnSeconds > 0) {
          // Spawning - circular progress using two fills
          const progress = 1 - (spawn.nextSpawnSeconds / SPAWN_INTERVAL);
          // Dark background circle
          tag.bg.circle(cx, cy, r);
          tag.bg.fill({ color: 0x222222, alpha: 0.7 });
          // Green progress pie slice (filled arc from top)
          if (progress > 0.01) {
            const startAngle = -Math.PI / 2;
            const endAngle = startAngle + progress * Math.PI * 2;
            tag.bg.moveTo(cx, cy);
            tag.bg.arc(cx, cy, r, startAngle, endAngle);
            tag.bg.closePath();
            tag.bg.fill({ color: 0x44cc44, alpha: 0.8 });
          }
          // Outline ring
          tag.bg.circle(cx, cy, r);
          tag.bg.stroke({ color: 0x44cc44, alpha: 0.5, width: 1 });
        } else {
          // Ready / idle - green circle
          tag.bg.circle(cx, cy, r);
          tag.bg.fill({ color: 0x44cc44, alpha: 0.5 });
        }
      }
    }

    // Remove housing tags for entities that no longer exist
    for (const [id, tag] of this.housingTags) {
      if (!activeHousingIds.has(id)) {
        this.tagContainer.removeChild(tag.bg);
        tag.bg.destroy();
        this.housingTags.delete(id);
      }
    }

    // ── Civilian name tags ──────────────────────────────────────────────────
    const activeCivilianIds = new Set<EntityId>();
    for (const id of civilianIds) {
      activeCivilianIds.add(id);
      const pos = world.getComponent<PositionComponent>(id, C.Position)!;
      const civ = world.getComponent<import('@shared/components').CivilianComponent>(id, C.Civilian);
      if (!civ) continue;

      // Hide name tag when downed
      const civDowned = this.downedEntities.has(id) || world.hasComponent(id, C.Downed);
      let tag = this.civilianTags.get(id);
      if (!tag) {
        const bg = new Graphics();
        const text = new Text({
          text: '',
          style: { fontSize: 9, fill: 0xffffff, fontFamily: 'monospace' },
        });
        text.anchor.set(0.5, 0.5);
        this.tagContainer.addChild(bg);
        this.tagContainer.addChild(text);
        tag = { bg, text };
        this.civilianTags.set(id, tag);
      }

      if (civDowned) {
        tag.bg.visible = false;
        tag.text.visible = false;
        continue;
      }
      tag.bg.visible = true;
      tag.text.visible = true;

      tag.text.text = civ.name;
      const tagY = pos.y - 24;
      const tagW = Math.max(20, tag.text.width + 10);
      const tagH = 12;

      tag.bg.clear();
      tag.bg.roundRect(pos.x - tagW / 2, tagY - tagH / 2, tagW, tagH, 3);
      // State-based background tint
      const bgColor = civ.state === 'fleeing' ? 0x441111 : (civ.state === 'working' || civ.state === 'delivering') ? 0x113311 : 0x111111;
      tag.bg.fill({ color: bgColor, alpha: 0.7 });

      tag.text.position.set(pos.x, tagY);
    }
    // Clean up civilian tags for removed entities
    for (const [id, tag] of this.civilianTags) {
      if (!activeCivilianIds.has(id)) {
        this.tagContainer.removeChild(tag.bg);
        this.tagContainer.removeChild(tag.text);
        tag.bg.destroy();
        tag.text.destroy();
        this.civilianTags.delete(id);
      }
    }

    // ── Speech bubbles ──────────────────────────────────────────────────────
    for (const id of civilianIds) {
      const pos = world.getComponent<PositionComponent>(id, C.Position)!;
      const civ = world.getComponent<import('@shared/components').CivilianComponent>(id, C.Civilian);
      if (!civ) continue;

      // Tick down speech timer
      if (civ.speechTimer > 0) {
        civ.speechTimer -= dt;
        if (civ.speechTimer <= 0) {
          civ.speechBubble = null;
          civ.speechTimer = 0;
        }
      }

      if (civ.speechBubble) {
        let bubble = this.speechBubbles.get(id);
        if (!bubble) {
          const bg = new Graphics();
          const text = new Text({
            text: '',
            style: { fontSize: 9, fill: 0xffffff, fontFamily: 'monospace' },
          });
          text.anchor.set(0.5, 0.5);
          this.tagContainer.addChild(bg);
          this.tagContainer.addChild(text);
          bubble = { bg, text };
          this.speechBubbles.set(id, bubble);
        }
        bubble.text.text = civ.speechBubble;
        const bubbleY = pos.y - 36;
        const bW = Math.max(30, bubble.text.width + 12);
        const bH = 14;
        bubble.bg.clear();
        bubble.bg.roundRect(pos.x - bW / 2, bubbleY - bH / 2, bW, bH, 4);
        bubble.bg.fill({ color: 0x222222, alpha: 0.85 });
        bubble.text.position.set(pos.x, bubbleY);
        bubble.bg.visible = true;
        bubble.text.visible = true;
      } else {
        const bubble = this.speechBubbles.get(id);
        if (bubble) {
          bubble.bg.visible = false;
          bubble.text.visible = false;
        }
      }
    }
    // Clean up speech bubbles for removed entities
    for (const [id, bubble] of this.speechBubbles) {
      if (!activeCivilianIds.has(id)) {
        this.tagContainer.removeChild(bubble.bg);
        this.tagContainer.removeChild(bubble.text);
        bubble.bg.destroy();
        bubble.text.destroy();
        this.speechBubbles.delete(id);
      }
    }
  }

  /** Destroy all entity graphics (call on quit to menu or world reset). */
  destroy(): void {
    for (const gfx of this.sprites.values()) {
      this.worldContainer.removeChild(gfx);
      gfx.destroy();
    }
    this.sprites.clear();
    this.hitTimers.clear();
    this.attackArcs.clear();
    this.downedEntities.clear();
    this.reviveProgress.clear();
    this.healthBarGfx.clear();
    this.dirty.clear();
    this.wasFlashing.clear();
    this.wasGhostHidden.clear();
    this.wasDowned.clear();
    this.wasDodging.clear();
    this.lastReviveProg.clear();
    for (const [, tag] of this.productionTags) {
      this.tagContainer.removeChild(tag.bg);
      this.tagContainer.removeChild(tag.text);
      tag.bg.destroy();
      tag.text.destroy();
    }
    this.productionTags.clear();
    for (const [, tag] of this.housingTags) {
      this.tagContainer.removeChild(tag.bg);
      tag.bg.destroy();
    }
    this.housingTags.clear();
    for (const [, tag] of this.civilianTags) {
      this.tagContainer.removeChild(tag.bg);
      this.tagContainer.removeChild(tag.text);
      tag.bg.destroy();
      tag.text.destroy();
    }
    this.civilianTags.clear();
    for (const [, bubble] of this.speechBubbles) {
      this.tagContainer.removeChild(bubble.bg);
      this.tagContainer.removeChild(bubble.text);
      bubble.bg.destroy();
      bubble.text.destroy();
    }
    this.speechBubbles.clear();
    for (const [, label] of this.bossLabels) {
      this.worldContainer.removeChild(label);
      label.destroy();
    }
    this.bossLabels.clear();
  }

  private getBossDisplayName(bossId: string): string {
    switch (bossId) {
      case 'ravager': return 'The Ravager';
      case 'necromancer': return 'The Necromancer';
      case 'shadow_lord': return 'The Shadow Lord';
      default: return 'Boss';
    }
  }
}