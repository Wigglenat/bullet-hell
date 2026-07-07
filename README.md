# MYRIAD BREAK — 万華弾幕 · 無限

An **infinite bullet-hell** built around a **10,000-power merge system**. No build
step, no dependencies, no install — pure canvas + vanilla JS.

**To play: open [`index.html`](./index.html) in any browser.** It runs straight
from `file://` — double-clicking the file is enough. (If the repo is made public,
it can also be served with GitHub Pages so it's playable from a link.)

## The 10,000-power pool

Every level-up deals three draws from a fixed pool of **exactly 10,000 powers**,
generated deterministically from a world seed — power *No.7777* is the same power
for everyone, forever.

| Tier | Name | Count | How it exists |
|---|---|---|---|
| 1 | **Base** | **5,000** | 25 elements × 20 bullet patterns × 10 variants |
| 2 | **Fused** | **2,500** | merged from two Base powers |
| 3 | **Ascended** | **1,250** | merged from two Fused powers |
| 4 | **Transcendent** | **625** | merged from two Ascended powers · adds a **Keystone** passive |
| 5 | **Mythic** | **625** | merged from two Transcendents · adds a screen-warping **Aura** |

Merged powers (Tiers 2–5) total **5,000** — half the pool. Because level-up draws
are uniform across the whole pool, rarity is emergent: **50%** Base, **25%** Fused,
**12.5%** Ascended, **6.25%** Transcendent, **6.25%** Mythic.

## Merging — the Merge Lab (press `E`)

- Pick **any two** powers you own. Both are consumed; a **higher-tier power is forged**
  (one tier above the higher ingredient).
- **Recipes are deterministic** — the same pair always forges the same result, so
  recipes can be learned, shared, and hunted.
- Forged powers merge again: Base → Fused → Ascended → Transcendent → **Mythic**.
- **Mythic + Mythic = ★ Overcharge** — the result gains a stacking ★ (each ★ is
  ×1.5 damage, **uncapped**). This is the infinite-power endgame.
- The **Codex** tracks every power you've ever discovered (persists between runs),
  out of 10,000.

## How a power works

Every power is a stack of components, so all 10,000 play differently:

- **20 patterns** — fan, ring, spiral, wave, seeker, orbitals, nova, lance, scatter,
  flak, boomerang, cross, starburst, wall, meteor, serpent, burst, mine, beam, echo.
- **25 elements**, each with a real mechanic — burn, chill, chain lightning,
  vulnerability, knockback, stun, lifesteal, pierce, shatter-AoE, crit, echo-hit,
  gravity pull…
- **10 variants** — swift, heavy, twin, rapid, giant, keen, splitting, piercing,
  volatile, prime.
- Higher tiers stack **more emitters** (up to 5), then **Keystones** (global passives)
  and **Auras** (Blade Halo, Stormheart, Event Horizon, Phoenix Soul…).

## Controls

| Key | Action |
|---|---|
| `WASD` / arrows | move (powers fire themselves — dodge!) |
| `Shift` | focus — slow movement, shows your true hitbox |
| `E` / `Tab` | Merge Lab |
| `P` / `Esc` | pause |
| `M` | mute |

Survive the waves, beat the wave-10/20/30… bosses, level up, and forge your way
from a single random Base power to a five-star Mythic arsenal.

## Repo layout

```
index.html      the game shell + all styling
js/powers.js    the 10,000-power generator, tiers, merge rules
js/game.js      engine: sim loop, patterns, enemies, waves, UI
```
