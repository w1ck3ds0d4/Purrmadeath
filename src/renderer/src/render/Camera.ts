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

  /** Set to true to allow look-around (ALT). Disabled while on menus. */
  lookEnabled = false;

  // ── Screen shake ────────────────────────────────────────────────────────────
  private shakeIntensity = 0;
  private shakeDuration = 0;
  private shakeTimer = 0;
  private shakeOffsetX = 0;
  private shakeOffsetY = 0;

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

    // Screen shake offset
    if (this.shakeTimer > 0) {
      this.shakeTimer -= dt;
      const st = Math.max(0, this.shakeTimer / this.shakeDuration);
      const offset = this.shakeIntensity * st;
      this.shakeOffsetX = (Math.random() - 0.5) * 2 * offset;
      this.shakeOffsetY = (Math.random() - 0.5) * 2 * offset;
      if (this.shakeTimer <= 0) {
        this.shakeIntensity = 0;
        this.shakeDuration = 0;
        this.shakeOffsetX = 0;
        this.shakeOffsetY = 0;
      }
    } else {
      this.shakeOffsetX = 0;
      this.shakeOffsetY = 0;
    }
  }

  // ── Screen shake ───────────────────────────────────────────────────────────

  shake(intensity: number, duration: number): void {
    // Stack by taking the max intensity
    this.shakeIntensity = Math.max(this.shakeIntensity, intensity);
    this.shakeDuration = Math.max(this.shakeDuration, duration);
    this.shakeTimer = this.shakeDuration;
  }

  // ── Derived view position ───────────────────────────────────────────────────

  /** The world X the camera is actually rendering (camera position + look-around offset + shake). */
  get viewX(): number {
    return this.x + this.lookOffsetX + this.shakeOffsetX;
  }

  get viewY(): number {
    return this.y + this.lookOffsetY + this.shakeOffsetY;
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
        if (!this.isLooking && this.lookEnabled) {
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
