# Changelog

All notable changes to Purrmadeath are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.0] - 2026-05-18

### Added

- **MarketOverlay**: new in-game market UI for trading resources between
  the player and town civilians.
- **TrainingCenterOverlay**: substantial rework around class skill
  trees. Tier-5 nodes drop active abilities (Warrior Berserker:
  Warcry Rage, Warrior Guardian: Unbreakable Charge, etc.). Tier 7,
  9, 10 unlock combat modifiers (frost shatter, chain lightning,
  toxic spread).

### Changed

- Cross-faction enemy combat removed: enemies of any faction now
  ignore each other. Only guards and player projectiles damage
  enemies. Simpler, predictable AI behavior; clears up a long-running
  bug where two factions could fight to mutual annihilation before
  the player engaged.
- Server-side rework in `GameSession`, `SessionManager`, `CombatSystem`,
  `EnemySystem`, `RespawnManager`, `BuildingContext`.
- Renderer changes in `TileRenderer`, `PlayerRendererSystem`,
  `ResourceHUD`, `BuildMenuOverlay`, `LobbyOverlay`, `PotionShopOverlay`.

### Fixed

- 4 ESLint errors (`no-useless-assignment` in `AbilityExecutor`,
  `no-undef` on `NodeJS.ErrnoException` in `ServerSocket`,
  `no-non-null-asserted-optional-chain` in `PlayerRendererSystem`).
- 22 stale or flake test failures resolved (#44):
  - Pathfinding test isolation now resets the module-level walkability
    cache between runs - it used to leak `true` results across tests
    that swapped mock generators.
  - SessionManager / ServerSocket tests bind to OS-assigned ports
    (`new ServerSocket(0)` + readback) to dodge Windows excluded port
    ranges (Hyper-V / Docker / WSL reserve chunks in 40-60k that
    occasionally returned `EACCES`).
  - Definition tests realigned with the 3-class MVP roster (was
    targeting a planned 7-class set), 30-card pool (was targeting
    40+), 5 shipping world events, and 9 implemented skill branches
    (15 declared, 6 are "Coming soon" placeholders with empty nodes).

### Internals

- electron 41 -> 42.1.0
- vitest 4.1.4 -> 4.1.6
- tsx 4.21 -> 4.22
- ws 8.20.0 -> 8.20.1
- eslint 10.2 -> 10.4
- @typescript-eslint/* to 8.59.3
- @types/node updated
- Project infrastructure: ARCHITECTURE, HOW_IT_WORKS, ROADMAP,
  SECURITY, COMMERCIAL, CONTRIBUTING docs added. CI + dependabot
  workflows. GPL-3.0 license. README SVG banner.

## [1.3.2] - 2026-04-01

Patch release on top of 1.3.1. See git history between v1.3.1 and
v1.3.2 for the detailed file-level changes; pre-1.4.0 releases
predate this changelog so the entries below are short by design.

## [1.3.1] - 2026-04-01

Patch release on top of 1.3.0.

## [1.3.0] - 2026-03-30

Minor release. Last 1.3.x feature drop.

## [1.2.4] - 2026-03-27

Patch release on top of 1.2.3.

## [1.2.3] - 2026-03-24

Patch release on top of 1.2.2.

## [1.2.0] - 2026-03-18

Minor release.

## [1.1.5] - 2026-03-18

Last 1.1.x patch before the 1.2.x line.
