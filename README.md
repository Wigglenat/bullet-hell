# SPACE SOULS — auto-fusing bullet hell

A bullet hell where your upgrades **fuse themselves**. Pure canvas + vanilla JS,
no build step, no dependencies.

**Play it:** https://wigglenat.github.io/bullet-hell/ — or just open
[`index.html`](./index.html) in any browser (works from `file://`).

## How it plays

Your ship fires by itself — you **dodge**, collect XP gems, and pick upgrades.
The arena is zoomed out for real maneuvering room. Every level-up offers 3
cards from the 42 classics:

| Attack | Defense | Utility |
|---|---|---|
| + Bullets, Chase (homing), Pierce, Bounce, Rapid Fire, Big Shots, Split, Critical, Orbitals, Nova, Laser, Rear Guard, Side Cannons, Chain Arc, Executioner, Velocity, Drones, Missiles, Mortar, Explosive Rounds, Frost Shot, Impact, Turret, Vortex | Lifesteal, Shield, Vitality, Regen, Ghost, Thorns, Armor, Evasion, Scavenger, Ram | Speed, Magnetic, Slow Field, Bomb, Greed, Adrenaline, Shrink, Graze |

Every card says exactly what it does ("+1 bullet", "+3% lifesteal", "+1 shield
charge"). Picking the same family again levels it up.

## Automatic fusion — no menus

When two of your powers grow strong enough, they **merge on their own**, keep
everything they did, get ~15% stronger, and gain a bonus — with a banner
announcing the result:

```
two families at Lv 3+        →  FUSED         "Vampiric Seekers" (Lifesteal + Chase)
two Fused at Lv 2+           →  ASCENDED      "Ascended Manifold Aegis"
two Ascended at Lv 2+        →  TRANSCENDENT  gains big specials (time-ripple, guardian nova…)
two Transcendent at Lv 2+    →  MYTHIC        "OUROBOROS — Colossal Barrage", levels uncapped
two Mythics                  →  ★ OVERCHARGE  everything ×1.5, stacks forever
```

## Named elites

Gold-ringed, personally named horrors — **VORAX THE HUNGERING**, **NYXA
STAR-EATER** — stalk in from wave 2 onward. They're tanky, fast, and worth it:
a burst of XP gems plus an **ELITE SPOILS** level-up where every card grants
**double levels** and the Primordial roll is boosted to **0.5%** (×50).
Spoils draws only offer level-ups, so elite hunting is the fastest road to
your next fusion.

## 🜏 Primordial — the 0.01% tier

Above Mythic sits **Primordial**: not craftable, not fusable. Every level-up
card slot has a **1-in-10,000 (0.01%)** chance to be replaced by a glowing
crimson Primordial relic. Relics ignore the normal stat caps, **don't take a
build slot**, and each one warps the run:

| Relic | What it does |
|---|---|
| **GENESIS ENGINE** | +100% damage, +50% fire rate, +4 bullets — and damage grows another +1% every second, forever |
| **WORLDHEART** | +300 max HP, +10 HP/s, +25% lifesteal — and you resurrect at full HP (90s cooldown) |
| **EVENT HORIZON** | a vast field slows enemies *and* their bullets 60%; every 10s a shockwave erases every enemy bullet |
| **FIRST LIGHT** | mega-laser every 1.5s, +50% crit chance, crits deal 4× |
| **ALPHA SWARM** | +8 orbital blades; every kill bursts into homing shards |
| **OMEGA PROTOCOL** | apocalypse barrage every 12s, +3 shields at double regen, near-instant bombs |

Relics can level (rarely offered as cards): each level makes the whole relic
+25% stronger.

Fusing frees a build slot (you hold at most 6 powers), and a fused-away classic
can be picked up fresh and grown again — that's the engine of infinite scaling.
Fusion names are readable (adjective of one part + noun of the other), and the
pause screen (`P`) lists every effect in plain numbers.

## Controls

**Desktop**

| Key | Action |
|---|---|
| `WASD` / arrows | move |
| `Shift` | focus — slow, precise movement (your red hitbox dot is always visible) |
| `P` / `Esc` | pause + full build breakdown |
| `M` | mute |

**Mobile / touch** — drag anywhere on the battlefield to steer with a floating
analog joystick: a full drag is full speed, a **light drag moves you slowly**
(that's your focus mode, and it shows the hitbox). Tap **⏸** (top-right) for
pause + build info. Level-up cards and menus are tappable.

Readability rules: enemy bullets are magenta/white and always drawn on top;
your bullets are quiet cyan; bosses (every 10th wave) get a name and an HP bar.

## Repo layout

```
index.html      shell + styling + overlays
js/powers.js    the 20 families, fusion tiers, auto-fusion logic
js/game.js      engine: sim loop, firing systems, enemies, waves, UI
```
