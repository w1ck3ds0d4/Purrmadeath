# Purrmadeath - Architecture Guide

This document maps every source file in the project, describing its purpose and key contents.
Use `Ctrl+F` to find what you're looking for quickly.

---

## Project Structure Overview

```
server/              Server-side game logic (Node.js + WebSocket)
  core/              Core orchestration (session, networking, logging)
  systems/           ECS systems (combat, movement, building, etc.)
  abilities/         Ability execution logic
shared/              Code shared between client and server
  components/        ECS component definitions
  definitions/       Data definitions (skills, enemies, cards, achievements)
src/renderer/        Client-side code (Pixi.js + Electron)
  src/game.ts        Main game loop and state management
  src/input/         Input handling
  src/net/           Networking (WebSocket client, reconciliation)
  src/render/        Camera, build ghost rendering
  src/systems/       Client-side systems (rendering, VFX, build mode)
  src/ui/            UI overlays, HUD elements, theme
```

---

## Server Files

### `server/server.ts` (~50 lines)
Entry point for the game server. Creates HTTP server and WebSocket, initializes SessionManager.

### `server/net/ServerSocket.ts` (~150 lines)
WebSocket server wrapper. Handles connections, IP tracking, per-IP rate limits (500 msg/s remote, unlimited localhost), MAX_CONNECTIONS enforcement. Heartbeat timeout: 120s (disabled for localhost). Rate monitoring logged every 30s.

### `server/core/SessionManager.ts` (~700 lines)
Routes incoming WebSocket messages to the correct GameSession. Manages:
- Session creation/joining with invite codes
- Player identity (UUID-based, persisted to disk)
- Meta stats storage (file-based in `metastats/` directory)
- Reconnection grace period
- Message type dispatch (routes to GameSession handlers)

### `server/core/GameLogger.ts` (~120 lines)
Persistent file-based session logger. Creates timestamped log files in `logs/` directory.
- 11 categories: ability, damage, buff, wave, building, save, player, combat, error, debug, system
- Auto-cleans old logs (keeps last 5 per save slot)
- Convenience methods: `logger.ability(msg)`, `logger.damage(msg)`, etc.

### `server/core/GameSession.ts` (~4000 lines)
**The largest file.** Core game session that orchestrates all gameplay. Sections:

| Line Range | Section | Description |
|-----------|---------|-------------|
| 1-139 | Imports | All system and type imports |
| 143-163 | Types | SessionPlayer, SessionPhase, SendFn |
| 183-310 | Fields | All private fields and system references |
| 311-549 | Constructor | System initialization with dependency injection |
| 553-695 | Player Management | addPlayer, removePlayer, suspendPlayer, rebindPlayer, lobby |
| 696-860 | Game Start | start() - transitions lobby to playing |
| 861-1180 | World Helpers | isWalkable, overlapsBuilding, findSafeSpawn, generateResources |
| 1180-1348 | Player Stats | recalculatePlayerStats, applyBuffBonuses |
| 1349-1550 | Entity Spawning | spawnBuilding, spawnResourceNode, spawnItemDrop, spawnLootDrops |
| 1551-1762 | Resource/Item | creditResources, applyCardPickup, boss/enemy kill handlers |
| 1763-1880 | Input/Building | applyInput, handleAttack, handleBuild* (place/demolish/upgrade/repair) |
| 1881-2116 | Interaction | handleTrainGuard, handleHireHero, handleTeleporter, handleInteract |
| 2117-2275 | Melee Combat | handleMeleeAttack - damage calc, on-hit effects, blood arc |
| 2277-2424 | Ranged Combat | handleRangedAttack - projectile spawning, elemental colors |
| 2425-2776 | Combat Helpers | countNearbyAllies, getPrimaryElement, applyOnHitEffects, applyThorns |
| 2777-2965 | Run End/Save | fireRunEnd, flushRunStats, handleSkill/Potion/Civilian delegates |
| 2966-3051 | Save/Load | saveNow, serializeSave, loadSave |
| 3052-3208 | Debug Commands | /spawn, /wave, /give, /card, /sp, /kill, /pause, /god, /speed, /heal, /tp |
| 3209-3330 | Pause/Sleep | handleSleepVote, handlePauseVote, recheckPauseVotes |
| 3331-3458 | Active Buffs | tickActiveBuffs - blood drain, charge, regen, buff expiry |
| 3459-3498 | Damage Reduction | Sync damageReductionMap, dodgeChance, shield before combat |
| 3499-3825 | Main Tick | tick_() - all systems update, snapshot diff, broadcast delta |
| 3826-4063 | Snapshots | buildFullSnapshot, buildDelta, gatherEntitySnapshots |

