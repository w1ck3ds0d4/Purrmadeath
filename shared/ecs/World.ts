// ─── ECS World ────────────────────────────────────────────────────────────────
// The World is the single source of truth for all game state.
// Both the server (canonical) and client (predicted / reconciled) use the same class.
//
// Design: sparse-set via nested Maps - simple, serializable, good enough for
// up to ~5 000 entities. If profiling shows a bottleneck, migrate hot component
// types to typed arrays; the public API stays the same.

export type EntityId = number;

export interface SerializedEntity {
  id: EntityId;
  components: Record<string, unknown>;
}

export interface SerializedWorld {
  entities: SerializedEntity[];
  nextEntityId: number;
}

export class World {
  // Counter bumped on every createEntity call. Never reused.
  private nextId: EntityId = 1;

  // The set of all living entity IDs.
  private entities = new Set<EntityId>();

  // storage[componentType][entityId] = componentData
  private storage = new Map<string, Map<EntityId, unknown>>();

  // Query result cache: "CompA,CompB" → EntityId[]
  // Invalidated on any structural change (entity create/destroy, component add/remove).
  private queryCache = new Map<string, EntityId[]>();
  private queryCacheDirty = true;

  // ── Entity lifecycle ────────────────────────────────────────────────────────

  /** Create a new entity and return its ID. */
  createEntity(): EntityId {
    const id = this.nextId++;
    this.entities.add(id);
    this.queryCacheDirty = true;
    return id;
  }

  /**
   * Create an entity with a pre-determined ID.
   * Used during snapshot/delta deserialization so IDs match between server and client.
   */
  createEntityWithId(id: EntityId): void {
    this.entities.add(id);
    if (id >= this.nextId) this.nextId = id + 1;
    this.queryCacheDirty = true;
  }

  /** Destroy an entity and remove all its components. Safe to call on unknown ID. */
  destroyEntity(id: EntityId): void {
    if (!this.entities.has(id)) return;
    this.entities.delete(id);
    for (const store of this.storage.values()) store.delete(id);
    this.queryCacheDirty = true;
  }

  hasEntity(id: EntityId): boolean {
    return this.entities.has(id);
  }

  /** All living entity IDs (read-only view - do not mutate). */
  get allEntities(): ReadonlySet<EntityId> {
    return this.entities;
  }

  // ── Component management ────────────────────────────────────────────────────

  /** Attach (or replace) a component on an entity. */
  addComponent<T extends object>(id: EntityId, type: string, data: T): void {
    if (!this.entities.has(id)) {
      throw new Error(`World.addComponent: entity ${id} does not exist`);
    }
    let store = this.storage.get(type);
    if (!store) {
      store = new Map();
      this.storage.set(type, store);
    }
    const hadBefore = store.has(id);
    store.set(id, data);
    if (!hadBefore) this.queryCacheDirty = true;
  }

  /** Remove a component from an entity. No-op if not present. */
  removeComponent(id: EntityId, type: string): void {
    const store = this.storage.get(type);
    if (store && store.delete(id)) this.queryCacheDirty = true;
  }

  /** Get component data. Returns undefined if the entity lacks this component. */
  getComponent<T>(id: EntityId, type: string): T | undefined {
    return this.storage.get(type)?.get(id) as T | undefined;
  }

  hasComponent(id: EntityId, type: string): boolean {
    return this.storage.get(type)?.has(id) ?? false;
  }

  // ── Query ───────────────────────────────────────────────────────────────────

  /**
   * Return all entities that have ALL the listed component types.
   * Results are cached until the next structural change (entity/component add/remove).
   * Returns a snapshot array - safe to iterate while destroying entities.
   *
   * Example:
   *   for (const id of world.query('Position', 'Velocity')) {
   *     const pos = world.getComponent<PositionComponent>(id, 'Position')!;
   *     pos.x += vel.vx * dt;
   *   }
   */
  query(...types: string[]): EntityId[] {
    if (this.queryCacheDirty) {
      this.queryCache.clear();
      this.queryCacheDirty = false;
    }

    const key = types.length === 1 ? types[0] : types.join(',');
    const cached = this.queryCache.get(key);
    if (cached) return cached;

    const result: EntityId[] = [];
    for (const id of this.entities) {
      if (types.every((t) => this.hasComponent(id, t))) result.push(id);
    }
    this.queryCache.set(key, result);
    return result;
  }

  // ── Serialization ───────────────────────────────────────────────────────────

  /** Serialize the full world to a plain object (for save files and full snapshots). */
  serialize(): SerializedWorld {
    const entities: SerializedEntity[] = [];
    for (const id of this.entities) {
      const components: Record<string, unknown> = {};
      for (const [type, store] of this.storage) {
        const data = store.get(id);
        if (data !== undefined) components[type] = data;
      }
      entities.push({ id, components });
    }
    return { entities, nextEntityId: this.nextId };
  }

  /** Replace the entire world from a serialized snapshot (full sync from server). */
  deserialize(snapshot: SerializedWorld): void {
    this.clear();
    this.nextId = snapshot.nextEntityId;
    for (const { id, components } of snapshot.entities) {
      this.entities.add(id);
      for (const [type, data] of Object.entries(components)) {
        let store = this.storage.get(type);
        if (!store) { store = new Map(); this.storage.set(type, store); }
        store.set(id, data as object);
      }
    }
    this.queryCacheDirty = true;
  }

  /**
   * Apply a partial delta - only the entities/components that changed.
   * Used for incremental server → client sync each tick.
   * Entities in the delta that don't exist yet are created automatically.
   */
  applyDelta(delta: Partial<SerializedWorld>): void {
    if (!delta.entities) return;
    for (const { id, components } of delta.entities) {
      if (!this.entities.has(id)) {
        this.entities.add(id);
        if (id >= this.nextId) this.nextId = id + 1;
      }
      for (const [type, data] of Object.entries(components)) {
        let store = this.storage.get(type);
        if (!store) { store = new Map(); this.storage.set(type, store); }
        store.set(id, data as object);
      }
    }
    this.queryCacheDirty = true;
  }

  /** Remove all entities and components, reset ID counter. */
  clear(): void {
    this.entities.clear();
    this.storage.clear();
    this.queryCache.clear();
    this.queryCacheDirty = false;
    this.nextId = 1;
  }
}
