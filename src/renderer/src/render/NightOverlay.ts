import { Sprite, Texture, Container, ImageSource } from 'pixi.js';
import { DAY_MAX_DURATION, NIGHT_DARKNESS_ALPHA } from '@shared/constants';
import type { DayNightPhase } from '@shared/protocol';

/**
 * Full-screen dark overlay with circular torch cutouts around players,
 * plus a separate ambient color-grading layer for time-of-day simulation.
 *
 * Two layers:
 * 1. Ambient tint (multiply blend, zIndex 99) - tints the visible world
 *    warm orange at sunrise/sunset, neutral at midday. Does NOT affect
 *    the dark areas outside torch range since multiply(black, X) = black.
 * 2. Darkness overlay (zIndex 100) - standard torch-cutout night darkness.
 */

/** Position in world coordinates. */
export interface LightSource {
  x: number;
  y: number;
  radius: number;
  /** Optional tint color (0xRRGGBB) for colored glows (e.g. portal faction). */
  color?: number;
}

/** Color stop for daytime ambient interpolation. */
interface ColorStop {
  t: number;
  r: number;
  g: number;
  b: number;
  a: number;
}

export class NightOverlay {
  // ── Darkness layer (torch cutouts) ──
  private sprite: Sprite;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private tex: Texture | null = null;
  private darkness = 0;
  private tintR = 8;
  private tintG = 8;
  private tintB = 30;
  /** When true, setTint() is active (blood moon etc) and ambient is bypassed. */
  private tintOverride = false;
  /** Canvas resolution scale (lower = faster, 0.5 = half res). */
  private readonly scale = 0.5;

  // ── Ambient tint layer (color grading) ──
  private ambientSprite: Sprite;
  private ambientCanvas: HTMLCanvasElement;
  private ambientCtx: CanvasRenderingContext2D;
  private ambientTex: Texture | null = null;

  // Ambient lighting state
  private ambientR = 255;
  private ambientG = 255;
  private ambientB = 240;
  private ambientAlpha = 0;

  /** Daytime color stops: t=0 (post-dawn) to t=1 (pre-dusk). */
  private static readonly DAY_STOPS: ColorStop[] = [
    { t: 0.00, r: 255, g: 150, b: 70,  a: 0.25 },  // Sunrise - warm orange
    { t: 0.12, r: 255, g: 190, b: 120, a: 0.15 },  // Early morning - soft peach
    { t: 0.30, r: 255, g: 240, b: 210, a: 0.06 },  // Late morning - clearing
    { t: 0.50, r: 255, g: 255, b: 248, a: 0.02 },  // Midday - near neutral
    { t: 0.70, r: 255, g: 230, b: 180, a: 0.10 },  // Afternoon - warming
    { t: 0.85, r: 255, g: 170, b: 80,  a: 0.22 },  // Golden hour - deep amber
    { t: 1.00, r: 255, g: 110, b: 40,  a: 0.32 },  // Pre-dusk - intense orange
  ];

  /** Night overlay RGB (deep blue). */
  private static readonly NIGHT_R = 8;
  private static readonly NIGHT_G = 8;
  private static readonly NIGHT_B = 30;

  constructor(stage: Container) {
    // Darkness canvas (torch cutouts)
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d')!;
    this.sprite = new Sprite();
    this.sprite.zIndex = 100; // above world, below Pixi UI (minimap, HUD)
    this.sprite.eventMode = 'none';
    stage.addChild(this.sprite);

    // Ambient tint canvas (color grading - below darkness)
    this.ambientCanvas = document.createElement('canvas');
    this.ambientCtx = this.ambientCanvas.getContext('2d')!;
    this.ambientSprite = new Sprite();
    this.ambientSprite.zIndex = 99; // below darkness overlay
    this.ambientSprite.eventMode = 'none';
    this.ambientSprite.blendMode = 'multiply';
    stage.addChild(this.ambientSprite);
  }

  /** Set the target darkness level (0 = full day, 1 = full night). */
  setDarkness(value: number): void {
    this.darkness = Math.max(0, Math.min(1, value));
  }

