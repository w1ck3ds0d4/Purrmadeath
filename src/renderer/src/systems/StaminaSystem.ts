import { World } from '@shared/ecs/World';
import { C, StaminaComponent, PlayerInputComponent } from '@shared/components';
import { PLAYER_SPRINT_STAMINA_DRAIN } from '@shared/constants';

/**
 * Manages stamina each frame:
 *   - Sprinting:     drains at PLAYER_SPRINT_STAMINA_DRAIN units/sec; regen paused.
 *   - Not sprinting: regenerates up to max at the entity's regenRate.
 */
export class StaminaSystem {
  update(world: World, dt: number): void {
    for (const id of world.query(C.Stamina)) {
      const st  = world.getComponent<StaminaComponent>(id, C.Stamina)!;
      const inp = world.getComponent<PlayerInputComponent>(id, C.PlayerInput);

      if (inp?.sprint && st.current > 0) {
        st.current = Math.max(0, st.current - PLAYER_SPRINT_STAMINA_DRAIN * dt);
        if (st.current === 0) st.exhausted = true;
      } else if (!inp?.sprint && st.current < st.max) {
        st.current = Math.min(st.max, st.current + st.regenRate * dt);
      }
    }
  }
}