### `server/systems/BuildingSystem.ts` (~1600 lines)
Building placement, upgrades, demolition, and per-tick systems. Handles building exclusion zones (walls/bridges/moats/spike traps exempt). Sections:

| Section | Description |
|---------|-------------|
| handlePlace | Validates placement, creates building entity, adds components |
| handleUpgrade | Level-up logic, stat scaling per building type |
| handleDemolish | Refund resources, destroy entity |
| handleRepair | Restore HP, consume resources |
| tickTurrets | Arrow/cannon turret targeting and firing |
| tickLaserBeams | Laser tower continuous beam damage |
| tickTeslaCoils | Tesla coil AOE zap + chain lightning |
| tickFlameTowers | Flame cone damage + VFX broadcast |
| tickRepairStations | Worker-based building repair |
| tickMoats | Enemy slow effect on moat tiles |
| tickProduction | Resource generation for lumbermill/quarry/mine/farm |
| tickWarehouseDeposit | Civilian deposit resources to warehouse |
| restoreBuildingComponents | Re-add components on save load |

### `server/systems/CombatSystem.ts` (~300 lines)
Melee attack resolution. `processMeleeAttack()` handles:
- Attack cooldown, lag compensation, arc/range checks
- Damage calculation with defense, crit, knockback
- Dodge chance, damage reduction map, shield blocking
- Raw damage tracking for Unbreakable Charge

### `server/systems/ProjectileSystem.ts` (~550 lines)
Projectile movement, collision, and special effects:
- Homing, bouncing, piercing, splitting projectiles
- Mortar arc for cannon turrets
- AOE explosions (cannon, headshot, explosive barrage)
- Crippling slow on hit (trapper combat mod)
- Shield blocking (aegis), damage reduction (unbreakable charge)
- Thorns reflection, blood arc heal on hit
- Poison/burn DOT application via on-hit effects
- Projectile color cycling based on elemental skills

### `server/systems/EnemySystem.ts` (~400 lines)
Enemy AI and guard behavior:
- Enemy pathfinding toward campfire/buildings, melee/ranged attacks, taunt targeting
- Guard AI: patrol around barracks or follow player (wolf companions)
- Wolf companion lifetime management (temporary wolves from Pack Call expire)
- Variant-specific behavior (ghost phasing, assassin dashes, titan ground slams)

### `server/systems/MovementSystem.ts` (~200 lines)
Entity movement: velocity integration, collision with buildings, bridge support.

### `server/systems/CivilianSystem.ts` (~500 lines)
Civilian NPC management:
- Timer-based spawning (2 every 60s), wandering AI
- Worker assignment to buildings (auto-assign idle civilians)
- Hunger system, downed/revive state
- Wave-cleared experience tracking
- Two-column civilian management panel data

### `server/systems/SkillSystem.ts` (~400 lines)
Skill point allocation, buff computation, ability cooldown management.
- `getSkillBuffs()` - computes aggregate stat bonuses from allocated nodes
- `sendState()` - syncs skill state + cooldowns to client
- Ability use validation and cooldown enforcement

### `server/systems/CardDispenser.ts` (~200 lines)
Card drop logic after wave clears. Manages the pick-one-of-three flow. 30 cards total (buffs, abilities, curses).

### `server/systems/SaveManager.ts` (~200 lines)
Save/load game state to JSON files. Serializes all entities, buildings, civilians, wave state.

### `server/systems/RespawnManager.ts` (~300 lines)
Death handling: player downed state, respawn timers, entity cleanup.
- Tracks attacker map for resource/kill credit
- Civilian downed state with revive window
- Party wipe detection

### `server/systems/WorldEventController.ts` (~200 lines)
Day modifier (world event) system. Rolls random events at day start (W2+, 15% base chance) with roulette animation delay. Events: Meteor Shower (random AOE damage), Earthquake (building damage + stun), Resource Boom (3x production), Surprise Attack (extra portals), Solar Eclipse (vision reduction + undead spawns). Events have duration, tint color, and vision/production multipliers.

