const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
    isValidActionPayload,
    isValidActionResultPayload,
    validateAttackAction,
    validateOriginBoundAction,
    createResourceState,
    normalizeBuildCost,
    applyResourceDelta
} = require('../../server/actionUtils');

// ---------------------------------------------------------------------------
// isValidActionPayload
// ---------------------------------------------------------------------------
describe('isValidActionPayload', () => {
    it('accepts a valid attack action', () => {
        assert.ok(isValidActionPayload({
            type: 'attack', dirX: 1, dirY: 0, originX: 100, originY: 100, weapon: 'sword'
        }));
    });
    it('accepts pistol weapon', () => {
        assert.ok(isValidActionPayload({
            type: 'attack', dirX: 0, dirY: -1, originX: 0, originY: 0, weapon: 'pistol'
        }));
    });
    it('rejects attack with unknown weapon', () => {
        assert.ok(!isValidActionPayload({
            type: 'attack', dirX: 1, dirY: 0, originX: 0, originY: 0, weapon: 'rocket'
        }));
    });
    it('accepts a valid build action', () => {
        assert.ok(isValidActionPayload({
            type: 'build', tileX: 5, tileY: 5, clientActionId: 1, buildingType: 'wallLvl1'
        }));
    });
    it('rejects build action missing clientActionId', () => {
        assert.ok(!isValidActionPayload({
            type: 'build', tileX: 5, tileY: 5, buildingType: 'wallLvl1'
        }));
    });
    it('rejects build action with empty buildingType', () => {
        assert.ok(!isValidActionPayload({
            type: 'build', tileX: 5, tileY: 5, clientActionId: 1, buildingType: ''
        }));
    });
    it('accepts remove action', () => {
        assert.ok(isValidActionPayload({ type: 'remove', tileX: 3, tileY: 3, clientActionId: 2 }));
    });
    it('accepts harvest and revive actions', () => {
        assert.ok(isValidActionPayload({ type: 'harvest', originX: 64, originY: 64 }));
        assert.ok(isValidActionPayload({ type: 'revive',  originX: 64, originY: 64 }));
    });
    it('accepts no-payload session actions', () => {
        for (const type of ['toggle_pause', 'restart_session', 'force_reset_session', 'dev_add_resources']) {
            assert.ok(isValidActionPayload({ type }), `${type} should be valid`);
        }
    });
    it('rejects unknown action type', () => {
        assert.ok(!isValidActionPayload({ type: 'unknown_thing' }));
    });
    it('rejects null', () => assert.ok(!isValidActionPayload(null)));
    it('rejects non-string type', () => assert.ok(!isValidActionPayload({ type: 42 })));
    it('rejects Infinity as coordinate', () => {
        assert.ok(!isValidActionPayload({ type: 'attack', dirX: Infinity, dirY: 0, originX: 0, originY: 0, weapon: 'sword' }));
    });
});

// ---------------------------------------------------------------------------
// isValidActionResultPayload
// ---------------------------------------------------------------------------
describe('isValidActionResultPayload', () => {
    it('accepts a valid result', () => {
        assert.ok(isValidActionResultPayload({ actionType: 'build', clientActionId: 1 }));
    });
    it('rejects missing actionType',      () => assert.ok(!isValidActionResultPayload({ clientActionId: 1 })));
    it('rejects non-finite clientActionId', () => assert.ok(!isValidActionResultPayload({ actionType: 'build', clientActionId: NaN })));
    it('rejects null',                    () => assert.ok(!isValidActionResultPayload(null)));
});

// ---------------------------------------------------------------------------
// validateAttackAction
// ---------------------------------------------------------------------------
describe('validateAttackAction', () => {
    const cooldowns = { sword: 500, pistol: 800 };

    it('accepts a valid in-range attack', () => {
        const actor = { x: 100, y: 100, lastAttackAtByWeapon: { sword: 0, pistol: 0 } };
        const result = validateAttackAction(
            { type: 'attack', weapon: 'sword', originX: 100, originY: 100, dirX: 1, dirY: 0 },
            actor, 100, cooldowns
        );
        assert.ok(result.ok);
    });
    it('rejects origin too far from actor', () => {
        const actor = { x: 0, y: 0, lastAttackAtByWeapon: { sword: 0 } };
        const result = validateAttackAction(
            { type: 'attack', weapon: 'sword', originX: 500, originY: 0, dirX: 1, dirY: 0 },
            actor, 100, cooldowns
        );
        assert.ok(!result.ok);
        assert.equal(result.reason, 'attack_origin_too_far');
    });
    it('rejects attack on cooldown', () => {
        const actor = { x: 0, y: 0, lastAttackAtByWeapon: { sword: Date.now() } };
        const result = validateAttackAction(
            { type: 'attack', weapon: 'sword', originX: 0, originY: 0, dirX: 1, dirY: 0 },
            actor, 100, cooldowns
        );
        assert.ok(!result.ok);
        assert.equal(result.reason, 'attack_cooldown');
    });
});

