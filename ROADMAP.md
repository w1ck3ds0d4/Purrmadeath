# ROADMAP - Purrmadeath

**Genre**: 2D top-down co-op roguelike | base building | procedural world
**Platform**: Electron desktop (LAN first - online later)
**Max players**: 4 per session
**Stack**: TypeScript - Pixi.js 8 - Vite - Electron - Node.js - WebSocket (ws)
**Architecture**: ECS (Entity-Component-System)

---

## Legend
- `[ ]` Not started
- `[~]` In progress
- `[x]` Complete

---

## Phase 0 - Foundation & Scaffolding
> Goal: runnable Electron window with Pixi.js rendering and WebSocket stub. Nothing game-specific yet.

- [x] **0.1** Repo structure: `src/` (client), `server/`, `shared/`, `electron/`
- [x] **0.2** Tooling: Vite + TypeScript + ESLint + path aliases (`@shared`, `@client`, `@server`)
- [x] **0.3** Electron main process: creates window, loads Vite dev server in dev / built files in prod
- [x] **0.4** ECS core (`World`, `Entity`, `ComponentRegistry`, `System` interface) - shared between client and server
- [x] **0.5** Fixed-tick game loop on server (20 TPS), variable render loop on client (rAF)
- [x] **0.6** WebSocket server stub (Node.js `ws`) - handshake, heartbeat, disconnect handling
- [x] **0.7** WebSocket client stub in renderer - connect/reconnect, message queue
- [x] **0.8** Pixi.js 8 renderer bootstrap: canvas setup, stage, viewport
- [x] **0.9** Dev tooling: hot reload for client (Vite HMR), nodemon for server

**Exit criteria**: Electron opens a window, renders a colored rectangle via Pixi.js, and logs a connected message from the local WS server.

---

## Phase 1 - World & Rendering
> Goal: infinite procedural tile world that streams in and out as the camera moves.

- [x] **1.1** Tile definitions and registry (tile ID - properties: walkable, solid, visual)
- [x] **1.2** Chunk system: 32x32 tile chunks, address by `(cx, cy)`, stored as flat typed arrays
- [x] **1.3** Simplex noise world generator: elevation + moisture - biome assignment
- [x] **1.4** Biome registry (Grassland, Forest, Cave, Desert, Tundra, Highland, Ocean, Shore) - each defines tile palette
- [x] **1.5** Chunk manager: load chunks in player view radius, unload distant chunks
- [x] **1.6** Tile renderer using Pixi.js `Graphics` with color batching and viewport culling
- [x] **1.7** Camera system: smooth follow + ALT+mouse look-around
- [x] **1.8** Debug overlay: FPS, camera pos, chunk coords, biome name, seed

**Exit criteria**: Walk around an infinite procedural world, tiles load and unload smoothly, biome colors are distinct.

---

## Phase 2 - Player, Input & Main Menu
> Goal: main menu - new game - one player moves through the world with smooth controls and a HUD.

### Architecture decisions locked in for this phase
- **4-player ready from day one**: player entities are generic ECS entities; Phase 2 spawns one, Phase 3 spawns four
- **Input action abstraction**: `InputManager` maps physical keys - abstract `Action` enum (`MoveUp`, `MoveDown`, `Attack`, etc.) so gamepad support and key rebinding require zero game-logic changes
- **HTML overlay for menus**: main menu and pause screen are `position: absolute` divs over the canvas; in-game HUD stays in Pixi.js
- **Player colors**: P1=blue `0x4a90d9` - P2=red `0xe05252` - P3=green `0x52c062` - P4=yellow `0xe0a830`
- **No save/load this phase**: deferred to Phase 5 (waves must exist first)
- **No sprint this phase**: deferred to Phase 4 alongside abilities

### Player stats (ECS components defined here, used in all future phases)
| Component | Fields |
|---|---|
| `Health` | `current`, `max` |
| `Stamina` | `current`, `max`, `regenRate` |
| `Defense` | `flat` (damage reduction), `percent` |
| `Speed` | `base`, `multiplier` (modified by buildings/abilities later) |

### Tasks
- [x] **2.1** Main menu (HTML overlay): title, **New Game**, **Settings** stub, animated world pan in background
- [x] **2.2** Game state machine: `MENU - LOADING - PLAYING - PAUSED` (pause overlay on ESC)
- [x] **2.3** `InputManager`: action mapping, key state polling, clean API for systems to query
- [x] **2.4** Player ECS components: `Position`, `Velocity`, `Health`, `Stamina`, `Defense`, `Speed`, `PlayerIndex`
- [x] **2.5** Player spawn: place player entity at world origin, remove Phase 1 WASD camera hack
- [x] **2.6** Movement system: WASD input - velocity - position, acceleration + friction curve
- [x] **2.7** Tile collision: solid tile detection, slide along walls (no getting stuck on corners)
- [x] **2.8** Camera handoff: camera `targetX/Y` now follows player entity position
- [x] **2.9** Player renderer: colored circle + directional arrow (vector shape, replaced by sprites in Phase 9)
- [x] **2.10** In-game HUD (Pixi.js): health bar, stamina bar, player color indicator, coords debug

**Exit criteria**: Main menu loads - New Game spawns a player - player moves through the world with smooth collision - ESC pauses - biome and HUD update correctly.

---

## Phase 3 - Core Multiplayer (LAN)
> Goal: 4 players in the same world over LAN with authoritative server.

- [x] **3.1** Server-side ECS: `GameSession` owns canonical World; `SessionManager` wires socket handlers
- [x] **3.2** Session manager: lobby creation, player join/leave, session ID, host/guest roles
- [x] **3.3** Network protocol (`shared/protocol.ts`): full typed message enum + payload interfaces (SESSION_CREATE/JOIN/ACK/START/STARTING, PLAYER_JOINED/LEFT, SNAPSHOT, DELTA, INPUT, CHAT, ERROR)
- [x] **3.4** Client-side prediction: local inputs applied immediately via `MovementSystem`; `Reconciler` buffers pending inputs with sequence numbers
- [x] **3.5** Server reconciliation: on DELTA, `Reconciler.applyDelta` snaps to server position if error > 2px, replays unacknowledged inputs
- [x] **3.6** Delta state sync: `GameSession.buildDelta()` diffs entity snapshots and sends only changed entities each tick
- [x] **3.7** Remote player entities: `RemotePlayerSystem` creates/updates/removes entities from SNAPSHOT and DELTA; LAN latency makes interpolation unnecessary
- [x] **3.8** Lobby UI: Host button connects to `localhost`, Join field accepts a 4-letter session code (Electron) or raw IP (browser); Start only for host
- [x] **3.9** In-game chat (text only) - also shows join/leave events in lobby
- [x] **3.10** Disconnection handling: `ServerSocket.onDisconnect` fires `SessionManager.handlePlayerLeave`, broadcasts `PLAYER_LEFT`, destroys session when empty
- [x] **3.11** LAN session discovery: server broadcasts UDP beacon every 2 s (`server/discovery.ts`); Electron main caches sessions by code; `resolveSessionCode(code)` IPC returns `{ ip, port }`
- [x] **3.12** Lobby share row: code chip + IP chip each with a one-click **Copy** button (green flash on success); IP chip hidden when connecting to `localhost`

