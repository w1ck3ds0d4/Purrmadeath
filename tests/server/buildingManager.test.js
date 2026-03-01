const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createBuildingManager } = require('../../server/buildingManager');

const MINIMAL_RULES = {
    wallLvl1: {
        footprint: { w: 1, h: 1 },
        cost: { wood: 1, stone: 0, iron: 0, gold: 0 },
        maxHp: 500,
        unbreakable: true
    },
    lumberMill: {
        footprint: { w: 2, h: 2 },
        cost: { wood: 20, stone: 10, iron: 0, gold: 0 },
        maxHp: 1000,
        unbreakable: false,
        outputResource: 'wood',
        producer: { cycleFrames: 180, outputPerCycle: 1, storageCap: 50 }
    }
};

function makeManager(resourceOverrides = {}) {
    let nonPlayerState = {
        buildingsState: null,
        sharedResources: Object.assign({ wood: 100, stone: 100, iron: 100, gold: 100 }, resourceOverrides),
        buildingsRevision: 0
    };
    const mgr = createBuildingManager({
        getNonPlayerState: () => nonPlayerState,
        serverPerf: {
            serverBuildApplied: 0,
            serverRemoveApplied: 0,
            serverHarvestApplied: 0,
            serverProducerTicks: 0
        },
        BUILDING_RULES: MINIMAL_RULES,
        SERVER_BUILD_MAX_DISTANCE: 9999,
        SERVER_TILE_SIZE: 32
    });
    return { mgr, getNps: () => nonPlayerState };
}

// ---------------------------------------------------------------------------
// Factory smoke
// ---------------------------------------------------------------------------
describe('createBuildingManager — factory', () => {
    it('instantiates without throwing', () => {
        assert.doesNotThrow(() => makeManager());
    });

    it('exposes expected methods', () => {
        const { mgr } = makeManager();
        for (const method of [
            'ensureBuildingState', 'hasSufficientResources', 'validateBuildOrRemove',
            'applyBuild', 'applyRemove', 'applyHarvest', 'releaseBuildReservation',
            'updateProducerOutputs', 'applyResourceDelta', 'applySingleResourceDelta',
            'computeBuildingStateHash', 'getBuildingIndexAtTile',
            'clearPendingReservations', 'keyFromTile',
            'getPendingBuildReservations', 'getPendingTileReservations', 'getResourceDelta'
        ]) {
            assert.equal(typeof mgr[method], 'function', `${method} should be a function`);
        }
    });
});

// ---------------------------------------------------------------------------
// ensureBuildingState
// ---------------------------------------------------------------------------
describe('ensureBuildingState', () => {
    it('initialises buildingsState from null', () => {
        const { mgr, getNps } = makeManager();
        mgr.ensureBuildingState();
        assert.ok(Array.isArray(getNps().buildingsState.buildings));
    });

    it('does not overwrite an existing buildingsState', () => {
        const { mgr, getNps } = makeManager();
        getNps().buildingsState = { nextBuildingId: 5, buildings: [{ id: 1, type: 'wallLvl1', tileX: 0, tileY: 0 }] };
        mgr.ensureBuildingState();
        assert.equal(getNps().buildingsState.buildings.length, 1);
    });
});

// ---------------------------------------------------------------------------
// hasSufficientResources
// ---------------------------------------------------------------------------
describe('hasSufficientResources', () => {
    it('returns true when resources cover the cost', () => {
        const { mgr } = makeManager({ wood: 10 });
        assert.ok(mgr.hasSufficientResources('wallLvl1'));   // costs 1 wood
    });

    it('returns false when resources are insufficient', () => {
        const { mgr } = makeManager({ wood: 0, stone: 0, iron: 0, gold: 0 });
        assert.ok(!mgr.hasSufficientResources('lumberMill')); // costs 20 wood + 10 stone
    });

    it('returns false for an unknown building type', () => {
        const { mgr } = makeManager();
        assert.ok(!mgr.hasSufficientResources('unknownThing'));
    });
});

// ---------------------------------------------------------------------------
// applyBuild + applyRemove
// ---------------------------------------------------------------------------
describe('applyBuild', () => {
    it('adds a building to buildingsState', () => {
        const { mgr, getNps } = makeManager();
        mgr.ensureBuildingState();
        const result = mgr.applyBuild({ buildingType: 'wallLvl1', tileX: 3, tileY: 3 });
        assert.ok(result.ok);
        assert.equal(getNps().buildingsState.buildings.length, 1);
        assert.equal(getNps().buildingsState.buildings[0].type, 'wallLvl1');
    });

    it('increments buildingsRevision', () => {
        const { mgr, getNps } = makeManager();
        mgr.ensureBuildingState();
        const revBefore = getNps().buildingsRevision;
        mgr.applyBuild({ buildingType: 'wallLvl1', tileX: 5, tileY: 5 });
        assert.ok(getNps().buildingsRevision > revBefore);
    });

    it('rejects an unknown building type', () => {
        const { mgr } = makeManager();
        mgr.ensureBuildingState();
        const result = mgr.applyBuild({ buildingType: 'alienTech', tileX: 0, tileY: 0 });
        assert.ok(!result.ok);
    });
});