  /** Update ambient color based on current day/night phase. */
  setAmbient(phase: DayNightPhase, dayTimeRemaining: number): void {
    if (phase === 'day') {
      const dayProgress = Math.max(0, Math.min(1, 1 - dayTimeRemaining / DAY_MAX_DURATION));
      const c = this.lerpStops(dayProgress);
      this.ambientR = c.r;
      this.ambientG = c.g;
      this.ambientB = c.b;
      this.ambientAlpha = c.a;
    } else if (phase === 'dusk') {
      // Lerp from pre-dusk amber toward night blue
      const last = NightOverlay.DAY_STOPS[NightOverlay.DAY_STOPS.length - 1];
      const t = this.darkness;
      this.ambientR = Math.round(last.r + (NightOverlay.NIGHT_R - last.r) * t);
      this.ambientG = Math.round(last.g + (NightOverlay.NIGHT_G - last.g) * t);
      this.ambientB = Math.round(last.b + (NightOverlay.NIGHT_B - last.b) * t);
      this.ambientAlpha = last.a * (1 - t); // Fade out as darkness takes over
    } else if (phase === 'dawn') {
      // Lerp from night blue toward post-dawn peach
      const first = NightOverlay.DAY_STOPS[0];
      const t = 1 - this.darkness;
      this.ambientR = Math.round(NightOverlay.NIGHT_R + (first.r - NightOverlay.NIGHT_R) * t);
      this.ambientG = Math.round(NightOverlay.NIGHT_G + (first.g - NightOverlay.NIGHT_G) * t);
      this.ambientB = Math.round(NightOverlay.NIGHT_B + (first.b - NightOverlay.NIGHT_B) * t);
      this.ambientAlpha = first.a * t; // Fade in as dawn brightens
    } else {
      // Night: no ambient tint, darkness handles everything
      this.ambientAlpha = 0;
    }
  }

  /** Change overlay tint (e.g. red for blood moon). Bypasses ambient. */
  setTint(color: number): void {
    this.tintR = (color >> 16) & 0xff;
    this.tintG = (color >> 8) & 0xff;
    this.tintB = color & 0xff;
    this.tintOverride = true;
  }

  /** Reset tint to default dark blue and re-enable ambient. */
  resetTint(): void {
    this.tintR = 8;
    this.tintG = 8;
    this.tintB = 30;
    this.tintOverride = false;
  }

  /**
   * Called every frame. Redraws the darkness overlay with torch cutouts
   * and the ambient color-grading layer.
   */
  update(
    cameraX: number,
    cameraY: number,
    zoom: number,
    screenW: number,
    screenH: number,
    lightSources: LightSource[],
  ): void {
    this.updateAmbient(screenW, screenH);
    this.updateDarkness(cameraX, cameraY, zoom, screenW, screenH, lightSources);
  }

  /** Update the ambient color-grading layer. */
  private updateAmbient(screenW: number, screenH: number): void {
    if (this.tintOverride || this.ambientAlpha < 0.005) {
      this.ambientSprite.visible = false;
      return;
    }

    this.ambientSprite.visible = true;

    // Use lower resolution for performance
    const s = this.scale;
    const cw = Math.ceil(screenW * s);
    const ch = Math.ceil(screenH * s);

    if (this.ambientCanvas.width !== cw || this.ambientCanvas.height !== ch) {
      this.ambientCanvas.width = cw;
      this.ambientCanvas.height = ch;
      if (this.ambientTex) this.ambientTex.destroy(true);
      this.ambientTex = null;
    }

    const ctx = this.ambientCtx;

    // Multiply blend: white = no change, colored = tint.
    // Lerp from white (no effect) toward the ambient color based on alpha.
    const a = this.ambientAlpha;
    const mr = Math.round(255 + (this.ambientR - 255) * a);
    const mg = Math.round(255 + (this.ambientG - 255) * a);
    const mb = Math.round(255 + (this.ambientB - 255) * a);

    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = `rgb(${mr},${mg},${mb})`;
    ctx.fillRect(0, 0, cw, ch);

    if (!this.ambientTex) {
      this.ambientTex = Texture.from({ resource: this.ambientCanvas });
      this.ambientSprite.texture = this.ambientTex;
    } else {
      (this.ambientTex.source as ImageSource).update();
    }
    this.ambientSprite.position.set(0, 0);
    this.ambientSprite.scale.set(1 / s);
  }