**Exit criteria**: 4 players connect via LAN, see each other moving in real-time with <50ms visual lag on local network.

---

## Phase 4 - Combat & Enemies
> Goal: enemies spawn, attack players, drop loot. Players can fight back.

- [x] **4.1** Combat components: `Facing` (mouse cursor - world-space angle in radians; drives melee arc + directional arrow), `Damage`, `Faction`, `AttackCooldown`, `KnockbackReceiver` - `Health` already defined in Phase 2
- [x] **4.2** Damage system: hit detection (120 deg arc, `MELEE_RANGE=60px`), damage application (flat+percent `Defense` reduction), knockback impulse via `KnockbackReceiver` (decays at 8/s in server `MovementSystem`)
- [x] **4.3** Melee attack: sword swing - 120 deg arc hitbox in mouse-facing direction, server-authoritative hit resolution
- [x] **4.4** Ranged attack: bow - aimed projectile entity toward mouse cursor, travel, collision
- [x] **4.5** Enemy AI: chase nearest player, melee attack at close range (10 dmg, 40px range, 1.0s cooldown, 200 knockback), server-authoritative hit resolution via CombatSystem
- [x] **4.6** Pathfinding: 8-directional A* on tile grid (Chebyshev heuristic), path caching with 0.5s replan, direct line-of-sight bypass, corner-cutting prevention
- [x] **4.7** Portal system (wave enemy source):
 - Portal entities spawn randomly around player centroid (400-800px), on walkable tiles, min 200px apart
 - Portals continuously spawn enemies every N seconds (interval shrinks 15% each wave)
 - Portal count (wave N = N portals) and HP (100 + 20xN) both scale per wave
 - Wave ends only when **all** portals are destroyed
- [x] **4.8** Resource gathering: biome-weighted resource nodes (Wood, Stone, Iron, Diamond) spawn around player; melee/ranged attacks damage them; destroying a node credits the attacker's resource counter
- [x] **4.9** Item drop entities: world-space `ItemDrop` component with scatter velocity + friction; auto-pickup on overlap for resources, `E` to collect non-auto items; `ItemDropSystem` handles lifetime/scatter/pickup
- [x] **4.10** Loot system: `LootTables.ts` defines per-enemy drop tables with probability rolls; enemies scatter item drops on death
- [x] **4.11** Death & respawn: downed state (30s bleed-out), teammates revive with E (5s, 30% HP), solo = immediate death; 8s respawn timer - spawn origin at full HP; enemies ignore downed players
- [x] **4.12** Wave wipe system:
 - **1st full-party wipe on a wave** - 25% of resources lost per player, scattered as item drops near spawn; all players respawn immediately
 - **2nd full-party wipe on same wave** - game over, return to menu
 - Wipe count resets between waves; building damage (50% HP) deferred to Phase 5
- [x] **4.13** Server-side anti-exploit: attack position tolerance validation (80px), facing angle sanity check, downed-state guards on all actions
- [x] **4.14** Sprint: Shift key - 1.5x speed multiplier; depletes Stamina at 30 units/sec; regen pauses while sprinting; feeds into stamina bar HUD
- [x] **4.15** Wave protocol messages: `WAVE_START` (wave number, prep duration) and `WAVE_END` (outcome) broadcast by server; client shows prep-countdown HUD overlay (WaveHUD)
- [x] **4.16** Enemy renderer: enemies travel through the same `RemotePlayerSystem` entity pipeline as remote players; `Faction` component drives the visual - red circle for enemies, colored circle for players
- [x] **4.17** Attack protocol: client sends `ATTACK` message (type: melee/ranged, seq, facing angle); server resolves and broadcasts `HIT` (sourceId, targetId, damage); no client-side prediction needed for attacks on LAN
- [x] **4.18** Debug overlay: hidden by default, **F4** toggles; server metrics panel - RTT (ms), packet loss (%), server message rate (msg/s)

**Exit criteria**: Enemies spawn from portals, chase players, deal damage, die, drop loot. Players can gather resources and pick up drops. Wave ends when all portals destroyed. Wipe penalties apply correctly.

---

## Phase 5 - Base Building
> Goal: players craft and place buildings that persist in the world and provide bonuses.

- [x] **5.1** Building component registry: `Building` component (`buildingType`, `permanent`), `'building'` faction type, `BuildingType` union (`'campfire' | 'wall'`)
- [x] **5.2** Campfire starter building: 3x3 pre-placed at spawn - acts as base anchor; enemies target it; if destroyed, run ends; surrounding 8 tiles rendered as stone floor (client-side cosmetic)
- [x] **5.3** Placement system: B key toggles build mode; variable-size grid-snap (odd-tile center, even-tile corner), multi-tile footprint walkability + overlap checks, per-type cost via BUILDING_COSTS registry, server-authoritative
- [x] **5.4** Building renderer: variable-size colored squares with border, health bar, hit flash, per-type icons (campfire flame, warehouse crate, lumbermill X, quarry triangle, mine pickaxe, farm wheat lines); sizes: wall 1x1, campfire/warehouse 3x3, lumbermill/quarry/mine/farm 2x2
- [x] **5.5** Warehouse building: shared resource pool (multiple warehouses allowed); players auto-deposit by proximity; building costs drawn from warehouse pool when available, else personal; Warehouse HUD shows shared totals; pool lost only when ALL warehouses destroyed; 50% resource drop on warehouse destruction
- [x] **5.6** Production buildings: Lumbermill (wood), Quarry (stone), Mine (iron + 20% diamond), Farm (food) - 2x2 footprint, tick-based resource generation, stored locally (auto-deposit to warehouse if nearby); storage scales 10-30-50, speed scales 1x-3x-5x with upgrades
- [x] **5.7** Defense buildings: Wall (1x1, blocks movement), Arrow Turret (auto-targeting, upgradeable range/damage), Cannon Turret (mortar-style AOE - arcing projectile lands at target position), Spike Trap (damages enemies on contact, self-damage), Bridge (placed on water, makes tiles walkable with adjacent-tile tolerance)
- [x] **5.8** Upgrade system: 3-tier upgrade per building type (F key in build mode), increasing material cost per tier; HP, production rate, turret stats all scale with level; Campfire upgradeable to level 5
- [x] **5.9** Building damage: enemies target buildings alongside players; buildings have health bars; building death broadcasts BUILD_DESTROYED; turrets also target portals
- [x] **5.10** Demolish & select: click to select building (shows level + upgrade/repair cost), X to demolish (50% refund), scroll to cycle building types
- [x] **5.11** Build mode HUD: B key toggle, hotbar slot highlights, ghost preview (green/red), overlay panel with name + cost + affordability colors; hint bar: Scroll/B/Click/X/F/R
- [x] **5.12** Building repair: R key repairs selected building to full HP; cost = fraction of build cost proportional to missing HP
- [x] **5.13** **Save system**: auto-save after each wave + save on host exit (any time)
 - 3 host-owned save slots (keyed by player UUID), per-player progress tracking
 - Saves: world seed, wave number, buildings + HP + upgrades, player resources + position, warehouse pool, elapsed time, kills, processed chunks
 - Saves stored on server disk (`./saves/` directory) as JSON files, loaded on startup
 - Returning players matched by UUID get their progress back; new players start fresh
 - Save slot picker UI when hosting (shows wave, time, kills per slot)
 - Delete save button per slot
 - Mid-wave leave warning dialog

