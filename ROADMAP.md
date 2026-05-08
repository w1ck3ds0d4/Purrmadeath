# ROADMAP - Purrmadeath

This roadmap covers what is shipped today (v1.3.2) and what is planned. The full historical task list lives in commit history and in the `## Phase X` style task lists that previously occupied this file. Phases that are fully complete are summarized here rather than re-listed.

## Shipped (highlights)

- Phase 0 to 9.8: foundation, world, multiplayer (LAN + online), combat, base building, roguelike systems, factions, classes/skill trees, civilians, day/night, world events, singleplayer with embedded local server.
- Phase 9.5: building ruins, curse cards, K-key tabbed overlay (Character / Skills / Cards), boss tick-based scheduling, XSS hardening on toasts and HUD.
- Phase 13: 8 unique bosses across W5 to W40 with multi-phase HP-threshold logic and per-boss loot.
- Phase 12 (mostly complete): expanded building roster (Gate, Ballista, Laser Tower, Workshop, Guard House, Tesla Coil, Repair Station, Teleporter Pads, Flame Tower, Catapult, Moat, Watchtower, Smeltery, Market) plus the new `steel` resource.
- POIs (Phase 10.2): Abandoned Camp, Shrine, Enemy Nest, Treasure Chest with chunk-based deterministic generation.
- v1.3.x patches: campfire-on-load fix, warehouse upgrade broadcast fix, blessings HUD, watchtower range integration, Training Center / Kennel / Siege Workshop / Arcane Tower removed in favor of Guard House and reworked Smeltery / Market.

## In Progress

- **Phase 15.1 Audio**: ambient civilian meows landed (`src/renderer/src/assets/audio/sfx/`), but combat SFX, biome ambience, and music layers are not built.

## Not Started or Partial

The following were enumerated as future work in prior planning notes and remain unimplemented in code.

### Phase 10 - Exploration & World Content
- Biome hazards (desert heat, snow slow, swamp poison).
- Dungeon system: cave entrances, procedural rooms, mini-bosses, legendary loot.
- World ruins: pre-built partially destroyed structures, repairable into free buildings.

### Phase 11 - Economy & Trade
- Gold drops scaling with wave.
- Bounty objectives during waves.
- Merchant NPC between waves.
- Resource conversion / brewery production buildings (the current Smeltery covers steel, but a generic resource market is not built).

### Phase 12 - Advanced Buildings
- Purifier (clears corruption).
- Library (tech tree research).

### Phase 14 - Meta Progression & Social
- Star Shards run currency.
- Unlock tree (Buildings, Weapons, Cards, Breeds, Civilians, Cosmetics).
- Ping system, quick chat, emotes, build blueprints.
- Spectator mode, reconnection summary, run leaderboard.
- Mutators: Hard mode, Pacifist, Speed run.

### Phase 15 - Polish, Audio, Cosmetics
- Adaptive music layers based on combat intensity.
- Particle effects: hit sparks, death effects, building dust.
- Screen shake systemization, trail effects, weather visuals.
- Character customization: hat / accessory cosmetic slot.
- Settings screen: key rebind, volume sliders, accessibility.
- Death recap, modding support.

### Phase 16 - Mobile Port
- Capacitor wrapping for iOS / Android (currently Electron-only).
- Touch controls, responsive UI scaling.
- Mobile multiplayer-only at first; later, Web Worker or cloud singleplayer.
- App store build pipelines (Xcode, Android Studio).

### Online Infrastructure
- Area-of-Interest filtering (only send entity updates within viewport). Today every client receives the full world delta.
- Entity pooling, pathfinding budget, worker threads for heavy systems.
- Beyond the existing UUID identity, no account system, friend list, or party invites.

## Known Gaps and Caveats

- **Single platform**: only Windows installer is built (`electron-builder --win`). macOS and Linux targets are not configured in `package.json`.
- **Single online region**: one EC2 `t3.micro` in `eu-west-2`. No regional failover or load balancing.
- **No anti-cheat beyond server validation**: server validates damage, position tolerance, and downed-state guards, but there is no behavioral anti-cheat or reporting flow.
- **Saves are not encrypted**: local saves in `%AppData%/purrmadeath/saves/` are plain JSON with schema validation only.
- **Achievements are server-trusted**: meta stats persist server-side in production but locally in singleplayer; tampering with local JSON is possible.
- **No telemetry or crash reporting**: `GameLogger` writes locally; nothing is shipped off-device.

## Out of Scope

- Mod marketplace, user-generated content, paid DLC.
- Ranked / competitive play. Purrmadeath is co-op vs world.
- Cross-progression with mobile until Phase 16 lands.
