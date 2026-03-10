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

  // Warrior abilities - red/orange tones
  ground_slam:        { fill: 0xcc4422, stroke: 0xff6633 },
  shield_charge:      { fill: 0xbb5500, stroke: 0xdd7722 },
  battle_fury:        { fill: 0xdd3311, stroke: 0xff5533 },
  earthquake:         { fill: 0xaa3300, stroke: 0xcc5522 },
  blade_storm:        { fill: 0xdd2222, stroke: 0xff4444 },

  // Ranger abilities - green tones
  arrow_volley:       { fill: 0x33aa44, stroke: 0x55cc66 },
  snare_net:          { fill: 0x558833, stroke: 0x77aa55 },
  grapple_hook:       { fill: 0x669944, stroke: 0x88bb66 },
  marked_for_death:   { fill: 0x44bb55, stroke: 0x66dd77 },
  multishot:          { fill: 0x33cc55, stroke: 0x55ee77 },

  // Mage abilities - purple/blue tones
  pyroclasm:          { fill: 0xff4400, stroke: 0xff7722 },
  ice_prison:         { fill: 0x4488cc, stroke: 0x66aaee },
  arcane_barrage:     { fill: 0x9944dd, stroke: 0xbb66ff },
  lightning_storm:    { fill: 0x4466dd, stroke: 0x6688ff },
  rift_collapse:      { fill: 0x7733cc, stroke: 0x9955ee },

  // Assassin abilities - dark red/shadow tones
  phantom_strike:     { fill: 0x553366, stroke: 0x775588 },
  smoke_bomb:         { fill: 0x444444, stroke: 0x666666 },
  death_mark:         { fill: 0x882233, stroke: 0xaa4455 },
  fan_of_knives:      { fill: 0x774433, stroke: 0x996655 },
  vanish:             { fill: 0x332244, stroke: 0x554466 },

  // Paladin abilities - gold/white tones
  divine_smite:       { fill: 0xddaa22, stroke: 0xffcc44 },
  aegis:              { fill: 0xccbb44, stroke: 0xeedd66 },
  judgment_hammer:    { fill: 0xeebb33, stroke: 0xffdd55 },
  consecration:       { fill: 0xddcc55, stroke: 0xffee77 },
  guardian_angel:     { fill: 0xeeeeaa, stroke: 0xffffcc },

  // Necromancer abilities - teal/dark green tones
  raise_dead:         { fill: 0x228866, stroke: 0x44aa88 },
  soul_drain:         { fill: 0x33aa88, stroke: 0x55ccaa },
  death_coil:         { fill: 0x227755, stroke: 0x449977 },
  bone_prison:        { fill: 0x559977, stroke: 0x77bb99 },
  plague_cloud:       { fill: 0x448844, stroke: 0x66aa66 },

  // Beastmaster abilities - orange/brown tones
  stampede:           { fill: 0xaa7733, stroke: 0xcc9955 },
  pack_hunt:          { fill: 0x996633, stroke: 0xbb8855 },
  primal_roar:        { fill: 0xcc8822, stroke: 0xeeaa44 },
  natures_wrath:      { fill: 0x77aa33, stroke: 0x99cc55 },
  wild_transformation:{ fill: 0xbb6622, stroke: 0xdd8844 },
};

/**
 * Client-side visual effects for skill abilities.
 * Renders expanding circles, rings, particle bursts, etc.
 */
export class AbilityVFXSystem {
  private gfx: Graphics;
  private effects: VFXEntry[] = [];
  private bolts: LightningBolt[] = [];
  private laserBeams: LaserBeamEntry[] = [];
  private flameCones: FlameConeEntry[] = [];

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
        case 'blade_storm':
          this.drawWhirlwind(fx, t, colors);
          break;
        case 'shield_wall':
        case 'aegis':
          this.drawShieldBubble(fx, t, colors);
          break;
        case 'battle_fury':
        case 'multishot':
        case 'vanish':
        case 'wild_transformation':
        case 'guardian_angel':
          this.drawBuffAura(fx, t, colors);
          break;
        case 'war_cry':
        case 'primal_roar':
        case 'lightning_storm':
        case 'marked_for_death':
        case 'death_mark':
        case 'bone_prison':
          this.drawExpandingRing(fx, t, colors);
          break;
        case 'rain_of_arrows':
        case 'judgment_hammer':
        case 'death_coil':
        case 'arcane_barrage':
          this.drawRainOfArrows(fx, t, colors);
          break;
        case 'explosive_trap':
        case 'meteor':
        case 'fan_of_knives':
        case 'divine_smite':
        case 'natures_wrath':
          this.drawExplosion(fx, t, colors);
          break;
        case 'ground_slam':
        case 'earthquake':
          this.drawGroundSlam(fx, t, colors);
          break;
        case 'shadow_step':
        case 'teleport':
          this.drawTeleport(fx, t, colors);
          break;
        case 'shield_charge':
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
        case 'pyroclasm':
          this.drawConePyroclasm(fx, t, colors);
          break;
        case 'ice_prison':
          this.drawIcePrison(fx, t, colors);
          break;
        case 'smoke_bomb':
          this.drawSmokeBomb(fx, t, colors);
          break;
        case 'rift_collapse':
          this.drawRiftCollapse(fx, t, colors);
          break;
        case 'blizzard':
        case 'snare_net':
        case 'consecration':
        case 'plague_cloud':
        case 'soul_drain':
          this.drawBlizzard(fx, t, colors);
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

  destroy(): void {
    this.effects.length = 0;
    this.bolts.length = 0;
    this.laserBeams.length = 0;
    this.flameCones.length = 0;
    this.gfx.clear();
  }
}
