import { World } from '@shared/ecs/World';
import { C, PositionComponent, FactionComponent, HealthComponent, BuildingComponent } from '@shared/components';
import { MessageType } from '@shared/protocol';
import {
  PLAYER_BASE_SPEED,
  PLAYER_MAX_STAMINA,
  PLAYER_STAMINA_REGEN,
  GAME_VERSION,
} from '@shared/constants';
import type {
  HandshakeAckMessage,
  SessionAckMessage,
  SessionStateMessage,
  PlayerJoinedMessage,
  PlayerLeftMessage,
  SnapshotMessage,
  DeltaMessage,
  AttackPerformedMessage,
  HitMessage,
  ProjectileSpawnMessage,
  ProjectileRemoveMessage,
  PauseVoteUpdateMessage,
  PauseStateMessage,
  ChatMessage,
  WaveStartMessage,
  WaveEndMessage,
  WaveTimerSyncMessage,
  ResourceUpdateMessage,
  PlayerDownedMessage,
  ReviveProgressMessage,
  PlayerRevivedMessage,
  PlayerDiedMessage,
  PlayerRespawnedMessage,
  PartyWipeMessage,
  GameOverMessage,
  BuildConfirmMessage,
  BuildUpgradeConfirmMessage,
  BuildRepairConfirmMessage,
  AoeExplosionMessage,
  WarehouseUpdateMessage,
  SaveSlotsResponseMessage,
  GameSavedMessage,
  EnemyIntroMessage,
  MetaStatsResponseMessage,
  CardOfferMessage,
  CardAppliedMessage,
  CardSyncMessage,
  SkillStateMessage,
  AbilityEffectMessage,
  PotionShopStateMessage,
  PotionStateMessage,
  LobbySlot,
} from '@shared/protocol';
import type { SaveSlotInfo } from '@shared/SaveFormat';
import type { NetworkClient } from './NetworkClient';
import type { Reconciler } from './Reconciler';
import type { Camera } from '../render/Camera';
import type { PlayerRendererSystem } from '../systems/PlayerRendererSystem';
import type { ProjectileRendererSystem } from '../systems/ProjectileRendererSystem';
import type { DamageNumberSystem } from '../systems/DamageNumberSystem';
import type { HitParticleSystem } from '../systems/HitParticleSystem';
import type { RemotePlayerSystem } from '../systems/RemotePlayerSystem';
import type { MovementSystem } from '../systems/MovementSystem';
import type { GameStateManager } from '../state/GameStateManager';
import { GameState } from '../state/GameStateManager';
import type { MenuOverlay } from '../ui/MenuOverlay';
import type { LobbyOverlay } from '../ui/LobbyOverlay';
import type { PauseBanner } from '../ui/PauseBanner';
import type { WaveHUD } from '../ui/WaveHUD';
import type { ResourceHUD } from '../ui/ResourceHUD';
import type { DeathOverlay } from '../ui/DeathOverlay';
import type { GameOverOverlay } from '../ui/GameOverOverlay';
import type { ChatOverlay } from '../ui/ChatOverlay';
import type { DebugOverlay } from '../ui/DebugOverlay';
import type { BuildModeOverlay } from '../ui/BuildModeOverlay';
import type { BuildGhostRenderer } from '../render/BuildGhostRenderer';
import type { WarehouseHUD } from '../ui/WarehouseHUD';
import type { StatsOverlay } from '../ui/StatsOverlay';
import type { CardPickerOverlay } from '../ui/CardPickerOverlay';
import type { SkillTreeOverlay } from '../ui/SkillTreeOverlay';
import type { AbilityVFXSystem } from '../systems/AbilityVFXSystem';
import type { PotionShopOverlay, PotionShopData } from '../ui/PotionShopOverlay';
import type { BuildMenuOverlay } from '../ui/BuildMenuOverlay';

// ── Shared mutable state ────────────────────────────────────────────────────

