import { World } from '@shared/ecs/World';
import { C, PlayerInputComponent, StaminaComponent } from '@shared/components';
import { InputManager, Action } from '../input/InputManager';

/** Reads keyboard state and writes dx/dy/sprint into every PlayerInput component. */
export class InputSystem {
  constructor(private readonly input: InputManager) {}

  update(world: World): void {
    const dx =
      (this.input.isHeld(Action.MoveRight) ? 1 : 0) -
      (this.input.isHeld(Action.MoveLeft)  ? 1 : 0);
    const dy =
      (this.input.isHeld(Action.MoveDown) ? 1 : 0) -
      (this.input.isHeld(Action.MoveUp)   ? 1 : 0);
    const wantSprint = this.input.isHeld(Action.Sprint);

    for (const id of world.query(C.PlayerInput)) {
      const inp = world.getComponent<PlayerInputComponent>(id, C.PlayerInput)!;
      const st  = world.getComponent<StaminaComponent>(id, C.Stamina);
      inp.dx = dx;
      inp.dy = dy;
      // Releasing Sprint clears the exhaustion lock so the player can sprint again
      if (st && !wantSprint) st.exhausted = false;
      // Sprint is active only while Shift is held, stamina > 0, and not exhausted
      inp.sprint = wantSprint && (st ? st.current > 0 && !st.exhausted : false);
    }
  }
}