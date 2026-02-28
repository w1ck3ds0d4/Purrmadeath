import { World } from '@shared/ecs/World';
import {
  C,
  PositionComponent,
  HealthComponent,
  ResourcesComponent,
  BuildingComponent,
  ActiveBuffsComponent,
  SpeedComponent,
} from '@shared/components';
import type { PotionType } from '@shared/definitions/PotionDefinitions';
import {
  POTION_POOL,
  POTION_CHARGES_BY_LEVEL,
  POTION_SHOP_INTERACT_RANGE,
} from '@shared/definitions/PotionDefinitions';
import { buildingHalfExtent, BUILDING_COSTS } from '@shared/constants';
import { MessageType } from '@shared/protocol';
import type {
  PotionUnlockMessage,
  PotionEquipMessage,
  PotionRestockMessage,
  PotionShopStateMessage,
  PotionStateMessage,
  ResourceUpdateMessage,
} from '@shared/protocol';
import type { ConnectedClient } from '../net/ServerSocket';
import type { CardSystem } from './CardSystem';

// ─── Types ──────────────────────────────────────────────────────────────────

interface PotionPlayerState {
  unlockedPotions: Set<PotionType>;
  equippedPotion: PotionType | null;
  charges: number;
  maxCharges: number;
  cooldownRemaining: number;
  cooldownMax: number;
}

interface SessionPlayer {
  client: ConnectedClient;
  playerId: string;
  entityId: number | null;
}

type SendFn = (client: ConnectedClient, msg: object) => void;