### `server/systems/DayNightController.ts` (~200 lines)
Day/night cycle: phase transitions, sleep voting, timer management.

### `server/systems/WaveController.ts` (~370 lines)
Wave spawning: portal placement, enemy count scaling, wave clear detection. Wave countdown and enemy wave preview banner. Portals spawn outside the campfire building range square (dynamic spawn distance based on range + 100px buffer). Applies wave milestone multipliers (HP, damage, portal count) from WaveMilestones.

### `server/systems/BossSystem.ts` (~200 lines)
Boss spawning and special attack patterns. 8 unique bosses (W5-W40), multi-phase mechanics, tick-based delayed actions.

### `server/abilities/AbilityExecutor.ts` (~400 lines)
Executes activated abilities: meteor shower, blizzard, thunderwave, blood drain, warcry, unbreakable charge, sniper shot, pack call, explosive barrage, arrow volley, etc.

---

## Shared Files

### `shared/constants.ts` (~1050 lines)
All game balance constants organized by category:
- Network (ports, tick rate, version, rate limits)
- World (tile size, chunk size)
- Player (HP, speed, stamina, melee range/damage)
- Enemies (HP scaling, variants, sizes)
- Buildings (costs, HP, sizes, exclusion zones, upgrade previews)
- Civilians (spawn timer 60s, hunger, capacity)
- Day/night (phase durations)

### `shared/protocol.ts` (~1500 lines)
All WebSocket message types and interfaces:
- MessageType enum (60+ message types)
- Handshake, session, lobby messages
- Input, attack, building interaction messages
- Entity snapshot and delta sync messages
- Wave, card, skill, potion messages
- Civilian, hero, world event messages
- Boss intro, phase, and loot messages

### `shared/components/index.ts` (~800 lines)
ECS component interfaces and the C enum mapping component keys.
Every game entity is composed of these components (Position, Health, Faction, Building, etc.)

### `shared/definitions/SkillDefinitions.ts` (~315 lines)
Skill system types, allocation logic, and buff computation. Branch data is imported from per-class files.
- Types: PassiveStat, SpecialEffectType, AbilityParams, CombatModifierType
- Interfaces: SkillNode, SkillBranch, SkillAllocation, SkillBuffs
- Functions: canAllocate, computeSkillBuffs, getActiveAbilities

### `shared/definitions/skills/WarriorSkills.ts` (~107 lines)
Warrior branches: Berserker (lifesteal/rage), Guardian (tank/thorns/charge), Blood Knight (drain/arc). Plus Templar and Slayer placeholders.

### `shared/definitions/skills/RangerSkills.ts` (~107 lines)
Ranger branches: Sharpshooter (poison/crit), Beastmaster (wolf companion), Trapper (multi-shot/explosives). Plus Shadow Hunter and Windwalker placeholders.

### `shared/definitions/skills/MageSkills.ts` (~104 lines)
Mage branches: Fire (burn/meteor), Frost (slow/blizzard), Electric (chain/thunderwave). Plus Earth and Void placeholders.

### `shared/definitions/EnemyDefinitions.ts` (~150 lines)
Enemy variant definitions: melee, ranged, fast, tank, giant, titan. Wave-based faction system (bandits, undead, corrupted).

### `shared/definitions/CardDefinitions.ts` (~110 lines)
30 cards: 15 stat (damage/HP/speed/crit/defense/regen/stamina/dodge), 10 build-defining (vampiric bite, last stand, pack hunter, rapid strikes, explosive touch, etc.), 5 curses (dual buff+debuff mechanics).

### `shared/definitions/ProgressionDefinitions.ts` (~110 lines)
18 achievements: 10 stat buff (kill/gather/build/survive milestones), 4 building unlocks (Siege Workshop, Kennel, Arcane Tower, Watchtower), 4 class unlock milestones. Computed from MetaStats.

### `shared/definitions/WaveMilestones.ts` (~92 lines)
Wave milestone definitions for permanent cumulative scaling. Milestones at W25 (Corruption - random enemy buffs), W50 (Undying Horde - 15% resurrect), W75 (Final Stand - 3x portals, 2x HP), W100 (Apocalypse - 1.5x damage). Infinite scaling past W100: portal count, HP, and damage multipliers increase every 10 waves.