  /** Update the darkness overlay with torch cutouts. */
  private updateDarkness(
    cameraX: number,
    cameraY: number,
    zoom: number,
    screenW: number,
    screenH: number,
    lightSources: LightSource[],
  ): void {
    const nightAlpha = this.darkness * NIGHT_DARKNESS_ALPHA;

    let fillR: number, fillG: number, fillB: number;

    if (this.tintOverride) {
      fillR = this.tintR;
      fillG = this.tintG;
      fillB = this.tintB;
    } else {
      fillR = NightOverlay.NIGHT_R;
      fillG = NightOverlay.NIGHT_G;
      fillB = NightOverlay.NIGHT_B;
    }

    if (nightAlpha < 0.005) {
      this.sprite.visible = false;
      return;
    }
    this.sprite.visible = true;

    const s = this.scale;
    const cw = Math.ceil(screenW * s);
    const ch = Math.ceil(screenH * s);

    // Resize canvas only when screen size changes
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
      if (this.tex) this.tex.destroy(true);
      this.tex = null;
    }

    const ctx = this.ctx;

    // 1. Fill with night darkness color
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = `rgba(${fillR},${fillG},${fillB},${nightAlpha})`;
    ctx.fillRect(0, 0, cw, ch);

    // 2. Cut out torch circles using destination-out (erases pixels)
    ctx.globalCompositeOperation = 'destination-out';
    const halfW = cw / 2;
    const halfH = ch / 2;

    for (const src of lightSources) {
      const sx = halfW + (src.x - cameraX) * zoom * s;
      const sy = halfH + (src.y - cameraY) * zoom * s;
      const sr = src.radius * zoom * s;

      // Soft-edged circle using radial gradient
      const grad = ctx.createRadialGradient(sx, sy, sr * 0.25, sx, sy, sr);
      grad.addColorStop(0, 'rgba(0,0,0,1)');
      grad.addColorStop(0.55, 'rgba(0,0,0,0.85)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(sx, sy, sr, 0, Math.PI * 2);
      ctx.fill();
    }

    // 3. Add colored glows for light sources that have a tint color
    ctx.globalCompositeOperation = 'source-over';
    for (const src of lightSources) {
      if (src.color === undefined) continue;
      const sx = halfW + (src.x - cameraX) * zoom * s;
      const sy = halfH + (src.y - cameraY) * zoom * s;
      const sr = src.radius * zoom * s;
      const r = (src.color >> 16) & 0xff;
      const g = (src.color >> 8) & 0xff;
      const b = src.color & 0xff;
      const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
      grad.addColorStop(0, `rgba(${r},${g},${b},${0.35 * nightAlpha})`);
      grad.addColorStop(0.5, `rgba(${r},${g},${b},${0.15 * nightAlpha})`);
      grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(sx, sy, sr, 0, Math.PI * 2);
      ctx.fill();
    }

    // 4. Upload canvas as texture to the sprite
    if (!this.tex) {
      this.tex = Texture.from({ resource: this.canvas });
      this.sprite.texture = this.tex;
    } else {
      // Force Pixi to re-upload the canvas pixels
      (this.tex.source as ImageSource).update();
    }
    this.sprite.position.set(0, 0);
    this.sprite.scale.set(1 / s);
  }

  getDarkness(): number {
    return this.darkness;
  }

  destroy(): void {
    if (this.tex) this.tex.destroy(true);
    if (this.ambientTex) this.ambientTex.destroy(true);
    this.sprite.destroy();
    this.ambientSprite.destroy();
  }

  /** Interpolate between daytime color stops. */
  private lerpStops(t: number): { r: number; g: number; b: number; a: number } {
    const stops = NightOverlay.DAY_STOPS;
    t = Math.max(0, Math.min(1, t));
    for (let i = 0; i < stops.length - 1; i++) {
      if (t <= stops[i + 1].t) {
        const s0 = stops[i], s1 = stops[i + 1];
        const f = (t - s0.t) / (s1.t - s0.t);
        return {
          r: Math.round(s0.r + (s1.r - s0.r) * f),
          g: Math.round(s0.g + (s1.g - s0.g) * f),
          b: Math.round(s0.b + (s1.b - s0.b) * f),
          a: s0.a + (s1.a - s0.a) * f,
        };
      }
    }
    const last = stops[stops.length - 1];
    return { r: last.r, g: last.g, b: last.b, a: last.a };
  }
}
