import { World } from '@shared/ecs/World';
import { C, PositionComponent, FactionComponent, HealthComponent, BuildingComponent } from '@shared/components';
import { MessageType } from '@shared/protocol';
import {
  TILE_SIZE,
  BUILDING_COSTS,
  BUILDING_SIZES,
  PLACEABLE_BUILDINGS,
  buildingHalfExtent,
  snapBuildingPosition,
  PLAYER_RADIUS,
  ENEMY_RADIUS,
  RESOURCE_NODE_RADIUS,
} from '@shared/constants';
import { TILE_DEFS } from '@shared/world/TileRegistry';
import type { InputManager } from '../input/InputManager';
import { Action } from '../input/InputManager';
import type { BuildModeOverlay } from '../ui/BuildModeOverlay';
import type { BuildGhostRenderer } from '../render/BuildGhostRenderer';
import type { ChunkManager } from '../world/ChunkManager';

// ── Dependencies ────────────────────────────────────────────────────────────

export interface BuildControllerDeps {
  world: World;
  input: InputManager;
  getChunks: () => ChunkManager | null;
  getMouseWorld: () => { x: number; y: number };
  buildOverlay: BuildModeOverlay;
  buildGhost: BuildGhostRenderer;
  combinedResources: () => Record<string, number>;
  getLocalResources: () => Record<string, number>;
  getWarehouseResources: () => Record<string, number>;
  getWarehouseExists: () => boolean;
  send: (msg: object) => void;
}

// ── Factory ─────────────────────────────────────────────────────────────────

