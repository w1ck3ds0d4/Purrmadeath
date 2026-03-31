/**
 * Plays ambient sounds for nearby entities.
 * Civilians meow when they speak (show a speech bubble).
 */
import { World, EntityId } from '@shared/ecs/World';
import { C, FactionComponent, PositionComponent } from '@shared/components';
import type { CivilianComponent } from '@shared/components';

// ── Audio assets ─────────────────────────────────────────────────────────────
const civMeowUrl = new URL('../assets/audio/sfx/civ_meow.wav', import.meta.url).href;

// ── Config ───────────────────────────────────────────────────────────────────
/** Maximum distance (px) from camera center for a civilian to be heard. */
const AUDIBLE_RANGE = 600;
const VOLUME_MIN = 0.15;
const VOLUME_MAX = 0.4;

export function createAmbientAudio() {
  // Track which civilians currently have a speech bubble showing
  const activeSpeech = new Set<EntityId>();

  function playMeow(volume: number): void {
    // Create a new Audio each time so meows can overlap freely
    const audio = new Audio(civMeowUrl);
    audio.volume = volume;
    audio.play().catch(() => {}); // ignore autoplay restrictions
  }

  function update(world: World, _dt: number, cameraX: number, cameraY: number): void {
    // Check all civilians for new speech bubbles
    for (const id of world.query(C.Position, C.Faction)) {
      const f = world.getComponent<FactionComponent>(id, C.Faction);
      if (f?.type !== 'civilian') continue;

      const civ = world.getComponent<CivilianComponent>(id, C.Civilian);
      if (!civ) continue;

      const hasBubble = civ.speechBubble != null && civ.speechBubble !== '';

      if (hasBubble && !activeSpeech.has(id)) {
        // New speech bubble appeared - play meow
        activeSpeech.add(id);

        const pos = world.getComponent<PositionComponent>(id, C.Position);
        if (pos) {
          const dx = pos.x - cameraX;
          const dy = pos.y - cameraY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < AUDIBLE_RANGE) {
            // Volume falls off with distance
            const t = 1 - dist / AUDIBLE_RANGE;
            const vol = VOLUME_MIN + t * (VOLUME_MAX - VOLUME_MIN);
            playMeow(vol);
          }
        }
      } else if (!hasBubble) {
        // Bubble gone - allow next meow trigger
        activeSpeech.delete(id);
      }
    }
  }

  function reset(): void {
    activeSpeech.clear();
  }

  return { update, reset };
}

export type AmbientAudio = ReturnType<typeof createAmbientAudio>;
