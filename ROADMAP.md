# Purrmadeath v1 Roadmap

## What v1 is

A 2D co-op roguelike (up to 4 players) with base building, procedural world,
3 classes with 3 active subclasses each, 8 unique bosses, 30 cards, 18
achievements, and live multiplayer (LAN + cloud EC2). Shipped as a Windows
Electron desktop app with auto-updater and EC2 deployment.

## Current state

v1.4.0 is shipped (2026-05-18) with the full Phase 1-9 feature set: world
gen, 4 POI types, 3x3 active subclasses with 10-tier skill trees, 14 defense
buildings, 6 production buildings, 8 bosses (W5-W40), 30 cards, 18
achievements, singleplayer + online multiplayer via invite codes, F4 debug
console, electron-updater. CI gates lint + typecheck + Vitest + npm audit.
Server tests cover pathfinding / combat / enemy AI; client rendering has no
tests. Distribution is Windows-only.

## v1 acceptance criteria

- [x] Procedural world + 4 POI types
- [x] 3 classes x 3 active subclasses (10-tier skill trees)
- [x] 14 defense / 6 production / 1 military / 1 housing / 5 utility / 2 shop buildings
- [x] 8 bosses every 5 waves (W5-W40), multi-phase mechanics
- [x] 30 cards (15 buffs, 10 abilities, 5 curses), 18 achievements
- [x] Singleplayer + online multiplayer (LAN + EC2 cloud, invite codes)
- [x] Civilian system, blessing/potion shops, campfire respawn
- [x] F4 debug console, session logging
- [x] Auto-updater (electron-updater + GitHub Releases + `.blockmap`)
- [x] CI gates: lint, tsc, Vitest, npm audit; release workflow building NSIS + deploying to EC2
- [x] SecureCheck reusable workflow wired
- [x] Server-side Vitest suite (pathfinding, combat, enemy AI)
- [ ] Audio layer beyond ambient meows (combat SFX + music layers per biome/wave)
- [ ] Client-side render tests (snapshot or visual regression at minimum)
- [ ] Documented manual smoke checklist for each release
- [ ] v1.0.0 retroactive marker — v1.4.0 is the de facto v1, but a `v1.0.0` ROADMAP-acceptance moment helps future planning

## Milestones to v1 (retro-cut + remaining polish)

Note: this product is already past 1.0 functionally. "v1 acceptance" here
means closing the polish items still tracked as gaps.

### M1. Audio layer (M)

- [ ] Combat SFX (hit, kill, taking damage, building destroyed)
- [ ] Music layers per biome and per wave intensity
- [ ] Volume sliders (master / SFX / music) in settings
- [ ] Audio gated behind preference (some players want only meows)

**Acceptance:** every action that the player intends produces an audible response; music ramps with wave intensity.

### M2. Client render tests (S/M)

- [ ] Snapshot tests for the main HUD, defense building placement, and combat UI
- [ ] Capture screenshots in CI for visual diff review

**Acceptance:** UI regressions break the build before they ship.

### M3. Release smoke checklist (S)

- [ ] Document a 15-minute smoke matrix: install fresh NSIS, run tutorial wave, host invite code, join from a second box, beat first boss, hit pause + resume, trigger auto-update
- [ ] Add the checklist to `docs/release-smoke.md`
- [ ] Reference it from `release.yml`

**Acceptance:** every release tag is preceded by a written attestation that the matrix passed.

### M4. Tag a v1.5.0 with the polish (S)

- [ ] Roll audio + render tests into a coherent release
- [ ] CHANGELOG entry summarizing the gap closure
- [ ] Publish

**Acceptance:** the product hits an "audio-complete, regression-tested" milestone marker.

## Beyond v1 (already documented as Phase 10-16)

- Biome hazards (toxic mist, blizzards)
- Dungeons + world ruins
- Gold bounties, merchant NPC
- Purifier and Library buildings
- Star shards + cosmetics
- macOS + Linux builds
- Multi-region server failover
- Mobile port (Capacitor)

## Out of scope for v1

- Anti-cheat behavioural monitoring (server-side validation only stays the baseline)
- PvP modes (co-op is the design)
