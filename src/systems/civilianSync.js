// Follower replication helper for civilian entities.
// Keeps the host/follower civilian mirror path isolated from local AI code.
export function syncReplicatedStateFromSnapshot(args) {
    const {
        entries,
        civilians,
        civilianById,
        civilianLayer,
        createCivilianSprite,
        civilianIdCounterRef,
        civilianRadius,
        civilianMaxHp,
        syncReplicatedHouseTimers,
        houseTimerEntries
    } = args;
    const source = Array.isArray(entries) ? entries : [];
    civilianById.clear();
    while (civilians.length < source.length) {
        const sprite = createCivilianSprite();
        civilianLayer.addChild(sprite);
        const civilian = {
            id: civilianIdCounterRef.value++,
            homeHouseId: null,
            x: 0,
            y: 0,
            hp: civilianMaxHp,
            maxHp: civilianMaxHp,
            isDead: false,
            state: 'replicated',
            cargoResource: null,
            cargoAmount: 0,
            targetProducerId: null,
            targetWarehouseId: null,
            targetX: 0,
            targetY: 0,
            finalTargetX: 0,
            finalTargetY: 0,
            hasTravelWaypoint: false,
            routeSalt: 0,
            stuckFrames: 0,
            stuckRecoveryCooldownFrames: 0,
            patrolRecheckFrames: 0,
            sprite
        };
        civilians.push(civilian);
        civilianById.set(civilian.id, civilian);
    }
    for (let i = 0; i < source.length; i++) {
        const civilian = civilians[i];
        const entry = source[i];
        const centerX = Number(entry?.x) || 0;
        const centerY = Number(entry?.y) || 0;
        civilian.id = Number(entry?.id) || civilian.id;
        civilian.x = centerX - civilianRadius;
        civilian.y = centerY - civilianRadius;
        civilian.hp = Number(entry?.hp) || civilian.hp;
        civilian.maxHp = Number(entry?.maxHp) || civilian.maxHp;
        civilian.isDead = Boolean(entry?.isDead);
        civilian.state = 'replicated';
        civilian.sprite.visible = !civilian.isDead;
        civilian.sprite.position.set(civilian.x, civilian.y);
        civilianById.set(civilian.id, civilian);
    }
    for (let i = civilians.length - 1; i >= source.length; i--) {
        const civilian = civilians[i];
        civilian.sprite.destroy();
        civilians.splice(i, 1);
    }
    syncReplicatedHouseTimers(houseTimerEntries);
}
