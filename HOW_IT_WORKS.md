# HOW IT WORKS - Purrmadeath

Purrmadeath is a 2D top-down co-op roguelike about cats defending a campfire against waves of monsters. You explore a procedural world, gather resources, build a base, hire civilians to staff it, and survive boss fights every five waves. Up to four players can join the same run online or over LAN.

## What You Do, In One Paragraph

You wake up next to a campfire. Enemies will come. You chop trees, mine stone, fight bandits, place a wall, then a turret, then a lumbermill. Civilians wander in and you assign them to your buildings so production keeps running while you fight. Every wave you earn a skill point and pick a card. Every five waves a boss shows up. Every fifty waves the game gets meaner. Lose your campfire and the run ends.

## Game Modes

- **Singleplayer**: fully offline. The Electron app runs an embedded local server, so no internet is required. Saves live in `%AppData%/purrmadeath/saves/`.
- **Host Game**: creates a session on the public server and gives you a 4-letter invite code. Friends join with the code.
- **Join**: enter an invite code (LAN auto-discovers via UDP) or a raw server IP.

Sessions hold up to 4 players. Pause is a vote in multiplayer and instant in singleplayer.

## Classes and Skill Trees

Three base classes with distinct weapons and stats:

- **Warrior**: sword, 120 HP, 180 speed, 2 defense. Branches: Berserker, Guardian, Blood Knight (plus Templar and Slayer locked behind achievements).
- **Ranger**: bow, 80 HP, 220 speed. Branches: Sharpshooter, Beastmaster, Trapper (plus Shadow Hunter and Windwalker locked).
- **Mage**: staff, 70 HP, 200 speed. Branches: Fire, Frost, Electric (plus Earth and Void locked).

Each branch is a 10-tier tree. You earn 1 skill point per wave cleared. Tier 5 unlocks an active ability assigned to the 1, 2, or 3 hotbar slot. Tiers 6 to 10 unlock combat modifiers (burn lifesteal, frost shatter, headshot explosion, blood arc, multi-shot, etc.).

## Controls

| Action | Key |
|---|---|
| Move | W A S D |
| Attack | Left Mouse |
| Sprint | Shift (hold) |
| Dodge Roll | Space |
| Interact / Upgrade | E |
| Ability 1 / 2 / 3 | 1 / 2 / 3 |
| Use Potion | 4 |
| Build Mode | Q |
| Rotate building | Mouse Wheel (in build mode) |
| Place / Select / Move building | LMB / RMB / F |
| Repair / Demolish | R / X |
| Civilians / Skill Tree / Chat | C / K / Enter |
| Pause / Close | Escape |
| Toggle Controls | F1 |
| Debug Console | F4 |

## Base Building

You place the **Campfire** for free at the start. It is your respawn point, your base anchor, and provides initial housing. It has an 80-tile (2560 px) square build range. Watchtowers extend that range by 20 tiles per level. Portals always spawn outside the range, so a well-placed campfire keeps the fight outside your walls.

Buildings group into:

- **Defense**: Wall, Gate, Arrow Turret, Cannon Turret, Ballista, Laser Tower, Tesla Coil, Flame Tower, Catapult, Flak Cannon, Moat, Spike Trap.
- **Production**: Lumbermill (wood), Quarry (stone), Mine (iron + 20% diamond), Farm (food), Workshop (weapons), Smeltery (steel from wood + iron).
- **Military**: Guard House (trains random-role guards using a civilian, food, steel, and gold).
- **Housing**: Cat House (extra civilian capacity).
- **Utility**: Warehouse (shared resource pool), Bridge, Light Tower (reveals ghosts), Healing Shrine, Repair Station, Teleporter Pad.
- **Shops**: Potion Shop, Tavern (hire hero NPCs), Market (3 random cards per wave, buy 1 with gold).

Each building has 3 upgrade tiers (Campfire goes to 5). Demolishing refunds 50 percent. Buildings can be relocated within the build range.

## Civilians

Civilians are cat NPCs with names. They wander in over time (2 every 60 s, capped at 20 if you have housing). The game auto-assigns idle civilians to unstaffed production buildings, or you can manage them by hand from the Civilian Panel (C). They eat 1 food per minute from the warehouse. If they starve or get hit by a monster they go down. Worker death pauses the building they were running. Speech bubbles tell you how they feel (`Help!`, `*purr*`, `I need a job...`).

## Waves, Bosses, and Cards

Portals spawn around your build range and continuously emit enemies. The wave ends only when every portal is destroyed. HP, damage, and portal count scale every wave, with permanent milestones at W25 (Corruption), W50 (Undying Horde, 15 percent resurrect), W75 (Final Stand, 3x portals, 2x HP), W100 (Apocalypse), and infinite scaling every 10 waves past 100.

Bosses appear every 5 waves from W5 to W40 with multi-phase mechanics (Ravager, Necromancer, Shadow Lord, Broodmother, Infernal, Frost Warden, Plague Bearer, Ancient Golem). Double bosses can spawn from W30+.

Every 3 waves and on boss kills you get a card pick (1 of 3, weighted by rarity). 30 cards total: 15 stat buffs, 10 build-defining abilities (Vampiric Bite, Last Stand, Pack Hunter, Rapid Strikes, Explosive Touch, etc.), and 5 curses that combine a buff and a debuff.

## Points of Interest, Day / Night, World Events

The procedural world contains POIs marked as diamond shapes with a `?`: Abandoned Camp (loot on E), Shrine (120 s blessing of speed/damage/regen/defense), Enemy Nest (proximity-triggered mini-wave), Treasure Chest (rare drops). The day / night cycle reduces vision at night and buffs enemies. From W2+, day modifiers can roll: Meteor Shower, Earthquake, Resource Boom (3x production), Surprise Attack (extra portals), Solar Eclipse (vision reduction + undead). Per-wave modifiers (Swarm, Ironhide, Fog, Frenzy) stack up to 3 from W15 onward.

## Saving and Updating

Saves auto-write after each wave clear and on host exit. There are 3 host-owned save slots per machine; returning players are matched by UUID and get their progress back. The Electron client checks GitHub Releases on launch via `electron-updater`; updates download in the background and apply on the next restart.

## Tips

- Place the Campfire on a chokepoint near forest and stone so production lines stay short.
- Build at least one Warehouse early. It pools resources for the whole party and is what building costs are drawn from.
- Watchtowers are cheap range extenders; one or two will let you push portals further out.
- Light Towers reveal ghosts, which are otherwise invisible and ignore walls.
- The Market lets you buy a card with gold once per wave, capped at 1 Market per game.
- Press F4 for the debug console (FPS, server tick profile, slash commands like `/give` and `/wave`).
