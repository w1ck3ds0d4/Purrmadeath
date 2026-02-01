export enum GameState {
  Menu,
  Lobby,
  Loading,
  Playing,
  Paused,
}

type OnEnterCallback = () => void;

/**
 * Simple state machine with enter callbacks.
 * Transitions are no-ops if already in the target state.
 */
export class GameStateManager {
  // null = not yet initialized; prevents the same-state guard from swallowing
  // the very first transition(GameState.Menu) call in game.ts.
  private state: GameState | null = null;
  private callbacks = new Map<GameState, OnEnterCallback>();

  get current(): GameState {
    // Before the first transition, behave as if we're in Menu so the ticker
    // renders the world background correctly from frame 0.
    return this.state ?? GameState.Menu;
  }

  /** Register a callback to run when entering a state. Chainable. */
  onEnter(state: GameState, cb: OnEnterCallback): this {
    this.callbacks.set(state, cb);
    return this;
  }

  transition(next: GameState): void {
    if (this.state === next) return;
    this.state = next;
    this.callbacks.get(next)?.();
  }
}