### `shared/definitions/WaveModifiers.ts` (~50 lines)
Per-wave random modifiers: Swarm (2x enemies, 50% HP), Ironhide (+50% HP, +25% dmg), Fog (0.5x vision), Frenzy (+30% speed, +20% dmg). 15% roll chance per wave, count scales with wave number (1 at W3-7, up to 3 at W15+).

### `shared/definitions/WorldEvents.ts` (~50 lines)
Day modifier (world event) definitions: Meteor Shower, Earthquake, Resource Boom, Surprise Attack, Solar Eclipse. Each defines min wave, duration, vision/production multipliers, tint color, and spawn rates.

### `shared/definitions/MilestoneDefinitions.ts` (~30 lines)
4 class unlock milestones: Templar, Slayer, Shadow Hunter, Windwalker. Computed from MetaStats.

### `shared/definitions/MetaStats.ts` (~90 lines)
Meta-progression stats interface and merge function. Tracks: damage dealt/taken, kills, resources, waves, time, buildings, crits, portals, wolves, abilities, walls.

### `shared/definitions/ClassDefinitions.ts` (~50 lines)
Base stats per player class (warrior, ranger, mage).

### `shared/SaveFormat.ts` (~150 lines)
SaveData interface for game persistence.

---

## Client Files

### `src/renderer/src/game.ts` (~1800 lines)
**Main client entry point and game loop.** Sections:

| Section | Description |
|---------|-------------|
| Imports & State | Module-level state variables (skills, inventory, buffs) |
| joinSession() | Creates ECS world, registers all message handlers, starts game loop |
| Game State Machine | Menu, Lobby, Playing, Paused, GameOver states |
| Input Handling | Key bindings (Q=build, E=interact, R=repair, X=demolish, etc.) |
| Build Mode | Build menu toggle, RMB select, placement ghost |
| Ability System | Cooldown tracking, targeting mode, ability activation |
| Render Loop | Camera follow, night overlay, VFX, minimap updates |
| HUD Management | Inventory accordion (top-center, open by default), controls, hotbar, wave HUD |

### `src/renderer/src/net/NetworkClient.ts` (~150 lines)
WebSocket client with auto-reconnect. Handles connection lifecycle.

### `src/renderer/src/net/NetworkHandler.ts` (~1100 lines)
All incoming message handlers. Sections:

| Section | Description |
|---------|-------------|
| Snapshot/Delta | Entity creation/update from server state |
| Combat | Hit results, attack animations, damage numbers |
| Building | Place/demolish/upgrade confirmations |
| Projectiles | Spawn/remove/explosion VFX, elemental color cycling |
| Wave | Wave start/clear, day/night sync, wave countdown, preview banner |
| Cards | Card offers, picks, applied effects |
| Skills | Skill state sync, ability effects |
| Civilians | Panel data, assign responses, auto-assign idle |
| UI | Chat, pause, notifications, resource gain popups, low HP vignette |

### `src/renderer/src/net/Reconciler.ts` (~150 lines)
Client-side prediction reconciliation. Replays unconfirmed inputs on server correction.

### `src/renderer/src/systems/PlayerRendererSystem.ts` (~1500 lines)
Renders all game entities using Pixi.js Graphics:
- Players (circles with facing indicators, name tags)
- Enemies (colored by variant, HP bars, status effects)
- Buildings (colored squares with icons, exclusion zones)
- Resource nodes (diamond shapes by type)
- Item drops, card drops, portals
- Civilians (orange circles, speech bubbles, spawn timers)
- Campfire waypoint indicator

### `src/renderer/src/systems/ProjectileRendererSystem.ts` (~400 lines)
Renders projectiles: arrows, mage orbs, ballista bolts, blood arcs, mortars.
Also renders AOE explosions, meteor impacts, and meteor warnings.
Supports elemental color cycling based on equipped skills.

### `src/renderer/src/systems/AbilityVFXSystem.ts` (~1070 lines)
Visual effects for abilities and persistent auras:
- Whirlwind, shield bubble, expanding rings
- Rain of arrows, explosions, teleport flashes
- Blizzard particles, meteor shower
- Lightning bolts (jagged path generation)
- Laser beams, flame cones
- Persistent auras (warcry, aegis, charge, blood drain)
- Unbreakable Charge progress bar and damage counter

