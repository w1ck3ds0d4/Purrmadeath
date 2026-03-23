// Protocol skill and ability messages - Skill allocation, ability usage,
// potions, and card offers/picks/syncs.

import { BaseMessage, MessageType } from './base';

// ---- Skill Tree ----

/** Client -> Server: allocate a skill point to a node. */
export interface SkillAllocateMessage extends BaseMessage {
  type: typeof MessageType.SKILL_ALLOCATE;
  nodeId: string;
}

/** Server -> Client: full skill allocation state (sent after allocation or on join). */
export interface SkillStateMessage extends BaseMessage {
  type: typeof MessageType.SKILL_STATE;
  allocated: string[];
  skillPoints: number;
  abilityCooldowns: Record<string, number>;
  slotAssignments?: [string | null, string | null, string | null];
}

/** Client -> Server: assign an ability to a hotbar slot (Q=0, E=1, R=2). */
export interface AbilitySlotAssignMessage extends BaseMessage {
  type: typeof MessageType.ABILITY_SLOT_ASSIGN;
  slot: 0 | 1 | 2;
  abilityId: string | null;
}

/** Client -> Server: activate an ability (Q/E/R). */
export interface AbilityUseMessage extends BaseMessage {
  type: typeof MessageType.ABILITY_USE;
  abilityId: string;
  facing: number;
  x: number;
  y: number;
  targetX?: number;
  targetY?: number;
}

/** Server -> all: broadcast ability visual effect. */
export interface AbilityEffectMessage extends BaseMessage {
  type: typeof MessageType.ABILITY_EFFECT;
  abilityId: string;
  sourceId: number;
  x: number;
  y: number;
  targetX?: number;
  targetY?: number;
  facing?: number;
  duration?: number;
  radius?: number;
}

// ---- Potions ----

/** Server -> Client: full shop state when player opens a potion shop. */
export interface PotionShopStateMessage extends BaseMessage {
  type: typeof MessageType.POTION_SHOP_STATE;
  shopEntityId: number;
  shopLevel: number;
  unlockedPotions: string[];
  equippedPotion: string | null;
  charges: number;
  maxCharges: number;
}

/** Client -> Server: unlock a potion. */
export interface PotionUnlockMessage extends BaseMessage {
  type: typeof MessageType.POTION_UNLOCK;
  potionType: string;
  shopEntityId: number;
}

/** Client -> Server: equip a potion to slot 4. */
export interface PotionEquipMessage extends BaseMessage {
  type: typeof MessageType.POTION_EQUIP;
  potionType: string;
}

/** Client -> Server: restock charges at a shop. */
export interface PotionRestockMessage extends BaseMessage {
  type: typeof MessageType.POTION_RESTOCK;
  shopEntityId: number;
}

/** Client -> Server: use equipped potion. */
export interface PotionUseMessage extends BaseMessage {
  type: typeof MessageType.POTION_USE;
}

/** Server -> Client: full potion state sync. */
export interface PotionStateMessage extends BaseMessage {
  type: typeof MessageType.POTION_STATE;
  equippedPotion: string | null;
  unlockedPotions: string[];
  charges: number;
  maxCharges: number;
  cooldown: number;
  cooldownMax: number;
}

// ---- Cards ----

export interface CardOfferMessage extends BaseMessage {
  type: typeof MessageType.CARD_OFFER;
  cards: import('../definitions/CardDefinitions').CardDefinition[];
}

export interface CardPickMessage extends BaseMessage {
  type: typeof MessageType.CARD_PICK;
  cardId: string;
}

export interface CardAppliedMessage extends BaseMessage {
  type: typeof MessageType.CARD_APPLIED;
  displayName: string;
  cardId: string;
  cardName: string;
  category: import('../definitions/CardDefinitions').CardCategory;
  isTrap: boolean;
  /** Synced abilities list for the receiving player (only present for ability-type cards). */
  abilities?: string[];
}

/** Server -> Client: restore card abilities + picked IDs from a loaded save. */
export interface CardSyncMessage extends BaseMessage {
  type: typeof MessageType.CARD_SYNC;
  abilities: string[];
  pickedCardIds: string[];
}
