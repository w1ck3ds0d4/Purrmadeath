import { Application } from 'pixi.js';

/**
 * Renderer owns the Pixi.js Application and the root stage.
 * All game layers (world, entities, UI) are added as children of stage.
 *
 * Phase 1: minimal setup - just canvas + ticker.
 * Phase 2+: will expose layer containers (worldLayer, entityLayer, uiLayer).
 */
export class Renderer {
  private app: Application;

  constructor() {
    this.app = new Application();
  }

  /** Initialize and mount the canvas into the given container element. */
  async init(container: HTMLElement): Promise<void> {
    await this.app.init({
      resizeTo: container,
      backgroundColor: 0x0a0a0f,
      antialias: false,             // pixel-accurate edges
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,            // correct hi-DPI scaling
    });

    container.appendChild(this.app.canvas);
  }

  /** The root Pixi stage. Add layer containers here. */
  get stage() {
    return this.app.stage;
  }

  /** Screen dimensions in CSS pixels. */
  get screen() {
    return this.app.screen;
  }

  /**
   * The Pixi Ticker - drives the game's render loop.
   * Register update callbacks with: renderer.ticker.add((ticker) => { ... })
   * ticker.deltaMS gives elapsed ms since last frame.
   */
  get ticker() {
    return this.app.ticker;
  }

  destroy(): void {
    this.app.destroy(true);
  }
}