export function createBuildController(deps: BuildControllerDeps) {
  const { world, input, buildOverlay, buildGhost } = deps;

  let active = false;
  let selectedIdx = 0;
  let selectedId: number | null = null;

  function exitBuildMode(): void {
    active = false;
    selectedId = null;
    buildOverlay.hide();
    buildGhost.hide();
  }

  function reset(): void {
    active = false;
    selectedId = null;
    selectedIdx = 0;
    buildOverlay.hide();
    buildGhost.hide();
  }

  function toggle(): void {
    active = !active;
    selectedId = null;
    if (active) {
      buildOverlay.show();
      buildOverlay.update(PLACEABLE_BUILDINGS[selectedIdx], deps.combinedResources());
      buildGhost.show();
    } else {
      buildOverlay.hide();
      buildGhost.hide();
    }
  }

  function handleScroll(scrollDelta: number): void {
    if (!active || scrollDelta === 0) return;
    const dir = scrollDelta > 0 ? 1 : -1;
    selectedIdx = (selectedIdx + dir + PLACEABLE_BUILDINGS.length) % PLACEABLE_BUILDINGS.length;
    selectedId = null;
    buildOverlay.update(PLACEABLE_BUILDINGS[selectedIdx], deps.combinedResources());
  }

  function update(): void {
    if (!active) return;
    const { x: wmx, y: wmy } = deps.getMouseWorld();
    const currentBuilding = PLACEABLE_BUILDINGS[selectedIdx];

    // Snap to grid
    const { x: snapX, y: snapY } = snapBuildingPosition(wmx, wmy, currentBuilding);
    const newHalf = buildingHalfExtent(currentBuilding);
    const tiles = BUILDING_SIZES[currentBuilding] ?? 1;

    // Cost affordability
    const costs = BUILDING_COSTS[currentBuilding] ?? {};
    const wRes = deps.getWarehouseExists()
      ? deps.getWarehouseResources() as Record<string, number>
      : {} as Record<string, number>;
    const localRes = deps.getLocalResources();
    let ghostValid = true;
    for (const [res, amount] of Object.entries(costs)) {
      const total = (wRes[res] ?? 0) + (localRes[res] ?? 0);
      if (total < amount!) { ghostValid = false; break; }
    }

    // Multi-tile walkability check
    const chunks = deps.getChunks();
    const isBridge = currentBuilding === 'bridge';
    if (ghostValid && chunks) {
      const startTX = Math.floor((snapX - newHalf) / TILE_SIZE);
      const startTY = Math.floor((snapY - newHalf) / TILE_SIZE);
      for (let ty = 0; ty < tiles && ghostValid; ty++) {
        for (let tx = 0; tx < tiles && ghostValid; tx++) {
          const tileId = chunks.getTile(startTX + tx, startTY + ty);
          const walkable = TILE_DEFS[tileId]?.walkable ?? false;
          if (isBridge ? walkable : !walkable) ghostValid = false;
        }
      }
    }

    // Overlap check against buildings, resources, players, enemies
    if (ghostValid) {
      for (const eid of world.query(C.Position, C.Faction)) {
        const ef = world.getComponent<FactionComponent>(eid, C.Faction);
        const ep = world.getComponent<PositionComponent>(eid, C.Position)!;
        if (ef?.type === 'building') {
          const bComp = world.getComponent<BuildingComponent>(eid, C.Building);
          const existHalf = bComp ? buildingHalfExtent(bComp.buildingType) : 16;
          if (Math.abs(ep.x - snapX) < newHalf + existHalf && Math.abs(ep.y - snapY) < newHalf + existHalf) { ghostValid = false; break; }
        } else if (ef?.type === 'resource') {
          if (Math.abs(ep.x - snapX) < newHalf + RESOURCE_NODE_RADIUS && Math.abs(ep.y - snapY) < newHalf + RESOURCE_NODE_RADIUS) { ghostValid = false; break; }
        } else if (ef?.type === 'player' || ef?.type === 'enemy') {
          const r = ef.type === 'player' ? PLAYER_RADIUS : ENEMY_RADIUS;
          if (Math.abs(ep.x - snapX) < newHalf + r && Math.abs(ep.y - snapY) < newHalf + r) { ghostValid = false; break; }
        }
      }
    }

    buildGhost.update(wmx, wmy, ghostValid, currentBuilding);

    // Click: select existing building or place new one
    if (input.isJustPressed(Action.Attack)) {
      let clicked: number | null = null;
      for (const eid of world.query(C.Position, C.Building)) {
        const ep = world.getComponent<PositionComponent>(eid, C.Position)!;
        const bComp = world.getComponent<BuildingComponent>(eid, C.Building)!;
        const bHalf = buildingHalfExtent(bComp.buildingType);
        if (Math.abs(wmx - ep.x) < bHalf && Math.abs(wmy - ep.y) < bHalf) { clicked = eid; break; }
      }
      if (clicked !== null) {
        selectedId = clicked;
        const bComp = world.getComponent<BuildingComponent>(clicked, C.Building)!;
        const hp = world.getComponent<HealthComponent>(clicked, C.Health);
        buildOverlay.updateSelection(bComp.buildingType, bComp.upgradeLevel, deps.combinedResources(), hp?.current, hp?.max);
      } else if (ghostValid) {
        deps.send({ type: MessageType.BUILD_PLACE, buildingType: currentBuilding, x: wmx, y: wmy });
        selectedId = null;
      }
    }

    // X: demolish
    if (input.isJustPressed(Action.Demolish) && selectedId !== null) {
      deps.send({ type: MessageType.BUILD_DEMOLISH, entityId: selectedId });
      selectedId = null;
      buildOverlay.update(PLACEABLE_BUILDINGS[selectedIdx], deps.combinedResources());
    }

    // V: upgrade
    if (input.isJustPressed(Action.Upgrade) && selectedId !== null) {
      deps.send({ type: MessageType.BUILD_UPGRADE, entityId: selectedId });
    }

    // R: repair
    if (input.isJustPressed(Action.Repair) && selectedId !== null) {
      deps.send({ type: MessageType.BUILD_REPAIR, entityId: selectedId });
    }

    // Deselect if building no longer exists
    if (selectedId !== null && !world.hasEntity(selectedId)) {
      selectedId = null;
      buildOverlay.update(PLACEABLE_BUILDINGS[selectedIdx], deps.combinedResources());
    }

    // Live HP update for selected building
    if (selectedId !== null) {
      const hp = world.getComponent<HealthComponent>(selectedId, C.Health);
      if (hp) buildOverlay.updateSelectionHp(hp.current, hp.max);
    }
  }

  return {
    get active() { return active; },
    set active(v: boolean) { active = v; },
    get selectedIdx() { return selectedIdx; },
    set selectedIdx(v: number) { selectedIdx = v; },
    get selectedId() { return selectedId; },
    set selectedId(v: number | null) { selectedId = v; },
    exitBuildMode,
    reset,
    toggle,
    handleScroll,
    update,
  };
}

export type BuildController = ReturnType<typeof createBuildController>;
