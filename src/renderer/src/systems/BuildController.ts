import { World } from '@shared/ecs/World';
import { C, PositionComponent, FactionComponent, HealthComponent, BuildingComponent } from '@shared/components';
import { MessageType } from '@shared/protocol';
import {
  TILE_SIZE,
  BUILDING_COSTS,
  BUILDING_SIZES,
  buildingHalfExtent,
  buildingExtent,
  snapBuildingPosition,
  PLAYER_RADIUS,
  ENEMY_RADIUS,
  RESOURCE_NODE_RADIUS,
  CAMPFIRE_HOUSING_PER_LEVEL,
  CAT_HOUSE_CAPACITY,
  DORMITORY_CAPACITY,
} from '@shared/constants';
import { TILE_DEFS } from '@shared/world/TileRegistry';
import type { InputManager } from '../input/InputManager';
import { Action } from '../input/InputManager';
import type { BuildModeOverlay } from '../ui/overlays/BuildModeOverlay';
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

export type BuildPhase = 'inactive' | 'picker' | 'placing';
export function createBuildController(deps: BuildControllerDeps) {
  const { world, input, buildOverlay, buildGhost } = deps;

  let phase: BuildPhase = 'inactive';
  let placingType = '';
  let selectedId: number | null = null;
  let selectMode = false;
  let rotation = 0;

  /** Returns true if the current building type supports rotation (non-square). */
  function isRotatable(type: string): boolean {
    const s = BUILDING_SIZES[type];
    return !!s && s.w !== s.h;
  }

  function openPicker(): void {
    phase = 'picker';
    selectedId = null;
    buildOverlay.hide();
    buildGhost.hide();
  }

  function selectBuilding(buildingType: string): void {
    phase = 'placing';
    placingType = buildingType;
    selectedId = null;
  }

  function reopenPicker(): void {
    phase = 'picker';
    selectedId = null;
    buildOverlay.hide();
    buildGhost.hide();
  }

  function enterSelectMode(): void {
    phase = 'placing';
    placingType = '';
    selectedId = null;
    selectMode = true;
    buildGhost.hide();
    buildOverlay.update('Click a building to select', {});
    buildOverlay.show();
  }

  function exitBuildMode(): void {
    phase = 'inactive';
    placingType = '';
    selectedId = null;
    selectMode = false;
    buildOverlay.hide();
    buildGhost.hide();
  }

  function reset(): void {
    phase = 'inactive';
    placingType = '';
    selectedId = null;
    selectMode = false;
    buildOverlay.hide();
    buildGhost.hide();
  }

  /** Compute total housing capacity and civilian population from the world. */
  function getHousingInfo(): { population: number; capacity: number } {
    let capacity = 0;
    let population = 0;
    for (const eid of world.query(C.Building, C.Faction)) {
      const bComp = world.getComponent<BuildingComponent>(eid, C.Building)!;
      const lvl = Math.max(0, Math.min((bComp.upgradeLevel ?? 1) - 1, 4));
      switch (bComp.buildingType) {
        case 'campfire': capacity += CAMPFIRE_HOUSING_PER_LEVEL[lvl] ?? 2; break;
        case 'cat_house': capacity += CAT_HOUSE_CAPACITY[Math.min(lvl, 2)] ?? 2; break;
        case 'dormitory': capacity += DORMITORY_CAPACITY[Math.min(lvl, 2)] ?? 5; break;
      }
    }
    for (const eid of world.query(C.Faction)) {
      const f = world.getComponent<FactionComponent>(eid, C.Faction);
      if (f?.type === 'civilian') population++;
    }
    return { population, capacity };
  }

  /** Find the building entity under the mouse cursor. */
  function findBuildingAt(wx: number, wy: number): number | null {
    for (const eid of world.query(C.Position, C.Building)) {
      const ep = world.getComponent<PositionComponent>(eid, C.Position)!;
      const bComp = world.getComponent<BuildingComponent>(eid, C.Building)!;
      const ext = buildingExtent(bComp.buildingType, bComp.rotation);
      if (Math.abs(wx - ep.x) < ext.hx && Math.abs(wy - ep.y) < ext.hy) return eid;
    }
    return null;
  }

  /** Check if a building type has housing stats to show. */
  function isHousingBuilding(type: string): boolean {
    return type === 'campfire' || type === 'cat_house' || type === 'dormitory';
  }

  function update(): void {
    if (phase !== 'placing') return;
    const { x: wmx, y: wmy } = deps.getMouseWorld();

    // ── Select mode: click any building to select, then V/G/X ──────────────
    if (selectMode) {
      buildGhost.hide();

      if (input.isJustPressed(Action.Attack)) {
        const clicked = findBuildingAt(wmx, wmy);
        if (clicked !== null) {
          selectedId = clicked;
          const bComp = world.getComponent<BuildingComponent>(clicked, C.Building)!;
          const hp = world.getComponent<HealthComponent>(clicked, C.Health);
          const hi = isHousingBuilding(bComp.buildingType) ? getHousingInfo() : undefined;
          buildOverlay.updateSelection(bComp.buildingType, bComp.upgradeLevel, deps.combinedResources(), hp?.current, hp?.max, hi);
        }
      }

      // V/G/X on selected building
      if (selectedId !== null) {
        if (input.isJustPressed(Action.Upgrade)) deps.send({ type: MessageType.BUILD_UPGRADE, entityId: selectedId });
        if (input.isJustPressed(Action.Repair)) deps.send({ type: MessageType.BUILD_REPAIR, entityId: selectedId });
        if (input.isJustPressed(Action.Demolish)) {
          const selBldg = world.getComponent<BuildingComponent>(selectedId, C.Building);
          if (selBldg && !selBldg.permanent) {
            deps.send({ type: MessageType.BUILD_DEMOLISH, entityId: selectedId });
            selectedId = null;
            buildOverlay.update('Click a building to select', {});
          }
        }
      }

      // Deselect if building no longer exists
      if (selectedId !== null && !world.hasEntity(selectedId)) {
        selectedId = null;
        buildOverlay.update('Click a building to select', {});
      }

      // Live HP update
      if (selectedId !== null) {
        const hp = world.getComponent<HealthComponent>(selectedId, C.Health);
        if (hp) buildOverlay.updateSelectionHp(hp.current, hp.max);
      }

      // Right-click or ESC: exit select mode back to picker
      if (input.isJustPressed(Action.Cancel) || input.isJustPressed(Action.Pause)) {
        selectMode = false;
        selectedId = null;
        reopenPicker();
      }
      return;
    }

    // ── Normal placing mode ──────────────────────────────────────────────────

    // Scroll: toggle rotation for non-square buildings
    if (input.isJustPressed(Action.RotateBuilding) && isRotatable(placingType)) {
      rotation = rotation === 0 ? 1 : 0;
    }
    // Reset rotation when building type doesn't support it
    if (!isRotatable(placingType)) rotation = 0;

    // Snap to grid
    const { x: snapX, y: snapY } = snapBuildingPosition(wmx, wmy, placingType, rotation);
    const ext = buildingExtent(placingType, rotation);
    const bSize = BUILDING_SIZES[placingType] ?? { w: 1, h: 1 };
    const tilesW = rotation === 1 ? bSize.h : bSize.w;
    const tilesH = rotation === 1 ? bSize.w : bSize.h;

    // Cost affordability
    const costs = BUILDING_COSTS[placingType] ?? {};
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
    const isBridge = placingType === 'bridge';
    if (ghostValid && chunks) {
      const startTX = Math.floor((snapX - ext.hx) / TILE_SIZE);
      const startTY = Math.floor((snapY - ext.hy) / TILE_SIZE);
      for (let ty = 0; ty < tilesH && ghostValid; ty++) {
        for (let tx = 0; tx < tilesW && ghostValid; tx++) {
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
          const existExt = bComp ? buildingExtent(bComp.buildingType, bComp.rotation) : { hx: 16, hy: 16 };
          if (Math.abs(ep.x - snapX) < ext.hx + existExt.hx && Math.abs(ep.y - snapY) < ext.hy + existExt.hy) { ghostValid = false; break; }
        } else if (ef?.type === 'resource') {
          if (Math.abs(ep.x - snapX) < ext.hx + RESOURCE_NODE_RADIUS && Math.abs(ep.y - snapY) < ext.hy + RESOURCE_NODE_RADIUS) { ghostValid = false; break; }
        } else if (ef?.type === 'player' || ef?.type === 'enemy') {
          const r = ef.type === 'player' ? PLAYER_RADIUS : ENEMY_RADIUS;
          if (Math.abs(ep.x - snapX) < ext.hx + r && Math.abs(ep.y - snapY) < ext.hy + r) { ghostValid = false; break; }
        }
      }
    }

    buildGhost.update(wmx, wmy, ghostValid, placingType, rotation);

    // Click: select existing building or place new one
    if (input.isJustPressed(Action.Attack)) {
      const clicked = findBuildingAt(wmx, wmy);
      if (clicked !== null) {
        selectedId = clicked;
        const bComp = world.getComponent<BuildingComponent>(clicked, C.Building)!;
        const hp = world.getComponent<HealthComponent>(clicked, C.Health);
        const hi = isHousingBuilding(bComp.buildingType) ? getHousingInfo() : undefined;
        buildOverlay.updateSelection(bComp.buildingType, bComp.upgradeLevel, deps.combinedResources(), hp?.current, hp?.max, hi);
      } else if (ghostValid) {
        deps.send({ type: MessageType.BUILD_PLACE, buildingType: placingType, x: wmx, y: wmy, rotation });
        selectedId = null;
      }
    }

    // X: demolish (skip permanent buildings like campfire)
    if (input.isJustPressed(Action.Demolish) && selectedId !== null) {
      const selBldg = world.getComponent<BuildingComponent>(selectedId, C.Building);
      if (selBldg && !selBldg.permanent) {
        deps.send({ type: MessageType.BUILD_DEMOLISH, entityId: selectedId });
        selectedId = null;
        buildOverlay.update(placingType, deps.combinedResources());
      }
    }

    // V: upgrade
    if (input.isJustPressed(Action.Upgrade) && selectedId !== null) {
      deps.send({ type: MessageType.BUILD_UPGRADE, entityId: selectedId });
    }

    // G: repair
    if (input.isJustPressed(Action.Repair) && selectedId !== null) {
      deps.send({ type: MessageType.BUILD_REPAIR, entityId: selectedId });
    }

    // Deselect if building no longer exists
    if (selectedId !== null && !world.hasEntity(selectedId)) {
      selectedId = null;
      buildOverlay.update(placingType, deps.combinedResources());
    }

    // Live HP update for selected building
    if (selectedId !== null) {
      const hp = world.getComponent<HealthComponent>(selectedId, C.Health);
      if (hp) buildOverlay.updateSelectionHp(hp.current, hp.max);
    }
  }

  return {
    get phase() { return phase; },
    get placingType() { return placingType; },
    get selectedId() { return selectedId; },
    set selectedId(v: number | null) { selectedId = v; },
    openPicker,
    selectBuilding,
    reopenPicker,
    enterSelectMode,
    exitBuildMode,
    reset,
    update,
  };
}

export type BuildController = ReturnType<typeof createBuildController>;
