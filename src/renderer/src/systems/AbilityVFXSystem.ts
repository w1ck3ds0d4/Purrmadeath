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

interface LaserBeamEntry {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  elapsed: number;
  duration: number;
}

const DEFAULT_DURATION = 0.5;
const LASER_BEAM_DURATION = 0.15;
const FLAME_CONE_DURATION = 0.12;

interface FlameConeEntry {
  sourceX: number;
  sourceY: number;
  facing: number;
  range: number;
  arcRadians: number;
  elapsed: number;
  duration: number;
}

// Ability-specific colors
interface LightningBolt {
  sourceX: number;
  sourceY: number;
  targets: Array<{ x: number; y: number }>;
  elapsed: number;
  duration: number;
  /** Pre-computed jagged segments per bolt (source -> each target). */
  segments: Array<Array<{ x: number; y: number }>>;
}

/** Generate a jagged lightning path between two points. */
function generateLightningPath(x1: number, y1: number, x2: number, y2: number, jag: number): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = [{ x: x1, y: y1 }];
  const dx = x2 - x1, dy = y2 - y1;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const steps = Math.max(3, Math.floor(dist / 12));
  const nx = -dy / dist, ny = dx / dist; // perpendicular
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const offset = (Math.random() - 0.5) * 2 * jag;
    pts.push({ x: x1 + dx * t + nx * offset, y: y1 + dy * t + ny * offset });
  }
  pts.push({ x: x2, y: y2 });
  return pts;
}

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

  // Warrior abilities
  warcry_rage:        { fill: 0xcc2222, stroke: 0xff4444 },
  unbreakable_charge: { fill: 0x3377cc, stroke: 0x55aaff },
  blood_drain:        { fill: 0x882233, stroke: 0xaa3344 },

  // Ranger abilities - green tones
  arrow_volley:       { fill: 0x33aa44, stroke: 0x55cc66 },
  snare_net:          { fill: 0x558833, stroke: 0x77aa55 },
  grapple_hook:       { fill: 0x669944, stroke: 0x88bb66 },
  marked_for_death:   { fill: 0x44bb55, stroke: 0x66dd77 },
  multishot:          { fill: 0x33cc55, stroke: 0x55ee77 },

  // Mage abilities
  meteor_shower:      { fill: 0xff4400, stroke: 0xff7722 },
  blizzard_freeze:    { fill: 0x66aaff, stroke: 0x99ccff },
  thunderwave:        { fill: 0x4466dd, stroke: 0x6688ff },

  // Ranger abilities
  sniper_shot:        { fill: 0xffdd44, stroke: 0xffee88 },
  pack_call:          { fill: 0x88774d, stroke: 0xbbaa77 },
  explosive_barrage:  { fill: 0xff6600, stroke: 0xff9944 },
};

/**
 * Client-side visual effects for skill abilities.
 * Renders expanding circles, rings, particle bursts, etc.
 */
/** Persistent aura effect that follows an entity. */
interface PersistentAura {
  id: string;
  color: number;
  glowColor: number;
  elapsed: number;
}

export class AbilityVFXSystem {
  private gfx: Graphics;
  private effects: VFXEntry[] = [];
  private bolts: LightningBolt[] = [];
  private laserBeams: LaserBeamEntry[] = [];
  private flameCones: FlameConeEntry[] = [];
  private persistentAuras: Map<string, PersistentAura> = new Map();
  private chargeLabelEl: HTMLElement;

  constructor(parent: Container) {
    this.gfx = new Graphics();
    this.gfx.zIndex = 15;
    parent.addChild(this.gfx);

    // HTML label for charge damage counter
    this.chargeLabelEl = document.createElement('div');
    this.chargeLabelEl.style.cssText = [
      'position: fixed',
      'display: none',
      'pointer-events: none',
      'z-index: 10',
      'font-family: monospace',
      'font-size: 12px',
      'font-weight: bold',
      'color: #ff6644',
      'text-shadow: 0 0 4px rgba(0,0,0,0.8), 0 1px 2px rgba(0,0,0,0.6)',
      'text-align: center',
      'white-space: nowrap',
    ].join(';');
    document.body.appendChild(this.chargeLabelEl);
  }

  /** Check if a persistent aura is currently active. */
  hasPersistentAura(id: string): boolean {
    return this.persistentAuras.has(id);
  }

  /** Add/remove a persistent aura that follows a position each frame. */
  setPersistentAura(id: string, active: boolean, color = 0xcc2222, glowColor = 0xff4444): void {
    if (active && !this.persistentAuras.has(id)) {
      this.persistentAuras.set(id, { id, color, glowColor, elapsed: 0 });
    } else if (!active) {
      this.persistentAuras.delete(id);
    }
  }