export interface GameplayState {
  localSlot: number;
  localEntityId: number | null;
  isHost: boolean;
  currentSessionId: string;
  currentSessionCode: string;
  lobbyPlayers: LobbySlot[];
  isMultiplayer: boolean;
  transportReady: boolean;
  pendingSaveSlots: SaveSlotInfo[];
  saveSlotRequestId: number;
  gameStartTime: number;
  serverElapsedTime: number;
  waveActive: boolean;
  localDowned: boolean;
  localDead: boolean;
  respawnTimer: number;
  localGameOver: boolean;
  buildModeActive: boolean;
  placingType: string;
  selectedBuildingId: number | null;
  localResources: Record<string, number>;
  warehouseResources: { wood: number; stone: number; iron: number; diamond: number; gold: number; food: number };
  warehouseExists: boolean;
  selectedClass: import('@shared/ClassDefinitions').PlayerClass;
  lastServerStats?: {
    wave: number; enemyCount: number; portalCount: number; playerCount: number;
    tickProfile?: { combat: number; enemy: number; movement: number; projectile: number; buildings: number; waves: number; total: number };
  };
  handshakeSent: boolean;
  seed: number;
  skillAllocated: Set<string>;
  skillPoints: number;
  onSkillStateUpdate?: () => void;
  cardAbilities: string[];
  pickedCardIds: string[];
  potionEquipped: string | null;
  potionUnlocked: string[];
  potionCharges: number;
  potionMaxCharges: number;
  potionCooldown: number;
  potionCooldownMax: number;
}

// ── Dependencies ────────────────────────────────────────────────────────────

export interface NetworkHandlerDeps {
  world: World;
  camera: Camera;
  playerRenderer: PlayerRendererSystem;
  projectileRenderer: ProjectileRendererSystem;
  damageNumbers: DamageNumberSystem;
  hitParticles: HitParticleSystem;
  reconciler: Reconciler;
  remotePlayerSys: RemotePlayerSystem;
  getMovementSystem: () => MovementSystem | null;
  initGameWorld: (seed: number) => void;
  stateMgr: GameStateManager;
  menuOverlay: MenuOverlay;
  lobbyOverlay: LobbyOverlay;
  pauseBanner: PauseBanner;
  waveHUD: WaveHUD;
  resourceHUD: ResourceHUD;
  deathOverlay: DeathOverlay;
  gameOverOverlay: GameOverOverlay;
  chatOverlay: ChatOverlay;
  debug: DebugOverlay;
  buildOverlay: BuildModeOverlay;
  buildGhost: BuildGhostRenderer;
  warehouseHUD: WarehouseHUD;
  cardPicker: CardPickerOverlay;
  skillTree: SkillTreeOverlay;
  abilityVFX: AbilityVFXSystem;
  statsOverlay: StatsOverlay;
  potionShopOverlay: PotionShopOverlay;
  buildMenu: BuildMenuOverlay;
  combinedResources: () => Record<string, number>;
  electronAPI?: { checkForUpdates?: () => void };
}

// ── Factory ─────────────────────────────────────────────────────────────────

