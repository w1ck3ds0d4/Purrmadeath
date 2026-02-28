import {
    ensureHouseStatesAndLabels,
    getHouseTimerReplication as getHouseTimerReplicationBase,
    syncReplicatedHouseTimers as syncReplicatedHouseTimersBase,
    updateHouseTimerLabels as updateHouseTimerLabelsBase
} from './civilianReplication.js';

// Thin adapter around house replication helpers to keep the civilian runtime file smaller.
export function ensureHouseStatesAdapter(params) {
    ensureHouseStatesAndLabels(params);
}

export function updateHouseTimerLabelsAdapter(params) {
    updateHouseTimerLabelsBase(params);
}

export function getHouseTimerReplicationAdapter(houseStates) {
    return getHouseTimerReplicationBase(houseStates);
}

export function syncReplicatedHouseTimersAdapter(params) {
    syncReplicatedHouseTimersBase(params);
}

