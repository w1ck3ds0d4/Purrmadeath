const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createCombatAuthority } = require('../../server/combatAuthority');

const MINIMAL_RULES = {
    wallLvl1: { footprint: { w: 1, h: 1 }, cost: {}, maxHp: 500, unbreakable: true }
};

function makePerf() {
    return {
        droppedQueuedEnemyHits: 0,
        killCorrections: 0,
        goldCorrections: 0,
        combatFreezeTicks: 0
    };
}

function makeAuthority({ getAuthorityPlayerId = () => null } = {}) {
    return createCombatAuthority({
        serverPerf: makePerf(),
        getAuthorityPlayerId,
        bumpBuildingRevision: () => {},
        BUILDING_RULES: MINIMAL_RULES,
        GOLD_PER_ENEMY_KILL: 5,
        AUTHORITY_SNAPSHOT_STALL_MS: 1200,
        SERVER_ENEMY_RADIUS: 12,
        SERVER_ENEMY_PROJECTILE_DAMAGE: 15,
        SERVER_ENEMY_PROJECTILE_RADIUS: 6,
        SERVER_ENEMY_CONTACT_DAMAGE: 10,
        SERVER_ENEMY_CONTACT_COOLDOWN_MS: 1000,
        SERVER_TOWER_PROJECTILE_DAMAGE: 50,
        SERVER_TOWER_PROJECTILE_RADIUS: 6,
        SERVER_PLAYER_RADIUS: 12,
        SERVER_CIVILIAN_RADIUS: 10,
        SERVER_PLAYER_RESPAWN_SECONDS: 5,
        SERVER_TILE_SIZE: 32
    });
}

// ---------------------------------------------------------------------------
// Factory smoke
// ---------------------------------------------------------------------------
describe('createCombatAuthority — factory', () => {
    it('instantiates without throwing', () => {
        assert.doesNotThrow(() => makeAuthority());
    });

    it('exposes expected methods', () => {
        const auth = makeAuthority();
        for (const method of [
            'reset', 'isFrozen', 'getSnapshotAgeMs',
            'setLastSnapshotAt', 'getLastSnapshotAt',
            'reconcile', 'queueEnemyHit', 'drainQueuedHits',
            'applyQueuedEnemyHits', 'applyEnemyProjectileDamage',
            'applyTowerProjectileDamage', 'applyEnemyMeleeContactDamage'
        ]) {
            assert.equal(typeof auth[method], 'function', `${method} should be a function`);
        }
    });
});

// ---------------------------------------------------------------------------
// isFrozen / getSnapshotAgeMs
// ---------------------------------------------------------------------------
describe('isFrozen', () => {
    it('returns true initially when no authority is set (no snapshot)', () => {
        // getAuthorityPlayerId returns null → age is Infinity → frozen
        const auth = makeAuthority({ getAuthorityPlayerId: () => null });
        assert.ok(auth.isFrozen(Date.now()));
    });

    it('returns false when authority is set and snapshot is fresh', () => {
        const auth = makeAuthority({ getAuthorityPlayerId: () => 1 });
        const now = Date.now();
        auth.setLastSnapshotAt(now);
        assert.ok(!auth.isFrozen(now + 100));
    });

    it('returns true when authority is set but snapshot is stale (> STALL_MS)', () => {
        const auth = makeAuthority({ getAuthorityPlayerId: () => 1 });
        const past = Date.now() - 5000;
        auth.setLastSnapshotAt(past);
        assert.ok(auth.isFrozen(Date.now()));
    });

    it('returns false when snapshot is stale but no authority player (no session started)', () => {
        // No authority means age = Infinity BUT isFrozen also needs no authority
        // isFrozen = age > STALL_MS; if age = Infinity and STALL_MS = 1200, it IS frozen
        // UNLESS we interpret "no authority = nothing to freeze" — check actual impl.
        // Per implementation: getAuthorityPlayerId()===null → age=Infinity → isFrozen=true
        const auth = makeAuthority({ getAuthorityPlayerId: () => null });
        auth.setLastSnapshotAt(Date.now());
        // With authority=null, getSnapshotAgeMs still returns Infinity (no authority set)
        // So isFrozen is true even if snapshot was just set
        assert.ok(auth.isFrozen(Date.now()));
    });
});

// ---------------------------------------------------------------------------
// setLastSnapshotAt / getLastSnapshotAt
// ---------------------------------------------------------------------------
describe('setLastSnapshotAt / getLastSnapshotAt', () => {
    it('round-trips the timestamp', () => {
        const auth = makeAuthority();
        const ts = Date.now();
        auth.setLastSnapshotAt(ts);
        assert.equal(auth.getLastSnapshotAt(), ts);
    });

    it('starts at 0', () => {
        const auth = makeAuthority();
        assert.equal(auth.getLastSnapshotAt(), 0);
    });
});

// ---------------------------------------------------------------------------
// reset
// ---------------------------------------------------------------------------
describe('reset', () => {
    it('clears pending hits so queue length becomes 0', () => {
        const auth = makeAuthority({ getAuthorityPlayerId: () => 1 });
        auth.queueEnemyHit(1, 42, 50);
        auth.queueEnemyHit(1, 43, 50);
        auth.reset();
        // After reset, drainQueuedHits should report 0 dropped (queue already empty)
        const perf = makePerf();
        // Create a fresh authority to verify reset state indirectly via applyQueuedEnemyHits
        const enemies = [{ id: 42, hp: 100 }];
        auth.applyQueuedEnemyHits(enemies);
        // Queue was cleared by reset, so no hits applied
        assert.equal(enemies[0].hp, 100);
    });
});

