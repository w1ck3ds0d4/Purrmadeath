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
  /** True if this is a ballista bolt (bigger arrow visual). */
  ballista?: boolean;
  /** Elemental colors for cycling rendering. */
  colors?: number[];
  /** Timestamp when the projectile was spawned (for color cycling). */
  spawnTime?: number;
  /** True if this is a sniper shot (massive arrow visual). */
  sniper?: boolean;
}

const TRAIL_LEN = 10; // pixels behind the body
const EXPLOSION_DURATION = 0.3; // seconds

// Meteor impact constants
const METEOR_EXPLOSION_DURATION = 0.6; // seconds - longer than cannon
const CRATER_LIFETIME = 8; // seconds before crater fully fades

interface Explosion {
  x: number;
  y: number;
  radius: number;
  elapsed: number;
}

interface MeteorImpact {
  x: number;
  y: number;
  radius: number;
  elapsed: number;
}

interface Crater {
  x: number;
  y: number;
  radius: number;
  age: number;
}

interface MeteorWarning {
  x: number;
  y: number;
  radius: number;
  /** Total warning duration. */
  delay: number;
  /** Time elapsed since warning started. */
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
  private craterGfx: Graphics;
  private projectiles = new Map<number, ProjectileVisual>();
  private explosions: Explosion[] = [];
  private meteorImpacts: MeteorImpact[] = [];
  private meteorWarnings: MeteorWarning[] = [];
  private craters: Crater[] = [];

  constructor(parent: Container) {
    // Crater layer below projectiles
    this.craterGfx = new Graphics();
    this.craterGfx.zIndex = 1;
    parent.addChild(this.craterGfx);

    this.gfx = new Graphics();
    this.gfx.zIndex = 10; // render above entities/buildings
    parent.addChild(this.gfx);
  }

