import * as PIXI from 'pixi.js';
import { PLAYER_COLLISION_RADIUS } from '../config/constants.js';

// Renders non-local multiplayer peers from server snapshots.
export function createRemotePlayerSystem({ layer }) {
    const peers = new Map();

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
            let sprite = peers.get(id);
            if (!sprite) {
                sprite = createPeerSprite();
                peers.set(id, sprite);
            }
            sprite.position.set(peer.x, peer.y);
            sprite.visible = true;
        }

        for (const [id, sprite] of peers) {
            if (activeIds.has(id)) {
                continue;
            }
            sprite.destroy();
            peers.delete(id);
        }
    }

    function clear() {
        for (const sprite of peers.values()) {
            sprite.destroy();
        }
        peers.clear();
    }

    return {
        sync,
        clear
    };
}