describe('applyRemove', () => {
    it('removes an existing building', () => {
        const { mgr, getNps } = makeManager();
        mgr.ensureBuildingState();
        mgr.applyBuild({ buildingType: 'wallLvl1', tileX: 2, tileY: 2 });
        assert.equal(getNps().buildingsState.buildings.length, 1);
        const actorState = { x: 2 * 32 + 16, y: 2 * 32 + 16 };
        mgr.applyRemove({ tileX: 2, tileY: 2 }, actorState);
        assert.equal(getNps().buildingsState.buildings.length, 0);
    });
});

// ---------------------------------------------------------------------------
// applyResourceDelta
// ---------------------------------------------------------------------------
describe('applyResourceDelta', () => {
    it('subtracts resources (sign=-1)', () => {
        const { mgr, getNps } = makeManager({ wood: 50 });
        mgr.applyResourceDelta({ wood: 10, stone: 0, iron: 0, gold: 0 }, -1);
        assert.equal(getNps().sharedResources.wood, 40);
    });

    it('adds resources (sign=+1)', () => {
        const { mgr, getNps } = makeManager({ wood: 10 });
        mgr.applyResourceDelta({ wood: 5, stone: 0, iron: 0, gold: 0 }, +1);
        assert.equal(getNps().sharedResources.wood, 15);
    });
});

// ---------------------------------------------------------------------------
// computeBuildingStateHash
// ---------------------------------------------------------------------------
describe('computeBuildingStateHash', () => {
    it('returns "0" for null state', () => {
        const { mgr } = makeManager();
        assert.equal(mgr.computeBuildingStateHash(null), '0');
    });

    it('returns the same hash for identical states', () => {
        const { mgr } = makeManager();
        const state = { buildings: [{ id: 1, type: 'wallLvl1', tileX: 0, tileY: 0, hp: 500, maxHp: 500, storedOutput: 0, cycleTimerFrames: 0, towerCooldownRemainingFrames: 0 }] };
        assert.equal(mgr.computeBuildingStateHash(state), mgr.computeBuildingStateHash(state));
    });

    it('returns different hashes for different states', () => {
        const { mgr } = makeManager();
        const a = { buildings: [{ id: 1, type: 'wallLvl1', tileX: 0, tileY: 0, hp: 500, maxHp: 500, storedOutput: 0, cycleTimerFrames: 0, towerCooldownRemainingFrames: 0 }] };
        const b = { buildings: [{ id: 1, type: 'wallLvl1', tileX: 1, tileY: 0, hp: 500, maxHp: 500, storedOutput: 0, cycleTimerFrames: 0, towerCooldownRemainingFrames: 0 }] };
        assert.notEqual(mgr.computeBuildingStateHash(a), mgr.computeBuildingStateHash(b));
    });
});

// ---------------------------------------------------------------------------
// clearPendingReservations
// ---------------------------------------------------------------------------
describe('clearPendingReservations', () => {
    it('clears both reservation maps without throwing', () => {
        const { mgr } = makeManager();
        mgr.getPendingBuildReservations().set('k1', { createdAt: Date.now() });
        mgr.getPendingTileReservations().set('1,2', { reservationKey: 'k1' });
        assert.doesNotThrow(() => mgr.clearPendingReservations());
        assert.equal(mgr.getPendingBuildReservations().size, 0);
        assert.equal(mgr.getPendingTileReservations().size, 0);
    });
});

// ---------------------------------------------------------------------------
// updateProducerOutputs
// ---------------------------------------------------------------------------
describe('updateProducerOutputs', () => {
    it('runs without throwing on an empty building state', () => {
        const { mgr } = makeManager();
        mgr.ensureBuildingState();
        assert.doesNotThrow(() => mgr.updateProducerOutputs(1));
    });

    it('advances production on a lumberMill over enough frames', () => {
        const { mgr, getNps } = makeManager();
        mgr.ensureBuildingState();
        mgr.applyBuild({ buildingType: 'lumberMill', tileX: 0, tileY: 0 });
        const building = getNps().buildingsState.buildings[0];
        const initialOutput = building.storedOutput;
        // Advance 200 frames — more than one 180-frame cycle
        mgr.updateProducerOutputs(200);
        assert.ok(building.storedOutput > initialOutput, 'storedOutput should have increased');
    });
});