  spawn(id: number, x: number, y: number, vx: number, vy: number, ownerSlot: number,
        targetX?: number, targetY?: number, totalFlightTime?: number, pierce?: boolean, homing?: boolean, ballista?: boolean, colors?: number[], sniper?: boolean): void {
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
    if (ballista) vis.ballista = true;
    if (sniper) vis.sniper = true;
    if (colors && colors.length > 0) {
      vis.colors = colors;
      vis.spawnTime = performance.now() / 1000;
    }
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

  /** Register a meteor warning (red circle on ground before impact). */
  addMeteorWarning(x: number, y: number, radius: number, delay: number): void {
    this.meteorWarnings.push({ x, y, radius, delay, elapsed: 0 });
  }

  /** Register a meteor impact - bigger explosion + leaves a crater. */
  addMeteorImpact(x: number, y: number, radius: number): void {
    this.meteorImpacts.push({ x, y, radius, elapsed: 0 });
    this.craters.push({ x, y, radius: radius * 0.8, age: 0 });
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
    // Tick cannon explosions
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      this.explosions[i].elapsed += dt;
      if (this.explosions[i].elapsed >= EXPLOSION_DURATION) {
        this.explosions.splice(i, 1);
      }
    }
    // Tick meteor impacts
    for (let i = this.meteorImpacts.length - 1; i >= 0; i--) {
      this.meteorImpacts[i].elapsed += dt;
      if (this.meteorImpacts[i].elapsed >= METEOR_EXPLOSION_DURATION) {
        this.meteorImpacts.splice(i, 1);
      }
    }
    // Tick meteor warnings (remove when expired - impact removes them)
    for (let i = this.meteorWarnings.length - 1; i >= 0; i--) {
      this.meteorWarnings[i].elapsed += dt;
      if (this.meteorWarnings[i].elapsed >= this.meteorWarnings[i].delay + 0.1) {
        this.meteorWarnings.splice(i, 1);
      }
    }
    // Tick craters
    for (let i = this.craters.length - 1; i >= 0; i--) {
      this.craters[i].age += dt;
      if (this.craters[i].age >= CRATER_LIFETIME) {
        this.craters.splice(i, 1);
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
    this.craterGfx.clear();

    // Visible world-space bounds for culling
    const halfW = screenW / (2 * zoom);
    const halfH = screenH / (2 * zoom);
    const margin = 50 / zoom;

    // ── Craters (ground layer) ───────────────────────────────────────────
    for (const c of this.craters) {
      if (c.x < cameraX - halfW - c.radius || c.x > cameraX + halfW + c.radius ||
          c.y < cameraY - halfH - c.radius || c.y > cameraY + halfH + c.radius) continue;

      const fade = 1 - c.age / CRATER_LIFETIME;
      // Scorched ground
      this.craterGfx.circle(c.x, c.y, c.radius);
      this.craterGfx.fill({ color: 0x221100, alpha: fade * 0.35 });
      // Darker inner ring
      this.craterGfx.circle(c.x, c.y, c.radius * 0.6);
      this.craterGfx.fill({ color: 0x110800, alpha: fade * 0.25 });
      // Rim
      this.craterGfx.circle(c.x, c.y, c.radius);
      this.craterGfx.stroke({ color: 0x332200, alpha: fade * 0.3, width: 1.5 });
    }

    // ── Projectiles ──────────────────────────────────────────────────────
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

      // Elemental color cycling overrides the default color
      if (p.colors && p.colors.length > 0 && p.spawnTime != null) {
        const elapsed = performance.now() / 1000 - p.spawnTime;
        const cycleIndex = Math.floor(elapsed / 0.2) % p.colors.length;
        color = p.colors[cycleIndex];
      }

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
        // Mage: glowing orb with outer glow (uses elemental color if available)
        this.gfx.circle(p.x, p.y, PROJECTILE_RADIUS * 2.5);
        this.gfx.fill({ color, alpha: 0.15 });
        this.gfx.circle(p.x, p.y, PROJECTILE_RADIUS * 1.5);
        this.gfx.fill({ color, alpha: 0.9 });
        // Short sparkle trail
        const tailX = p.x - dx * TRAIL_LEN * 0.8;
        const tailY = p.y - dy * TRAIL_LEN * 0.8;
        this.gfx.moveTo(tailX, tailY);
        this.gfx.lineTo(p.x, p.y);
        this.gfx.stroke({ color, alpha: 0.5, width: 3 });
      } else if (p.ballista) {
        // Ballista: large heavy bolt with thick shaft and metallic head
        const nx = -dy, ny = dx; // perpendicular
        // Thick shaft (long trail)
        const shaftLen = TRAIL_LEN * 3;
        const tailX = p.x - dx * shaftLen;
        const tailY = p.y - dy * shaftLen;
        this.gfx.moveTo(tailX, tailY);
        this.gfx.lineTo(p.x, p.y);
        this.gfx.stroke({ color: 0x8b7355, alpha: 0.7, width: 3 }); // wooden shaft
        // Fletching (tail fins)
        const finLen = 6;
        this.gfx.moveTo(tailX + nx * finLen, tailY + ny * finLen);
        this.gfx.lineTo(tailX + dx * 4, tailY + dy * 4);
        this.gfx.lineTo(tailX - nx * finLen, tailY - ny * finLen);
        this.gfx.stroke({ color: 0x666666, alpha: 0.5, width: 1.5 });
        // Large pointed head (metallic)
        const headLen = 8;
        this.gfx.moveTo(p.x + dx * headLen, p.y + dy * headLen);
        this.gfx.lineTo(p.x + nx * 4, p.y + ny * 4);
        this.gfx.lineTo(p.x - dx * 2, p.y - dy * 2);
        this.gfx.lineTo(p.x - nx * 4, p.y - ny * 4);
        this.gfx.closePath();
        this.gfx.fill({ color: 0xaabbcc, alpha: 0.95 });
        // Metallic glint on head
        this.gfx.circle(p.x + dx * 3, p.y + dy * 3, 1.5);
        this.gfx.fill({ color: 0xddeeff, alpha: 0.7 });
      } else if (p.sniper) {
        // Sniper shot: massive glowing arrow with long green trail
        const shaftLen = TRAIL_LEN * 5;
        const tailX = p.x - dx * shaftLen;
        const tailY = p.y - dy * shaftLen;
        const nx = -dy, ny = dx;
        // Outer glow trail
        this.gfx.moveTo(tailX, tailY);
        this.gfx.lineTo(p.x, p.y);
        this.gfx.stroke({ color: 0x44dd66, alpha: 0.25, width: 10 });
        // Inner bright trail
        this.gfx.moveTo(tailX, tailY);
        this.gfx.lineTo(p.x, p.y);
        this.gfx.stroke({ color: 0x88ff88, alpha: 0.6, width: 4 });
        // Core shaft (white-green)
        this.gfx.moveTo(tailX, tailY);
        this.gfx.lineTo(p.x, p.y);
        this.gfx.stroke({ color: 0xddffdd, alpha: 0.9, width: 2 });
        // Large arrowhead
        const headLen = 12;
        this.gfx.moveTo(p.x + dx * headLen, p.y + dy * headLen);
        this.gfx.lineTo(p.x + nx * 6, p.y + ny * 6);
        this.gfx.lineTo(p.x - dx * 3, p.y - dy * 3);
        this.gfx.lineTo(p.x - nx * 6, p.y - ny * 6);
        this.gfx.closePath();
        this.gfx.fill({ color: 0x66ff88, alpha: 0.9 });
        // Bright tip
        this.gfx.circle(p.x + dx * headLen * 0.8, p.y + dy * headLen * 0.8, 3);
        this.gfx.fill({ color: 0xffffff, alpha: 0.8 });
        // Fletching (tail fins)
        const finLen = 8;
        this.gfx.moveTo(tailX + nx * finLen, tailY + ny * finLen);
        this.gfx.lineTo(tailX + dx * 6, tailY + dy * 6);
        this.gfx.lineTo(tailX - nx * finLen, tailY - ny * finLen);
        this.gfx.stroke({ color: 0x44aa55, alpha: 0.5, width: 1.5 });
      } else if (p.pierce && p.colors && p.colors[0] === 0xcc1122) {
        // Blood Arc: large crescent moon shape (no trail line)
        const arcR = 14;
        const angle = Math.atan2(p.vy, p.vx);
        // Outer glow
        this.gfx.arc(p.x, p.y, arcR + 3, angle - Math.PI * 0.55, angle + Math.PI * 0.55);
        this.gfx.arc(p.x + dx * 5, p.y + dy * 5, arcR * 0.4, angle + Math.PI * 0.4, angle - Math.PI * 0.4, true);
        this.gfx.closePath();
        this.gfx.fill({ color: 0x660011, alpha: 0.3 });
        // Main crescent body
        this.gfx.arc(p.x, p.y, arcR, angle - Math.PI * 0.5, angle + Math.PI * 0.5);
        this.gfx.arc(p.x + dx * 4, p.y + dy * 4, arcR * 0.5, angle + Math.PI * 0.4, angle - Math.PI * 0.4, true);
        this.gfx.closePath();
        this.gfx.fill({ color: 0xcc1122, alpha: 0.9 });
        // Bright inner edge
        this.gfx.arc(p.x, p.y, arcR * 0.75, angle - Math.PI * 0.4, angle + Math.PI * 0.4);
        this.gfx.arc(p.x + dx * 3, p.y + dy * 3, arcR * 0.35, angle + Math.PI * 0.3, angle - Math.PI * 0.3, true);
        this.gfx.closePath();
        this.gfx.fill({ color: 0xff4455, alpha: 0.5 });
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

    // ── Cannon AOE explosions ────────────────────────────────────────────
    for (const exp of this.explosions) {
      const t = exp.elapsed / EXPLOSION_DURATION; // 0->1
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

    // ── Meteor warnings (pulsing red circle on ground) ──────────────────
    for (const w of this.meteorWarnings) {
      if (w.x < cameraX - halfW - w.radius || w.x > cameraX + halfW + w.radius ||
          w.y < cameraY - halfH - w.radius || w.y > cameraY + halfH + w.radius) continue;

      const t = Math.min(w.elapsed / w.delay, 1); // 0 -> 1 as impact approaches
      const pulse = 0.5 + 0.5 * Math.sin(w.elapsed * 8); // fast pulse
      const alpha = (0.15 + 0.35 * t) * (0.7 + 0.3 * pulse); // grows more visible near impact

      // Red fill
      this.gfx.circle(w.x, w.y, w.radius * (0.8 + 0.2 * t));
      this.gfx.fill({ color: 0xff2200, alpha: alpha * 0.4 });
      // Red ring
      this.gfx.circle(w.x, w.y, w.radius * (0.8 + 0.2 * t));
      this.gfx.stroke({ color: 0xff4400, alpha: alpha, width: 2 });
      // Inner crosshair
      this.gfx.circle(w.x, w.y, w.radius * 0.15);
      this.gfx.fill({ color: 0xff0000, alpha: alpha * 0.6 });
    }

    // ── Meteor explosions (bigger, more dramatic) ────────────────────────
    for (const m of this.meteorImpacts) {
      const t = m.elapsed / METEOR_EXPLOSION_DURATION; // 0->1

      // Phase 1: bright flash expanding (0 -> 0.3)
      // Phase 2: fire ring expanding + fading (0.3 -> 1.0)
      const expandRadius = m.radius * (0.4 + 0.6 * t);

      if (t < 0.3) {
        // Bright white-yellow flash
        const flashT = t / 0.3;
        const flashAlpha = (1 - flashT) * 0.7;
        this.gfx.circle(m.x, m.y, expandRadius * 0.8);
        this.gfx.fill({ color: 0xffeeaa, alpha: flashAlpha });
      }

      // Outer fire ring
      const ringAlpha = (1 - t) * 0.6;
      this.gfx.circle(m.x, m.y, expandRadius);
      this.gfx.fill({ color: 0xff4400, alpha: ringAlpha * 0.25 });
      this.gfx.circle(m.x, m.y, expandRadius);
      this.gfx.stroke({ color: 0xff6600, alpha: ringAlpha, width: 3 });

      // Mid ring (orange)
      this.gfx.circle(m.x, m.y, expandRadius * 0.65);
      this.gfx.fill({ color: 0xff8800, alpha: ringAlpha * 0.3 });
      this.gfx.circle(m.x, m.y, expandRadius * 0.65);
      this.gfx.stroke({ color: 0xffaa22, alpha: ringAlpha * 0.7, width: 2 });

      // Inner core (bright yellow)
      const coreAlpha = (1 - t * t) * 0.5;
      this.gfx.circle(m.x, m.y, expandRadius * 0.3);
      this.gfx.fill({ color: 0xffdd44, alpha: coreAlpha });
    }
  }

  destroy(): void {
    this.projectiles.clear();
    this.explosions.length = 0;
    this.meteorImpacts.length = 0;
    this.meteorWarnings.length = 0;
    this.craters.length = 0;
    this.gfx.clear();
    this.craterGfx.clear();
  }
}
