import { Graphics, Container } from 'pixi.js';

// ── Effect types ─────────────────────────────────────────────────────────────

interface VFXEntry {
  type: string;
  x: number;
  y: number;
  targetX?: number;
  targetY?: number;
  radius: number;
  elapsed: number;
  duration: number;
  facing?: number;
}

const DEFAULT_DURATION = 0.5;

// Ability-specific colors
const ABILITY_COLORS: Record<string, { fill: number; stroke: number }> = {
  whirlwind:     { fill: 0xcc3333, stroke: 0xff4444 },
  shield_wall:   { fill: 0x3377cc, stroke: 0x55aaff },
  war_cry:       { fill: 0xccaa33, stroke: 0xffdd44 },
  rain_of_arrows:{ fill: 0x44dd66, stroke: 0x66ff88 },
  explosive_trap:{ fill: 0xff6600, stroke: 0xff9933 },
  shadow_step:   { fill: 0x6644cc, stroke: 0x8866ff },
  meteor:        { fill: 0xff4400, stroke: 0xff7722 },
  blizzard:      { fill: 0x66aaff, stroke: 0x99ccff },
  teleport:      { fill: 0xaa66ff, stroke: 0xcc99ff },
};

/**
 * Client-side visual effects for skill abilities.
 * Renders expanding circles, rings, particle bursts, etc.
 */
export class AbilityVFXSystem {
  private gfx: Graphics;
  private effects: VFXEntry[] = [];

  constructor(parent: Container) {
    this.gfx = new Graphics();
    this.gfx.zIndex = 15;
    parent.addChild(this.gfx);
  }

  /** Trigger a VFX for an ability at the given position. */
  trigger(abilityId: string, x: number, y: number, radius?: number, duration?: number, facing?: number, targetX?: number, targetY?: number): void {
    this.effects.push({
      type: abilityId,
      x, y,
      targetX, targetY,
      radius: radius ?? 80,
      elapsed: 0,
      duration: duration ?? DEFAULT_DURATION,
      facing,
    });
  }