**Exit criteria**: Players gather resources, craft buildings, buildings produce items and defend the base. Save system works reliably - saves on wave clear and on exit, restores all state including player position.

---

## Phase 5.5 - UI & Quality of Life (completed 2026-03-06)
> Post-Phase 5 polish pass: minimap, HUD layout, enemy AI fixes, and save system hardening.

- [x] **5.5.1** HUD layout: minimap (220px) + coords + wave timer stacked on right side; wave HUD width matches minimap
- [x] **5.5.2** Minimap: biome terrain grid with smooth sub-cell scrolling, entity dots colored by type (player colors, resource-type colors for wood/stone/iron/diamond), black border, clip mask
- [x] **5.5.3** Lazy chunk-based resource generation: 3x3 pre-gen at startup, 5x5 dynamic gen as player explores; 1500 node cap
- [x] **5.5.4** Enemy stuck detection: tracks position history, applies perpendicular wiggle when stuck for >2s; pathfinding routes around portals
- [x] **5.5.5** Save system fixes: UUID-based player identity (not WebSocket client ID), correct validation field names (`currentHp`/`maxHp`), disk persistence, save migration for old mine-quarry
- [x] **5.5.6** Bridge fixes: visible rendering above water tiles (filled brown plank with border), walkable with adjacent-tile tolerance so players can step on/off from land
- [x] **5.5.7** Pause screen shows elapsed game time
- [x] **5.5.8** Debug console defaults to `/all` view when opened
- [x] **5.5.9** Damage numbers: floating damage text on hit

---

## Phase 6 - Roguelike Systems (complete)
> Goal: difficulty scaling, new enemies, new buildings, persistent stats, and a card-based power-up system.

### Part 0: Spatial Hash Grid
- [x] **6.0.1** `SpatialHash` class (128x128px cells) for O(1) proximity queries

### Part 1: Difficulty Scaling
- [x] **6.1.1** Compound wave scaling: HP +2%/wave, damage +1%/wave
- [x] **6.1.2** Per-entity `EnemyStats` component replaces global constants (damage, range, knockback, radius)
- [x] **6.1.3** `EnemyVariants.ts` - per-variant base stats table; `pickEnemyVariant()` with wave-based weights
- [x] **6.1.4** Portal extra spawns: +1 enemy per portal interval every 3 waves

### Part 2: New Enemy Types
- [x] **6.2.1** Ghost: invisible by default, phases through walls, targets nearest player only, deals damage while hidden
- [x] **6.2.2** Giant: 2x radius, 150 HP, targets nearest building (not campfire priority), slow 2s attack speed
- [x] **6.2.3** Assassin: fast (120 speed), instant dash every 20s when target within 200px
- [x] **6.2.4** Enemy intro warnings: "New threat: Ghosts!" toast on first wave a type appears
- [x] **6.2.5** Wave-based spawn weights: melee/ranger (W1-2), +ghost (W3), +giant (W5), +assassin (W7)

### Part 3: New Buildings
- [x] **6.3.1** Light Tower: reveals hidden ghosts within range (200/300/400px per level); bright yellow icon with radiating rays
- [x] **6.3.2** Healing Shrine: heals nearby players (3/5/8 HP/s per level, 120/160/200px range)
- [x] **6.3.3** Barracks: spawns guard NPCs (1/2/3 max per level) that patrol and attack enemies; guards destroyed when barracks destroyed

### Part 4: Meta Stats
- [x] **6.4.1** `MetaStats` interface: lifetime damage, resources, kills by type, waves, time, buildings, runs
- [x] **6.4.2** Per-run stat tracking in GameSession (damage dealt, resources gathered, kills by type, buildings built)
- [x] **6.4.3** SessionManager persistence: JSON files in `./metastats/`, merged on run end via `onRunEnd` callback
- [x] **6.4.4** Stats overlay UI: accessible from main menu "Stats" button, shows all lifetime stats

### Part 5: Card System (redesigned v1.2.0)
- [x] **6.5.1** `CardDefinitions.ts`: 30 cards - 15 stat (common-legendary), 10 build-defining, 5 curses
- [x] **6.5.2** Card protocol: `CARD_OFFER` (3 cards), `CARD_PICK`, `CARD_APPLIED` messages
- [x] **6.5.3** `CardSystem`: weighted random selection, at most 1 curse per offer, 30s auto-pick timeout
- [x] **6.5.4** Stat cards: damage, HP, speed, crit chance, crit damage, defense, regen, stamina, dodge
- [x] **6.5.5** Build-defining cards: Vampiric Bite (lifesteal), Last Stand, Pack Hunter, Bounty Hunter, Building Regen, Rapid Strikes (hold-attack), Magnetic Fur, Second Wind, Alchemist's Pouch, Explosive Touch
- [x] **6.5.6** Curse cards: Fragile Bones (-HP), Heavy Paws (-speed), Dulled Claws (-damage), Enemy Rage (+enemy dmg), Thick Fog (+enemy speed)
- [x] **6.5.7** CardPickerOverlay: 3-panel selection UI with category colors, rarity borders, curse warnings
- [x] **6.5.8** `requiresMultiplayer` flag: co-op cards (Pack Hunter) filtered when playing solo

### Part 6: Achievement System (v1.2.0)
- [x] **6.6.1** 10 stat buff achievements: First Blood, Veteran, Slayer, Gatherer, Architect, Survivor, Enduring, Ironclad, Speed Demon, Critical Eye
- [x] **6.6.2** 4 building unlock achievements: Siege Master (portals), Beast Tamer (wolves), Enchanter (abilities), Warden (walls)
- [x] **6.6.3** 4 class unlock milestones: Templar, Slayer, Shadow Hunter, Windwalker
- [x] **6.6.4** 6 new MetaStats tracking fields: damageTaken, criticalHits, portalsDestroyed, wolvesSummoned, abilitiesUsed, wallsBuilt
- [x] **6.6.5** Achievement-locked buildings: Siege Workshop, Kennel, Arcane Tower (removed in v1.3.2), Watchtower (now active)
- [x] **6.6.6** Build menu gating: locked buildings show grayed out with achievement requirement tooltip

**Exit criteria**: Difficulty ramps each wave. 5 enemy types with distinct behavior. 30 cards with stat/playstyle/curse mechanics. 18 achievements with permanent buffs, class unlocks, and building unlocks.

---

## Phase 6.5 - Factions, Loot Tables & Balance Pass
> Goal: activate enemy factions, per-variant loot, and balance fixes before Phase 7.

