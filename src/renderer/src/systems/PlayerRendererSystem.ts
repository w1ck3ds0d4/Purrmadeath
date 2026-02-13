import { Container, Graphics } from 'pixi.js';
import { World, EntityId } from '@shared/ecs/World';
import {
  C,
  PositionComponent,
  PlayerIndexComponent,
  FactionComponent,
  HealthComponent,
  ResourceNodeComponent,
  ItemDropComponent,
} from '@shared/components';
import { PLAYER_RADIUS, PLAYER_COLORS, MELEE_RANGE, MELEE_ARC, PORTAL_RADIUS, RESOURCE_NODE_RADIUS, ITEM_DROP_RADIUS } from '@shared/constants';

// Enemy body color
const ENEMY_COLOR = 0xcc3333;
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
  private attackArcs  = new Map<EntityId, { facing: number; elapsed: number }>();
  private downedEntities = new Set<EntityId>();
  private reviveProgress = new Map<EntityId, number>(); // entityId → 0..1

  constructor(private readonly worldContainer: Container) {}

  /** Triggers a 150ms white flash on the struck entity. */
  notifyHit(entityId: EntityId): void {
    this.hitTimers.set(entityId, HIT_FLASH_DURATION);
  }

  /** Triggers a sword-arc animation (220ms) originating from the attacker. */
  notifyAttack(entityId: EntityId, facing: number): void {
    this.attackArcs.set(entityId, { facing, elapsed: 0 });
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
  ): void {
    // Collect all renderable entities: players, enemies, portals, resources, item drops
    const playerIds = new Set(world.query(C.Position, C.PlayerIndex));
    const factionEntities = world.query(C.Position, C.Faction);
    const enemyIds    = new Set<number>();
    const portalIds   = new Set<number>();
    const resourceIds = new Set<number>();
    const itemIds     = new Set<number>();
    for (const id of factionEntities) {
      const f = world.getComponent<FactionComponent>(id, C.Faction)!;
      if (f.type === 'enemy') enemyIds.add(id);
      else if (f.type === 'portal') portalIds.add(id);
      else if (f.type === 'resource') resourceIds.add(id);
      else if (f.type === 'item') itemIds.add(id);
    }
    const living = new Set([...playerIds, ...enemyIds, ...portalIds, ...resourceIds, ...itemIds]);

    // Remove sprites for entities that no longer exist; clean up all timers
    for (const [id, gfx] of this.sprites) {
      if (!living.has(id)) {
        this.worldContainer.removeChild(gfx);
        gfx.destroy();
        this.sprites.delete(id);
        this.hitTimers.delete(id);
        this.attackArcs.delete(id);
      }
    }

    for (const id of living) {
      const pos     = world.getComponent<PositionComponent>(id, C.Position)!;
      const pIdx    = world.getComponent<PlayerIndexComponent>(id, C.PlayerIndex);
      const hp      = world.getComponent<HealthComponent>(id, C.Health);
      const isEnemy    = enemyIds.has(id);
      const isPortal   = portalIds.has(id);
      const isResource = resourceIds.has(id);
      const isItem     = itemIds.has(id);

      if (!this.sprites.has(id)) {
        const gfx = new Graphics();
        this.worldContainer.addChild(gfx);
        this.sprites.set(id, gfx);
      }

      const gfx = this.sprites.get(id)!;
      gfx.clear();

      // ── Timers ────────────────────────────────────────────────────────────────

      // Tick down hit flash
      const flashRemaining = this.hitTimers.get(id) ?? 0;
      if (flashRemaining > 0) this.hitTimers.set(id, Math.max(0, flashRemaining - dt));
      const flashT = Math.min(1, flashRemaining / HIT_FLASH_DURATION); // 1 → 0

      if (isPortal) {
        // ── Portal rendering ──────────────────────────────────────────────────
        const pr = PORTAL_RADIUS;
        // Pulsing glow ring
        const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 400);
        const glowColor = flashT > 0 ? lerpColor(PORTAL_OUTER_COLOR, 0xffffff, flashT * 0.6) : PORTAL_OUTER_COLOR;

        // Outer glow ring
        gfx.circle(0, 0, pr + 6);
        gfx.fill({ color: glowColor, alpha: 0.15 * pulse });

        // Main body
        gfx.circle(0, 0, pr);
        gfx.fill({ color: glowColor, alpha: 0.7 });

        // Darker core
        gfx.circle(0, 0, pr * 0.5);
        gfx.fill({ color: PORTAL_CORE_COLOR, alpha: 0.9 });

        // Outline
        gfx.circle(0, 0, pr);
        gfx.stroke({ color: 0xcc66ff, alpha: 0.6 * pulse, width: 2 });

        // Health bar (wider than enemy bar since portals are larger)
        if (hp && hp.max > 0) {
          const portalBarW = pr * 2 + 8;
          const portalBarY = -(pr + 12);
          const ratio    = Math.max(0, hp.current / hp.max);
          const barColor = ratio > 0.5 ? 0x44cc44 : ratio > 0.25 ? 0xddaa22 : 0xcc3333;

          gfx.rect(-portalBarW / 2, portalBarY, portalBarW, BAR_H);
          gfx.fill({ color: 0x222222, alpha: 0.8 });
          if (ratio > 0) {
            gfx.rect(-portalBarW / 2, portalBarY, portalBarW * ratio, BAR_H);
            gfx.fill({ color: barColor, alpha: 1 });
          }
        }
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

        // Health bar (only show if damaged)
        if (hp && hp.max > 0 && hp.current < hp.max) {
          const ratio    = Math.max(0, hp.current / hp.max);
          const barColor = ratio > 0.5 ? 0x44cc44 : ratio > 0.25 ? 0xddaa22 : 0xcc3333;
          const resBarW = rr * 2 + 4;
          const resBarY = -(rr + 10);

          gfx.rect(-resBarW / 2, resBarY, resBarW, BAR_H);
          gfx.fill({ color: 0x222222, alpha: 0.8 });
          if (ratio > 0) {
            gfx.rect(-resBarW / 2, resBarY, resBarW * ratio, BAR_H);
            gfx.fill({ color: barColor, alpha: 1 });
          }
        }

      } else if (isItem) {
        // ── Item drop rendering ──────────────────────────────────────────────
        const drop = world.getComponent<ItemDropComponent>(id, C.ItemDrop);
        const dropType = drop?.itemType ?? 'wood';
        const dropColor = ITEM_DROP_COLORS[dropType] ?? 0xcccccc;
        const ir = ITEM_DROP_RADIUS;

        // Gentle vertical bob
        const bob = Math.sin(performance.now() / 600 + id * 1.7) * 2;

        // Pulsing glow
        const pulse = 0.4 + 0.3 * Math.sin(performance.now() / 800 + id);

        // Glow ring
        gfx.circle(0, bob, ir + 3);
        gfx.fill({ color: dropColor, alpha: 0.12 * pulse });

        // Diamond shape
        gfx.poly([0, bob - ir, ir * 0.7, bob, 0, bob + ir, -ir * 0.7, bob]);
        gfx.fill({ color: dropColor, alpha: 0.9 });

        // Outline
        gfx.poly([0, bob - ir, ir * 0.7, bob, 0, bob + ir, -ir * 0.7, bob]);
        gfx.stroke({ color: 0xffffff, alpha: 0.3, width: 1 });

      } else {
        // ── Standard entity rendering (players + enemies) ────────────────────

        // Tick down attack arc
        const arc = this.attackArcs.get(id);
        if (arc) {
          arc.elapsed += dt;
          if (arc.elapsed >= ARC_DURATION) this.attackArcs.delete(id);
        }

        const baseColor = isEnemy
          ? ENEMY_COLOR
          : (PLAYER_COLORS[pIdx?.index ?? 0] ?? PLAYER_COLORS[0]);
        const color = flashT > 0 ? lerpColor(baseColor, 0xffffff, flashT * 0.6) : baseColor;
        const r = PLAYER_RADIUS;

        // ── Attack arc (drawn first, appears behind the entity body) ──────────

        if (arc && arc.elapsed < ARC_DURATION) {
          const t        = arc.elapsed / ARC_DURATION;
          const arcAlpha = (1 - t) * 0.45;
          const halfArc  = MELEE_ARC / 2;
          const startA   = arc.facing - halfArc;
          const endA     = arc.facing + halfArc;
          const STEPS    = 10;

          const pts: number[] = [0, 0];
          for (let i = 0; i <= STEPS; i++) {
            const a = startA + (endA - startA) * (i / STEPS);
            pts.push(Math.cos(a) * MELEE_RANGE, Math.sin(a) * MELEE_RANGE);
          }
          gfx.poly(pts);
          gfx.fill({ color: 0xffffaa, alpha: arcAlpha });
        }

        // ── Body ────────────────────────────────────────────────────────────────

        const isDowned = this.downedEntities.has(id);
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
          gfx.circle(0, 0, r);
          gfx.fill({ color, alpha: 1 });

          gfx.circle(0, 0, r);
          gfx.stroke({ color: 0x000000, alpha: 0.45, width: 2 });
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

        // ── Enemy health bar ────────────────────────────────────────────────────

        if (isEnemy && hp && hp.max > 0) {
          const ratio    = Math.max(0, hp.current / hp.max);
          const barColor = ratio > 0.5 ? 0x44cc44 : ratio > 0.25 ? 0xddaa22 : 0xcc3333;

          gfx.rect(-BAR_W / 2, BAR_Y, BAR_W, BAR_H);
          gfx.fill({ color: 0x222222, alpha: 0.8 });
          if (ratio > 0) {
            gfx.rect(-BAR_W / 2, BAR_Y, BAR_W * ratio, BAR_H);
            gfx.fill({ color: barColor, alpha: 1 });
          }
        }
      }

      // Apply smooth offset to local player sprite so corrections don't cause
      // visible backward jerks (the camera already uses the same offset).
      if (id === localEntityId) {
        gfx.position.set(pos.x + smoothX, pos.y + smoothY);
      } else {
        gfx.position.set(pos.x, pos.y);
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
  }
}