  /** Render all active persistent auras at the given position. */
  renderPersistentAuras(x: number, y: number, dt: number): void {
    for (const aura of this.persistentAuras.values()) {
      aura.elapsed += dt;
      const t = aura.elapsed;
      const pulse = 0.85 + 0.15 * Math.sin(t * 4);
      const r = 18 * pulse;

      // Fire-like aura glow
      this.gfx.circle(x, y, r + 6);
      this.gfx.fill({ color: aura.color, alpha: 0.08 });
      this.gfx.circle(x, y, r);
      this.gfx.stroke({ color: aura.glowColor, alpha: 0.35, width: 2.5 });

      // Rising flame particles
      for (let i = 0; i < 5; i++) {
        const angle = (t * 2.5 + i * 1.256) % (Math.PI * 2);
        const dist = r * (0.6 + 0.4 * ((i * 0.37 + t * 0.5) % 1));
        const rise = ((t * 2 + i * 0.7) % 1) * 20;
        const px = x + Math.cos(angle) * dist;
        const py = y - rise - 4;
        const pAlpha = 0.4 * (1 - rise / 20);
        this.gfx.circle(px, py, 1.5);
        this.gfx.fill({ color: aura.glowColor, alpha: pAlpha });
      }
    }
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

  /** Trigger chain lightning bolts from source to all targets. */
  triggerLightning(sourceX: number, sourceY: number, targets: Array<{ x: number; y: number }>): void {
    const segments: Array<Array<{ x: number; y: number }>> = [];
    for (const t of targets) {
      segments.push(generateLightningPath(sourceX, sourceY, t.x, t.y, 10));
    }
    this.bolts.push({ sourceX, sourceY, targets, elapsed: 0, duration: 0.35, segments });
  }

  /** Trigger a laser beam VFX from source tower to target. */
  triggerLaserBeam(sourceX: number, sourceY: number, targetX: number, targetY: number): void {
    // Replace any existing beam from the same source (avoid stacking)
    for (let i = this.laserBeams.length - 1; i >= 0; i--) {
      const b = this.laserBeams[i];
      if (Math.abs(b.sourceX - sourceX) < 2 && Math.abs(b.sourceY - sourceY) < 2) {
        this.laserBeams.splice(i, 1);
      }
    }
    this.laserBeams.push({ sourceX, sourceY, targetX, targetY, elapsed: 0, duration: LASER_BEAM_DURATION });
  }

  /** Trigger a flame cone VFX from a flame tower. */
  triggerFlameCone(sourceX: number, sourceY: number, facing: number, range: number, arcRadians: number): void {
    // Replace existing cone from same source
    for (let i = this.flameCones.length - 1; i >= 0; i--) {
      const c = this.flameCones[i];
      if (Math.abs(c.sourceX - sourceX) < 2 && Math.abs(c.sourceY - sourceY) < 2) {
        this.flameCones.splice(i, 1);
      }
    }
    this.flameCones.push({ sourceX, sourceY, facing, range, arcRadians, elapsed: 0, duration: FLAME_CONE_DURATION });
  }

  update(dt: number): void {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      this.effects[i].elapsed += dt;
      if (this.effects[i].elapsed >= this.effects[i].duration) {
        this.effects.splice(i, 1);
      }
    }
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      this.bolts[i].elapsed += dt;
      if (this.bolts[i].elapsed >= this.bolts[i].duration) {
        this.bolts.splice(i, 1);
      }
    }
    for (let i = this.laserBeams.length - 1; i >= 0; i--) {
      this.laserBeams[i].elapsed += dt;
      if (this.laserBeams[i].elapsed >= this.laserBeams[i].duration) {
        this.laserBeams.splice(i, 1);
      }
    }
    for (let i = this.flameCones.length - 1; i >= 0; i--) {
      this.flameCones[i].elapsed += dt;
      if (this.flameCones[i].elapsed >= this.flameCones[i].duration) {
        this.flameCones.splice(i, 1);
      }
    }
  }

  render(cameraX: number, cameraY: number, zoom: number, screenW: number, screenH: number, localPlayer?: { x: number; y: number; dt: number; chargeProgress?: number; chargeDamage?: number }): void {
    this.gfx.clear();

    // Draw persistent auras (after clear, before other effects)
    if (localPlayer) {
      this.renderPersistentAuras(localPlayer.x, localPlayer.y, localPlayer.dt);

      // Unbreakable Charge progress bar + damage counter
      if (localPlayer.chargeProgress != null && localPlayer.chargeProgress > 0.001) {
        const barW = 50, barH = 6;
        const barX = localPlayer.x - barW / 2;
        const barY = localPlayer.y + 22;

        // Background
        this.gfx.rect(barX, barY, barW, barH);
        this.gfx.fill({ color: 0x0a0a1a, alpha: 0.85 });

        // Fill
        const progress = Math.min(1, localPlayer.chargeProgress);
        const fillW = barW * progress;
        const fillColor = progress > 0.8 ? 0x55ddff : progress > 0.5 ? 0x44aadd : 0x3388bb;
        this.gfx.rect(barX, barY, fillW, barH);
        this.gfx.fill({ color: fillColor, alpha: 0.9 });

        // Border
        this.gfx.rect(barX, barY, barW, barH);
        this.gfx.stroke({ color: 0x6699dd, alpha: 0.7, width: 1 });

        // Show damage counter as HTML label (positioned in screen space)
        const dmg = localPlayer.chargeDamage ?? 0;
        const screenX = (localPlayer.x - cameraX) * zoom + screenW / 2;
        const screenY = (barY + barH + 4 - cameraY) * zoom + screenH / 2;
        this.chargeLabelEl.style.display = 'block';
        this.chargeLabelEl.style.left = `${screenX}px`;
        this.chargeLabelEl.style.top = `${screenY}px`;
        this.chargeLabelEl.style.transform = 'translateX(-50%)';
        const releaseDmg = 75 + Math.round(dmg * 2);
        this.chargeLabelEl.textContent = `${releaseDmg} DMG`;
      } else {
        this.chargeLabelEl.style.display = 'none';
      }
    }

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
        case 'aegis':
        case 'unbreakable_charge':
          this.drawStaticTauntZone(fx, t, colors);
          break;
        case 'warcry_rage':
        case 'multishot':
        case 'vanish':
        case 'wild_transformation':
        case 'guardian_angel':
          this.drawBuffAura(fx, t, colors);
          break;
        case 'war_cry':
        case 'primal_roar':
        case 'marked_for_death':
        case 'death_mark':
        case 'bone_prison':
        case 'thunderwave':
          this.drawThunderwave(fx, t);
          break;
        case 'rain_of_arrows':
        case 'judgment_hammer':
        case 'death_coil':
          this.drawRainOfArrows(fx, t, colors);
          break;
        case 'meteor_shower':
          this.drawMeteorShower(fx, t, colors);
          break;
        case 'explosive_trap':
        case 'meteor':
        case 'fan_of_knives':
        case 'divine_smite':
        case 'natures_wrath':
          this.drawExplosion(fx, t, colors);
          break;
        case 'shadow_step':
        case 'teleport':
          this.drawTeleport(fx, t, colors);
          break;
        case 'phantom_strike':
        case 'stampede':
        case 'grapple_hook':
          this.drawDashTrail(fx, t, colors);
          break;
        case 'raise_dead':
        case 'pack_hunt':
          this.drawSummon(fx, t, colors);
          break;
        case 'arrow_volley':
          this.drawConePyroclasm(fx, t, colors);
          break;
        case 'smoke_bomb':
          this.drawSmokeBomb(fx, t, colors);
          break;
        case 'blizzard_freeze':
          this.drawBlizzardFreeze(fx, t);
          break;
        case 'blizzard':
        case 'snare_net':
        case 'consecration':
        case 'plague_cloud':
        case 'soul_drain':
        case 'blood_drain':
          this.drawBlizzard(fx, t, colors);
          break;

        // ── Ranger VFX ──────────────────────────────────────────────────
        case 'sniper_shot':
          // Golden charging glow around the player that intensifies over time
          this.drawShieldBubble(fx, t, colors);
          break;
        case 'pack_call':
          // Poof of brown/nature particles where wolves spawn
          this.drawExplosion(fx, t, colors);
          break;
        case 'explosive_barrage':
          // Orange explosion at impact point
          this.drawExplosion(fx, t, colors);
          break;

        default:
          this.drawExpandingRing(fx, t, colors);
          break;
      }
    }

    // ── Lightning bolts ──
    for (const bolt of this.bolts) {
      const bt = bolt.elapsed / bolt.duration;
      const alpha = bt < 0.15 ? bt / 0.15 : (1 - bt) * 0.8;

      // Core bolt (bright white-blue)
      for (const seg of bolt.segments) {
        if (seg.length < 2) continue;
        this.gfx.moveTo(seg[0].x, seg[0].y);
        for (let i = 1; i < seg.length; i++) this.gfx.lineTo(seg[i].x, seg[i].y);
        this.gfx.stroke({ color: 0xaaddff, alpha, width: 2.5 });
        // Glow pass
        this.gfx.moveTo(seg[0].x, seg[0].y);
        for (let i = 1; i < seg.length; i++) this.gfx.lineTo(seg[i].x, seg[i].y);
        this.gfx.stroke({ color: 0x4488ff, alpha: alpha * 0.4, width: 6 });
      }

      // Impact flash at source
      if (bt < 0.2) {
        const flashAlpha = (1 - bt / 0.2) * 0.5;
        this.gfx.circle(bolt.sourceX, bolt.sourceY, 8);
        this.gfx.fill({ color: 0xaaddff, alpha: flashAlpha });
      }

      // Impact sparks at each target
      for (const tgt of bolt.targets) {
        const sparkAlpha = alpha * 0.6;
        this.gfx.circle(tgt.x, tgt.y, 4);
        this.gfx.fill({ color: 0xffffff, alpha: sparkAlpha });
        this.gfx.circle(tgt.x, tgt.y, 8);
        this.gfx.fill({ color: 0x4488ff, alpha: sparkAlpha * 0.3 });
      }
    }

    // ── Laser beams ──
    for (const beam of this.laserBeams) {
      const bt = beam.elapsed / beam.duration;
      // Pulsing alpha for visual interest
      const pulse = 0.7 + 0.3 * Math.sin(beam.elapsed * 30);
      const alpha = (bt < 0.1 ? bt / 0.1 : 1 - bt) * pulse;

      // Outer glow (wider, semi-transparent red)
      this.gfx.moveTo(beam.sourceX, beam.sourceY);
      this.gfx.lineTo(beam.targetX, beam.targetY);
      this.gfx.stroke({ color: 0xff2222, alpha: alpha * 0.3, width: 8 });

      // Core beam (thin bright red-white)
      this.gfx.moveTo(beam.sourceX, beam.sourceY);
      this.gfx.lineTo(beam.targetX, beam.targetY);
      this.gfx.stroke({ color: 0xff6666, alpha, width: 2 });

      // Bright center
      this.gfx.moveTo(beam.sourceX, beam.sourceY);
      this.gfx.lineTo(beam.targetX, beam.targetY);
      this.gfx.stroke({ color: 0xffaaaa, alpha: alpha * 0.8, width: 1 });

      // Impact glow at target
      if (bt < 0.5) {
        const impactAlpha = alpha * 0.5;
        this.gfx.circle(beam.targetX, beam.targetY, 6);
        this.gfx.fill({ color: 0xff4444, alpha: impactAlpha });
        this.gfx.circle(beam.targetX, beam.targetY, 10);
        this.gfx.fill({ color: 0xff2222, alpha: impactAlpha * 0.3 });
      }
    }

    // ── Flame cones ──
    for (const cone of this.flameCones) {
      const ct = cone.elapsed / cone.duration;
      const alpha = (ct < 0.15 ? ct / 0.15 : 1 - ct) * 0.6;
      const halfArc = cone.arcRadians / 2;
      const segments = 16;
      const r = cone.range;

      // Filled cone (orange-red gradient)
      this.gfx.moveTo(cone.sourceX, cone.sourceY);
      for (let i = 0; i <= segments; i++) {
        const angle = cone.facing - halfArc + (cone.arcRadians * i / segments);
        this.gfx.lineTo(cone.sourceX + Math.cos(angle) * r, cone.sourceY + Math.sin(angle) * r);
      }
      this.gfx.closePath();
      this.gfx.fill({ color: 0xff4400, alpha: alpha * 0.2 });

      // Cone outline (bright orange)
      this.gfx.moveTo(cone.sourceX, cone.sourceY);
      for (let i = 0; i <= segments; i++) {
        const angle = cone.facing - halfArc + (cone.arcRadians * i / segments);
        this.gfx.lineTo(cone.sourceX + Math.cos(angle) * r, cone.sourceY + Math.sin(angle) * r);
      }
      this.gfx.closePath();
      this.gfx.stroke({ color: 0xff6622, alpha: alpha * 0.5, width: 1.5 });

      // Inner flame particles
      for (let i = 0; i < 8; i++) {
        const pAngle = cone.facing - halfArc + Math.random() * cone.arcRadians;
        const pDist = r * (0.2 + Math.random() * 0.8);
        const px = cone.sourceX + Math.cos(pAngle) * pDist;
        const py = cone.sourceY + Math.sin(pAngle) * pDist;
        const size = 2 + Math.random() * 3;
        this.gfx.circle(px, py, size);
        this.gfx.fill({ color: Math.random() > 0.5 ? 0xff8833 : 0xffcc22, alpha: alpha * (0.4 + Math.random() * 0.4) });
      }

      // Hot core near source
      this.gfx.circle(cone.sourceX + Math.cos(cone.facing) * 8, cone.sourceY + Math.sin(cone.facing) * 8, 5);
      this.gfx.fill({ color: 0xffdd44, alpha: alpha * 0.5 });
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

  private drawStaticTauntZone(fx: VFXEntry, t: number, colors: { fill: number; stroke: number }): void {
    // Static circle showing taunt area - no pulsing, fades in/out
    const alpha = t < 0.05 ? t / 0.05 * 0.3 : (t > 0.9 ? (1 - t) / 0.1 * 0.3 : 0.3);
    this.gfx.circle(fx.x, fx.y, fx.radius);
    this.gfx.fill({ color: colors.fill, alpha: alpha * 0.08 });
    this.gfx.circle(fx.x, fx.y, fx.radius);
    this.gfx.stroke({ color: colors.stroke, alpha: alpha * 0.5, width: 1.5 });
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

  private drawGroundSlam(fx: VFXEntry, t: number, colors: { fill: number; stroke: number }): void {
    const alpha = (1 - t) * 0.7;
    const r = fx.radius * t;
    // Shockwave ring
    this.gfx.circle(fx.x, fx.y, r);
    this.gfx.stroke({ color: colors.stroke, alpha, width: 3 });
    // Inner impact
    if (t < 0.3) {
      const ia = (1 - t / 0.3) * 0.4;
      this.gfx.circle(fx.x, fx.y, fx.radius * 0.3);
      this.gfx.fill({ color: colors.fill, alpha: ia });
    }
    // Debris particles
    const count = 8;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const dist = r * 0.8;
      const px = fx.x + Math.cos(angle) * dist;
      const py = fx.y + Math.sin(angle) * dist;
      this.gfx.circle(px, py, 2 + (1 - t) * 2);
      this.gfx.fill({ color: colors.fill, alpha: alpha * 0.6 });
    }
  }

  private drawDashTrail(fx: VFXEntry, t: number, colors: { fill: number; stroke: number }): void {
    const alpha = (1 - t) * 0.6;
    const tx = fx.targetX ?? fx.x;
    const ty = fx.targetY ?? fx.y;
    // Trail line
    this.gfx.moveTo(fx.x, fx.y);
    this.gfx.lineTo(tx, ty);
    this.gfx.stroke({ color: colors.stroke, alpha, width: 4 });
    // Glow trail
    this.gfx.moveTo(fx.x, fx.y);
    this.gfx.lineTo(tx, ty);
    this.gfx.stroke({ color: colors.fill, alpha: alpha * 0.3, width: 10 });
    // Afterimage circles along path
    const steps = 5;
    for (let i = 0; i < steps; i++) {
      const st = i / steps;
      const px = fx.x + (tx - fx.x) * st;
      const py = fx.y + (ty - fx.y) * st;
      const sa = alpha * (1 - st) * 0.4;
      this.gfx.circle(px, py, 6);
      this.gfx.fill({ color: colors.fill, alpha: sa });
    }
    // Impact flash at destination
    if (t < 0.2) {
      this.gfx.circle(tx, ty, 12 * (1 - t / 0.2));
      this.gfx.fill({ color: 0xffffff, alpha: (1 - t / 0.2) * 0.5 });
    }
  }

  private drawConePyroclasm(fx: VFXEntry, t: number, colors: { fill: number; stroke: number }): void {
    const alpha = (1 - t) * 0.6;
    const facing = fx.facing ?? 0;
    const halfArc = 0.4; // ~45 degrees
    const r = fx.radius * (0.3 + 0.7 * t);
    // Filled cone
    this.gfx.moveTo(fx.x, fx.y);
    const segments = 12;
    for (let i = 0; i <= segments; i++) {
      const angle = facing - halfArc + (2 * halfArc * i / segments);
      this.gfx.lineTo(fx.x + Math.cos(angle) * r, fx.y + Math.sin(angle) * r);
    }
    this.gfx.closePath();
    this.gfx.fill({ color: colors.fill, alpha: alpha * 0.3 });
    // Cone outline
    this.gfx.moveTo(fx.x, fx.y);
    for (let i = 0; i <= segments; i++) {
      const angle = facing - halfArc + (2 * halfArc * i / segments);
      this.gfx.lineTo(fx.x + Math.cos(angle) * r, fx.y + Math.sin(angle) * r);
    }
    this.gfx.closePath();
    this.gfx.stroke({ color: colors.stroke, alpha, width: 2 });
    // Fire particles
    for (let i = 0; i < 6; i++) {
      const pa = facing - halfArc + Math.random() * 2 * halfArc;
      const pd = r * (0.3 + Math.random() * 0.7);
      const px = fx.x + Math.cos(pa) * pd;
      const py = fx.y + Math.sin(pa) * pd;
      this.gfx.circle(px, py, 2 + Math.random() * 3);
      this.gfx.fill({ color: 0xff8833, alpha: alpha * 0.7 });
    }
  }

  private drawIcePrison(fx: VFXEntry, t: number, colors: { fill: number; stroke: number }): void {
    const alpha = t < 0.1 ? t / 0.1 * 0.5 : (t > 0.8 ? (1 - t) / 0.2 * 0.5 : 0.5);
    const r = fx.radius;
    // Ice zone fill
    this.gfx.circle(fx.x, fx.y, r);
    this.gfx.fill({ color: colors.fill, alpha: alpha * 0.15 });
    // Hexagonal cage outline
    for (let i = 0; i < 6; i++) {
      const a1 = (i / 6) * Math.PI * 2;
      const a2 = ((i + 1) / 6) * Math.PI * 2;
      this.gfx.moveTo(fx.x + Math.cos(a1) * r, fx.y + Math.sin(a1) * r);
      this.gfx.lineTo(fx.x + Math.cos(a2) * r, fx.y + Math.sin(a2) * r);
      this.gfx.stroke({ color: colors.stroke, alpha, width: 2 });
    }
    // Inner crystal lines
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + t * 0.5;
      this.gfx.moveTo(fx.x + Math.cos(a) * r * 0.3, fx.y + Math.sin(a) * r * 0.3);
      this.gfx.lineTo(fx.x + Math.cos(a + Math.PI) * r * 0.3, fx.y + Math.sin(a + Math.PI) * r * 0.3);
      this.gfx.stroke({ color: 0xccddff, alpha: alpha * 0.4, width: 1 });
    }
    // Frost sparkles
    for (let i = 0; i < 4; i++) {
      const sa = Math.random() * Math.PI * 2;
      const sd = Math.random() * r;
      this.gfx.circle(fx.x + Math.cos(sa) * sd, fx.y + Math.sin(sa) * sd, 2);
      this.gfx.fill({ color: 0xffffff, alpha: alpha * 0.6 });
    }
  }

  private drawSmokeBomb(fx: VFXEntry, t: number, colors: { fill: number; stroke: number }): void {
    const alpha = t < 0.1 ? t / 0.1 * 0.5 : (t > 0.8 ? (1 - t) / 0.2 * 0.5 : 0.5);
    const r = fx.radius * (0.5 + 0.5 * Math.min(1, t * 3));
    // Dark smoke fill
    this.gfx.circle(fx.x, fx.y, r);
    this.gfx.fill({ color: 0x111122, alpha: alpha * 0.4 });
    this.gfx.circle(fx.x, fx.y, r);
    this.gfx.stroke({ color: colors.stroke, alpha: alpha * 0.3, width: 2 });
    // Swirling smoke tendrils
    for (let i = 0; i < 5; i++) {
      const angle = (i / 5) * Math.PI * 2 + t * Math.PI * 2;
      const tr = r * (0.4 + 0.3 * Math.sin(t * 8 + i));
      const tx = fx.x + Math.cos(angle) * tr;
      const ty = fx.y + Math.sin(angle) * tr;
      this.gfx.circle(tx, ty, 4 + Math.sin(t * 6 + i * 2) * 2);
      this.gfx.fill({ color: colors.fill, alpha: alpha * 0.3 });
    }
  }

  private drawSummon(fx: VFXEntry, t: number, colors: { fill: number; stroke: number }): void {
    const alpha = (1 - t) * 0.6;
    const count = 4;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const dist = 30 + i * 15;
      const sx = fx.x + Math.cos(angle) * dist;
      const sy = fx.y + Math.sin(angle) * dist;
      // Rising sparkle
      const rise = t * 20;
      this.gfx.circle(sx, sy - rise, 3 + (1 - t) * 4);
      this.gfx.fill({ color: colors.stroke, alpha });
      // Ground circle
      const gr = 8 * (1 - t);
      this.gfx.circle(sx, sy, gr);
      this.gfx.fill({ color: colors.fill, alpha: alpha * 0.3 });
    }
    // Center flash
    if (t < 0.15) {
      this.gfx.circle(fx.x, fx.y, 15 * (1 - t / 0.15));
      this.gfx.fill({ color: 0xffffff, alpha: (1 - t / 0.15) * 0.4 });
    }
  }

  private drawBuffAura(fx: VFXEntry, t: number, colors: { fill: number; stroke: number }): void {
    const pulse = 0.8 + 0.2 * Math.sin(t * Math.PI * 6);
    const alpha = t < 0.1 ? t / 0.1 * 0.4 : (t > 0.85 ? (1 - t) / 0.15 * 0.4 : 0.4);
    const r = 20 * pulse;
    // Inner glow
    this.gfx.circle(fx.x, fx.y, r);
    this.gfx.fill({ color: colors.fill, alpha: alpha * 0.2 });
    // Outer ring
    this.gfx.circle(fx.x, fx.y, r + 4);
    this.gfx.stroke({ color: colors.stroke, alpha: alpha * 0.6, width: 2 });
    // Rising particles
    for (let i = 0; i < 3; i++) {
      const pa = (t * 4 + i * 2.1) % (Math.PI * 2);
      const pd = r * 0.8;
      const rise = ((t * 3 + i) % 1) * 15;
      const px = fx.x + Math.cos(pa) * pd;
      const py = fx.y - rise;
      this.gfx.circle(px, py, 2);
      this.gfx.fill({ color: colors.stroke, alpha: alpha * 0.5 });
    }
  }

  private drawRiftCollapse(fx: VFXEntry, t: number, colors: { fill: number; stroke: number }): void {
    const alpha = (1 - t) * 0.6;
    const r = fx.radius * (1 - t * 0.5);
    const cx = fx.targetX ?? fx.x;
    const cy = fx.targetY ?? fx.y;
    // Contracting ring
    this.gfx.circle(cx, cy, r);
    this.gfx.stroke({ color: colors.stroke, alpha, width: 2 });
    // Center dark point
    this.gfx.circle(cx, cy, 6 + t * 8);
    this.gfx.fill({ color: 0x220033, alpha: alpha * 0.5 });
    // Spiral pull lines (inward)
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2 + t * Math.PI * 4;
      const outerR = r;
      const innerR = 10 + t * 15;
      this.gfx.moveTo(cx + Math.cos(angle) * outerR, cy + Math.sin(angle) * outerR);
      this.gfx.lineTo(cx + Math.cos(angle + 0.3) * innerR, cy + Math.sin(angle + 0.3) * innerR);
      this.gfx.stroke({ color: colors.fill, alpha: alpha * 0.4, width: 1.5 });
    }
  }

  private drawMeteorShower(fx: VFXEntry, t: number, _colors: { fill: number; stroke: number }): void {
    const cx = fx.targetX ?? fx.x;
    const cy = fx.targetY ?? fx.y;
    const r = fx.radius;

    // Danger zone ring (faint red circle)
    const zoneAlpha = t < 0.05 ? t / 0.05 * 0.12 : (t > 0.9 ? (1 - t) / 0.1 * 0.12 : 0.12);
    this.gfx.circle(cx, cy, r);
    this.gfx.stroke({ color: 0xff4400, alpha: zoneAlpha, width: 2 });
    this.gfx.circle(cx, cy, r);
    this.gfx.fill({ color: 0xff2200, alpha: zoneAlpha * 0.15 });

    // Simulate large meteors falling at staggered phases
    const meteorCount = 6;
    for (let i = 0; i < meteorCount; i++) {
      const phase = ((t * 2.5 + i * 0.42) % 1);

      // Spread across the full area using golden angle distribution (fixed positions)
      const goldenAngle = 2.399963; // ~137.5 degrees
      const mAngle = i * goldenAngle;
      const mDist = r * (0.15 + (i / meteorCount) * 0.75);
      const mx = cx + Math.cos(mAngle) * mDist;
      const my = cy + Math.sin(mAngle) * mDist;

      if (phase < 0.35) {
        // FALLING PHASE - rock drops straight down onto mx, my
        const fallT = phase / 0.35;
        const meteorX = mx;
        const meteorY = my - 100 * (1 - fallT); // falls straight down to my
        const alpha = 0.3 + fallT * 0.7;
        const meteorSize = 8 + fallT * 6;

        // White smoke trail behind the meteor (above it)
        for (let s = 0; s < 4; s++) {
          const smokeY2 = meteorY - 15 - s * 18;
          const smokeSize = 5 + s * 3;
          const smokeAlpha = alpha * (0.25 - s * 0.06);
          if (smokeAlpha > 0.02) {
            this.gfx.circle(meteorX + Math.sin(s * 2.5) * 3, smokeY2, smokeSize);
            this.gfx.fill({ color: 0xddccbb, alpha: smokeAlpha });
          }
        }

        // Rock body (dark core + bright edge)
        this.gfx.circle(meteorX, meteorY, meteorSize);
        this.gfx.fill({ color: 0x664422, alpha: alpha });
        this.gfx.circle(meteorX, meteorY, meteorSize * 0.7);
        this.gfx.fill({ color: 0xff8844, alpha: alpha * 0.6 });
        // Hot glow
        this.gfx.circle(meteorX, meteorY, meteorSize * 1.5);
        this.gfx.fill({ color: 0xff4400, alpha: alpha * 0.15 });
      } else if (phase < 0.7) {
        // IMPACT PHASE - large explosion with shockwave
        const impactT = (phase - 0.35) / 0.35;
        const alpha = (1 - impactT) * 0.8;
        const blastR = 15 + impactT * 40;

        // White-hot center flash
        if (impactT < 0.3) {
          const flashAlpha = (1 - impactT / 0.3) * 0.7;
          this.gfx.circle(mx, my, 12);
          this.gfx.fill({ color: 0xffffcc, alpha: flashAlpha });
        }

        // Inner fire
        this.gfx.circle(mx, my, blastR * 0.5);
        this.gfx.fill({ color: 0xff6622, alpha: alpha * 0.5 });

        // Outer blast
        this.gfx.circle(mx, my, blastR);
        this.gfx.fill({ color: 0xff4400, alpha: alpha * 0.2 });
        this.gfx.circle(mx, my, blastR);
        this.gfx.stroke({ color: 0xff6622, alpha: alpha * 0.4, width: 2 });

        // Expanding shockwave ring
        const ringR = blastR * 1.3;
        this.gfx.circle(mx, my, ringR);
        this.gfx.stroke({ color: 0xffaa44, alpha: alpha * 0.3, width: 1 });

        // Flying debris rocks
        for (let d = 0; d < 5; d++) {
          const dAngle = (d / 5) * Math.PI * 2 + i * 1.3;
          const dDist = blastR * (0.5 + impactT * 0.8);
          const dSize = 3 - impactT * 2;
          if (dSize > 0.5) {
            this.gfx.circle(mx + Math.cos(dAngle) * dDist, my + Math.sin(dAngle) * dDist, dSize);
            this.gfx.fill({ color: 0x885533, alpha: alpha * 0.6 });
          }
        }
      }
      // phase 0.7-1.0: gap before next meteor cycle
    }
  }

  private drawThunderwave(fx: VFXEntry, t: number): void {
    const alpha = (1 - t) * 0.7;
    const r = fx.radius * t;

    // Yellow shockwave ring (expanding)
    this.gfx.circle(fx.x, fx.y, r);
    this.gfx.stroke({ color: 0xffdd44, alpha, width: 4 });
    // Inner glow ring
    this.gfx.circle(fx.x, fx.y, r * 0.95);
    this.gfx.stroke({ color: 0xffffaa, alpha: alpha * 0.4, width: 8 });

    // Yellow fill pulse
    if (t < 0.3) {
      const fillAlpha = (1 - t / 0.3) * 0.15;
      this.gfx.circle(fx.x, fx.y, r);
      this.gfx.fill({ color: 0xffee66, alpha: fillAlpha });
    }

    // Lightning bolts radiating outward from center
    const boltCount = 8;
    for (let i = 0; i < boltCount; i++) {
      const angle = (i / boltCount) * Math.PI * 2 + t * 3;
      const boltLen = r * 0.9;
      // Jagged bolt from center outward
      let bx = fx.x, by = fx.y;
      const segments = 5;
      this.gfx.moveTo(bx, by);
      for (let s = 1; s <= segments; s++) {
        const st = s / segments;
        const baseX = fx.x + Math.cos(angle) * boltLen * st;
        const baseY = fx.y + Math.sin(angle) * boltLen * st;
        // Perpendicular jag
        const perpX = -Math.sin(angle);
        const perpY = Math.cos(angle);
        const jag = (Math.sin(s * 7 + i * 3 + t * 20) * 12) * (1 - st);
        bx = baseX + perpX * jag;
        by = baseY + perpY * jag;
        this.gfx.lineTo(bx, by);
      }
      this.gfx.stroke({ color: 0xffee88, alpha: alpha * 0.6, width: 2 });
      // Glow pass
      this.gfx.moveTo(fx.x, fx.y);
      for (let s = 1; s <= segments; s++) {
        const st = s / segments;
        const baseX = fx.x + Math.cos(angle) * boltLen * st;
        const baseY = fx.y + Math.sin(angle) * boltLen * st;
        const perpX = -Math.sin(angle);
        const perpY = Math.cos(angle);
        const jag = (Math.sin(s * 7 + i * 3 + t * 20) * 12) * (1 - st);
        this.gfx.lineTo(baseX + perpX * jag, baseY + perpY * jag);
      }
      this.gfx.stroke({ color: 0xffdd22, alpha: alpha * 0.2, width: 5 });
    }

    // Center flash
    if (t < 0.15) {
      const flashAlpha = (1 - t / 0.15) * 0.6;
      this.gfx.circle(fx.x, fx.y, 15);
      this.gfx.fill({ color: 0xffffff, alpha: flashAlpha });
    }

    // Sparks at the ring edge
    for (let i = 0; i < 12; i++) {
      const sparkAngle = (i / 12) * Math.PI * 2 + t * 5;
      const sparkR = r + (Math.sin(i * 4 + t * 15) * 8);
      const sx = fx.x + Math.cos(sparkAngle) * sparkR;
      const sy = fx.y + Math.sin(sparkAngle) * sparkR;
      this.gfx.circle(sx, sy, 2);
      this.gfx.fill({ color: 0xffffcc, alpha: alpha * 0.5 });
    }
  }

  private drawBlizzardFreeze(fx: VFXEntry, t: number): void {
    const cx = fx.targetX ?? fx.x;
    const cy = fx.targetY ?? fx.y;
    const r = fx.radius;
    // Steady alpha with fade in/out
    const alpha = t < 0.1 ? t / 0.1 * 0.5 : (t > 0.85 ? (1 - t) / 0.15 * 0.5 : 0.5);

    // Ice zone fill
    this.gfx.circle(cx, cy, r);
    this.gfx.fill({ color: 0x88ccff, alpha: alpha * 0.12 });
    // Zone border
    this.gfx.circle(cx, cy, r);
    this.gfx.stroke({ color: 0x66aaff, alpha: alpha * 0.4, width: 2 });

    // Inner frost ring
    this.gfx.circle(cx, cy, r * 0.7);
    this.gfx.stroke({ color: 0xaaddff, alpha: alpha * 0.2, width: 1 });

    // Swirling snowflake particles (many!)
    const particleCount = 20;
    for (let i = 0; i < particleCount; i++) {
      const pAngle = (i / particleCount) * Math.PI * 2 + t * Math.PI * 2 * (i % 2 === 0 ? 1 : -1);
      const pDist = r * (0.2 + (i % 5) * 0.16);
      const wobble = Math.sin(t * 8 + i * 1.7) * 10;
      const px = cx + Math.cos(pAngle) * (pDist + wobble);
      const py = cy + Math.sin(pAngle) * (pDist + wobble);
      const size = 2 + (i % 3);
      this.gfx.circle(px, py, size);
      this.gfx.fill({ color: 0xffffff, alpha: alpha * (0.4 + (i % 3) * 0.15) });
    }

    // Floating ice shards (larger, slower)
    for (let i = 0; i < 6; i++) {
      const shardAngle = (i / 6) * Math.PI * 2 + t * 1.5;
      const shardDist = r * (0.3 + 0.3 * Math.sin(t * 3 + i * 2));
      const sx = cx + Math.cos(shardAngle) * shardDist;
      const sy = cy + Math.sin(shardAngle) * shardDist;
      // Diamond shape
      const shardSize = 5 + Math.sin(t * 4 + i) * 2;
      this.gfx.moveTo(sx, sy - shardSize);
      this.gfx.lineTo(sx + shardSize * 0.6, sy);
      this.gfx.lineTo(sx, sy + shardSize);
      this.gfx.lineTo(sx - shardSize * 0.6, sy);
      this.gfx.closePath();
      this.gfx.fill({ color: 0xccddff, alpha: alpha * 0.4 });
      this.gfx.moveTo(sx, sy - shardSize);
      this.gfx.lineTo(sx + shardSize * 0.6, sy);
      this.gfx.lineTo(sx, sy + shardSize);
      this.gfx.lineTo(sx - shardSize * 0.6, sy);
      this.gfx.closePath();
      this.gfx.stroke({ color: 0xaaccff, alpha: alpha * 0.5, width: 1 });
    }

    // Ground frost sparkles (random positions, twinkling)
    for (let i = 0; i < 15; i++) {
      const sparkSeed = i * 7919;
      const sparkAngle = ((sparkSeed & 0xffff) / 0xffff) * Math.PI * 2;
      const sparkDist = ((sparkSeed >> 8 & 0xff) / 0xff) * r * 0.9;
      const twinkle = Math.sin(t * 12 + i * 2.3) * 0.5 + 0.5;
      const gx = cx + Math.cos(sparkAngle) * sparkDist;
      const gy = cy + Math.sin(sparkAngle) * sparkDist;
      this.gfx.circle(gx, gy, 1.5);
      this.gfx.fill({ color: 0xffffff, alpha: alpha * twinkle * 0.6 });
    }
  }

  destroy(): void {
    this.effects.length = 0;
    this.bolts.length = 0;
    this.laserBeams.length = 0;
    this.flameCones.length = 0;
    this.persistentAuras.clear();
    this.chargeLabelEl.style.display = 'none';
    this.gfx.clear();
  }
}
