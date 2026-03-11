import { Container, Text } from 'pixi.js';

interface DamageNumber {
  text: Text;
  worldX: number;
  worldY: number;
  age: number;
  lifetime: number;
  vy: number;
}

const LIFETIME = 0.8;
const RESOURCE_LIFETIME = 1.2;
const FLOAT_SPEED = -60; // pixels per second (upward)
const FONT_SIZE = 14;
const MAX_NUMBERS = 80;

const RESOURCE_COLORS: Record<string, number> = {
  wood: 0x8a6a3a,
  stone: 0xaaaaaa,
  iron: 0xb08060,
  diamond: 0x44ccdd,
  gold: 0xe0c030,
  food: 0x44aa44,
  weapons: 0xcc6644,
};

export class DamageNumberSystem {
  private numbers: DamageNumber[] = [];
  private container: Container;

  constructor(stage: Container) {
    this.container = new Container();
    this.container.zIndex = 101; // above night overlay (100)
    stage.addChild(this.container);
  }

  /** Spawn a floating damage number at world coordinates. */
  add(worldX: number, worldY: number, damage: number, color: number = 0xff4444, crit = false): void {
    // Small random horizontal offset to prevent stacking
    const offsetX = (Math.random() - 0.5) * 20;
    const offsetY = (Math.random() - 0.5) * 10;

    const displayColor = crit ? 0xffdd44 : color;
    const displayText = crit ? `-${Math.round(damage)}!` : `-${Math.round(damage)}`;
    const displaySize = crit ? 18 : FONT_SIZE;

    const text = new Text({
      text: displayText,
      style: {
        fontSize: displaySize,
        fontFamily: 'monospace',
        fontWeight: 'bold',
        fill: displayColor,
        stroke: { color: 0x000000, width: 4 },
        dropShadow: { color: displayColor, alpha: 0.6, blur: 4, distance: 0 },
      },
    });
    text.anchor.set(0.5);

    // Evict oldest if at capacity
    if (this.numbers.length >= MAX_NUMBERS) {
      const oldest = this.numbers[0];
      this.container.removeChild(oldest.text);
      oldest.text.destroy();
      this.numbers[0] = this.numbers[this.numbers.length - 1];
      this.numbers.pop();
    }

    this.container.addChild(text);
    this.numbers.push({
      text,
      worldX: worldX + offsetX,
      worldY: worldY + offsetY,
      age: 0,
      lifetime: LIFETIME,
      vy: FLOAT_SPEED,
    });
  }

  /** Spawn a floating text label (e.g. "DODGE", "IMMUNE") at world coordinates. */
  addText(worldX: number, worldY: number, label: string, color: number): void {
    const offsetX = (Math.random() - 0.5) * 20;
    const offsetY = (Math.random() - 0.5) * 10;
    const text = new Text({ text: label, style: {
      fontSize: 14, fontFamily: 'monospace', fontWeight: 'bold',
      fill: color, stroke: { color: 0x000000, width: 3 },
    }});
    text.anchor.set(0.5);
    if (this.numbers.length >= MAX_NUMBERS) {
      const oldest = this.numbers[0];
      this.container.removeChild(oldest.text);
      oldest.text.destroy();
      this.numbers[0] = this.numbers[this.numbers.length - 1];
      this.numbers.pop();
    }
    this.container.addChild(text);
    this.numbers.push({ text, worldX: worldX + offsetX, worldY: worldY + offsetY, age: 0, lifetime: LIFETIME, vy: FLOAT_SPEED });
  }

  /** Spawn a floating resource gain popup at world coordinates. */
  addResource(worldX: number, worldY: number, amount: number, resource: string): void {
    if (amount <= 0) return;
    const offsetX = (Math.random() - 0.5) * 30;
    const offsetY = (Math.random() - 0.5) * 10 - 20; // slightly above entity
    const color = RESOURCE_COLORS[resource] ?? 0x88cc88;
    const label = resource.charAt(0).toUpperCase() + resource.slice(1);
    const text = new Text({
      text: `+${amount} ${label}`,
      style: {
        fontSize: 12,
        fontFamily: 'monospace',
        fontWeight: 'bold',
        fill: color,
        stroke: { color: 0x000000, width: 3 },
      },
    });
    text.anchor.set(0.5);

    if (this.numbers.length >= MAX_NUMBERS) {
      const oldest = this.numbers[0];
      this.container.removeChild(oldest.text);
      oldest.text.destroy();
      this.numbers[0] = this.numbers[this.numbers.length - 1];
      this.numbers.pop();
    }

    this.container.addChild(text);
    this.numbers.push({
      text,
      worldX: worldX + offsetX,
      worldY: worldY + offsetY,
      age: 0,
      lifetime: RESOURCE_LIFETIME,
      vy: FLOAT_SPEED * 0.6,
    });
  }

  update(dt: number, viewX: number, viewY: number, zoom: number, screenW: number, screenH: number): void {
    const offsetX = screenW / 2 - viewX * zoom;
    const offsetY = screenH / 2 - viewY * zoom;

    for (let i = this.numbers.length - 1; i >= 0; i--) {
      const n = this.numbers[i];
      n.age += dt;
      n.worldY += n.vy * dt;

      // Fade out
      const alpha = 1 - n.age / n.lifetime;
      n.text.alpha = Math.max(0, alpha);

      // Scale pop effect
      const baseScale = n.age < 0.1 ? 1 + (1 - n.age / 0.1) * 0.3 : 1;
      n.text.scale.set(baseScale * zoom);

      // Transform world coords to screen coords
      n.text.position.set(
        n.worldX * zoom + offsetX,
        n.worldY * zoom + offsetY,
      );

      if (n.age >= n.lifetime) {
        this.container.removeChild(n.text);
        n.text.destroy();
        // Swap-and-pop for O(1) removal
        this.numbers[i] = this.numbers[this.numbers.length - 1];
        this.numbers.pop();
      }
    }
  }

  destroy(): void {
    for (const n of this.numbers) {
      n.text.destroy();
    }
    this.numbers = [];
    this.container.destroy();
  }
}
