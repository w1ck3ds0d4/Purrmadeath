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

  // ── Entity lifecycle ────────────────────────────────────────────────────────

  /** Create a new entity and return its ID. */
  createEntity(): EntityId {
    const id = this.nextId++;
    this.entities.add(id);
    return id;
  }

  /**
   * Create an entity with a pre-determined ID.
   * Used during snapshot/delta deserialization so IDs match between server and client.
   */
  createEntityWithId(id: EntityId): void {
    this.entities.add(id);
    if (id >= this.nextId) this.nextId = id + 1;
  }

  /** Destroy an entity and remove all its components. Safe to call on unknown ID. */
  destroyEntity(id: EntityId): void {
    if (!this.entities.has(id)) return;
    this.entities.delete(id);
    for (const store of this.storage.values()) store.delete(id);
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
    store.set(id, data);
  }

  /** Remove a component from an entity. No-op if not present. */
  removeComponent(id: EntityId, type: string): void {
    this.storage.get(type)?.delete(id);
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
   * Returns a snapshot array - safe to iterate while destroying entities.
   *
   * Example:
   *   for (const id of world.query('Position', 'Velocity')) {
   *     const pos = world.getComponent<PositionComponent>(id, 'Position')!;
   *     pos.x += vel.vx * dt;
   *   }
   */
  query(...types: string[]): EntityId[] {
    const result: EntityId[] = [];
    for (const id of this.entities) {
      if (types.every((t) => this.hasComponent(id, t))) result.push(id);
    }
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
  }

  /** Remove all entities and components, reset ID counter. */
  clear(): void {
    this.entities.clear();
    this.storage.clear();
    this.nextId = 1;
  }
}