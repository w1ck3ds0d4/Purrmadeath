// ─── Action enum ──────────────────────────────────────────────────────────────
// Abstract intent — physical key → Action so rebinding and gamepad support
// require changes only to the DEFAULT_BINDINGS table, not any game system.

export enum Action {
  MoveUp,
  MoveDown,
  MoveLeft,
  MoveRight,
  Interact,
  Attack,
  Pause,
}

// One or more key strings per action (Set.has is O(1)).
const DEFAULT_BINDINGS: Readonly<Record<Action, readonly string[]>> = {
  [Action.MoveUp]:    ['w', 'ArrowUp'],
  [Action.MoveDown]:  ['s', 'ArrowDown'],
  [Action.MoveLeft]:  ['a', 'ArrowLeft'],
  [Action.MoveRight]: ['d', 'ArrowRight'],
  [Action.Interact]:  ['e', 'f'],
  [Action.Attack]:    [' '],
  [Action.Pause]:     ['Escape'],
};

export class InputManager {
  private held           = new Set<string>();
  private justPressedSet = new Set<string>();

  constructor() {
    document.addEventListener('keydown', (e) => {
      if (!this.held.has(e.key)) this.justPressedSet.add(e.key);
      this.held.add(e.key);
    });
    document.addEventListener('keyup', (e) => this.held.delete(e.key));
  }

  /** True while the key(s) for this action are held down. */
  isHeld(action: Action): boolean {
    return DEFAULT_BINDINGS[action].some((k) => this.held.has(k));
  }

  /** True only on the frame the key was first pressed. */
  isJustPressed(action: Action): boolean {
    return DEFAULT_BINDINGS[action].some((k) => this.justPressedSet.has(k));
  }

  /** Call at the end of each frame to clear just-pressed state. */
  flush(): void {
    this.justPressedSet.clear();
  }
}