### `src/renderer/src/systems/BuildController.ts` (~350 lines)
Build mode state machine: inactive -> picker -> placing -> select.
Handles building placement validation, rotation, ghost preview.

### `src/renderer/src/systems/DamageNumberSystem.ts` (~100 lines)
Floating damage numbers that pop up and fade. Resource gain popups.

### `src/renderer/src/render/Camera.ts` (~200 lines)
Camera system: target tracking, smooth follow, ALT look-around, screen shake.

### `src/renderer/src/render/BuildGhostRenderer.ts` (~200 lines)
Renders the building placement ghost with valid/invalid coloring.

### `src/renderer/src/input/InputManager.ts` (~150 lines)
Maps keyboard/mouse input to game actions. Tracks pressed/released state.

---

## UI Files

### `src/renderer/src/ui/theme.ts` (~80 lines)
Shared color tokens, fonts, and border radii for all UI. Laevatain-themed dark palette with crimson red accent and violet-purple borders.

### `src/renderer/src/ui/overlays/`
| File | Purpose |
|------|---------|
| `SkillTreeOverlay.ts` (~1100 lines) | Character/Skills/Cards tabbed panel (K key) |
| `BuildMenuOverlay.ts` (~500 lines) | Building menu with categories, tooltips, achievement gating |
| `CivilianPanelOverlay.ts` (~400 lines) | Civilian management (two-column layout, auto-assign) |
| `MenuOverlay.ts` (~500 lines) | Main menu, settings, save slots |
| `LobbyOverlay.ts` (~400 lines) | Multiplayer/singleplayer lobby, class selection |
| `CardPickerOverlay.ts` (~300 lines) | Pick-one-of-three card selection |
| `ChatOverlay.ts` (~300 lines) | In-game chat |
| `StatsOverlay.ts` (~300 lines) | Meta stats and achievement display |
| `GameOverOverlay.ts` (~200 lines) | Game over screen |
| `DeathOverlay.ts` (~150 lines) | Death/respawn overlay |
| `PotionShopOverlay.ts` (~200 lines) | Potion shop UI |
| `TrainingCenterOverlay.ts` (~200 lines) | Guard training UI (Warrior/Ranger/Mage roles) |

### `src/renderer/src/ui/hud/`
| File | Purpose |
|------|---------|
| `HUD.ts` (~150 lines) | HP/stamina bars (Pixi.js), low HP vignette |
| `WeaponHotbar.ts` (~200 lines) | Ability/potion/build hotbar |
| `WaveHUD.ts` (~500 lines) | Day timer, wave info, sleep button, countdown, preview banner |
| `Minimap.ts` (~250 lines) | Minimap with entity dots, campfire waypoint |
| `ResourceHUD.ts` (~200 lines) | Inventory accordion (top-center, open by default), resource gain popups |
| `NotificationToast.ts` (~150 lines) | Toast notifications |

### `src/renderer/src/ui/debug/DebugOverlay.ts` (~300 lines)
Developer console with 3-column stats display (Core, Server, Game) and command input. Commands: `/sp`, `/spawn`, `/give`, `/card`, `/wave`, `/kill`, `/pause`, `/god`, `/speed`, `/heal`, `/tp`, `/all`.

---

## Electron Files

### `src/main/index.ts` (~150 lines)
Electron main process: window creation, embedded server (CJS-bundled `server.cjs` extracted from asar to userData), auto-updater (prod only). Client-side logging to `%AppData%/purrmadeath/logs/`.

### `src/preload/index.ts` (~30 lines)
Electron preload script for IPC bridge.

---

## Key Patterns

- **Factory pattern**: All server systems use `createXxx(deps) -> { publicAPI }`
- **ECS**: World + Component keys (C enum) + system functions
- **Server-authoritative**: All game logic runs on server, client predicts and reconciles
- **Shared mutable state**: Objects passed by reference (playerState, inventory, etc.)
- **Callback injection**: Systems receive callbacks for cross-system communication
- **Message-based sync**: Server broadcasts delta snapshots at 30Hz
- **Lazy getter pattern**: `getProjectileRuntime = () => projectileRuntime` avoids init ordering issues
- **Transport/Session split**: WebSocket connection (auto on startup) vs session identity (on Host/Join action)
- **Spatial hash optimization**: O(1) proximity queries for turrets, spike traps, laser beams