  update(dt: number): void {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      this.effects[i].elapsed += dt;
      if (this.effects[i].elapsed >= this.effects[i].duration) {
        this.effects.splice(i, 1);
      }
    }
  }

  render(cameraX: number, cameraY: number, zoom: number, screenW: number, screenH: number): void {
    this.gfx.clear();

    const halfW = screenW / (2 * zoom);
    const halfH = screenH / (2 * zoom);
    const margin = 200 / zoom;

    for (const fx of this.effects) {
      // Cull off-screen
      if (fx.x < cameraX - halfW - margin || fx.x > cameraX + halfW + margin ||
          fx.y < cameraY - halfH - margin || fx.y > cameraY + halfH + margin) continue;

      const t = fx.elapsed / fx.duration; // 0→1
      const colors = ABILITY_COLORS[fx.type] ?? { fill: 0xffffff, stroke: 0xffffff };

      switch (fx.type) {
        case 'whirlwind':
          this.drawWhirlwind(fx, t, colors);
          break;
        case 'shield_wall':
          this.drawShieldBubble(fx, t, colors);
          break;
        case 'war_cry':
          this.drawExpandingRing(fx, t, colors);
          break;
        case 'rain_of_arrows':
          this.drawRainOfArrows(fx, t, colors);
          break;
        case 'explosive_trap':
        case 'meteor':
          this.drawExplosion(fx, t, colors);
          break;
        case 'shadow_step':
        case 'teleport':
          this.drawTeleport(fx, t, colors);
          break;
        case 'blizzard':
          this.drawBlizzard(fx, t, colors);
          break;
        default:
          this.drawExpandingRing(fx, t, colors);
          break;
      }
    }
  }

  // ── Individual VFX renderers ─────────────────────────────────────────────────

  private drawWhirlwind(fx: VFXEntry, t: number, colors: { fill: number; stroke: number }): void {
    const alpha = (1 - t) * 0.5;
    // Spinning arcs
    const arcs = 3;
    const baseAngle = t * Math.PI * 6; // 3 full rotations
    for (let i = 0; i < arcs; i++) {
      const angle = baseAngle + (i * Math.PI * 2) / arcs;
      const r = fx.radius * (0.4 + 0.6 * t);
      const ax = fx.x + Math.cos(angle) * r;
      const ay = fx.y + Math.sin(angle) * r;
      this.gfx.moveTo(fx.x, fx.y);
      this.gfx.lineTo(ax, ay);
      this.gfx.stroke({ color: colors.stroke, alpha, width: 3 });
    }
    // Outer ring
    this.gfx.circle(fx.x, fx.y, fx.radius * (0.5 + 0.5 * t));
    this.gfx.stroke({ color: colors.stroke, alpha: alpha * 0.5, width: 2 });
  }

  private drawShieldBubble(fx: VFXEntry, t: number, colors: { fill: number; stroke: number }): void {
    // Shield wall lasts longer - show a pulsing shield ring
    const pulse = 0.9 + 0.1 * Math.sin(t * Math.PI * 8);
    const alpha = t < 0.1 ? t / 0.1 : (t > 0.9 ? (1 - t) / 0.1 : 0.4);
    const r = fx.radius * pulse;
    this.gfx.circle(fx.x, fx.y, r);
    this.gfx.fill({ color: colors.fill, alpha: alpha * 0.15 });
    this.gfx.circle(fx.x, fx.y, r);
    this.gfx.stroke({ color: colors.stroke, alpha: alpha * 0.6, width: 2 });
  }

  private drawExpandingRing(fx: VFXEntry, t: number, colors: { fill: number; stroke: number }): void {
    const alpha = (1 - t) * 0.6;
    const r = fx.radius * t;
    this.gfx.circle(fx.x, fx.y, r);
    this.gfx.fill({ color: colors.fill, alpha: alpha * 0.2 });
    this.gfx.circle(fx.x, fx.y, r);
    this.gfx.stroke({ color: colors.stroke, alpha, width: 2 });
  }

  private drawRainOfArrows(fx: VFXEntry, t: number, colors: { fill: number; stroke: number }): void {
    const cx = fx.targetX ?? fx.x;
    const cy = fx.targetY ?? fx.y;
    const alpha = (1 - t) * 0.6;

    // Target area circle
    this.gfx.circle(cx, cy, fx.radius);
    this.gfx.fill({ color: colors.fill, alpha: alpha * 0.15 });
    this.gfx.circle(cx, cy, fx.radius);
    this.gfx.stroke({ color: colors.stroke, alpha: alpha * 0.4, width: 1 });

    // Arrow lines falling from above
    const count = 8;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + t * 3;
      const dist = fx.radius * (0.3 + 0.5 * ((i * 0.37) % 1));
      const ax = cx + Math.cos(angle) * dist;
      const ay = cy + Math.sin(angle) * dist;
      const fallProgress = Math.min(1, (t * count + i) % 1);
      const arrowY = ay - 30 * (1 - fallProgress);
      this.gfx.moveTo(ax, arrowY - 8);
      this.gfx.lineTo(ax, arrowY + 4);
      this.gfx.stroke({ color: colors.stroke, alpha: alpha * fallProgress, width: 2 });
    }
  }

  private drawExplosion(fx: VFXEntry, t: number, colors: { fill: number; stroke: number }): void {
    const cx = fx.targetX ?? fx.x;
    const cy = fx.targetY ?? fx.y;
    const alpha = (1 - t) * 0.7;
    const r = fx.radius * (0.3 + 0.7 * t);

    // Inner flash
    this.gfx.circle(cx, cy, r * 0.5);
    this.gfx.fill({ color: 0xffdd66, alpha: alpha * 0.5 });
    // Outer blast
    this.gfx.circle(cx, cy, r);
    this.gfx.fill({ color: colors.fill, alpha: alpha * 0.25 });
    this.gfx.circle(cx, cy, r);
    this.gfx.stroke({ color: colors.stroke, alpha, width: 2 });
  }

  private drawTeleport(fx: VFXEntry, t: number, colors: { fill: number; stroke: number }): void {
    const alpha = (1 - t) * 0.6;
    // Origin flash (shrinking)
    const originR = 15 * (1 - t);
    this.gfx.circle(fx.x, fx.y, originR);
    this.gfx.fill({ color: colors.fill, alpha: alpha * 0.5 });

    // Destination flash (expanding)
    if (fx.targetX != null && fx.targetY != null) {
      const destR = 15 * t;
      this.gfx.circle(fx.targetX, fx.targetY, destR);
      this.gfx.fill({ color: colors.fill, alpha: alpha * 0.5 });
      this.gfx.circle(fx.targetX, fx.targetY, destR);
      this.gfx.stroke({ color: colors.stroke, alpha, width: 2 });
    }
  }

  private drawBlizzard(fx: VFXEntry, t: number, colors: { fill: number; stroke: number }): void {
    const cx = fx.targetX ?? fx.x;
    const cy = fx.targetY ?? fx.y;
    // Blizzard has a longer duration - steady state with fade in/out
    const alpha = t < 0.1 ? t / 0.1 * 0.4 : (t > 0.85 ? (1 - t) / 0.15 * 0.4 : 0.4);

    // Zone circle
    this.gfx.circle(cx, cy, fx.radius);
    this.gfx.fill({ color: colors.fill, alpha: alpha * 0.15 });
    this.gfx.circle(cx, cy, fx.radius);
    this.gfx.stroke({ color: colors.stroke, alpha: alpha * 0.5, width: 1 });

    // Swirling snow particles (just rings at different phases)
    for (let ring = 0; ring < 3; ring++) {
      const ringR = fx.radius * (0.3 + ring * 0.25);
      const ringAngle = t * Math.PI * 4 + ring * 1.2;
      const rx = cx + Math.cos(ringAngle) * ringR;
      const ry = cy + Math.sin(ringAngle) * ringR;
      this.gfx.circle(rx, ry, 3);
      this.gfx.fill({ color: 0xffffff, alpha: alpha * 0.6 });
    }
  }

  destroy(): void {
    this.effects.length = 0;
    this.gfx.clear();
  }
}