// ---------------------------------------------------------------------------
// validateOriginBoundAction
// ---------------------------------------------------------------------------
describe('validateOriginBoundAction', () => {
    it('accepts within range', () => {
        const actor = { x: 100, y: 100 };
        const r = validateOriginBoundAction({ originX: 100, originY: 100 }, actor, 200, 'too_far');
        assert.ok(r.ok);
    });
    it('rejects out of range', () => {
        const actor = { x: 0, y: 0 };
        const r = validateOriginBoundAction({ originX: 999, originY: 0 }, actor, 100, 'too_far');
        assert.ok(!r.ok);
        assert.equal(r.reason, 'too_far');
    });
    it('rejects non-finite origin', () => {
        const actor = { x: 0, y: 0 };
        const r = validateOriginBoundAction({ originX: NaN, originY: 0 }, actor, 100, 'too_far');
        assert.ok(!r.ok);
        assert.equal(r.reason, 'invalid_origin');
    });
});

// ---------------------------------------------------------------------------
// createResourceState
// ---------------------------------------------------------------------------
describe('createResourceState', () => {
    it('creates zeroed state from null',    () => assert.deepEqual(createResourceState(null), { wood:0, stone:0, iron:0, gold:0 }));
    it('floors non-integer values',         () => assert.equal(createResourceState({ wood: 5.9 }).wood, 5));
    it('clamps negative values to 0',       () => assert.equal(createResourceState({ wood: -10 }).wood, 0));
    it('copies positive integer values',    () => assert.equal(createResourceState({ stone: 42 }).stone, 42));
    it('handles NaN gracefully',            () => assert.equal(createResourceState({ gold: NaN }).gold, 0));
});

// ---------------------------------------------------------------------------
// normalizeBuildCost
// ---------------------------------------------------------------------------
describe('normalizeBuildCost', () => {
    const RULES = {
        wallLvl1: { footprint: { w:1, h:1 }, cost: { wood:1, stone:0, iron:0, gold:0 }, maxHp: 500 },
        free:     { footprint: { w:1, h:1 }, maxHp: 100 }   // no cost property
    };
    it('returns cost for known building type',   () => assert.deepEqual(normalizeBuildCost('wallLvl1', RULES), { wood:1, stone:0, iron:0, gold:0 }));
    it('returns null for unknown building type', () => assert.equal(normalizeBuildCost('unknown', RULES), null));
    it('returns null when rule has no cost',     () => assert.equal(normalizeBuildCost('free', RULES), null));
});

// ---------------------------------------------------------------------------
// applyResourceDelta
// ---------------------------------------------------------------------------
describe('applyResourceDelta', () => {
    it('subtracts cost (sign=-1)', () => {
        const state = { wood: 50, stone: 50, iron: 50, gold: 50 };
        applyResourceDelta(state, { wood: 10, stone: 5, iron: 0, gold: 0 }, -1);
        assert.equal(state.wood, 40);
        assert.equal(state.stone, 45);
    });
    it('adds cost (sign=+1)', () => {
        const state = { wood: 10, stone: 0, iron: 0, gold: 0 };
        applyResourceDelta(state, { wood: 5, stone: 0, iron: 0, gold: 0 }, +1);
        assert.equal(state.wood, 15);
    });
    it('clamps result to 0 (no negative resources)', () => {
        const state = { wood: 3, stone: 0, iron: 0, gold: 0 };
        applyResourceDelta(state, { wood: 10, stone: 0, iron: 0, gold: 0 }, -1);
        assert.equal(state.wood, 0);
    });
    it('does nothing when state is null', () => {
        assert.doesNotThrow(() => applyResourceDelta(null, { wood: 1 }, -1));
    });
});
