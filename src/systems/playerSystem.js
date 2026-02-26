import * as PIXI from 'pixi.js';
import {
    PLAYER_COLLISION_RADIUS,
    PLAYER_SPEED,
    TILE_SIZE,
    WEAPONS
} from '../config/constants.js';

// Player system owns player state, movement, facing direction, and local visuals
// (player body, aim indicator, sword swing effect).
export function createPlayerSystem({ stage, spawnWorldX, spawnWorldY, screenWidth, screenHeight }) {
    const state = {
        hp: 100,
        maxHp: 100,
        invulnFrames: 0,
        isDead: false
    };
    const combat = {
        weapon: 'sword',
        cooldownFrames: 0,
        facingX: 1,
        facingY: 0
    };

    let worldX = spawnWorldX;
    let worldY = spawnWorldY;
    let hitFlashFrames = 0;
    const swordSwingState = {
        ttl: 0,
        maxTtl: 8,
        angle: 0
    };

    const sprite = new PIXI.Graphics();
    sprite.circle(16, 16, 16);
    sprite.fill(0xff6b6b);
    sprite.position.set(screenWidth / 2 - 16, screenHeight / 2 - 16);
    stage.addChild(sprite);

    const aimIndicator = new PIXI.Graphics();
    aimIndicator.moveTo(0, -6);
    aimIndicator.lineTo(16, 0);
    aimIndicator.lineTo(0, 6);
    aimIndicator.closePath();
    aimIndicator.fill(0xffd166);
    aimIndicator.stroke({ width: 1, color: 0x5c4a11 });
    stage.addChild(aimIndicator);

    const swordSwingSprite = new PIXI.Graphics();
    swordSwingSprite.visible = false;
    stage.addChild(swordSwingSprite);

    function getCenter() {
        return { x: worldX + TILE_SIZE / 2, y: worldY + TILE_SIZE / 2 };
    }

    function getTile() {
        const center = getCenter();
        return {
            x: Math.floor(center.x / TILE_SIZE),
            y: Math.floor(center.y / TILE_SIZE)
        };
    }

    function setWorldPosition(x, y) {
        worldX = x;
        worldY = y;
    }

    function updateFacingFromMouse(mouseX, mouseY, viewportWidth, viewportHeight) {
        const aimDx = mouseX - viewportWidth / 2;
        const aimDy = mouseY - viewportHeight / 2;
        const aimMagnitude = Math.hypot(aimDx, aimDy);
        if (aimMagnitude > 0.001) {
            combat.facingX = aimDx / aimMagnitude;
            combat.facingY = aimDy / aimMagnitude;
        }
    }

    function updateScreenVisuals() {
        const playerScreenCenterX = sprite.position.x + PLAYER_COLLISION_RADIUS;
        const playerScreenCenterY = sprite.position.y + PLAYER_COLLISION_RADIUS;
        aimIndicator.rotation = Math.atan2(combat.facingY, combat.facingX);
        aimIndicator.position.set(
            playerScreenCenterX + combat.facingX * 22,
            playerScreenCenterY + combat.facingY * 22
        );

        if (swordSwingState.ttl > 0) {
            const progress = 1 - swordSwingState.ttl / swordSwingState.maxTtl;
            const cfg = WEAPONS.sword;
            const arcHalf = cfg.arcRadians * 0.5;
            const start = swordSwingState.angle - arcHalf;
            const end = swordSwingState.angle + arcHalf;
            const radius = cfg.range + 14 + progress * 8;
            swordSwingSprite.clear();
            swordSwingSprite.moveTo(playerScreenCenterX, playerScreenCenterY);
            swordSwingSprite.arc(playerScreenCenterX, playerScreenCenterY, radius, start, end);
            swordSwingSprite.closePath();
            swordSwingSprite.fill(0xf6dfa7);
            swordSwingSprite.alpha = 0.32 * (1 - progress);
            swordSwingState.ttl -= 1;
            swordSwingSprite.visible = true;
        } else {
            swordSwingSprite.visible = false;
        }
    }

    function triggerSwordSwing(dirX, dirY) {
        swordSwingState.ttl = swordSwingState.maxTtl;
        swordSwingState.angle = Math.atan2(dirY, dirX);
    }

    function updateMovement(keys, deltaMoveScale, canMoveToWorldPosition) {
        if (state.isDead) {
            return;
        }
        const moveDistance = PLAYER_SPEED * deltaMoveScale;
        let nextX = worldX;
        let nextY = worldY;
        if (keys.w || keys.arrowup) {
            nextY -= moveDistance;
        }
        if (keys.s || keys.arrowdown) {
            nextY += moveDistance;
        }
        if (keys.a || keys.arrowleft) {
            nextX -= moveDistance;
        }
        if (keys.d || keys.arrowright) {
            nextX += moveDistance;
        }

        if (canMoveToWorldPosition(nextX, nextY)) {
            worldX = nextX;
            worldY = nextY;
        }
    }

    // Timers are decremented in 60fps-frame units using deltaFrames,
    // so cooldown/invulnerability remain consistent across varying FPS.
    function tickCombatTimers(deltaFrames) {
        if (state.invulnFrames > 0) {
            state.invulnFrames -= deltaFrames;
        }
        if (combat.cooldownFrames > 0) {
            combat.cooldownFrames -= deltaFrames;
        }
    }

    function flashOnHit(frames) {
        hitFlashFrames = frames;
    }

    function updateHitVisual() {
        if (hitFlashFrames > 0) {
            sprite.alpha = 0.5;
            hitFlashFrames -= 1;
        } else {
            sprite.alpha = 1;
        }
    }

    function handleResize(width, height) {
        sprite.position.set(width / 2 - 16, height / 2 - 16);
    }

    return {
        state,
        combat,
        sprite,
        getCenter,
        getTile,
        getWorldPosition: () => ({ x: worldX, y: worldY }),
        setWorldPosition,
        updateFacingFromMouse,
        updateScreenVisuals,
        triggerSwordSwing,
        updateMovement,
        tickCombatTimers,
        flashOnHit,
        updateHitVisual,
        handleResize
    };
}
