import { Container, Graphics } from 'pixi.js';
import { PLAYER_COLORS, PROJECTILE_RADIUS } from '@shared/constants';

interface ProjectileVisual {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ownerSlot: number;
  /** Mortar fields (cannon turret only). */
  targetX?: number;
  targetY?: number;
  totalFlightTime?: number;
  /** Start position for arc interpolation. */
  startX?: number;
  startY?: number;
  elapsed?: number;
  /** True if projectile pierces through targets (ranger). */
  pierce?: boolean;
  /** True if projectile homes in on nearest enemy (mage). */
  homing?: boolean;
}

const TRAIL_LEN = 10; // pixels behind the body
const EXPLOSION_DURATION = 0.3; // seconds

interface Explosion {
  x: number;
  y: number;
  radius: number;
  elapsed: number;
}

/**
 * Client-side projectile renderer.
 *
 * Maintains a map of active projectiles and draws them each frame.
 * Movement is predicted locally (constant velocity, straight line)
 * since the server only sends PROJECTILE_SPAWN and PROJECTILE_REMOVE.
 */
export class ProjectileRendererSystem {
  private gfx: Graphics;
  private projectiles = new Map<number, ProjectileVisual>();
  private explosions: Explosion[] = [];

  constructor(parent: Container) {
    this.gfx = new Graphics();
    this.gfx.zIndex = 10; // render above entities/buildings
    parent.addChild(this.gfx);
  }

  spawn(id: number, x: number, y: number, vx: number, vy: number, ownerSlot: number,
        targetX?: number, targetY?: number, totalFlightTime?: number, pierce?: boolean, homing?: boolean): void {
    const vis: ProjectileVisual = { x, y, vx, vy, ownerSlot };
    if (targetX != null && targetY != null && totalFlightTime != null) {
      vis.targetX = targetX;
      vis.targetY = targetY;
      vis.totalFlightTime = totalFlightTime;
      vis.startX = x;
      vis.startY = y;
      vis.elapsed = 0;
    }
    if (pierce) vis.pierce = true;
    if (homing) vis.homing = true;
    this.projectiles.set(id, vis);
  }

  remove(id: number): void {
    this.projectiles.delete(id);
  }

  /** Expose active projectiles for client-side hit prediction. */
  getProjectiles(): Map<number, ProjectileVisual> {
    return this.projectiles;
  }

  /** Register a cannon AOE explosion for rendering. */
  addExplosion(x: number, y: number, radius: number): void {
    this.explosions.push({ x, y, radius, elapsed: 0 });
  }

  /** Advance all projectile positions by dt seconds. */
  update(dt: number): void {
    for (const p of this.projectiles.values()) {
      if (p.targetX != null && p.targetY != null && p.totalFlightTime != null && p.startX != null && p.startY != null) {
        // Mortar arc: interpolate from start to target
        p.elapsed = (p.elapsed ?? 0) + dt;
        const t = Math.min(p.elapsed / p.totalFlightTime, 1);
        p.x = p.startX + (p.targetX - p.startX) * t;
        p.y = p.startY + (p.targetY - p.startY) * t;
      } else {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
    }
    // Tick explosions
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      this.explosions[i].elapsed += dt;
      if (this.explosions[i].elapsed >= EXPLOSION_DURATION) {
        this.explosions.splice(i, 1);
      }
    }
  }

