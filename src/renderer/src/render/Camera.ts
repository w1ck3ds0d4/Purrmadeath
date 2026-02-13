/**
 * Camera controls the view into the game world.
 *
 * Normal mode: smoothly follows (targetX, targetY) - set by the player entity in Phase 2.
 * Look-around mode (hold ALT): mouse movement shifts the view offset so players can
 *   scout ahead without moving. Releasing ALT eases the offset back to center.
 *
 * Phase 1: targetX/targetY are driven by WASD (temporary, removed when player exists).
 * Phase 2: targetX/targetY = player.position.
 */
export class Camera {
  // ── Follow target (world pixels) ────────────────────────────────────────────
  /** The world position the camera wants to center on. Updated externally. */
  targetX = 0;
  targetY = 0;

  // ── Actual camera position (lerped toward target) ───────────────────────────
  x = 0;
  y = 0;

  // ── Zoom ────────────────────────────────────────────────────────────────────
  /** Screen pixels per world pixel. >1 = zoomed in, <1 = zoomed out. */
  zoom = 1.5;

  // ── Look-around state ────────────────────────────────────────────────────────
  private lookOffsetX = 0;
  private lookOffsetY = 0;
  private isLooking = false;
  private mouseX = 0;
  private mouseY = 0;
  private lookAnchorX = 0;
  private lookAnchorY = 0;
  private lookBaseX = 0; // offset at the moment ALT was pressed
  private lookBaseY = 0;

  constructor() {
    this.bindEvents();
  }

  // ── Update ──────────────────────────────────────────────────────────────────

  /**
   * Call once per frame. dt is in seconds.
   * Lerps position toward target and eases the look-around offset back to zero.
   */
  update(dt: number): void {
    // Smooth follow - speed 8 feels responsive without being instant
    const followSpeed = 8;
    const t = Math.min(followSpeed * dt, 1);
    this.x += (this.targetX - this.x) * t;
    this.y += (this.targetY - this.y) * t;

    // When not looking, ease the look offset back to center
    if (!this.isLooking) {
      const snapSpeed = 7;
      const s = Math.min(snapSpeed * dt, 1);
      this.lookOffsetX += (0 - this.lookOffsetX) * s;
      this.lookOffsetY += (0 - this.lookOffsetY) * s;
    }
  }

  // ── Derived view position ───────────────────────────────────────────────────

  /** The world X the camera is actually rendering (camera position + look-around offset). */
  get viewX(): number {
    return this.x + this.lookOffsetX;
  }

  get viewY(): number {
    return this.y + this.lookOffsetY;
  }

  // ── Input binding ───────────────────────────────────────────────────────────

  private bindEvents(): void {
    // Track mouse position every frame for use when ALT is pressed
    document.addEventListener('mousemove', (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;

      if (this.isLooking) {
        // Offset from the anchor point (where the mouse was when ALT was pressed),
        // divided by zoom so we're moving in world units, not screen units.
        this.lookOffsetX = this.lookBaseX + (e.clientX - this.lookAnchorX) / this.zoom;
        this.lookOffsetY = this.lookBaseY + (e.clientY - this.lookAnchorY) / this.zoom;
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Alt') {
        // Prevent Alt from triggering the Electron / browser menu
        e.preventDefault();
        if (!this.isLooking) {
          this.isLooking = true;
          // Anchor the look to wherever the mouse currently is
          this.lookAnchorX = this.mouseX;
          this.lookAnchorY = this.mouseY;
          // Preserve any offset already built up so there's no jump
          this.lookBaseX = this.lookOffsetX;
          this.lookBaseY = this.lookOffsetY;
        }
      }
    });

    document.addEventListener('keyup', (e) => {
      if (e.key === 'Alt') {
        this.isLooking = false;
        // update() will ease lookOffset back to 0
      }
    });
  }
}