- [x] **6.5.1** Wave-based enemy factions: bandits (W1+), undead (W5+), corrupted (W9+); each portal assigned a faction; different factions fight each other
- [x] **6.5.2** Faction-biased variant weights: undead favor ghosts/giants, corrupted favor assassins/rangers
- [x] **6.5.3** Faction visuals: color tints per faction (bandits red, undead green, corrupted purple), intro toast messages
- [x] **6.5.4** Per-variant loot tables: melee (wood/stone), ranger (iron), ghost (diamond/gold), giant (guaranteed large drops), assassin (gold-heavy)
- [x] **6.5.5** Balance pass: guard spawn interval 30-15s, guard HP 50-80, guard damage 8-12; cannon AOE [100,200,400]-[80,120,180], cannon damage 25-20; ranger HP 30-35, ranged damage 8-12, ranged cooldown 2.0-1.5s, speed 60-70
- [x] **6.5.6** Tests: faction schedule, faction variant weights, loot table validation (37 total tests)

**Exit criteria**: Multiple factions appear in later waves and fight each other. Variant-specific loot drops. Guards viable, cannons balanced, rangers threatening.

---

## Phase 7 - Class System & Skill Trees (complete)
> Goal: class-based combat identity with skill progression and milestone unlocks.

### Part 1: Class Definitions & Lobby Selection (Sub-Phase 7A)
- [x] **7.1** 3 base classes: Warrior (sword, 120 HP, 180 speed, 2 defense), Ranger (bow, 80 HP, 220 speed), Mage (staff, 70 HP, 200 speed)
- [x] **7.2** Class selection UI in lobby (3 buttons with stat previews, visible to all players)
- [x] **7.3** `ClassComponent` + protocol changes: `CLASS_SELECT` message, class sent with join/create, stored per player
- [x] **7.4** Class-specific base stats applied on spawn (HP, speed, defense, stamina, damage)
- [x] **7.5** Remove dual weapon switching - single class weapon, attack type determined server-side by class
- [x] **7.6** Hotbar slot 0 shows class weapon name; slot 1 hidden (no second weapon)
- [x] **7.7** Save/load preserves player class (backwards-compatible, defaults to warrior)

### Part 2: Class-Specific Combat (Sub-Phase 7B)
- [x] **7.8** Homing projectile for Mage: tracks nearest enemy in 120 deg forward arc, turn rate ~4 rad/s, distinct purple visual
- [x] **7.9** Hotbar redesign: 6 slots (class weapon, 3 skill slots, healing potion, build hammer)

### Part 3: Skill Tree System (10-tier with combat mods)
- [x] **7.9** 5 specialization branches per class (15 branches total), 10 tiers per branch
- [x] **7.10** Skill points: +1 per wave cleared, spendable in skill tree overlay (K key)
- [x] **7.11** Passive skills: stat boosts (damage, speed, HP, defense, crit, dodge, attack speed, HP regen, cooldown reduction, flat damage, crit damage)
- [x] **7.12** Active abilities: tier-5 capstone per branch, assigned to skill hotbar slots (1/2/3), cooldown-based
- [x] **7.12.1** Combat modifiers: tiers 6-10 include combat-changing mechanics (burn lifesteal, explosive burn, frost shatter, electric stun, double range, aegis shield, blood arc, multi-shot, headshot explosion, toxic spread, etc.)
- [x] **7.12.2** Skill definitions split into per-class files: `skills/WarriorSkills.ts`, `skills/RangerSkills.ts`, `skills/MageSkills.ts`

#### Warrior Branches (3 active + 2 placeholder)
- **Berserker**: bloodlust stacks + Warcry Rage (T5: speed/DR/regen aura) + Titan's Reach (T10: double melee range)
- **Guardian**: thorns + Unbreakable Charge (T5: taunt/store/release AOE) + Aegis Shield (T10: hit-block shield)
- **Blood Knight**: armor break + Blood Drain (T5: AOE HP drain) + Blood Arc (T10: penetrating projectile)
- **Templar**: placeholder (unlocked via achievement)
- **Slayer**: placeholder (unlocked via achievement)

#### Ranger Branches (3 active + 2 placeholder)
- **Sharpshooter**: poison arrows + Sniper Shot (T5: 500% damage charged arrow) + Headshot (T10: 3x crit + AOE explosion)
- **Beastmaster**: wolf companion + Pack Call (T5: summon 3 wolves) + Alpha Predator (T10: invulnerable wolf)
- **Trapper**: poison tips + Explosive Barrage (T5: 5 explosive arrows) + Multi-Shot (T10: 3 arrows per attack)
- **Shadow Hunter**: placeholder (unlocked via achievement)
- **Windwalker**: placeholder (unlocked via achievement)

#### Mage Branches (3 active + 2 placeholder)
- **Fire Mage**: burn DOT + Meteor Shower (T5: 300px AOE) + Cataclysm (T10: explosive burn AOE)
- **Frost Mage**: slow on hit + Blizzard (T5: freeze + damage amp) + Frost Nova (T10: shatter shards)
- **Electric Mage**: chain bouncing + Thunderwave (T5: knockback + stun) + Paralysis (T10: stun on hit)
- **Earth Mage**: placeholder
- **Void Mage**: placeholder

### Part 4: Skill Tree UI
- [x] **7.13** Full-screen skill tree overlay (K key): 5 branch columns, 10 tiers, prerequisite lines, branch names header
- [x] **7.14** Node states: locked (grey), available (glowing), allocated (filled + colored), combat mod (special border)
- [x] **7.15** Ability cooldown display on hotbar skill slots (red overlay bar)
- [x] **7.15.1** Ability slots footer: sticky at bottom, shows assigned abilities with key labels (1/2/3)
- [x] **7.15.2** Tooltip system: hover any node to see description, positioned to right of node

### Part 5: Milestone Class Unlocks
- [x] **7.16** Milestone framework: persistent `unlockedClasses` in MetaStats
- [x] **7.17** 4 placeholder subclasses unlocked by achievements: Templar (wave 15 warrior), Slayer (1000 kills warrior), Shadow Hunter (wave 10 ranger), Windwalker (wave 10 ranger)
- [x] **7.18** Lobby shows locked classes greyed out with unlock condition tooltip; server-side class gating

### Part 6: Save & Protocol Updates
- [x] **7.19** `SavedPlayer` gains `playerClass`, `skillPoints`, `allocatedSkills` (backwards-compatible, defaults to Warrior)
- [x] **7.20** Dodge roll: Space key, brief invincibility (0.2s), costs 25 stamina, 0.6s cooldown, semi-transparent visual, screen shake on damage, hit particles on impact
- [x] **7.21** Critical hits: 10% chance for 2x damage, yellow damage number with "!" suffix, screen shake on crit

---

## Phase 8 - Civilian System (complete)
> Goal: living village where cat civilians run production. Protecting them IS the game.

