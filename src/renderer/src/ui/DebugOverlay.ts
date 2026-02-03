import { Container, Graphics, Text } from 'pixi.js';
import { CHUNK_SIZE, TILE_SIZE } from '@shared/constants';
import type { Camera } from '../render/Camera';

export interface NetStats {
  rtt: number;
  packetLoss: number;
  msgsPerSec: number;
}

export interface DebugInfo {
  camera: Camera;
  loadedChunks: number;
  biome: string;
  seed: number;
  /** Present only when connected to a server. */
  net?: NetStats;
}

/**
 * DebugOverlay renders a HUD panel with real-time diagnostic info.
 *
 * Hidden by default. Press F4 to toggle.
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
    this.container.visible = false; // off by default — F4 to show
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

    // F4 toggles visibility
    document.addEventListener('keydown', (e) => {
      if (e.key === 'F4') {
        e.preventDefault();
        this.container.visible = !this.container.visible;
      }
    });
  }

  update(dt: number, info: DebugInfo): void {
    // Always track FPS so it's accurate the moment the overlay is opened
    this.frameCount++;
    this.elapsed += dt;
    if (this.elapsed >= 0.5) {
      this.fps = Math.round(this.frameCount / this.elapsed);
      this.frameCount = 0;
      this.elapsed = 0;
    }

    if (!this.container.visible) return;

    const { camera, loadedChunks, biome, seed } = info;
    const chunkPixels = CHUNK_SIZE * TILE_SIZE;
    const cx = Math.floor(camera.x / chunkPixels);
    const cy = Math.floor(camera.y / chunkPixels);

    const lines: string[] = [
      `FPS:    ${this.fps}`,
      `Pos:    (${Math.round(camera.x)}, ${Math.round(camera.y)})`,
      `Chunk:  (${cx}, ${cy})`,
      `Biome:  ${biome}`,
      `Chunks: ${loadedChunks}`,
      `Seed:   ${seed}`,
    ];

    if (info.net) {
      const { rtt, packetLoss, msgsPerSec } = info.net;
      lines.push(
        ``,
        `Ping:   ${rtt} ms`,
        `Loss:   ${packetLoss}%`,
        `Svr:    ${msgsPerSec} msg/s`,
      );
    }

    lines.push(
      ``,
      `── Shortcuts ──`,
      `[F4]  Debug panel`,
      `[F5]  Spawn enemies`,
      `[F6]  Skip wave prep`,
      `[F7]  Pause wave timer`,
      `[Esc] Pause vote`,
    );

    this.label.text = lines.join('\n');

    // Resize the background to fit the text
    const pad = 8;
    this.bg.clear();
    this.bg.rect(0, 0, this.label.width + pad * 2, this.label.height + pad + 6);
    this.bg.fill({ color: 0x000000, alpha: 0.55 });
  }
}