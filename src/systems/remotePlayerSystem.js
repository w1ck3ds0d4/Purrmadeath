import * as PIXI from 'pixi.js';
import { PLAYER_COLLISION_RADIUS } from '../config/constants.js';

// Renders non-local multiplayer peers from server snapshots.
export function createRemotePlayerSystem({ layer }) {
    const peers = new Map();
    const smoothingPerSecond = 12;

    function createPeerSprite() {
        const sprite = new PIXI.Graphics();
        sprite.circle(PLAYER_COLLISION_RADIUS, PLAYER_COLLISION_RADIUS, PLAYER_COLLISION_RADIUS);
        sprite.fill(0x4f7df0);
        sprite.stroke({ width: 1, color: 0x15284d });
        layer.addChild(sprite);
        return sprite;
    }

    function sync(snapshotPlayers, localPlayerId) {
        const activeIds = new Set();
        for (const peer of snapshotPlayers) {
            if (peer.playerId === localPlayerId) {
                continue;
            }
            const id = String(peer.playerId);
            activeIds.add(id);
            let entry = peers.get(id);
            if (!entry) {
                const sprite = createPeerSprite();
                entry = {
                    sprite,
                    x: peer.x,
                    y: peer.y,
                    targetX: peer.x,
                    targetY: peer.y
                };
                sprite.position.set(peer.x, peer.y);
                peers.set(id, entry);
            }
            entry.targetX = peer.x;
            entry.targetY = peer.y;
            entry.sprite.visible = true;
        }

        for (const [id, entry] of peers) {
            if (activeIds.has(id)) {
                continue;
            }
            entry.sprite.destroy();
            peers.delete(id);
        }
    }

    function update(deltaMs) {
        const alpha = Math.max(0, Math.min(1, (deltaMs / 1000) * smoothingPerSecond));
        for (const entry of peers.values()) {
            entry.x += (entry.targetX - entry.x) * alpha;
            entry.y += (entry.targetY - entry.y) * alpha;
            entry.sprite.position.set(entry.x, entry.y);
        }
    }

    function clear() {
        for (const entry of peers.values()) {
            entry.sprite.destroy();
        }
        peers.clear();
    }

    return {
        sync,
        update,
        clear
    };
}
