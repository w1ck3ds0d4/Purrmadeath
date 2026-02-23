import { Graphics, Container } from 'pixi.js';

interface Particle {
  g: Graphics;
  vx: number;
  vy: number;
  life: number;
}

export class HitParticleSystem {
  private pool: Particle[] = [];
  private active: Particle[] = [];

  constructor(private readonly container: Container) {}

  burst(worldX: number, worldY: number, count: number): void {
    for (let i = 0; i < count; i++) {
      let p = this.pool.pop();
      if (!p) {
        const g = new Graphics();
        g.circle(0, 0, 2).fill({ color: 0xffffff });
        p = { g, vx: 0, vy: 0, life: 0 };
      }
      const angle = Math.random() * Math.PI * 2;
      const speed = 80 + Math.random() * 120;
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed;
      p.life = 0.3 + Math.random() * 0.2;
      p.g.position.set(worldX, worldY);
      p.g.alpha = 1;
      p.g.visible = true;
      this.container.addChild(p.g);
      this.active.push(p);
    }
  }

  update(dt: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.g.visible = false;
        this.container.removeChild(p.g);
        this.pool.push(p);
        this.active.splice(i, 1);
        continue;
      }
      p.g.position.x += p.vx * dt;
      p.g.position.y += p.vy * dt;
      p.g.alpha = Math.max(0, p.life / 0.4);
    }
  }

  render(): void { /* particles are Graphics children, auto-rendered */ }

  destroy(): void {
    for (const p of this.active) p.g.destroy();
    for (const p of this.pool) p.g.destroy();
    this.active.length = 0;
    this.pool.length = 0;
  }
}
