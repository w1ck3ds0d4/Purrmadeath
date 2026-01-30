import { Application, Graphics, Text } from 'pixi.js';

/**
 * Renderer wraps the Pixi.js Application and owns the top-level stage.
 *
 * Phase 0: minimal setup — colored rectangle + debug text to confirm rendering works.
 * Phase 1+: will expose Camera, chunk layers, entity sprite layer, UI layer.
 */
export class Renderer {
  private app: Application;

  constructor() {
    this.app = new Application();
  }

  /** Initialize and mount the canvas into the given container element. */
  async init(container: HTMLElement): Promise<void> {
    await this.app.init({
      resizeTo: container,          // canvas always fills the container
      backgroundColor: 0x0a0a0f,   // matches body background
      antialias: false,             // pixel-accurate (no blur on tile edges)
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,            // scale canvas correctly on hi-DPI screens
    });

    container.appendChild(this.app.canvas);

    // ── Phase 0 placeholder content ──────────────────────────────────────────
    // A colored square in the center confirms Pixi.js is working.
    const square = new Graphics();
    square.rect(0, 0, 120, 120);
    square.fill({ color: 0x4a90d9 });
    square.pivot.set(60, 60); // center the pivot so positioning is intuitive
    this.app.stage.addChild(square);

    // Keep the square centered on resize
    const reposition = () => {
      square.position.set(this.app.screen.width / 2, this.app.screen.height / 2);
    };
    reposition();
    this.app.renderer.on('resize', reposition);

    // Debug label in the top-left corner
    const label = new Text({
      text: 'Purrmadeath — Phase 0',
      style: { fontSize: 13, fill: 0x00ff88, fontFamily: 'monospace' },
    });
    label.position.set(10, 10);
    this.app.stage.addChild(label);
  }

  /** The root Pixi stage — add child containers here. */
  get stage() {
    return this.app.stage;
  }

  get screen() {
    return this.app.screen;
  }

  destroy(): void {
    this.app.destroy(true);
  }
}