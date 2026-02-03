import { Container, Graphics } from 'pixi.js';
import { World, EntityId } from '@shared/ecs/World';
import {
  C,
  PositionComponent,
  PlayerIndexComponent,
  FactionComponent,
  HealthComponent,
} from '@shared/components';
import { PLAYER_RADIUS, PLAYER_COLORS, MELEE_RANGE, MELEE_ARC, PORTAL_RADIUS } from '@shared/constants';

// Enemy body color
const ENEMY_COLOR = 0xcc3333;
// Portal colors
const PORTAL_OUTER_COLOR = 0x9933ff;
const PORTAL_CORE_COLOR  = 0x6600cc;
// Duration of the white hit-flash in seconds
const HIT_FLASH_DURATION = 0.15;
// Duration of the attack arc animation in seconds
const ARC_DURATION = 0.22;
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

  constructor(private readonly worldContainer: Container) {}

  /** Triggers a 150ms white flash on the struck entity. */
  notifyHit(entityId: EntityId): void {
    this.hitTimers.set(entityId, HIT_FLASH_DURATION);
  }

  /** Triggers a sword-arc animation (220ms) originating from the attacker. */
  notifyAttack(entityId: EntityId, facing: number): void {
    this.attackArcs.set(entityId, { facing, elapsed: 0 });
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
  ): void {
    // Collect all renderable entities: players, enemies, and portals
    const playerIds = new Set(world.query(C.Position, C.PlayerIndex));
    const factionEntities = world.query(C.Position, C.Faction);
    const enemyIds  = new Set<number>();
    const portalIds = new Set<number>();
    for (const id of factionEntities) {
      const f = world.getComponent<FactionComponent>(id, C.Faction)!;
      if (f.type === 'enemy') enemyIds.add(id);
      else if (f.type === 'portal') portalIds.add(id);
    }
    const living = new Set([...playerIds, ...enemyIds, ...portalIds]);

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
      const isEnemy  = enemyIds.has(id);
      const isPortal = portalIds.has(id);

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

        gfx.circle(0, 0, r);
        gfx.fill({ color, alpha: 1 });

        gfx.circle(0, 0, r);
        gfx.stroke({ color: 0x000000, alpha: 0.45, width: 2 });

        // ── Facing triangle (local player only) ─────────────────────────────────

        if (id === localEntityId && localFacing !== null) {
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

      gfx.position.set(pos.x, pos.y);
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
  }
}