export interface PotionSystemDeps {
  world: World;
  players: Map<string, SessionPlayer>;
  warehousePool: Record<string, number>;
  warehouseIds: Set<number>;
  cards: CardSystem;
  broadcastWarehouseUpdate: (send: SendFn) => void;
  isActive: () => boolean;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createPotionSystem(deps: PotionSystemDeps) {
  const { world, players, warehousePool, warehouseIds, cards } = deps;

  const states = new Map<string, PotionPlayerState>();

  function getState(clientId: string): PotionPlayerState {
    let s = states.get(clientId);
    if (!s) {
      s = { unlockedPotions: new Set(), equippedPotion: null, charges: 0, maxCharges: 0, cooldownRemaining: 0, cooldownMax: 0 };
      states.set(clientId, s);
    }
    return s;
  }

  function getMaxCharges(clientId: string, shopLevel: number): number {
    const base = POTION_CHARGES_BY_LEVEL[shopLevel - 1] ?? 2;
    const buffs = cards.getBuffs(clientId);
    const bonus = buffs.abilities.includes('extra_potion_charge') ? 1 : 0;
    return base + bonus;
  }

  /** Find highest-level potion shop in the world. */
  function getHighestShopLevel(): number {
    let maxLevel = 0;
    for (const id of world.query(C.Building)) {
      const bldg = world.getComponent<BuildingComponent>(id, C.Building);
      if (bldg?.buildingType === 'potion_shop') {
        maxLevel = Math.max(maxLevel, bldg.upgradeLevel);
      }
    }
    return maxLevel;
  }

  function sendPotionState(clientId: string, send: SendFn): void {
    const player = players.get(clientId);
    if (!player) return;
    const s = getState(clientId);
    const msg: PotionStateMessage = {
      type: MessageType.POTION_STATE,
      equippedPotion: s.equippedPotion,
      unlockedPotions: [...s.unlockedPotions],
      charges: s.charges,
      maxCharges: s.maxCharges,
      cooldown: s.cooldownRemaining,
      cooldownMax: s.cooldownMax,
    };
    send(player.client, msg);
  }

  function sendResourceUpdate(player: SessionPlayer, send: SendFn): void {
    if (player.entityId === null) return;
    const res = world.getComponent<ResourcesComponent>(player.entityId, C.Resources);
    if (!res) return;
    send(player.client, {
      type: MessageType.RESOURCE_UPDATE,
      wood: res.wood, stone: res.stone, iron: res.iron,
      diamond: res.diamond, gold: res.gold, food: res.food,
    } as ResourceUpdateMessage);
  }

  /** Check if cost can be paid from warehouse + player inventory. */
  function canAfford(
    playerEntityId: number,
    cost: Partial<Record<string, number>>,
  ): boolean {
    const res = world.getComponent<ResourcesComponent>(playerEntityId, C.Resources);
    if (!res) return false;
    const pPool = res as unknown as Record<string, number>;
    const hasWarehouse = warehouseIds.size > 0;
    for (const [r, amount] of Object.entries(cost)) {
      const total = (hasWarehouse ? (warehousePool[r] ?? 0) : 0) + (pPool[r] ?? 0);
      if (total < amount!) return false;
    }
    return true;
  }

  /** Deduct cost from warehouse first, then player. Returns true if successful. */
  function deductCost(
    player: SessionPlayer,
    cost: Partial<Record<string, number>>,
    send: SendFn,
  ): boolean {
    if (player.entityId === null) return false;
    const res = world.getComponent<ResourcesComponent>(player.entityId, C.Resources);
    if (!res) return false;
    const pPool = res as unknown as Record<string, number>;
    const hasWarehouse = warehouseIds.size > 0;

    // Check affordability first
    for (const [r, amount] of Object.entries(cost)) {
      const total = (hasWarehouse ? (warehousePool[r] ?? 0) : 0) + (pPool[r] ?? 0);
      if (total < amount!) return false;
    }

    // Deduct
    let drewFromWarehouse = false;
    let drewFromPlayer = false;
    for (const [r, amount] of Object.entries(cost)) {
      let remaining = amount!;
      if (hasWarehouse) {
        const fromW = Math.min(remaining, warehousePool[r] ?? 0);
        if (fromW > 0) { warehousePool[r] -= fromW; remaining -= fromW; drewFromWarehouse = true; }
      }
      if (remaining > 0) { pPool[r] -= remaining; drewFromPlayer = true; }
    }

    if (drewFromWarehouse) deps.broadcastWarehouseUpdate(send);
    if (drewFromPlayer) sendResourceUpdate(player, send);
    return true;
  }

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handleShopOpen(clientId: string, shopEntityId: number, send: SendFn): void {
    const player = players.get(clientId);
    if (!player || player.entityId === null) return;

    const bldg = world.getComponent<BuildingComponent>(shopEntityId, C.Building);
    if (!bldg || bldg.buildingType !== 'potion_shop') return;

    const shopLevel = bldg.upgradeLevel;
    const s = getState(clientId);
    s.maxCharges = getMaxCharges(clientId, shopLevel);

    const msg: PotionShopStateMessage = {
      type: MessageType.POTION_SHOP_STATE,
      shopEntityId,
      shopLevel,
      unlockedPotions: [...s.unlockedPotions],
      equippedPotion: s.equippedPotion,
      charges: s.charges,
      maxCharges: s.maxCharges,
    };
    send(player.client, msg);
  }

  function handleUnlock(clientId: string, msg: PotionUnlockMessage, send: SendFn): void {
    if (!deps.isActive()) return;
    const player = players.get(clientId);
    if (!player || player.entityId === null) return;

    const potionType = msg.potionType as PotionType;
    const def = POTION_POOL[potionType];
    if (!def) return;

    // Validate proximity to shop
    const bldg = world.getComponent<BuildingComponent>(msg.shopEntityId, C.Building);
    if (!bldg || bldg.buildingType !== 'potion_shop') return;
    if (!isNearShop(player.entityId, msg.shopEntityId)) return;

    const s = getState(clientId);
    if (s.unlockedPotions.has(potionType)) return; // already unlocked

    if (!deductCost(player, def.unlockCost, send)) return;

    s.unlockedPotions.add(potionType);
    sendPotionState(clientId, send);
    // Re-send shop state so UI updates
    handleShopOpen(clientId, msg.shopEntityId, send);
  }

  function handleEquip(clientId: string, msg: PotionEquipMessage, send: SendFn): void {
    if (!deps.isActive()) return;
    const player = players.get(clientId);
    if (!player) return;

    const potionType = msg.potionType as PotionType;
    if (!POTION_POOL[potionType]) return;

    const s = getState(clientId);
    if (!s.unlockedPotions.has(potionType)) return;

    const shopLevel = getHighestShopLevel();
    s.equippedPotion = potionType;
    s.maxCharges = shopLevel > 0 ? getMaxCharges(clientId, shopLevel) : 2;
    // First equip grants full charges
    if (s.charges === 0) s.charges = s.maxCharges;
    sendPotionState(clientId, send);
  }

  function handleRestock(clientId: string, msg: PotionRestockMessage, send: SendFn): void {
    if (!deps.isActive()) return;
    const player = players.get(clientId);
    if (!player || player.entityId === null) return;

    const s = getState(clientId);
    if (!s.equippedPotion) return;
    if (s.charges >= s.maxCharges) return; // already full

    const bldg = world.getComponent<BuildingComponent>(msg.shopEntityId, C.Building);
    if (!bldg || bldg.buildingType !== 'potion_shop') return;
    if (!isNearShop(player.entityId, msg.shopEntityId)) return;

    const def = POTION_POOL[s.equippedPotion];
    if (!def) return;

    if (!deductCost(player, def.restockCost, send)) return;

    const shopLevel = bldg.upgradeLevel;
    s.maxCharges = getMaxCharges(clientId, shopLevel);
    s.charges = s.maxCharges;
    sendPotionState(clientId, send);
    // Re-send shop state so UI updates
    handleShopOpen(clientId, msg.shopEntityId, send);
  }

  function handleUse(clientId: string, send: SendFn): void {
    if (!deps.isActive()) return;
    const player = players.get(clientId);
    if (!player || player.entityId === null) return;

    const s = getState(clientId);
    if (!s.equippedPotion) return;
    if (s.charges <= 0) return;
    if (s.cooldownRemaining > 0) return;

    const def = POTION_POOL[s.equippedPotion];
    if (!def) return;

    const shopLevel = getHighestShopLevel();
    const effect = def.effectByLevel[Math.min(shopLevel - 1, def.effectByLevel.length - 1)] ?? def.effectByLevel[0];

    // Consume charge and set cooldown
    s.charges--;
    s.cooldownRemaining = def.cooldown;
    s.cooldownMax = def.cooldown;

    const eid = player.entityId;

    // Apply effect
    switch (effect.type) {
      case 'heal': {
        const hp = world.getComponent<HealthComponent>(eid, C.Health);
        if (hp) hp.current = Math.min(hp.max, hp.current + effect.value);
        break;
      }
      case 'speed_boost':
      case 'damage_boost':
      case 'shield': {
        // Push to ActiveBuffs for timed effect
        let ab = world.getComponent<ActiveBuffsComponent>(eid, C.ActiveBuffs);
        if (!ab) {
          ab = { buffs: [] };
          world.addComponent(eid, C.ActiveBuffs, ab);
        }
        const buffId = `potion_${effect.type === 'speed_boost' ? 'speed' : effect.type === 'damage_boost' ? 'damage' : 'shield'}`;
        // Remove any existing potion buff of same type
        ab.buffs = ab.buffs.filter(b => b.id !== buffId);
        const buffEffect: Record<string, number> = {};
        if (effect.type === 'speed_boost') {
          buffEffect.speedMultiplier = effect.value;
          // Apply speed multiplier directly
          const spd = world.getComponent<SpeedComponent>(eid, C.Speed);
          if (spd) spd.multiplier *= (1 + effect.value);
        } else if (effect.type === 'damage_boost') {
          buffEffect.damageMultiplier = effect.value;
        } else {
          buffEffect.shieldHp = effect.value;
        }
        ab.buffs.push({ id: buffId, remaining: effect.duration, effect: buffEffect });
        break;
      }
    }

    sendPotionState(clientId, send);
  }

  function isNearShop(playerEntityId: number, shopEntityId: number): boolean {
    const pPos = world.getComponent<PositionComponent>(playerEntityId, C.Position);
    const sPos = world.getComponent<PositionComponent>(shopEntityId, C.Position);
    if (!pPos || !sPos) return false;
    const half = buildingHalfExtent('potion_shop');
    const range = half + POTION_SHOP_INTERACT_RANGE;
    const dx = pPos.x - sPos.x;
    const dy = pPos.y - sPos.y;
    return dx * dx + dy * dy <= range * range;
  }

  // ── Tick ────────────────────────────────────────────────────────────────────

  function tick(dt: number, send: SendFn): void {
    for (const [clientId, s] of states) {
      if (s.cooldownRemaining > 0) {
        s.cooldownRemaining = Math.max(0, s.cooldownRemaining - dt);
      }
    }

    // Handle speed buff expiry: when potion_speed buff is removed by SkillSystem,
    // we need to revert the speed multiplier. Check each player.
    for (const p of players.values()) {
      if (p.entityId === null) continue;
      const ab = world.getComponent<ActiveBuffsComponent>(p.entityId, C.ActiveBuffs);
      if (!ab) continue;

      // Check if a potion_speed buff just expired (remaining <= 0)
      for (let i = ab.buffs.length - 1; i >= 0; i--) {
        const buff = ab.buffs[i];
        if (buff.id === 'potion_speed' && buff.remaining <= 0) {
          // Revert speed multiplier
          const spd = world.getComponent<SpeedComponent>(p.entityId, C.Speed);
          if (spd) spd.multiplier /= (1 + (buff.effect.speedMultiplier ?? 0));
          ab.buffs.splice(i, 1);
        }
      }
    }
  }

  // ── Serialize / Restore ────────────────────────────────────────────────────

  function serialize(clientId: string): { equippedPotion: string | null; unlockedPotions: string[]; charges: number; maxCharges: number } | undefined {
    const s = states.get(clientId);
    if (!s) return undefined;
    return {
      equippedPotion: s.equippedPotion,
      unlockedPotions: [...s.unlockedPotions],
      charges: s.charges,
      maxCharges: s.maxCharges,
    };
  }

  function restore(clientId: string, saved: { equippedPotion: string | null; unlockedPotions: string[]; charges: number; maxCharges: number }): void {
    const s = getState(clientId);
    s.equippedPotion = saved.equippedPotion as PotionType | null;
    s.unlockedPotions = new Set(saved.unlockedPotions as PotionType[]);
    s.charges = saved.charges;
    s.maxCharges = saved.maxCharges;
    s.cooldownRemaining = 0;
    s.cooldownMax = 0;
  }

  /** Remap player state from old clientId to new clientId (reconnection). */
  function remapClient(oldId: string, newId: string): void {
    const s = states.get(oldId);
    if (s) {
      states.delete(oldId);
      states.set(newId, s);
    }
  }

  function reset(): void {
    states.clear();
  }

  return {
    handleShopOpen,
    handleUnlock,
    handleEquip,
    handleRestock,
    handleUse,
    tick,
    serialize,
    restore,
    remapClient,
    sendPotionState,
    reset,
  };
}

export type PotionSystem = ReturnType<typeof createPotionSystem>;
