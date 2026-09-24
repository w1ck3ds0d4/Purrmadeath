# Roadmap

**Status:** maintain. **Last reviewed:** 2026-09-24.

v1.4.0 shipped 2026-05-18 with the full feature set (world gen, 3 classes, 8 bosses, cards,
achievements, singleplayer + online multiplayer, auto-updater). Four months of nothing but
Dependabot bumps since. Done here means: CI stays green, the public Dependabot alert count stays
low, and no new feature branch opens without Daniel reopening the project.

> How this file is used: Claude Project threads build the first unticked item under **Now**, one
> item per branch and pull request, and tick it in that same PR as `- [x] ... (#PR)`. Daniel owns
> the order and the lists; threads never add to Now, Next or Later themselves, they propose under
> **Ideas**.

## Now

No new features without Daniel's go.

- [ ] **Triage the open Dependabot alerts**: this is a public repo with the highest Dependabot alert count in the batch. Sort by severity and clear or dismiss each with a reason. Done when: the repo's Security tab shows 0 open alerts, or every remaining one has a dismissal reason recorded.
- [ ] **Keep CI and Dependabot Updates green**: review and merge patch/minor dependency PRs as they land; treat any major bump or new alert as priority. Done when: no open Dependabot PR is older than 14 days and CI is green on main.
- [ ] **Reconfirm ROADMAP.md and CHANGELOG.md match the shipped v1.4.0 state**: both were last substantively touched in May. Done when: a read-through finds no claim that contradicts the current `src/`/`server/` code or the latest release notes.

## Next

Parked feature ideas, not scheduled:

- [ ] **Audio layer (parked)**: combat SFX and per-biome/wave music layers, gated behind a settings toggle. Done when: every player action produces an audible response and music ramps with wave intensity.
- [ ] **Client render tests (parked)**: snapshot tests for HUD, building placement, combat UI. Done when: a UI regression fails CI before it ships.

## Later

- Documented manual release smoke checklist (parked)
- Retroactive `v1.0.0` tag marker for planning purposes (parked)
- Anything beyond the shipped v1.4.0 feature set waits for Daniel to reopen this project

## Ideas

(empty to start; threads add proposals here)

## Done

- [x] v1.4.0: full Phase 1-9 feature set shipped 2026-05-18: world gen, 4 POI types, 3 classes x 3 subclasses (10-tier skill trees), 14 defense / 6 production buildings, 8 bosses (W5-W40), 30 cards, 18 achievements, singleplayer + online multiplayer (LAN + EC2), F4 debug console, electron-updater
- [x] CI gates: ESLint, strict `tsc --noEmit`, Vitest, npm audit; release workflow builds NSIS and deploys to EC2
- [x] SecureCheck reusable workflow wired
- [x] Server-side Vitest suite covering pathfinding, combat, enemy AI
