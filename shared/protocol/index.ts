// Protocol barrel file - re-exports all protocol types from category-specific files.

export * from './base';
export * from './session';
export * from './gameplay';
export * from './building';
export * from './skills';
export * from './social';

// ---- Union type ----

import type { BaseMessage } from './base';
import type {
  HandshakeMessage, HandshakeAckMessage,
  SessionCreateMessage, SessionJoinMessage, SessionLeaveMessage, SessionAckMessage,
  PlayerJoinedMessage, PlayerLeftMessage, SessionClosedMessage, SessionStateMessage,
  SessionStartMessage, SessionStartingMessage,
  ClassSelectMessage, PlayerKickMessage,
  SaveSlotsRequestMessage, SaveSlotsResponseMessage, GameSavedMessage, SaveDeleteMessage,
} from './session';
import type {
  SnapshotMessage, DeltaMessage, InputMessage,
  AttackMessage, AttackPerformedMessage, HitMessage,
  ProjectileSpawnMessage, ProjectileRemoveMessage,
  PlayerDownedMessage, ReviveProgressMessage, PlayerRevivedMessage, PlayerDiedMessage, PlayerRespawnedMessage,
  PartyWipeMessage, GameOverMessage,
  ResourceUpdateMessage, InteractMessage,
} from './gameplay';
import type {
  BuildPlaceMessage, BuildConfirmMessage, BuildDestroyedMessage, BuildRuinedMessage,
  CampfireDestroyedMessage, BuildDemolishMessage, BuildUpgradeMessage, BuildUpgradeConfirmMessage,
  BuildRepairMessage, BuildRepairConfirmMessage,
  AoeExplosionMessage, MeteorWarningMessage, WarehouseUpdateMessage,
  LaserBeamVFXMessage, FlameConeMessage, TeslaChainMessage,
  TeleporterUseMessage, TeleporterResultMessage,
  CivilianSpeechMessage, CivilianDiedMessage, CivilianSpawnedMessage,
  CivilianPanelRequestMessage, CivilianPanelStateMessage, CivilianAssignMessage,
  TrainGuardMessage, TrainGuardResultMessage,
  TavernStateMessage, HireHeroMessage, HireHeroResultMessage, HeroDiedMessage, HeroAbilityMessage,
} from './building';
import type {
  SkillAllocateMessage, SkillStateMessage,
  AbilitySlotAssignMessage, AbilityUseMessage, AbilityEffectMessage,
  PotionShopStateMessage, PotionUnlockMessage, PotionEquipMessage, PotionRestockMessage, PotionUseMessage, PotionStateMessage,
  CardOfferMessage, CardPickMessage, CardAppliedMessage,
} from './skills';
import type {
  ChatMessage, PauseVoteMessage, PauseVoteUpdateMessage, PauseStateMessage,
  WaveStartMessage, WaveEndMessage, WaveTimerSyncMessage,
  DayNightSyncMessage, SleepVoteMessage, SleepUpdateMessage,
  WaveModifierMessage, DayEventRollMessage, WorldEventStartMessage, WorldEventEndMessage,
  EnemyIntroMessage, BossIntroMessage, BossPhaseMessage, CardPickupMessage,
  MetaStatsRequestMessage, MetaStatsResponseMessage, MetaStatsUploadMessage,
  DebugSpawnEnemiesMessage,
} from './social';
import type { ErrorMessage } from './base';

export type AnyMessage =
  | HandshakeMessage
  | HandshakeAckMessage
  | ErrorMessage
  | SessionCreateMessage
  | SessionJoinMessage
  | SessionLeaveMessage
  | SessionAckMessage
  | PlayerJoinedMessage
  | PlayerLeftMessage
  | SessionClosedMessage
  | SessionStateMessage
  | SessionStartMessage
  | SessionStartingMessage
  | SnapshotMessage
  | DeltaMessage
  | InputMessage
  | AttackMessage
  | AttackPerformedMessage
  | HitMessage
  | ProjectileSpawnMessage
  | ProjectileRemoveMessage
  | PauseVoteMessage
  | PauseVoteUpdateMessage
  | PauseStateMessage
  | ChatMessage
  | WaveStartMessage
  | WaveEndMessage
  | WaveTimerSyncMessage
  | ResourceUpdateMessage
  | InteractMessage
  | DebugSpawnEnemiesMessage
  | PlayerDownedMessage
  | ReviveProgressMessage
  | PlayerRevivedMessage
  | PlayerDiedMessage
  | PlayerRespawnedMessage
  | PartyWipeMessage
  | GameOverMessage
  | BuildPlaceMessage
  | BuildConfirmMessage
  | BuildDestroyedMessage
  | BuildRuinedMessage
  | CampfireDestroyedMessage
  | BuildDemolishMessage
  | BuildUpgradeMessage
  | BuildUpgradeConfirmMessage
  | BuildRepairMessage
  | BuildRepairConfirmMessage
  | AoeExplosionMessage
  | MeteorWarningMessage
  | WarehouseUpdateMessage
  | SaveSlotsRequestMessage
  | SaveSlotsResponseMessage
  | GameSavedMessage
  | SaveDeleteMessage
  | EnemyIntroMessage
  | MetaStatsRequestMessage
  | MetaStatsResponseMessage
  | MetaStatsUploadMessage
  | CardOfferMessage
  | CardPickMessage
  | CardAppliedMessage
  | ClassSelectMessage
  | PlayerKickMessage
  | SkillAllocateMessage
  | SkillStateMessage
  | AbilitySlotAssignMessage
  | AbilityUseMessage
  | AbilityEffectMessage
  | PotionShopStateMessage
  | PotionUnlockMessage
  | PotionEquipMessage
  | PotionRestockMessage
  | PotionUseMessage
  | PotionStateMessage
  | CivilianSpeechMessage
  | CivilianDiedMessage
  | CivilianSpawnedMessage
  | CivilianPanelRequestMessage
  | CivilianPanelStateMessage
  | CivilianAssignMessage
  | TrainGuardMessage
  | TrainGuardResultMessage
  | DayNightSyncMessage
  | SleepVoteMessage
  | SleepUpdateMessage
  | WaveModifierMessage
  | DayEventRollMessage
  | WorldEventStartMessage
  | WorldEventEndMessage
  | CardPickupMessage
  | BossIntroMessage
  | BossPhaseMessage
  | TeleporterUseMessage
  | TeleporterResultMessage
  | LaserBeamVFXMessage
  | FlameConeMessage
  | TeslaChainMessage
  | TavernStateMessage
  | HireHeroMessage
  | HireHeroResultMessage
  | HeroDiedMessage
  | HeroAbilityMessage
  | BaseMessage;
