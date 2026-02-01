import { World } from '@shared/ecs/World';
import { C, PlayerInputComponent } from '@shared/components';
import { InputManager, Action } from '../input/InputManager';

/** Reads keyboard state and writes dx/dy into every PlayerInput component. */
export class InputSystem {
  constructor(private readonly input: InputManager) {}

  update(world: World): void {
    const dx =
      (this.input.isHeld(Action.MoveRight) ? 1 : 0) -
      (this.input.isHeld(Action.MoveLeft)  ? 1 : 0);
    const dy =
      (this.input.isHeld(Action.MoveDown) ? 1 : 0) -
      (this.input.isHeld(Action.MoveUp)   ? 1 : 0);

    for (const id of world.query(C.PlayerInput)) {
      const inp = world.getComponent<PlayerInputComponent>(id, C.PlayerInput)!;
      inp.dx = dx;
      inp.dy = dy;
    }
  }
}
