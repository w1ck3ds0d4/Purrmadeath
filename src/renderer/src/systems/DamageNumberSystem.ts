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
const FLOAT_SPEED = -60; // pixels per second (upward)
const FONT_SIZE = 14;
const MAX_NUMBERS = 80;

export class DamageNumberSystem {
  private numbers: DamageNumber[] = [];
  private container: Container;

  constructor(worldContainer: Container) {
    this.container = new Container();
    worldContainer.addChild(this.container);
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
        stroke: { color: 0x000000, width: 3 },
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

  update(dt: number): void {
    for (let i = this.numbers.length - 1; i >= 0; i--) {
      const n = this.numbers[i];
      n.age += dt;
      n.worldY += n.vy * dt;

      // Fade out
      const alpha = 1 - n.age / n.lifetime;
      n.text.alpha = Math.max(0, alpha);

      // Scale pop effect
      const scale = n.age < 0.1 ? 1 + (1 - n.age / 0.1) * 0.3 : 1;
      n.text.scale.set(scale);

      // Position is set during render pass (needs camera transform)
      n.text.position.set(n.worldX, n.worldY);

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
