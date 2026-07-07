# MYRIAD BREAK — auto-fusing bullet hell

A bullet hell where your upgrades **fuse themselves**. Pure canvas + vanilla JS,
no build step, no dependencies.

**Play it:** https://wigglenat.github.io/bullet-hell/ — or just open
[`index.html`](./index.html) in any browser (works from `file://`).

## How it plays

Your ship fires by itself — you **dodge**, collect XP gems, and pick upgrades.
Every level-up offers 3 cards from the 20 classics:

| Attack | Defense | Utility |
|---|---|---|
| + Bullets, Chase (homing), Pierce, Bounce, Rapid Fire, Big Shots, Split, Critical, Orbitals, Nova, Laser | Lifesteal, Shield, Vitality, Regen, Ghost | Speed, Magnetic, Slow Field, Bomb |

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

Fusing frees a build slot (you hold at most 6 powers), and a fused-away classic
can be picked up fresh and grown again — that's the engine of infinite scaling.
Fusion names are readable (adjective of one part + noun of the other), and the
pause screen (`P`) lists every effect in plain numbers.

## Controls

| Key | Action |
|---|---|
| `WASD` / arrows | move |
| `Shift` | focus — slow, precise movement (your red hitbox dot is always visible) |
| `P` / `Esc` | pause + full build breakdown |
| `M` | mute |

Readability rules: enemy bullets are magenta/white and always drawn on top;
your bullets are quiet cyan; bosses (every 10th wave) get a name and an HP bar.

## Repo layout

```
index.html      shell + styling + overlays
js/powers.js    the 20 families, fusion tiers, auto-fusion logic
js/game.js      engine: sim loop, firing systems, enemies, waves, UI
```