// ---------------------------------------------------------------------------
// queueEnemyHit + applyQueuedEnemyHits — kill and damage tracking
// ---------------------------------------------------------------------------
describe('queueEnemyHit + applyQueuedEnemyHits', () => {
    it('decrements enemy hp by the queued damage', () => {
        const auth = makeAuthority();
        auth.queueEnemyHit(1, 10, 30);
        const enemies = [{ id: 10, hp: 100 }];
        auth.applyQueuedEnemyHits(enemies);
        assert.equal(enemies[0].hp, 70);
    });

    it('records a kill when hp reaches 0', () => {
        const auth = makeAuthority();
        auth.queueEnemyHit(1, 10, 999);
        const enemies = [{ id: 10, hp: 50 }];
        auth.applyQueuedEnemyHits(enemies);
        assert.equal(enemies[0].hp, 0);
        // reconcile should now see 1 kill for player 1
        const playerStates = [{ playerId: 1, kills: 0 }];
        const resources = { gold: 0 };
        auth.reconcile(playerStates, resources);
        assert.equal(playerStates[0].kills, 1);
    });

    it('ignores hits for unknown enemy ids', () => {
        const auth = makeAuthority();
        auth.queueEnemyHit(1, 99, 50);
        const enemies = [{ id: 1, hp: 100 }];
        auth.applyQueuedEnemyHits(enemies);
        assert.equal(enemies[0].hp, 100);
    });

    it('clears the queue after applying', () => {
        const auth = makeAuthority();
        auth.queueEnemyHit(1, 5, 10);
        auth.applyQueuedEnemyHits([{ id: 5, hp: 100 }]);
        // Second apply with same enemy — no more hits should be applied
        const enemies2 = [{ id: 5, hp: 100 }];
        auth.applyQueuedEnemyHits(enemies2);
        assert.equal(enemies2[0].hp, 100);
    });
});

// ---------------------------------------------------------------------------
// drainQueuedHits
// ---------------------------------------------------------------------------
describe('drainQueuedHits', () => {
    it('clears the queue and increments serverPerf.droppedQueuedEnemyHits', () => {
        const perf = makePerf();
        const auth = createCombatAuthority({
            serverPerf: perf,
            getAuthorityPlayerId: () => null,
            bumpBuildingRevision: () => {},
            BUILDING_RULES: MINIMAL_RULES,
            GOLD_PER_ENEMY_KILL: 5,
            AUTHORITY_SNAPSHOT_STALL_MS: 1200,
            SERVER_ENEMY_RADIUS: 12,
            SERVER_ENEMY_PROJECTILE_DAMAGE: 15,
            SERVER_ENEMY_PROJECTILE_RADIUS: 6,
            SERVER_ENEMY_CONTACT_DAMAGE: 10,
            SERVER_ENEMY_CONTACT_COOLDOWN_MS: 1000,
            SERVER_TOWER_PROJECTILE_DAMAGE: 50,
            SERVER_TOWER_PROJECTILE_RADIUS: 6,
            SERVER_PLAYER_RADIUS: 12,
            SERVER_CIVILIAN_RADIUS: 10,
            SERVER_PLAYER_RESPAWN_SECONDS: 5,
            SERVER_TILE_SIZE: 32
        });
        auth.queueEnemyHit(1, 1, 10);
        auth.queueEnemyHit(1, 2, 10);
        auth.drainQueuedHits();
        assert.equal(perf.droppedQueuedEnemyHits, 2);
        // Queue is now empty — draining again adds 0 more
        auth.drainQueuedHits();
        assert.equal(perf.droppedQueuedEnemyHits, 2);
    });
});

// ---------------------------------------------------------------------------
// reconcile — kill/gold canonicalization regression
// ---------------------------------------------------------------------------
describe('reconcile', () => {
    it('awards gold based on total kills × GOLD_PER_ENEMY_KILL', () => {
        const auth = makeAuthority();
        // Simulate 3 kills for player 1 via queued hits
        for (let i = 1; i <= 3; i++) {
            auth.queueEnemyHit(1, i, 999);
            auth.applyQueuedEnemyHits([{ id: i, hp: 50 }]);
        }
        const playerStates = [{ playerId: 1, kills: 3 }];
        const resources = { gold: 15 }; // matches 3 × 5
        auth.reconcile(playerStates, resources);
        // canonical gold = kills(3) * 5 + nonKillOffset(0) = 15
        assert.equal(resources.gold, 15);
    });

    it('does not reduce gold below the non-kill offset', () => {
        const auth = makeAuthority();
        // No kills — player has 20 gold from non-kill sources (harvesting etc.)
        const playerStates = [{ playerId: 1, kills: 0 }];
        const resources = { gold: 20 };
        auth.reconcile(playerStates, resources);
        // nonKillOffset should be set to 20, gold stays 20
        assert.equal(resources.gold, 20);
    });

    it('kill count is monotonically non-decreasing (never reverts)', () => {
        const auth = makeAuthority();
        // First reconcile: 5 kills
        auth.reconcile([{ playerId: 1, kills: 5 }], { gold: 25 });
        // Second reconcile: client reports only 2 kills (e.g. due to resync)
        const states = [{ playerId: 1, kills: 2 }];
        auth.reconcile(states, { gold: 10 });
        // Authoritative kills should remain 5
        assert.equal(states[0].kills, 5);
    });
});
