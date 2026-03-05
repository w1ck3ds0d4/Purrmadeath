// ── Action enum ──────────────────────────────────────────────────────────────
// Abstract intent - physical key -> Action so rebinding and gamepad support
// require changes only to the DEFAULT_BINDINGS table, not any game system.

export enum Action {
  MoveUp,
  MoveDown,
  MoveLeft,
  MoveRight,
  Interact,
  Attack,
  Sprint,
  Pause,
  BuildMode,
  Demolish,
  Upgrade,
  Repair,
  DodgeRoll,
  Skill1,
  Skill2,
  Skill3,
  UsePotion,
  SkillTree,
  CivilianPanel,
  Cancel,
  RotateBuilding,
}

// One or more key strings per action (Set.has is O(1)).
const DEFAULT_BINDINGS: Readonly<Record<Action, readonly string[]>> = {
  [Action.MoveUp]:             ['w', 'ArrowUp'],
  [Action.MoveDown]:           ['s', 'ArrowDown'],
  [Action.MoveLeft]:           ['a', 'ArrowLeft'],
  [Action.MoveRight]:          ['d', 'ArrowRight'],
  [Action.Interact]:           ['e'],
  [Action.Attack]:             ['MouseLeft'],
  [Action.Sprint]:             ['Shift'],
  [Action.Pause]:              ['Escape'],
  [Action.BuildMode]:          ['b'],
  [Action.Demolish]:           ['x'],
  [Action.Upgrade]:            ['f'],
  [Action.Repair]:             ['r'],
  [Action.DodgeRoll]:          [' '],
  [Action.Skill1]:             ['1'],
  [Action.Skill2]:             ['2'],
  [Action.Skill3]:             ['3'],
  [Action.UsePotion]:          ['q'],
  [Action.SkillTree]:          ['k'],
  [Action.CivilianPanel]:      ['c'],
  [Action.Cancel]:             ['MouseRight'],
  [Action.RotateBuilding]:     ['ScrollDown', 'ScrollUp'],
};

export class InputManager {
  private held           = new Set<string>();
  private justPressedSet = new Set<string>();
  scrollDelta = 0;

  constructor() {
    document.addEventListener('keydown', (e) => {
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (!this.held.has(key)) this.justPressedSet.add(key);
      this.held.add(key);
    });
    document.addEventListener('keyup', (e) => {
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      this.held.delete(key);
    });
    document.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        if (!this.held.has('MouseLeft')) this.justPressedSet.add('MouseLeft');
        this.held.add('MouseLeft');
      } else if (e.button === 2) {
        if (!this.held.has('MouseRight')) this.justPressedSet.add('MouseRight');
        this.held.add('MouseRight');
      }
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.held.delete('MouseLeft');
      else if (e.button === 2) this.held.delete('MouseRight');
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('wheel', (e) => {
      this.scrollDelta += e.deltaY;
      // Inject synthetic scroll keys for just-pressed detection
      if (e.deltaY > 0) this.justPressedSet.add('ScrollDown');
      else if (e.deltaY < 0) this.justPressedSet.add('ScrollUp');
    });

    // Clear all input when the window loses focus (prevents stuck keys on Alt+Tab, etc.)
    window.addEventListener('blur', () => {
      this.held.clear();
      this.justPressedSet.clear();
    });
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
    this.scrollDelta = 0;
  }
}