  /**
   * Redraw all projectiles in world coordinates.
   * The parent worldContainer already applies camera scale + translation,
   * so we draw at world positions directly (matching PlayerRendererSystem).
   */
  render(cameraX: number, cameraY: number, zoom: number, screenW: number, screenH: number): void {
    this.gfx.clear();

    // Visible world-space bounds for culling
    const halfW = screenW / (2 * zoom);
    const halfH = screenH / (2 * zoom);
    const margin = 50 / zoom;

    for (const p of this.projectiles.values()) {
      // Cull off-screen projectiles in world space
      if (p.x < cameraX - halfW - margin || p.x > cameraX + halfW + margin ||
          p.y < cameraY - halfH - margin || p.y > cameraY + halfH + margin) continue;

      // Color by projectile type: ranger=green, mage=white, turret=gray, enemy=orange, default=player color
      let color: number;
      if (p.pierce) color = 0x44dd66;
      else if (p.homing) color = 0xeeeeff;
      else if (p.ownerSlot === -1) color = 0x9999bb;
      else if (p.ownerSlot === -2) color = 0xdd7722;
      else color = PLAYER_COLORS[p.ownerSlot] ?? 0xffffff;

      const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
      if (speed === 0) continue;

      // Direction unit vector
      const dx = p.vx / speed;
      const dy = p.vy / speed;

      // Mortar projectiles: draw larger with parabolic arc scale
      if (p.targetX != null && p.totalFlightTime != null && p.elapsed != null) {
        const t = Math.min(p.elapsed / p.totalFlightTime, 1);
        const arcScale = 1 + 1.5 * 4 * t * (1 - t);
        const bodyRadius = PROJECTILE_RADIUS * arcScale;
        this.gfx.circle(p.x, p.y, PROJECTILE_RADIUS * 0.8);
        this.gfx.fill({ color: 0x000000, alpha: 0.2 });
        const arcHeight = 30 * 4 * t * (1 - t);
        this.gfx.circle(p.x, p.y - arcHeight, bodyRadius);
        this.gfx.fill({ color: 0xff6600, alpha: 0.9 });
      } else if (p.homing) {
        // Mage: glowing orb with outer glow (white base — will be tinted by element later)
        this.gfx.circle(p.x, p.y, PROJECTILE_RADIUS * 2.5);
        this.gfx.fill({ color: 0xffffff, alpha: 0.15 });
        this.gfx.circle(p.x, p.y, PROJECTILE_RADIUS * 1.5);
        this.gfx.fill({ color: 0xeeeeff, alpha: 0.9 });
        // Short sparkle trail
        const tailX = p.x - dx * TRAIL_LEN * 0.8;
        const tailY = p.y - dy * TRAIL_LEN * 0.8;
        this.gfx.moveTo(tailX, tailY);
        this.gfx.lineTo(p.x, p.y);
        this.gfx.stroke({ color: 0xddddff, alpha: 0.5, width: 3 });
      } else if (p.pierce) {
        // Ranger: elongated arrow with long trail
        const tailX = p.x - dx * TRAIL_LEN * 2;
        const tailY = p.y - dy * TRAIL_LEN * 2;
        this.gfx.moveTo(tailX, tailY);
        this.gfx.lineTo(p.x, p.y);
        this.gfx.stroke({ color: 0x44dd66, alpha: 0.35, width: 2 });
        // Pointed head (diamond shape)
        const nx = -dy, ny = dx; // perpendicular
        this.gfx.moveTo(p.x + dx * 5, p.y + dy * 5);
        this.gfx.lineTo(p.x + nx * 2.5, p.y + ny * 2.5);
        this.gfx.lineTo(p.x - dx * 3, p.y - dy * 3);
        this.gfx.lineTo(p.x - nx * 2.5, p.y - ny * 2.5);
        this.gfx.closePath();
        this.gfx.fill({ color: 0x44dd66, alpha: 0.9 });
      } else {
        // Default: circle + trail (warrior / turret / enemy)
        const tailX = p.x - dx * TRAIL_LEN;
        const tailY = p.y - dy * TRAIL_LEN;
        this.gfx.moveTo(tailX, tailY);
        this.gfx.lineTo(p.x, p.y);
        this.gfx.stroke({ color, alpha: 0.4, width: 2 });
        this.gfx.circle(p.x, p.y, PROJECTILE_RADIUS);
        this.gfx.fill({ color, alpha: 0.9 });
      }
    }

    // Draw AOE explosions
    for (const exp of this.explosions) {
      const t = exp.elapsed / EXPLOSION_DURATION; // 0→1
      const currentRadius = exp.radius * (0.3 + 0.7 * t);
      const alpha = (1 - t) * 0.5;
      // Outer ring
      this.gfx.circle(exp.x, exp.y, currentRadius);
      this.gfx.fill({ color: 0xff8800, alpha: alpha * 0.3 });
      this.gfx.circle(exp.x, exp.y, currentRadius);
      this.gfx.stroke({ color: 0xffaa33, alpha, width: 2 });
      // Inner flash
      this.gfx.circle(exp.x, exp.y, currentRadius * 0.4);
      this.gfx.fill({ color: 0xffdd66, alpha: alpha * 0.6 });
    }
  }

  destroy(): void {
    this.projectiles.clear();
    this.explosions.length = 0;
    this.gfx.clear();
  }
}
