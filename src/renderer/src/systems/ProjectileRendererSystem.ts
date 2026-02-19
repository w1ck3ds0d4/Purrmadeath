import { Container, Graphics } from 'pixi.js';
import { PLAYER_COLORS, PROJECTILE_RADIUS } from '@shared/constants';

interface ProjectileVisual {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ownerSlot: number;
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

  spawn(id: number, x: number, y: number, vx: number, vy: number, ownerSlot: number): void {
    this.projectiles.set(id, { x, y, vx, vy, ownerSlot });
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
      p.x += p.vx * dt;
      p.y += p.vy * dt;
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

      // Turret projectiles (ownerSlot = -1) gray/blue, ranger enemy projectiles (ownerSlot = -2) purple
      const color = p.ownerSlot === -1 ? 0x9999bb
        : p.ownerSlot === -2 ? 0xdd7722
        : (PLAYER_COLORS[p.ownerSlot] ?? 0xffffff);
      const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
      if (speed === 0) continue;

      // Direction unit vector
      const dx = p.vx / speed;
      const dy = p.vy / speed;

      // Trail line (behind the body) - world coordinates
      const tailX = p.x - dx * TRAIL_LEN;
      const tailY = p.y - dy * TRAIL_LEN;
      this.gfx.moveTo(tailX, tailY);
      this.gfx.lineTo(p.x, p.y);
      this.gfx.stroke({ color, alpha: 0.4, width: 2 });

      // Body circle - world coordinates
      this.gfx.circle(p.x, p.y, PROJECTILE_RADIUS);
      this.gfx.fill({ color, alpha: 0.9 });
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