- [x] **8.1** Civilian entity: small cat NPCs with 30 unique names, warm orange rendering, name tags above head
- [x] **8.2** Worker AI: auto-assign nearest idle civilian to unoccupied production buildings, flee enemies toward campfire at 2x speed
- [x] **8.3** Production requires workers: buildings with WorkerSlot idle when no civilian is assigned; worker death pauses production
- [x] **8.4** Housing buildings: Cat House (2/3/4 cap, 3 upgrade levels), Dormitory (5/7/10 cap, 3 upgrade levels); campfire provides base 3 capacity
- [x] **8.5** Civilian spawning: 2 at game start, +2 every 60s (if housing allows), max 20 population
- [x] **8.6** Food/hunger system: civilians consume 1 food/60s from warehouse; hunger rises without food, starvation damage at 100
- [x] **8.7** Full save/restore: civilians serialized with position, name, hunger, state; WorkerSlot and Housing on buildings saved
- [x] **8.8** Civilian death: worker assignment cleared, name freed, population drops, reassignment triggers for remaining idle civilians
- [x] **8.9** Speech bubbles: contextual messages (fleeing: "Help!", hungry, idle: "I need a job...", working: "*purr*") with network sync

---

## Phase 9 - World Events & Day/Night (complete)
> Goal: dynamic world that changes between and during waves.

