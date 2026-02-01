import { World } from '@shared/ecs/World';
import { C, StaminaComponent } from '@shared/components';

/** Passively regenerates stamina up to its max value each frame. */
export class StaminaSystem {
  update(world: World, dt: number): void {
    for (const id of world.query(C.Stamina)) {
      const st = world.getComponent<StaminaComponent>(id, C.Stamina)!;
      if (st.current < st.max) {
        st.current = Math.min(st.max, st.current + st.regenRate * dt);
      }
    }
  }
}
