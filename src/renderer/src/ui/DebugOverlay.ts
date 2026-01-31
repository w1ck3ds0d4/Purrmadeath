import { Container, Graphics, Text } from 'pixi.js';
import { CHUNK_SIZE, TILE_SIZE } from '@shared/constants';
import type { Camera } from '../render/Camera';

export interface DebugInfo {
  camera: Camera;
  loadedChunks: number;
  biome: string;
  seed: number;
}

/**
 * DebugOverlay renders a HUD panel with real-time diagnostic info.
 * Always sits on top of the world (added last to stage).
 */
export class DebugOverlay {
  private container: Container;
  private label: Text;
  private bg: Graphics;

  // FPS tracking
  private frameCount = 0;
  private elapsed = 0;
  private fps = 0;

  constructor(stage: Container) {
    this.container = new Container();
    stage.addChild(this.container);

    // Semi-transparent background panel for readability
    this.bg = new Graphics();
    this.container.addChild(this.bg);

    this.label = new Text({
      text: '',
      style: {
        fontSize: 12,
        fill: 0x00ff88,
        fontFamily: 'monospace',
        lineHeight: 18,
      },
    });
    this.label.position.set(8, 6);
    this.container.addChild(this.label);
  }

  update(dt: number, info: DebugInfo): void {
    // Update FPS counter every 0.5 s to keep it readable
    this.frameCount++;
    this.elapsed += dt;
    if (this.elapsed >= 0.5) {
      this.fps = Math.round(this.frameCount / this.elapsed);
      this.frameCount = 0;
      this.elapsed = 0;
    }

    const { camera, loadedChunks, biome, seed } = info;
    const chunkPixels = CHUNK_SIZE * TILE_SIZE;
    const cx = Math.floor(camera.x / chunkPixels);
    const cy = Math.floor(camera.y / chunkPixels);

    this.label.text = [
      `FPS: ${this.fps}`,
      `Pos: (${Math.round(camera.x)}, ${Math.round(camera.y)})`,
      `Chunk: (${cx}, ${cy})`,
      `Biome: ${biome}`,
      `Chunks: ${loadedChunks}`,
      `Seed: ${seed}`,
      ``,
      `WASD — move`,
      `ALT + mouse — look around`,
    ].join('\n');

    // Resize the background to fit the text
    const pad = 8;
    this.bg.clear();
    this.bg.rect(0, 0, this.label.width + pad * 2, this.label.height + pad + 6);
    this.bg.fill({ color: 0x000000, alpha: 0.55 });
  }
}