- [x] **9.1** Day/night cycle: visual tint, reduced vision at night, enemy buffs
- [x] **9.2** Wave modifiers: Swarm (2x enemies, 50% HP), Ironhide (+50% HP, +25% dmg), Fog (halved vision), Frenzy (+30% speed, +20% dmg) - 15% chance per wave from W3+, stacking up to 3 modifiers at W15+; displayed as colored tags in WaveHUD
- [x] **9.3** Event system (day modifiers): Meteor Shower (W5+, random AOE every second, 1.5s warning, 20 dmg), Earthquake (W7+, 3 buildings take 30 dmg + enemy stun every 30s), Solar Eclipse (W4+, 40% vision reduction + undead spawns for 150s), Surprise Attack (W5+, extra portals spawn throughout day) - 15% base chance at day start (W2+), roulette animation delay (3.5s)
- [x] **9.4** Resource boom (positive): 3x production multiplier for the whole day
- [x] **9.5** Portal surge (Surprise Attack): 3 extra portals at start + 1-3 more every 30s through the day
- [x] **9.5.1** Event roulette spinner: slot-machine animation at day start, larger UI (340px wide)
- [x] **9.6** Potion shop system: 4 craftable potions (Catnip Tea/heal, Quick Pounce Brew/speed, Tiger's Rage Elixir/damage, Iron Fur Tonic/shield); building-based shop with unlock/equip flow; integrates with card system (extra_potion_charge ability)
- [x] **9.7** Infinite scaling milestones: W25 corruption (random enemy buffs), W50 undying horde (15% resurrect), W75 final stand (3x portals, 2x HP), W100 apocalypse (1.5x damage, mega boss), W100+ infinite scaling every 10 waves

---

## Phase 9.5 - Content Overhaul (completed 2026-03-13)
> Goal: deeper gameplay systems - building ruins, curse cards, boss encounters, and character stats UI.

### Building Ruins
- [x] **9.5.1** Ruins system: destroyed buildings become burning ruins (30s burn, 120s total decay); can be repaired at 40% of build cost (level 1) or restored at 60% of total invested cost; ruins component with burnTimer + decayTimer
- [x] **9.5.2** Ruins rendering: burning overlay on client, ruins visual state synced via snapshot (isRuins, ruinsBurning flags)

### Curse Cards
- [x] **9.5.3** Curse card category: replaces old "trap" category; 17 curse cards with dual buff+debuff mechanics (e.g. Berserker's Curse: -20 HP, +25% damage); common through legendary rarities
- [x] **9.5.4** Card auto-grant: cards granted automatically on specific wave clears and boss kills; CARD_PICKUP message with category/description for toast display

### K-Key Tabbed Overlay
- [x] **9.5.5** Refactored SkillTreeOverlay into 3-tab system: Character | Skills | Cards
- [x] **9.5.6** Character tab: stats breakdown table (Base + Skills + Cards + Buffs = Total) for 8 stats (HP, Defense, Damage, Speed, Crit, Attack Speed, HP Regen, Stamina); special effects list; card abilities list; permanent buffs panel
- [x] **9.5.7** Skills tab: pure skill tree (5 branches, 5 tiers) with ability assignment bar (1/2/3 drag-and-drop)
- [x] **9.5.8** Cards tab: collected cards grouped by category (Buffs, Abilities, Curses, Resources) in grid layout with rarity borders

### Security & Performance
- [x] **9.5.9** XSS prevention: CardToast and WaveHUD rewritten to use DOM APIs (textContent) instead of innerHTML with unescaped server data
- [x] **9.5.10** BossSystem: replaced all setTimeout calls with tick-based DelayedAction queue; squared-distance optimizations; cleanup on reset prevents orphaned callbacks
- [x] **9.5.11** Bug fix: highestWaveSurvived now correctly reports last completed wave (currentWave - 1) instead of wave died on

---

## Phase 9.8 - Singleplayer & Infrastructure (v1.2.0, complete)
> Goal: fully offline singleplayer, performance optimizations, and developer tooling.

### Singleplayer
- [x] **9.8.1** Embedded local server: CJS-bundled server (`server.cjs`) extracted from asar to userData on first run
- [x] **9.8.2** Singleplayer button: works offline without remote server connection
- [x] **9.8.3** Singleplayer lobby: simplified (no invite code, no player list, class selection + start)
- [x] **9.8.4** Instant pause in singleplayer (no vote needed)
- [x] **9.8.5** Local saves: stored in `%AppData%/purrmadeath/saves/`, persist across sessions

### Performance
- [x] **9.8.6** Spatial hash for spike traps (O(1) lookup instead of O(E) per trap)
- [x] **9.8.7** Spatial hash for laser beam targeting (replaces full entity query)
- [x] **9.8.8** Laser beam broadcast throttled to 10 Hz (was 30 Hz per tower)
- [x] **9.8.9** Ghost visibility: pre-cached light reveal + player positions per tick
- [x] **9.8.10** Heal aura: cached ally list (20 entities) instead of full entity query (100+)
- [x] **9.8.11** Rate limiting: skipped for localhost, 500 msg/s for remote, rate monitoring logged every 30s

### Developer Tooling
- [x] **9.8.12** Server-side GameLogger: timestamped log files per session (ability, damage, buff, wave, save events)
- [x] **9.8.13** Client-side logging: production builds log startup/connection flow to `%AppData%/purrmadeath/logs/`
- [x] **9.8.14** Debug console: 3-column stats (Core, Server, Game), `/all` view, `/help` commands
- [x] **9.8.15** Ability debug logging: params, hit counts, damage totals logged on every ability use

---

## Phase 10 - Exploration & World Content
> Goal: the procedural world rewards exploration with unique content.

- [x] **10.2** POIs: 4 types with deterministic chunk-based generation (separate seed from resources):
 - Abandoned Camp: loot resources on E-key interact (60px radius)
 - Shrine: temporary buff (speed, damage, defense, regen) with duration timer; blessings HUD shows active buffs with countdown (top-right corner)
 - Enemy Nest: proximity-triggered mini-wave (150px radius), loot on clear
 - Treasure Chest: rare resource drops on E-key interact (60px radius)
 - Diamond-shaped rendering with pulsing glow when unconsumed, biome-weighted spawn tables
 - Chunk load/unload lifecycle (same as resource nodes), POI loot tables in `shared/data/LootTables.ts`
- [ ] **10.3** Biome hazards: desert heat, snow slow, swamp poison
- [ ] **10.4** Dungeon system: cave entrances, procedural rooms, mini-boss, legendary loot
- [ ] **10.5** World ruins: pre-built partially destroyed structures, repairable for free buildings
- [x] **10.6** Class sprites: pixel art character rendering replacing colored circles. Idle PNG + walking GIF animation per class (ImageDecoder frame extraction). Ranger sprite implemented with lobby icon + in-game sprite.
- [x] **10.7** UI theme overhaul: purple color scheme (was red), custom crosshair, logo on main menu and app icon, exit button, settings disabled placeholder

---

## Phase 11 - Economy & Trade
> Goal: gold economy, merchant NPCs, and resource management depth.

- [ ] **11.1** Gold drops from enemies (scaling with wave)
- [ ] **11.2** Bounty system: optional objectives during waves for gold/resources
- [ ] **11.3** Merchant NPC: spawns between waves, sells weapons/armor/consumables for gold
- [ ] **11.4** Market building: resource conversion
- [ ] **11.5** Brewery building: produces buff potions from food

---

## Phase 12 - Advanced Buildings & Defense (mostly complete)
> Goal: deep base building with 20+ building types.

- [x] **12.1** Building size system overhaul: per-building w/h dimensions, rotation support for non-square buildings (R key), updated footprint collision and tile walkability
- [x] **12.2** Gate building (3x1, rotatable): auto-opens for friendlies (players/civilians/guards), blocks enemies; faction-aware collision in both server and client MovementSystem
- [x] **12.3** Ballista defense tower: piercing projectiles that hit all enemies in a line, 1x1, 3 upgrade levels (cooldown/damage scaling)
- [x] **12.4** Laser tower: continuous beam DPS (no projectile), target acquisition/validation each tick, 3 upgrade levels (DPS/range scaling), beam rendering with glow effect
- [x] **12.5** Workshop building: 2x2 production building with civilian worker, produces "weapons" resource stored in warehouse, 3 upgrade levels (production interval)
- [x] ~~**12.6** Training center (replaced by Guard House in v1.3.2)~~
- [x] **12.6b** Guard House (replaces Training Center + Kennel): trains guards with random role assignment, costs 1 civilian + food + steel + gold; no role selection - role is randomized on train
- [x] **12.7** Campfire civilian rework: per-level housing capacity [2,4,6,8,10], spawns 2 civilians on campfire level-up (wave clear), alongside natural growth every 3 waves
- [x] **12.8** Tesla Coil AOE rework: hits all enemies in range (not just nearest), secondary chain arcs spread from hit targets, jagged lightning bolt VFX with glow and impact sparks
- [x] **12.9** Repair Station: worker-based building repair (civilian assigned, consumes wood/stone from warehouse)
- [x] **12.10** Teleporter Pads: place two, press E to teleport between them
- [x] **12.11** Flame Tower: cone AOE fire damage with auto-rotate to nearest enemy
- [x] **12.12** Catapult: long-range AOE siege weapon, targets portals/buildings
- [x] **12.13** Moat: indestructible 999 HP trench, slows enemies by 50%
- [x] ~~**12.14** Siege Workshop, Kennel, Arcane Tower (removed in v1.3.2 building rework)~~
- [x] **12.14b** Watchtower: extends campfire building range by 20 tiles per level
- [x] **12.15** Building move visual: building hidden from original position during move mode (client-side only)
- [x] **12.15b** Smeltery rework: production building that consumes wood + iron to produce steel (new refined resource)
- [x] **12.15c** Market rework: daily card shop building - offers 3 random cards per wave, player can buy 1 with gold, limited to 1 Market per game
- [x] **12.15d** Steel resource: new refined resource produced by Smeltery, required by Laser Tower, Tesla Coil, Flame Tower, and Guard House
- [ ] **12.16** Purifier (clears corruption), Library (tech tree research)

---

## Phase 13 - Boss Encounters (complete)
> Goal: epic boss fights every 5 waves with multi-phase mechanics.

- [x] **13.1** Boss framework: BossComponent with phaseIndex, per-ability cooldowns, tick-based delayed actions (no setTimeout); BossSystem with squared-distance optimizations and helper functions (damagePlayersInRadius, knockbackPlayersInRadius)
- [x] **13.2** 8 unique bosses across 8 waves: Ravager (W5, charge + ground slam), Necromancer (W10, summon + death bolt + bone shield), Shadow Lord (W15, teleport + clones + shadow wave), Broodmother (W20, burrow + web shot), Infernal (W25, fire trail + meteor rain + inferno burst), Frost Warden (W30, frost aura + ice spike + blizzard), Plague Bearer (W35, plague spit + pandemic), Ancient Golem (W40, earthquake stomp + rock throw + shatter)
- [x] **13.3** Phase system: bosses transition through 2-3 phases at HP thresholds (66%/33%); each phase unlocks new abilities; phase banner broadcast to clients with camera shake
- [x] **13.4** Boss HP bar: top-center UI element, color changes at 50%/25% thresholds, auto-hides on death; boss intro banner with description and max HP
- [x] **13.5** Boss loot tables: per-boss card pools with rarity filters (rare+, epic+, legendary), bonus resource drops, special on-kill effects (speed buff, cleanse); boss-specific loot in CardDropTables
- [x] **13.6** Double bosses from W30+; Ancient Golem 20% rare spawn chance on W25+
- [x] **13.7** Boss protocol: BOSS_INTRO (name, description, maxHp), BOSS_PHASE (phaseIndex, bannerText) messages

---

## Phase 14 - Meta Progression & Social
> Goal: long-term player investment across runs.

- [x] **14.1** Progression system: 18 achievements in 3 categories (stat buffs, class unlocks, building unlocks) with medal tiers; permanent stat buffs persist across runs
- [x] **14.2** Meta stats tracking: lifetime damage, resources, kills by type, waves survived, highest wave, time played, buildings built, total runs; per-run stat merging with highestWaveSurvived tracking
- [ ] **14.3** Star Shards: earned per run (waves x kills x civilians alive)
- [ ] **14.4** Unlock tree: Buildings, Weapons, Cards, Breeds, Civilians, Cosmetics
- [ ] **14.5** Ping system, quick chat/emotes, build blueprints
- [ ] **14.6** Spectator mode, reconnection summary, run leaderboard
- [ ] **14.7** Mutators: Hard mode, Pacifist, Speed run

---

## Phase 15 - Polish, Audio & Cosmetics
> Goal: ship-worthy quality.

- [~] **15.1** Sound system: spatial audio, biome ambient, combat SFX, cat sounds
 - [x] **15.1.1** Ambient audio system: civilians meow when speaking (speech bubble trigger, distance-based volume, overlap allowed)
 - [x] **15.1.2** Audio asset pipeline: `src/renderer/src/assets/audio/sfx/` directory with Vite URL imports
- [ ] **15.2** Music: adaptive layers based on combat intensity
- [ ] **15.3** Particle effects: hit sparks, death effects, building dust
- [ ] **15.4** Screen shake, trail effects, weather visuals
- [ ] **15.5** Character customization: hat/accessory slot (cosmetic)
- [ ] **15.6** Settings screen: key rebind, volume, accessibility
- [ ] **15.7** Death recap, modding support

---

## Bug Fixes & Patches (v1.3.0 - v1.3.2)

- [x] Fix: campfire not required on save load (campfirePlaced defaulted to true for saves without campfire)
- [x] Fix: warehouse upgrade not broadcasting inventory limit changes (missing broadcastWarehouseUpdate call)
- [x] Fix: blessings HUD added showing active shrine buffs with countdown timers (top-right corner)
- [x] Fix: watchtower build range extension working correctly with campfire range system
- [x] Rework: building system overhaul - removed Training Center, Kennel, Siege Workshop, Arcane Tower; added Guard House, reworked Smeltery and Market; added steel resource

---

## Online Infrastructure (partially complete)

- [x] **Inf.1** Dedicated server: EC2 t3.micro (eu-west-2) via systemd
- [x] **Inf.2** Session discovery: 4-letter codes, auto-connect on launch
- [x] **Inf.3** Version gating, bandwidth optimization, anti-cheat foundations
- [x] **Inf.4** Server-side persistence: saves + meta stats as JSON on disk
- [ ] **Inf.5** Area of Interest: only send entity updates within player viewport
- [ ] **Inf.6** Entity pooling, pathfinding budget, worker threads (if needed)

---

## Phase 16 - Mobile Port
> Goal: bring Purrmadeath to iOS and Android via Capacitor.

- [ ] **16.1** Capacitor integration: wrap existing web app in native iOS/Android shell (replace Electron for mobile builds)
- [ ] **16.2** Touch controls: virtual joystick for movement, touch buttons for attack/abilities/interact, tap-to-place for build mode
- [ ] **16.3** Responsive UI: scale HUD, overlays, and menus for smaller screens (portrait + landscape)
- [ ] **16.4** Multiplayer-only initially: connect to remote server (no embedded local server on mobile)
- [ ] **16.5** Performance tuning: mobile GPU optimizations, reduced particle/entity counts, lower-res tile textures
- [ ] **16.6** Mobile singleplayer: Web Worker-based server or cloud-hosted personal server instances
- [ ] **16.7** App store builds: Xcode (iOS) + Android Studio (Android) build pipelines, signing, store listings

---

## Design Reference - Core Systems

> Locked design decisions. Update this section when a system is redefined, not when it is implemented.

### Inventory & Hotbar
| Slot | Type | Notes |
|---|---|---|
| **1** | Class weapon | Warrior=Sword, Ranger=Bow, Mage=Staff - determined by class, not swappable |
| **2-4** | Skill abilities | Unlocked via skill tree (tier-5 capstone per branch); activated with 1/2/3 |
| **5** | Healing potion | Locked type; limited supply per wave; replenished by challenges / abilities / buildings |
| **6** | Build hammer | Locked; toggles build mode |

- **Class determines weapon**: no weapon switching - each class has exactly one attack type
- **Skill tree** (`K` key): 5 specialization branches per class, 10 tiers each; spend 1 skill point per wave cleared

### Wave Flow
1. **3-minute prep** before Wave 1; **1-minute prep** between all subsequent waves
2. Portals spawn randomly around players/buildings - never in player line-of-sight, never inside base footprint
3. Portals continuously emit enemies every X seconds (interval shrinks each wave)
4. Portal count and HP both scale up per wave
5. **Wave ends only when every portal is destroyed** (not timer-based)

### Base Anchor
- A **Campfire** is pre-placed at the player spawn point - the run's base anchor
- Enemies prioritise attacking it; if the Campfire is destroyed, the run ends immediately
- Players build outward from it; no building-zone restriction, but enemies always path toward it

### Resource Flow
- Players gather raw resources by hitting world objects (trees - Wood, stone deposits - Stone, iron veins - Iron, diamond deposits - Diamond)
- Enemy kills also drop resources and loot (drop tables per enemy type)
- Resources are deposited into the **Warehouse** building (shared party pool)
- All building placement costs are drawn automatically from the Warehouse
- Production buildings generate resources over time: Lumbermill (wood), Quarry (stone), Mine (iron + diamond), Farm (food)

### Card System
- Every 3 waves: shown **3 random card choices** (weighted by rarity), pick 1
- Cards grant buffs (damage, speed, HP, regen), abilities (ghost sight), resources, or curses (debuffs affecting all players)
- 30-second auto-pick timeout (first non-curse card)
- Card effects persist for the entire run

---

## Architecture Reference

```
server/                  Game server (Node.js + ws)
  core/
    GameSession.ts         Session logic, tick loop, combat, waves
    GameLogger.ts          Persistent file-based session logging
    SessionManager.ts      Session management, reconnection, save persistence
  systems/               ECS systems (combat, enemies, movement, projectiles)
  abilities/             Ability execution (AbilityExecutor.ts)
  net/                   WebSocket server, IP tracking, connection limits
  server.ts              Server entry point

shared/                  Shared between client and server
  components/            ECS component definitions
  definitions/           Data definitions (skills, enemies, cards, achievements)
    skills/              Per-class skill trees (WarriorSkills, RangerSkills, MageSkills)
  ecs/                   Core ECS (World, Entity) - isomorphic
  world/                 Tile registry, world generation
  constants.ts           Game balance, version, building costs
  protocol.ts            Network message types (60+ message types)
  SaveFormat.ts          Save file data structures

src/
  main/                  Electron main process (window, embedded server, auto-updater)
  preload/               Preload script (IPC bridge)
  renderer/src/          Client (Pixi.js)
    game.ts                Main game loop, network handlers
    input/                 Input manager, keybindings
    net/                   WebSocket client, reconciler, message handlers
    render/                Tile renderer, build ghost, camera
    systems/               Rendering systems (players, projectiles, VFX, build mode)
    ui/                    HUD, overlays (build menu, skill tree, civilian panel, debug)

.github/workflows/
  release.yml            CI/CD: build - publish - deploy on tag push
```

### Key Design Principles
1. **Server is always truth** - clients predict locally, server corrects
2. **ECS everywhere** - every game object is just an entity + components; systems are stateless functions
3. **Shared types** - `shared/protocol.ts` and `shared/components/` enforce message contracts between client and server at compile time
4. **Chunk authority** - server owns all chunk data; clients request chunks as they move
5. **Never trust the client** - all damage, building, pickup, and item actions validated server-side before applying

---

## Infrastructure & Release (completed 2026-03-03)

- [x] **Inf.1** AWS EC2 server (t3.micro, eu-west-2) with Elastic IP - game server runs via systemd
- [x] **Inf.2** Auto-connect on startup - client connects to production server immediately, no manual IP entry
- [x] **Inf.3** Version gating - `GAME_VERSION` handshake rejects mismatched clients
- [x] **Inf.4** Electron auto-updater - `electron-updater` checks GitHub Releases on launch; downloads in background; in-game banner prompts user to install & restart
- [x] **Inf.5** GitHub Actions release workflow - push `vX.X.X` tag - builds Windows installer - publishes GitHub Release - deploys server to EC2 automatically
- [x] **Inf.6** Version label - `vX.X.X` shown bottom-right of main menu
- [x] **Inf.7** Game over fixes - "Back to Menu" button clickable; ESC and movement blocked during game over screen
- [x] **Inf.8** Debug console upgrade - HTML-based overlay (F4 toggle) with typed commands: `/core`, `/net`, `/server`, `/all`, `/logs`, `/spawn`, `/skipwave`, `/pausewave`, `/help`, `/clear`; replaces old Pixi.js Graphics debug panel
- [x] **Inf.9** In-game chat overlay - Enter to open, Enter to send, Escape to cancel; fade-out message feed at bottom-left; player name colored by slot; blocks movement/attack while typing
- [x] **Inf.10** AWS CLI scripts - `npm run aws:start`, `aws:stop`, `aws:status` for quick EC2 instance management

---

## v1.0.9 - Multiplayer Playtest Fixes (2026-03-18)

- [x] Fix player names not persisting in multiplayer (restore from localStorage on reconnect/menu return)
- [x] Fix ESC pause banner not disappearing when all votes withdrawn (broadcast at 0 votes)
- [x] Reduce meteor shower duration from 999s to 30s
- [x] Fix wave modifier crash (null check in computeModifierAggregate)
- [x] Inventory full notification now shows which resource is full
- [x] Civilian panel now refreshes live (1s polling while open)
- [x] RMB building selection - removed "Select Building" button, RMB selects buildings for upgrade/repair/demolish
- [x] Manual warehouse deposit - press E near warehouse to store resources (removed auto-deposit)
- [x] Warehouse HUD only visible in build mode; inventory HUD always visible
- [x] Keybind tutorial panel below wave timer (right side HUD)
- [x] Civilians now spawn on timer (2 every 60s) instead of per-wave
- [x] Training center failure now shows notification toast (e.g. "No idle civilians")
- [x] Removed storage shed building (redundant with warehouse)
- [x] Building exclusion zones - campfire has 5x5 no-build zone
- [x] Interaction prompt "Press E to store resources" shown near warehouse

- [x] Fix turrets (tesla coils, flame towers, laser beams) leaving enemies alive at 0 HP - added death processing and destroyDeadEntities calls
- [x] Fix floating point damage in flame towers and laser beams - round damage to integers
- [x] Updated skill tree tests for 10-tier branches (was still testing 5-tier)
- [x] Laser tower beam VFX - red beam line with glow from tower to target, pulsing alpha
- [x] Smite chain combat mod VFX - reuses tesla chain lightning bolt visuals for chain damage arcs

- [x] Catapult reworked to AOE mortar - prioritizes portals, then targets densest enemy cluster, deals splash damage on impact
- [x] Flame tower range increased from 60 to 100 (upgrade tiers: 100/120/140)
- [x] /pause chat command - host-only, toggles day timer pause with server announcement
- [x] Projectile bouncing - bouncing projectiles redirect to nearest un-hit enemy within range after hitting, used by electric mage chain bolts
- [x] Mage combat modifiers implemented: burn_lifesteal (fire T9), frost_crit (frost T8), frost_shatter (frost T10), explosive_burn (fire T10), electric_stun (electric T10), dodgeChance (fire T6)

---

## v1.2.0 - Cards, Achievements & Singleplayer (2026-03-20)

- [x] 30-card system redesign (15 stat, 10 build-defining, 5 curses)
- [x] 18 achievements with permanent buffs, building unlocks, class unlocks
- [x] 4 achievement-locked buildings: Siege Workshop, Kennel, Arcane Tower, Watchtower
- [x] Fully offline singleplayer with embedded local server (CJS bundled)
- [x] Spatial hash performance optimizations (spike traps, laser beams, ghost visibility)
- [x] Server-side GameLogger and client-side logging
- [x] Rate limiting (500 msg/s remote, unlimited localhost)
- [x] Heartbeat timeout: 120s (disabled for localhost)

---

## v1.2.1 - New Cards & Achievements (2026-03-24)

- [x] Additional cards and achievements
- [x] Laevatain-themed dark UI (crimson red accent, violet-purple borders)
- [x] Wave countdown, enemy wave preview banner, resource gain popups, low HP vignette
- [x] Auto-assign idle civilians
- [x] Campfire waypoint indicator
- [x] Top-center inventory accordion (open by default)
- [x] Civilian management panel (two-column layout)
- [x] Projectile color cycling based on elemental skills

---

## v1.2.2 - Building System & Day/Night Improvements (2026-03-25)

- [x] Campfire building range system: player-placed campfire (free cost), 80-tile square building range, watchtowers extend range by 20 tiles per level
- [x] Portals now spawn outside the campfire building range (prevents in-base portal spawns)
- [x] BUILD_RANGE_UPDATE protocol message: broadcasts campfire position, range, and watchtower bonuses
- [x] BuildGhostRenderer updated to show building range boundary
- [x] Death before campfire placement = permanent death

---

## v1.2.3 - Wave Milestones & Day Modifiers (2026-03-26)

- [x] Wave milestone system (WaveMilestones.ts): permanent cumulative scaling at W25/W50/W75/W100, plus infinite scaling every 10 waves past W100
 - W25 Corruption: enemies gain random buffs (speed +30%, regen, damage aura +20%, or shield +25% HP)
 - W50 Undying Horde: 15% chance enemies resurrect 3s after death
 - W75 Final Stand: 3x portal multiplier, 2x enemy HP
 - W100 Apocalypse: 1.5x enemy damage
 - W100+ Infinite Scaling: portal count, HP, and damage scale every 10 waves
- [x] Day modifiers revamp: events now roll at day start (W2+) with 15% base chance, roulette animation, duration-based effects with vision/production/tint multipliers
- [x] Building relocation: BUILD_MOVE message allows moving buildings within the build range
- [x] Wave modifiers rebalanced: 15% roll chance (was 25%), displayed as colored tags in WaveHUD

---

## v1.2.4 - Resource Respawning, POIs & Performance (2026-03-27)

- [x] Resource node respawning: destroyed nodes respawn after 120-150s (if position is valid - no building, no solid tile, outside build range)
- [x] Resource node chunk lifecycle: load/unload system removes global 1500 cap, entities bounded by player proximity (load radius 2, unload radius 4)
- [x] Points of Interest (POIs): 4 types spawning in the world via deterministic chunk generation
 - Abandoned Camp: E-key to loot resources (wood, stone, iron, food)
 - Ancient Shrine: E-key for temporary buff (speed, damage, regen, or defense for 120s)
 - Enemy Nest: proximity-triggered mini-wave (4-8 enemies), loot drops on clear
 - Treasure Chest: E-key for rare resources (diamond, gold, iron)
- [x] POI rendering: diamond shapes with per-type colors, pulsing glow when unconsumed, grayed out when used
- [x] POI save/load: entities, cache, and processed chunks all persist across saves
- [x] EnemySystem performance fix: spatial hash for resource/portal collision checks (was O(N*M) with 1500+ resources)
- [x] Comprehensive debug logging: entity breakdowns, resource node lifecycle, wave spawn breakdowns, EnemySystem perf stats

---

*Last updated: v1.2.4 (2026-03-27)*
