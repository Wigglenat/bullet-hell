# SPACE SOULS — auto-fusing bullet hell

A bullet hell where your upgrades **fuse themselves**. Pure canvas + vanilla JS,
no build step, no dependencies.

**Play it:** https://wigglenat.github.io/bullet-hell/ — or just open
[`index.html`](./index.html) in any browser (works from `file://`).

## How it plays

Your ship fires by itself — you **dodge**, collect XP gems, and pick upgrades.
The arena is zoomed out for real maneuvering room. Every level-up offers 3
cards from the 43 classics:

| Attack | Defense | Utility |
|---|---|---|
| + Bullets, Chase (homing), Pierce, Bounce, Rapid Fire, Big Shots, Split, Critical, Orbitals, Nova, Laser, Rear Guard, Side Cannons, Chain Arc, Executioner, Velocity, Drones, Missiles, Fire Rounds (burn), Splash Rounds (AoE), Explosive Rounds, Frost Shot, Impact, Turret, Vortex, Range (+20% shot range per level — beat the drop-off) | Lifesteal, Shield, Vitality, Regen, Ghost, Thorns, Armor, Evasion, Scavenger, Ram | Speed, Magnetic, Slow Field, Greed, Adrenaline, Shrink, Graze |

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

## ⚡ Synergies — Isaac-style combination effects

Fusions don't just add stats — like *The Binding of Isaac*, the **right pair
changes how your weapon behaves**. The moment a fusion contains both halves of
a known pair anywhere in its family tree, a **⚡ SYNERGY banner** announces the
discovery, the effect switches on run-wide, and your bullets **visibly tint**
toward your elements (fire = orange, frost = ice-blue, arc = gold…). The pause
screen lists every active synergy.

| Pair | Synergy | New behavior |
|---|---|---|
| Fire Rounds + Splash Rounds | **Napalm** | splash hits leave burning ground pools |
| Splash Rounds + Frost Shot | **Cryo Shatter** | splash damage also chills everything it touches |
| Frost Shot + Executioner | **Shatterpoint** | chilled enemies are executed at DOUBLE the cull threshold |
| Pierce + Chain Arc | **Rail Storm** | chain lightning jumps 2 extra times |
| Chase + Chain Arc | **Storm Seekers** | +15% arc chance |
| Bounce + Explosive Rounds | **Blast Ricochet** | bullets detonate on every wall bounce |
| Split + Missiles | **Cluster Warheads** | missile explosions release homing shards |
| Drones + Laser | **Beam Drones** | your drones fire mini-beams alongside your laser |
| Fire Rounds + Orbitals | **Flame Wheel** | orbital blades set enemies on fire |
| Missiles + Turret | **Missile Battery** | turret shots explode on impact |
| Impact + Ram | **Battering Ram** | ramming blasts everything around you backwards |
| Shield + Thorns | **Retaliation Aegis** | shield blocks detonate a huge thorn burst |
| Lifesteal + Executioner | **Soul Harvest** | executions heal 2% of your max HP |
| Critical + Graze | **Bullet Waltz** | +10% crit chance while graze-heat is hot |
| Speed + Shrink | **Phantom Needle** | your hitbox shrinks another 15% |
| Nova + Frost Shot | **Ice Ring** | nova rings always chill what they touch |

## Named elites

Gold-ringed, personally named horrors — **VORAX THE HUNGERING**, **NYXA
STAR-EATER** — stalk in from wave 2 onward. They're tanky, fast, and worth it:
a burst of XP gems plus an **ELITE SPOILS** level-up where every card grants
**double levels** and the Primordial roll is boosted to **0.5%** (×50).
Spoils draws only offer level-ups, so elite hunting is the fastest road to
your next fusion.

## Sectors & the Warden

A run is split into **sectors of 100 waves**. Wave 100 empties the arena — one
enemy comes alone: the **SECTOR WARDEN** (*APOPHIS — WARDEN OF SECTOR 1*, …).
It's reactive: it **reads your bullets and sidesteps** converging fire. Three
dodges and it's **EXHAUSTED** for four seconds — that gold ring is your punish
window. It holds mid-range, switches patterns based on your distance, and
enrages below 40% HP.

Kill it and the sector is cleared: half your HP back, a **SECTOR SPOILS** draw
with double levels and **1.01% Primordial odds** (base 0.01% + a flat 1%), and
Sector N+1 begins at wave 1 with difficulty carrying over.

### The Warden hierarchy

| Total wave | Boss | Crazy abilities | Spoils |
|---|---|---|---|
| every 100 | **SECTOR WARDEN** | sidestep-dodges your shots (3, then exhausted), range-adaptive patterns, enrage | 1 draw · 1.01% Primordial |
| every 1,000 | **GALAXY WARDEN** | **blinks** (teleports) out of your fire, **splits phantom clones** at ⅔ and ⅓ HP, **inhales** — eats your bullets while dragging you in | 2 draws · 2.01% |
| every 10,000 | **UNIVERSE WARDEN** | all of the above + **armored face / glowing weak point on its back** (25% / 150% damage), an **echo of your own ship** hunting you, and a REALIGNMENT pulse that re-aims every bullet on screen at you | 3 draws · 5.01% + **one guaranteed Primordial** |
| wave 100,000 | **THE LAST SOUL — END OF ALL THINGS** | everything at once, plus desperation bullet-walls with escape gaps below 15% HP | 3 draws of **pure Primordial** |

Beat THE LAST SOUL and the run doesn't end — it begins again: **NG+**. You keep
your entire build (every fusion, star, essence, and relic); the universe
restarts at Sector 1 with enemy scaling multiplied. The HUD wears your NG+
badge. There is no top.

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
| **OMEGA PROTOCOL** | apocalypse barrage every 12s, +3 shields at double regen, massive splash on every bullet |

Relics can level (rarely offered as cards): each level makes the whole relic
+25% stronger.

There is **no build limit** — stack as many powers as the run gives you, and a
fused-away classic can be picked up fresh and grown again. Every fusion pair
has its own **thematic name** (Lifesteal + Thorns = **Blood Barrier**,
Chase + Fire Rounds = **Hellhound Rounds** — all 946 combinations are named),
and the pause screen (`P`) lists every effect in plain numbers.

## Controls

**Desktop**

| Key | Action |
|---|---|
| `WASD` / arrows | move |
| `Shift` | focus — slow, precise movement (your red hitbox dot is always visible) |
| `F` | game speed ×1 → ×2 → ×3 → ×4 (whole sim fast-forwards) |
| `P` / `Esc` | pause + full build breakdown |
| `M` | mute |

**Mobile / touch** — drag anywhere on the battlefield to steer with a floating
analog joystick: a full drag is full speed, a **light drag moves you slowly**
(that's your focus mode, and it shows the hitbox). Tap **⏸** (top-right) for
pause + build info, or **▶▶** next to it to cycle game speed. Level-up cards
and menus are tappable.

Readability rules: enemy bullets are magenta/white and always drawn on top;
your bullets are quiet cyan; bosses (every 10th wave) get a name and an HP bar.

## Repo layout

```
index.html         shell + styling + overlays
js/fusion-names.js curated thematic names for all 903 fusion pairs
js/powers.js       the 42 families, fusion tiers, auto-fusion logic
js/game.js         engine: sim loop, firing systems, enemies, waves, UI
```