export function registerMessageHandlers(
  net: NetworkClient,
  s: GameplayState,
  d: NetworkHandlerDeps,
): void {

  // ── Session lifecycle ───────────────────────────────────────────────────

  net.on(MessageType.HANDSHAKE_ACK, (msg) => {
    const ack = msg as HandshakeAckMessage;
    console.log(`[Net] Connected - clientId: ${ack.clientId}, server v${ack.serverVersion}`);

    s.transportReady = true;
    d.menuOverlay.setConnectionStatus('connected');
    d.menuOverlay.setButtonsEnabled(true);

    if (ack.serverVersion !== GAME_VERSION) {
      console.warn(`[Net] Version mismatch: client ${GAME_VERSION}, server ${ack.serverVersion}`);
      d.menuOverlay.setConnectionStatus('disconnected');
      d.menuOverlay.setButtonsEnabled(false);
      d.electronAPI?.checkForUpdates?.();
      return;
    }

    if (ack.lastDisplayName) {
      d.menuOverlay.displayName = ack.lastDisplayName;
    }
  });

  net.on(MessageType.SESSION_ACK, (msg) => {
    const ack = msg as SessionAckMessage;
    s.localSlot          = ack.slot;
    s.isHost             = ack.isHost;
    s.currentSessionId   = ack.sessionId;
    s.currentSessionCode = ack.code ?? '';
    s.lobbyPlayers       = ack.players;
    s.seed               = ack.seed;
    d.initGameWorld(ack.seed);

    // Apply milestone class unlocks
    d.lobbyOverlay.setUnlockedClasses(ack.unlockedClasses ?? []);

    // Check if local player's class is locked from a loaded save
    const localSlotData = ack.players.find(p => p.slot === ack.slot);
    if (localSlotData?.classLocked) {
      if (localSlotData.playerClass) s.selectedClass = localSlotData.playerClass;
      d.lobbyOverlay.setClassLocked(true);
      d.lobbyOverlay.selectClass(s.selectedClass);
    } else {
      d.lobbyOverlay.setClassLocked(false);
    }

    d.stateMgr.transition(GameState.Lobby);
  });

  net.on(MessageType.PLAYER_JOINED, (msg) => {
    const pj = msg as PlayerJoinedMessage;
    s.lobbyPlayers = s.lobbyPlayers.filter((p) => p.playerId !== pj.player.playerId);
    s.lobbyPlayers.push(pj.player);
    d.lobbyOverlay.updatePlayers(s.lobbyPlayers);
    d.lobbyOverlay.addChatMessage('→', `${pj.player.displayName} joined`);
    d.debug.log(`Player joined: ${pj.player.displayName} (slot ${pj.player.slot})`);
  });

  net.on(MessageType.PLAYER_LEFT, (msg) => {
    const pl = msg as PlayerLeftMessage;
    s.lobbyPlayers = s.lobbyPlayers.filter((p) => p.playerId !== pl.playerId);
    d.lobbyOverlay.updatePlayers(s.lobbyPlayers);
    d.lobbyOverlay.addChatMessage('←', `Player ${pl.slot + 1} left`);
    d.debug.log(`Player left: slot ${pl.slot + 1}`);
  });

  net.on(MessageType.SESSION_STATE, (msg) => {
    const state = msg as SessionStateMessage;
    s.lobbyPlayers = state.players;
    d.lobbyOverlay.updatePlayers(s.lobbyPlayers);
  });

  // ── World state ─────────────────────────────────────────────────────────

  net.on(MessageType.SNAPSHOT, (msg) => {
    const snap = msg as SnapshotMessage;

    d.world.clear();
    d.playerRenderer.destroy();

    s.isMultiplayer = s.lobbyPlayers.length > 1;
    d.remotePlayerSys.applySnapshot(d.world, snap);

    const localSnap = snap.entities.find((e) => e.slot === s.localSlot);
    if (localSnap) {
      s.localEntityId = localSnap.entityId;
      d.reconciler.localEntityId = s.localEntityId;

      d.world.addComponent(s.localEntityId, C.Speed,       { base: PLAYER_BASE_SPEED, multiplier: 1 });
      d.world.addComponent(s.localEntityId, C.Stamina,     { current: PLAYER_MAX_STAMINA, max: PLAYER_MAX_STAMINA, regenRate: PLAYER_STAMINA_REGEN, exhausted: false });
      d.world.addComponent(s.localEntityId, C.PlayerInput, { dx: 0, dy: 0, sprint: false });

      const pos = d.world.getComponent<PositionComponent>(s.localEntityId, C.Position)!;
      d.camera.x = pos.x; d.camera.y = pos.y;
      d.camera.targetX = pos.x; d.camera.targetY = pos.y;
    }

    d.stateMgr.transition(GameState.Playing);
  });

  net.on(MessageType.DELTA, (msg) => {
    if (d.stateMgr.current !== GameState.Playing) return;
    const delta = msg as DeltaMessage;

    if (delta.serverStats) s.lastServerStats = delta.serverStats;

    d.reconciler.applyDelta(d.world, delta, (replayDt) => {
      d.getMovementSystem()?.update(d.world, replayDt, s.localEntityId ?? undefined);
    });

    d.remotePlayerSys.applyDelta(d.world, delta);
  });

  // ── Combat ──────────────────────────────────────────────────────────────

  net.on(MessageType.ATTACK_PERFORMED, (msg) => {
    const ap = msg as AttackPerformedMessage;
    if (ap.sourceId !== s.localEntityId) {
      d.playerRenderer.notifyAttack(ap.sourceId, ap.facing);
    }
  });

  net.on(MessageType.HIT, (msg) => {
    const hit = msg as HitMessage;
    const crit = hit.crit === true;
    d.playerRenderer.notifyHit(hit.targetId);

    const tgtPos = d.world.getComponent<PositionComponent>(hit.targetId, C.Position);
    if (tgtPos) {
      const faction = d.world.getComponent<FactionComponent>(hit.targetId, C.Faction);
      const color = faction?.type === 'building' ? 0xffa040
                  : faction?.type === 'resource' ? 0xffffff
                  : 0xff4444;
      d.damageNumbers.add(tgtPos.x, tgtPos.y - 10, hit.damage, color, crit);
      d.hitParticles.burst(tgtPos.x, tgtPos.y, crit ? 8 : 4);

      // Screen shake when the local player is hit
      if (hit.targetId === s.localEntityId) {
        d.camera.shake(crit ? 6 : 3, crit ? 0.15 : 0.1);
      }

      // Screen shake when the local player lands a critical hit
      if (hit.sourceId === s.localEntityId && crit) {
        d.camera.shake(4, 0.12);
      }
    }
  });

  net.on(MessageType.PROJECTILE_SPAWN, (msg) => {
    const ps = msg as ProjectileSpawnMessage;
    d.projectileRenderer.spawn(ps.projectileId, ps.x, ps.y, ps.vx, ps.vy, ps.ownerSlot,
      ps.targetX, ps.targetY, ps.totalFlightTime, ps.pierce, ps.homing);
  });

  net.on(MessageType.PROJECTILE_REMOVE, (msg) => {
    const pr = msg as ProjectileRemoveMessage;
    d.projectileRenderer.remove(pr.projectileId);
  });

  net.on(MessageType.AOE_EXPLOSION, (msg) => {
    const aoe = msg as AoeExplosionMessage;
    d.projectileRenderer.addExplosion(aoe.x, aoe.y, aoe.radius);
  });

  // ── Wave ────────────────────────────────────────────────────────────────

  net.on(MessageType.WAVE_START, (msg) => {
    const ws = msg as WaveStartMessage;
    d.waveHUD.onWaveStart(ws.waveNumber, ws.prepDuration);
    s.waveActive = ws.prepDuration === 0;
    d.debug.log(`Wave ${ws.waveNumber} started (prep: ${ws.prepDuration}s)`);
  });

  net.on(MessageType.WAVE_END, (msg) => {
    const we = msg as WaveEndMessage;
    d.waveHUD.onWaveEnd(we.waveNumber);
    s.waveActive = false;
    d.debug.log(`Wave ${we.waveNumber} cleared`);
  });

  net.on(MessageType.WAVE_TIMER_SYNC, (msg) => {
    const sync = msg as WaveTimerSyncMessage;
    d.waveHUD.onTimerSync(sync.waveNumber, sync.remaining, sync.paused);
  });

  net.on(MessageType.ENEMY_INTRO, (msg) => {
    const intro = msg as EnemyIntroMessage;
    d.chatOverlay.addMessage('System', -1, `New threat: ${intro.displayName}!`);
    d.debug.log(`New enemy type: ${intro.displayName}`);
  });

  // ── Cards ───────────────────────────────────────────────────────────────

  net.on(MessageType.CARD_OFFER, (msg) => {
    const offer = msg as CardOfferMessage;
    d.waveHUD.setPaused(true);
    d.cardPicker.show(offer.cards, (cardId) => {
      net.send({ type: MessageType.CARD_PICK, cardId });
    });
  });

  net.on(MessageType.CARD_APPLIED, (msg) => {
    const applied = msg as CardAppliedMessage;
    const prefix = applied.isTrap ? 'TRAP' : 'Card';
    d.chatOverlay.addMessage('System', -1, `${applied.displayName} picked ${prefix}: ${applied.cardName}`);
    d.cardPicker.hide();
    d.waveHUD.setPaused(false);
    // Sync card abilities for the local player
    if (applied.abilities) s.cardAbilities = applied.abilities;
    // Track picked card
    if (applied.cardId && !s.pickedCardIds.includes(applied.cardId)) {
      s.pickedCardIds = [...s.pickedCardIds, applied.cardId];
    }
  });

  net.on(MessageType.CARD_SYNC, (msg) => {
    const sync = msg as CardSyncMessage;
    s.cardAbilities = sync.abilities;
    s.pickedCardIds = sync.pickedCardIds;
  });

  // ── Skills ──────────────────────────────────────────────────────────────

  net.on(MessageType.SKILL_STATE, (msg) => {
    const ss = msg as SkillStateMessage;
    s.skillAllocated = new Set(ss.allocated);
    s.skillPoints = ss.skillPoints;
    // Sync ability cooldowns from server
    if (ss.abilityCooldowns) {
      // abilityCooldowns are keyed by abilityId — caller maps them to slots
    }
    s.onSkillStateUpdate?.();
    d.skillTree.updateState(s.skillAllocated, s.skillPoints);
  });

  net.on(MessageType.ABILITY_EFFECT, (msg) => {
    const effect = msg as AbilityEffectMessage;
    d.abilityVFX.trigger(
      effect.abilityId, effect.x, effect.y,
      effect.radius, effect.duration, effect.facing,
      effect.targetX, effect.targetY,
    );
  });

  // ── Potions ────────────────────────────────────────────────────────────

  net.on(MessageType.POTION_SHOP_STATE, (msg) => {
    const ps = msg as PotionShopStateMessage;
    const shopData: PotionShopData = {
      shopEntityId: ps.shopEntityId,
      shopLevel: ps.shopLevel,
      unlockedPotions: ps.unlockedPotions,
      equippedPotion: ps.equippedPotion,
      charges: ps.charges,
      maxCharges: ps.maxCharges,
    };
    d.potionShopOverlay.show(shopData, d.combinedResources());
  });

  net.on(MessageType.POTION_STATE, (msg) => {
    const ps = msg as PotionStateMessage;
    s.potionEquipped = ps.equippedPotion;
    s.potionUnlocked = ps.unlockedPotions;
    s.potionCharges = ps.charges;
    s.potionMaxCharges = ps.maxCharges;
    s.potionCooldown = ps.cooldown;
    s.potionCooldownMax = ps.cooldownMax;
    // Refresh potion shop if open (e.g. after equip)
    d.potionShopOverlay.refreshState(ps.equippedPotion, ps.unlockedPotions, ps.charges, ps.maxCharges, d.combinedResources());
  });

  // ── Resources ───────────────────────────────────────────────────────────

  net.on(MessageType.RESOURCE_UPDATE, (msg) => {
    const ru = msg as ResourceUpdateMessage;
    d.resourceHUD.setResources(ru.wood, ru.stone, ru.iron, ru.diamond, ru.gold, ru.food);
    s.localResources = { wood: ru.wood, stone: ru.stone, iron: ru.iron, diamond: ru.diamond, gold: ru.gold, food: ru.food };
    if (s.buildModeActive && s.placingType) {
      d.buildOverlay.update(s.placingType, d.combinedResources());
    }
    d.potionShopOverlay.updateResources(d.combinedResources());
  });

  net.on(MessageType.WAREHOUSE_UPDATE, (msg) => {
    const wu = msg as WarehouseUpdateMessage;
    s.warehouseResources = { wood: wu.wood, stone: wu.stone, iron: wu.iron, diamond: wu.diamond, gold: wu.gold, food: wu.food };
    s.warehouseExists = wu.exists;
    if (s.warehouseExists) {
      d.warehouseHUD.update(s.warehouseResources);
      d.warehouseHUD.show();
    } else {
      d.warehouseHUD.hide();
    }
    if (s.buildModeActive && s.placingType) {
      d.buildOverlay.update(s.placingType, d.combinedResources());
    }
    d.potionShopOverlay.updateResources(d.combinedResources());
  });

  // ── Pause / Social ──────────────────────────────────────────────────────

  net.on(MessageType.PAUSE_VOTE_UPDATE, (msg) => {
    const update = msg as PauseVoteUpdateMessage;
    d.pauseBanner.show(update.direction, update.voters, update.required);
  });

  net.on(MessageType.PAUSE_STATE, (msg) => {
    const ps = msg as PauseStateMessage;
    d.pauseBanner.hide();
    if (ps.elapsedTime != null) s.serverElapsedTime = ps.elapsedTime;
    if (ps.paused) {
      const seq = d.reconciler.recordInput(0, 0, false, 0);
      net.send({ type: MessageType.INPUT, seq, dx: 0, dy: 0, sprint: false, t: performance.now() });
      d.stateMgr.transition(GameState.Paused);
    } else {
      d.stateMgr.transition(GameState.Playing);
    }
  });

  net.on(MessageType.CHAT, (msg) => {
    const chat = msg as ChatMessage;
    if (d.stateMgr.current === GameState.Lobby) {
      d.lobbyOverlay.addChatMessage(chat.displayName, chat.text);
    } else {
      d.chatOverlay.addMessage(chat.displayName, chat.slot, chat.text);
    }
    d.debug.log(`[Chat] ${chat.displayName}: ${chat.text}`);
  });

  // ── Player death / respawn ──────────────────────────────────────────────

  net.on(MessageType.PLAYER_DOWNED, (msg) => {
    if (s.localGameOver) return;
    const pd = msg as PlayerDownedMessage;
    d.playerRenderer.notifyDowned(pd.entityId);
    d.debug.log(`Player downed (entity ${pd.entityId})`);
    if (pd.entityId === s.localEntityId) {
      s.localDowned = true;
      s.buildModeActive = false;
      s.selectedBuildingId = null;
      d.buildOverlay.hide();
      d.buildGhost.hide();
      d.buildMenu.hide();
      d.deathOverlay.showDowned(pd.bleedTimer, !s.isMultiplayer);
    }
  });

  net.on(MessageType.REVIVE_PROGRESS, (msg) => {
    if (s.localGameOver) return;
    const rp = msg as ReviveProgressMessage;
    d.playerRenderer.notifyReviveProgress(rp.targetId, rp.progress);
    if (rp.targetId === s.localEntityId) {
      d.deathOverlay.showReviving(rp.progress);
    }
  });

  net.on(MessageType.PLAYER_REVIVED, (msg) => {
    if (s.localGameOver) return;
    const pr = msg as PlayerRevivedMessage;
    d.playerRenderer.notifyRevived(pr.entityId);
    d.debug.log(`Player revived (entity ${pr.entityId})`);
    if (pr.entityId === s.localEntityId) {
      s.localDowned = false;
      s.localDead = false;
      d.deathOverlay.hide();
    }
  });

  net.on(MessageType.PLAYER_DIED, (msg) => {
    if (s.localGameOver) return;
    const pd = msg as PlayerDiedMessage;
    d.playerRenderer.notifyDeath(pd.entityId);
    d.debug.log(`Player died (entity ${pd.entityId})`);
    if (pd.entityId === s.localEntityId) {
      s.localDowned = false;
      s.localDead = true;
      s.respawnTimer = pd.respawnTimer;
      d.deathOverlay.showDead(pd.respawnTimer);
    }
  });

  net.on(MessageType.PLAYER_RESPAWNED, (msg) => {
    if (s.localGameOver) return;
    const pr = msg as PlayerRespawnedMessage;
    d.playerRenderer.notifyRespawned(pr.entityId);
    if (pr.entityId === s.localEntityId) {
      s.localDowned = false;
      s.localDead = false;
      s.respawnTimer = 0;
      d.deathOverlay.hide();
      d.camera.x = pr.x; d.camera.y = pr.y;
      d.camera.targetX = pr.x; d.camera.targetY = pr.y;
    }
  });

  net.on(MessageType.PARTY_WIPE, (msg) => {
    if (s.localGameOver) return;
    const pw = msg as PartyWipeMessage;
    d.debug.log(`Party wipe #${pw.wipeCount} - ${pw.outcome}`);
    if (pw.outcome === 'penalty') {
      console.log(`[Game] Party wipe #${pw.wipeCount} - 25% resource penalty`);
    }
  });

  // ── Game flow ───────────────────────────────────────────────────────────

  net.on(MessageType.GAME_OVER, (msg) => {
    const go = msg as GameOverMessage;
    console.log(`[Game] Game Over - reached wave ${go.waveReached}, reason: ${go.reason}`);
    d.debug.log(`Game Over - wave ${go.waveReached}, reason: ${go.reason}`);
    s.localGameOver = true;
    s.localDowned = false;
    s.localDead = false;
    s.buildModeActive = false;
    s.selectedBuildingId = null;
    d.buildOverlay.hide();
    d.buildGhost.hide();
    d.buildMenu.hide();
    d.deathOverlay.hide();
    d.gameOverOverlay.show({
      waveReached: go.waveReached,
      enemiesKilled: go.enemiesKilled,
      timePlayed: go.timePlayed,
      reason: go.reason,
    });
  });

  net.on(MessageType.META_STATS_RESPONSE, (msg) => {
    const resp = msg as MetaStatsResponseMessage;
    d.statsOverlay.show(resp.stats, () => d.menuOverlay.showMenu());
  });

  // ── Save system ─────────────────────────────────────────────────────────

  net.on(MessageType.GAME_SAVED, (msg) => {
    const saved = msg as GameSavedMessage;
    d.debug.log(`Game saved (wave ${saved.wave}, slot ${saved.slot})`);
    d.chatOverlay.addMessage('System', -1, `Game saved \u2014 Wave ${saved.wave}`);
  });

  net.on(MessageType.SAVE_SLOTS_RESPONSE, (msg) => {
    const resp = msg as SaveSlotsResponseMessage;
    if (s.saveSlotRequestId < 1) return;
    s.pendingSaveSlots = resp.slots;
    d.menuOverlay.showSaveSlots(resp.slots);
  });

  // ── Building ────────────────────────────────────────────────────────────

  net.on(MessageType.BUILD_CONFIRM, (msg) => {
    const bc = msg as BuildConfirmMessage;
    if (!bc.success) d.debug.log(`Build failed: ${bc.reason ?? 'unknown'}`);
  });

  net.on(MessageType.BUILD_UPGRADE_CONFIRM, (msg) => {
    const uc = msg as BuildUpgradeConfirmMessage;
    if (uc.success && uc.entityId !== undefined) {
      d.debug.log(`Upgraded to level ${uc.newLevel}`);
      if (s.selectedBuildingId === uc.entityId) {
        const bComp = d.world.getComponent<BuildingComponent>(uc.entityId, C.Building);
        const hp = d.world.getComponent<HealthComponent>(uc.entityId, C.Health);
        if (bComp) {
          bComp.upgradeLevel = uc.newLevel!;
          d.buildOverlay.updateSelection(bComp.buildingType, bComp.upgradeLevel, d.combinedResources(), hp?.current, hp?.max);
        }
      }
    } else if (!uc.success) {
      d.debug.log(`Upgrade failed: ${uc.reason ?? 'unknown'}`);
    }
  });

  net.on(MessageType.BUILD_REPAIR_CONFIRM, (msg) => {
    const rc = msg as BuildRepairConfirmMessage;
    if (rc.success && rc.entityId !== undefined) {
      d.debug.log('Building repaired');
      if (s.selectedBuildingId === rc.entityId) {
        const bComp = d.world.getComponent<BuildingComponent>(rc.entityId, C.Building);
        const hp = d.world.getComponent<HealthComponent>(rc.entityId, C.Health);
        if (bComp) {
          d.buildOverlay.updateSelection(bComp.buildingType, bComp.upgradeLevel, d.combinedResources(), hp?.current, hp?.max);
        }
      }
    } else if (!rc.success) {
      d.debug.log(`Repair failed: ${rc.reason ?? 'unknown'}`);
    }
  });

  net.on(MessageType.CAMPFIRE_DESTROYED, () => {
    d.debug.log('Campfire destroyed!');
  });

  // ── Errors ──────────────────────────────────────────────────────────────

  net.on(MessageType.ERROR, (msg) => {
    const err = msg as unknown as { code: string; message: string };
    console.error(`[Net] Server error ${err.code}: ${err.message}`);
    d.debug.log(`Error: ${err.code} - ${err.message}`);
    if (err.code === 'VERSION_MISMATCH') {
      d.menuOverlay.setConnectionStatus('disconnected');
      d.menuOverlay.setButtonsEnabled(false);
      d.electronAPI?.checkForUpdates?.();
    }
  });

  net.on(MessageType.SESSION_CLOSED, (msg) => {
    const closed = msg as unknown as { reason: string };
    console.warn(`[Net] Session closed: ${closed.reason}`);
    d.debug.log(`Session closed: ${closed.reason}`);
    d.stateMgr.transition(GameState.Menu);
    if (closed.reason === 'Kicked by host') {
      d.menuOverlay.showInfoDialog('You have been kicked by the host.');
    }
  });

  // ── Transport callbacks ─────────────────────────────────────────────────

  net.onConnect(() => {
    d.menuOverlay.setConnectionStatus('connecting');
  });

  net.onDrop(() => {
    s.transportReady = false;
    s.handshakeSent = false;
    d.menuOverlay.setConnectionStatus('disconnected');
    d.menuOverlay.setButtonsEnabled(false);
    d.debug.log('Connection lost');

    if (d.stateMgr.current !== GameState.Menu) {
      console.warn('[Net] Connection lost - returning to menu');
      d.stateMgr.transition(GameState.Menu);
    }
  });
}
