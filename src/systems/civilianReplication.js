import * as PIXI from 'pixi.js';

const HOUSE_LABEL_STYLE = {
    fill: '#f7f7f7',
    fontFamily: 'monospace',
    fontSize: 11
};

function createHouseLabel(layer) {
    const label = new PIXI.Text({
        text: '',
        style: HOUSE_LABEL_STYLE
    });
    label.anchor.set(0.5);
    layer.addChild(label);
    return label;
}

// House timer/label replication helpers.
export function ensureHouseStatesAndLabels(args) {
    const {
        houses,
        houseStates,
        houseTimerLabels,
        civilianLayer,
        civilians,
        HOUSE_SPAWN_INTERVAL_FRAMES
    } = args;
    const houseIds = new Set(houses.map((house) => house.id));

    for (const house of houses) {
        if (!houseStates.has(house.id)) {
            houseStates.set(house.id, {
                spawnTimer: 0,
                activeCivilianIds: new Set()
            });
        }
        if (!houseTimerLabels.has(house.id)) {
            houseTimerLabels.set(house.id, createHouseLabel(civilianLayer));
        }
    }

    for (const [houseId, state] of houseStates) {
        if (!houseIds.has(houseId)) {
            for (const civilianId of state.activeCivilianIds) {
                const civilian = civilians.find((entry) => entry.id === civilianId);
                if (civilian) {
                    civilian.homeHouseId = null;
                }
            }
            const label = houseTimerLabels.get(houseId);
            if (label) {
                label.destroy();
                houseTimerLabels.delete(houseId);
            }
            houseStates.delete(houseId);
            continue;
        }
        // Keep stale/invalid timers from drifting forever after long pauses.
        state.spawnTimer = Number.isFinite(state.spawnTimer) ? state.spawnTimer : HOUSE_SPAWN_INTERVAL_FRAMES;
    }
}

export function updateHouseTimerLabels(args) {
    const {
        houses,
        houseStates,
        houseTimerLabels,
        getBuildingCenter,
        TILE_SIZE,
        HOUSE_CIVILIAN_CAP_BONUS
    } = args;
    for (const house of houses) {
        const state = houseStates.get(house.id);
        const label = houseTimerLabels.get(house.id);
        if (!state || !label) {
            continue;
        }
        const center = getBuildingCenter(house);
        label.position.set(center.x, center.y - (house.footprintH * TILE_SIZE * 0.5) - 8);
        const seconds = Math.max(0, Math.ceil(state.spawnTimer / 60));
        label.text = `Civ ${state.activeCivilianIds.size}/${HOUSE_CIVILIAN_CAP_BONUS} | ${seconds}s`;
    }
}

export function getHouseTimerReplication(houseStates) {
    const entries = [];
    for (const [houseId, state] of houseStates) {
        entries.push({
            houseId: Number(houseId),
            activeCivilianCount: state.activeCivilianIds.size,
            spawnTimerFrames: state.spawnTimer
        });
    }
    return entries;
}

export function syncReplicatedHouseTimers(args) {
    const {
        entries,
        houses,
        houseTimerLabels,
        civilianLayer,
        getBuildingCenter,
        TILE_SIZE,
        HOUSE_CIVILIAN_CAP_BONUS
    } = args;
    const source = Array.isArray(entries) ? entries : [];
    const houseById = new Map();
    for (const house of houses) {
        houseById.set(Number(house.id), house);
    }
    const seen = new Set();
    for (const entry of source) {
        const houseId = Number(entry?.houseId);
        if (!Number.isFinite(houseId)) {
            continue;
        }
        const house = houseById.get(houseId);
        if (!house) {
            continue;
        }
        seen.add(houseId);
        let label = houseTimerLabels.get(houseId);
        if (!label) {
            label = createHouseLabel(civilianLayer);
            houseTimerLabels.set(houseId, label);
        }
        const center = getBuildingCenter(house);
        label.position.set(center.x, center.y - (house.footprintH * TILE_SIZE * 0.5) - 8);
        const activeCount = Math.max(0, Math.floor(Number(entry?.activeCivilianCount) || 0));
        const seconds = Math.max(0, Math.ceil((Number(entry?.spawnTimerFrames) || 0) / 60));
        label.text = `Civ ${activeCount}/${HOUSE_CIVILIAN_CAP_BONUS} | ${seconds}s`;
        label.visible = true;
    }
    for (const [houseId, label] of houseTimerLabels) {
        if (!seen.has(Number(houseId))) {
            label.visible = false;
        }
    }
}
