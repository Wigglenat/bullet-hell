'use strict';
/* ============================================================================
 * POWERS.JS — The 10,000-power system.
 *
 * Pool layout (exactly as specced):
 *   Tier 1  "Base"          5,000   ids     0 .. 4999
 *   Tier 2  "Fused"         2,500   ids  5000 .. 7499   (merged)
 *   Tier 3  "Ascended"      1,250   ids  7500 .. 8749   (merged)
 *   Tier 4  "Transcendent"    625   ids  8750 .. 9374   (merged)
 *   Tier 5  "Mythic"          625   ids  9375 .. 9999   (merged)
 *   ------------------------------------------------------------
 *   Total merged powers: 2500+1250+625+625 = 5,000
 *   Total pool:                              10,000
 *
 * Everything is generated deterministically from a fixed seed, so power
 * #7777 is the same power for every player, and merge recipes are stable:
 * merging the same two powers always yields the same result.
 * ==========================================================================*/

// ---------------------------------------------------------------------------
// Deterministic RNG + integer hashing
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Mix any number of integers into one well-distributed 32-bit hash.
function hash32() {
  let h = 0x9E3779B9;
  for (let i = 0; i < arguments.length; i++) {
    let k = arguments[i] | 0;
    k = Math.imul(k, 0xCC9E2D51); k = (k << 15) | (k >>> 17); k = Math.imul(k, 0x1B873593);
    h ^= k; h = (h << 13) | (h >>> 19); h = (Math.imul(h, 5) + 0xE6546B64) | 0;
  }
  h ^= h >>> 16; h = Math.imul(h, 0x85EBCA6B);
  h ^= h >>> 13; h = Math.imul(h, 0xC2B2AE35);
  h ^= h >>> 16;
  return h >>> 0;
}

const WORLD_SEED = 0x5EEDDA;

// ---------------------------------------------------------------------------
// Element table — 25 elements. Each maps to a concrete on-hit mechanic.
// mech types implemented by the engine:
//   dot, slow, chain, vuln, knock, stun, leech, pierce, aoe, crit, echo, pull
// ---------------------------------------------------------------------------
const ELEMENTS = [
  { key: 'fire',      root: 'Pyro',    adj: 'Infernal',   color: '#ff5a2a', mech: 'dot',    p: 0.45 },
  { key: 'ice',       root: 'Cryo',    adj: 'Glacial',    color: '#6fd8ff', mech: 'slow',   p: 0.40 },
  { key: 'lightning', root: 'Volt',    adj: 'Voltaic',    color: '#ffe94a', mech: 'chain',  p: 0.60 },
  { key: 'water',     root: 'Hydro',   adj: 'Tidal',      color: '#3a86ff', mech: 'vuln',   p: 0.18 },
  { key: 'wind',      root: 'Aero',    adj: 'Galeforce',  color: '#b8ffd8', mech: 'knock',  p: 140  },
  { key: 'earth',     root: 'Terra',   adj: 'Seismic',    color: '#c89a5a', mech: 'stun',   p: 0.14 },
  { key: 'nature',    root: 'Flora',   adj: 'Verdant',    color: '#58d84a', mech: 'leech',  p: 0.03 },
  { key: 'poison',    root: 'Toxi',    adj: 'Venomous',   color: '#9bd820', mech: 'dot',    p: 0.70 },
  { key: 'shadow',    root: 'Umbra',   adj: 'Umbral',     color: '#7a5cd8', mech: 'vuln',   p: 0.22 },
  { key: 'holy',      root: 'Lumen',   adj: 'Radiant',    color: '#ffe9a8', mech: 'crit',   p: 0.12 },
  { key: 'arcane',    root: 'Arca',    adj: 'Arcane',     color: '#d05cff', mech: 'echo',   p: 0.25 },
  { key: 'void',      root: 'Nihil',   adj: 'Voidtouched',color: '#5c6bd8', mech: 'pull',   p: 90   },
  { key: 'blood',     root: 'Hemo',    adj: 'Sanguine',   color: '#ff2a5a', mech: 'leech',  p: 0.05 },
  { key: 'steel',     root: 'Ferro',   adj: 'Steelbound', color: '#b8c8d8', mech: 'pierce', p: 1    },
  { key: 'crystal',   root: 'Crysta',  adj: 'Prismatic',  color: '#7affd8', mech: 'aoe',    p: 42   },
  { key: 'sound',     root: 'Sono',    adj: 'Resonant',   color: '#ff8ad8', mech: 'aoe',    p: 36   },
  { key: 'gravity',   root: 'Gravi',   adj: 'Graviton',   color: '#a88aff', mech: 'pull',   p: 120  },
  { key: 'time',      root: 'Chrono',  adj: 'Chronal',    color: '#8affff', mech: 'slow',   p: 0.50 },
  { key: 'lunar',     root: 'Luna',    adj: 'Lunar',      color: '#c8d8ff', mech: 'crit',   p: 0.15 },
  { key: 'solar',     root: 'Sol',     adj: 'Solar',      color: '#ffb42a', mech: 'dot',    p: 0.60 },
  { key: 'storm',     root: 'Tempes',  adj: 'Stormcaller',color: '#4ad8ff', mech: 'chain',  p: 0.45 },
  { key: 'spirit',    root: 'Anima',   adj: 'Spiritwoven',color: '#baffc8', mech: 'pierce', p: 1    },
  { key: 'dream',     root: 'Oneiro',  adj: 'Dreamveiled',color: '#ffc8f0', mech: 'slow',   p: 0.35 },
  { key: 'chaos',     root: 'Chao',    adj: 'Chaotic',    color: '#ff6bff', mech: 'crit',   p: 0.20 },
  { key: 'cosmic',    root: 'Astra',   adj: 'Astral',     color: '#f0f0ff', mech: 'echo',   p: 0.30 },
];

// ---------------------------------------------------------------------------
// Pattern table — 20 emitter behaviors implemented by the engine.
// base: relative stat baseline for that pattern.
// ---------------------------------------------------------------------------
const PATTERNS = [
  { key: 'fan',       noun: 'Fan',       base: { dmg: 9,  rate: 1.10, count: 3, speed: 340, size: 5,  life: 1.5 } },
  { key: 'ring',      noun: 'Ring',      base: { dmg: 7,  rate: 0.55, count: 10,speed: 260, size: 5,  life: 1.7 } },
  { key: 'spiral',    noun: 'Spiral',    base: { dmg: 8,  rate: 5.00, count: 1, speed: 300, size: 5,  life: 1.6 } },
  { key: 'wave',      noun: 'Wave',      base: { dmg: 10, rate: 1.30, count: 2, speed: 300, size: 6,  life: 1.6 } },
  { key: 'seeker',    noun: 'Seeker',    base: { dmg: 11, rate: 0.95, count: 1, speed: 260, size: 6,  life: 2.6 } },
  { key: 'orbitals',  noun: 'Orbit',     base: { dmg: 12, rate: 0.40, count: 2, speed: 3.0, size: 8,  life: 6.0 } },
  { key: 'nova',      noun: 'Nova',      base: { dmg: 13, rate: 0.45, count: 1, speed: 220, size: 10, life: 0.9 } },
  { key: 'lance',     noun: 'Lance',     base: { dmg: 26, rate: 0.60, count: 1, speed: 430, size: 9,  life: 1.4 } },
  { key: 'scatter',   noun: 'Scatter',   base: { dmg: 6,  rate: 1.00, count: 6, speed: 390, size: 4,  life: 0.5 } },
  { key: 'flak',      noun: 'Flak',      base: { dmg: 9,  rate: 0.85, count: 1, speed: 300, size: 7,  life: 0.8 } },
  { key: 'boomerang', noun: 'Boomerang', base: { dmg: 14, rate: 0.75, count: 1, speed: 380, size: 8,  life: 2.2 } },
  { key: 'cross',     noun: 'Cross',     base: { dmg: 9,  rate: 0.90, count: 4, speed: 320, size: 5,  life: 1.5 } },
  { key: 'starburst', noun: 'Starburst', base: { dmg: 8,  rate: 0.80, count: 5, speed: 300, size: 5,  life: 1.6 } },
  { key: 'wall',      noun: 'Wall',      base: { dmg: 8,  rate: 0.80, count: 5, speed: 280, size: 5,  life: 1.4 } },
  { key: 'meteor',    noun: 'Meteor',    base: { dmg: 24, rate: 0.55, count: 1, speed: 0,   size: 46, life: 0.7 } },
  { key: 'serpent',   noun: 'Serpent',   base: { dmg: 11, rate: 1.10, count: 1, speed: 300, size: 7,  life: 2.0 } },
  { key: 'burst',     noun: 'Burst',     base: { dmg: 8,  rate: 1.40, count: 3, speed: 360, size: 5,  life: 1.3 } },
  { key: 'mine',      noun: 'Mine',      base: { dmg: 22, rate: 0.55, count: 1, speed: 0,   size: 8,  life: 8.0 } },
  { key: 'beam',      noun: 'Beam',      base: { dmg: 15, rate: 1.00, count: 1, speed: 0,   size: 7,  life: 0.14} },
  { key: 'echoshot',  noun: 'Echo',      base: { dmg: 12, rate: 1.10, count: 1, speed: 360, size: 6,  life: 1.6 } },
];

// ---------------------------------------------------------------------------
// Variant table — 10 stat mutators. 25 * 20 * 10 = 5,000 base powers.
// ---------------------------------------------------------------------------
const VARIANTS = [
  { key: 'swift',     prefix: 'Swift',     mods: { speed: 1.40, rate: 1.15, dmg: 0.85 } },
  { key: 'heavy',     prefix: 'Heavy',     mods: { dmg: 1.50, size: 1.25, rate: 0.75 } },
  { key: 'twin',      prefix: 'Twin',      mods: { count: 1, dmg: 0.80 } },              // count is additive
  { key: 'rapid',     prefix: 'Rapid',     mods: { rate: 1.45, dmg: 0.75 } },
  { key: 'giant',     prefix: 'Giant',     mods: { size: 1.60, dmg: 1.25, speed: 0.80 } },
  { key: 'keen',      prefix: 'Keen',      mods: { crit: 0.15 } },
  { key: 'splitting', prefix: 'Splitting', mods: { split: true } },                      // shards on kill
  { key: 'piercing',  prefix: 'Piercing',  mods: { pierce: 1 } },
  { key: 'volatile',  prefix: 'Volatile',  mods: { volatile: true } },                   // blast on expiry
  { key: 'prime',     prefix: 'Prime',     mods: { dmg: 1.08, rate: 1.08, speed: 1.08 } },
];

// ---------------------------------------------------------------------------
// Tier table
// ---------------------------------------------------------------------------
const TIERS = [
  null,
  { tier: 1, name: 'Base',         count: 5000, start: 0,    mult: 1.00, emitters: 1, color: '#9fb4c8', jp: '基' },
  { tier: 2, name: 'Fused',        count: 2500, start: 5000, mult: 1.70, emitters: 2, color: '#54d68a', jp: '融' },
  { tier: 3, name: 'Ascended',     count: 1250, start: 7500, mult: 2.90, emitters: 3, color: '#4aa8ff', jp: '昇' },
  { tier: 4, name: 'Transcendent', count: 625,  start: 8750, mult: 5.00, emitters: 4, color: '#c063ff', jp: '超' },
  { tier: 5, name: 'Mythic',       count: 625,  start: 9375, mult: 8.50, emitters: 5, color: '#ffb454', jp: '神' },
];
const POOL_TOTAL = 10000;

function tierOf(id) {
  if (id < 5000) return 1;
  if (id < 7500) return 2;
  if (id < 8750) return 3;
  if (id < 9375) return 4;
  return 5;
}

// ---------------------------------------------------------------------------
// Name banks for higher tiers
// ---------------------------------------------------------------------------
const T3_EPITHETS = ['Ascendant', 'Exalted', 'Sovereign', 'Zenith', 'Apex', 'Celestial',
  'Eternal', 'Fabled', 'Halcyon', 'Paragon', 'Luminous', 'Tempered'];
const T4_TITLES = ['Annihilator', 'Worldshaper', 'Godpiercer', 'Skysunderer', 'Fatespinner',
  'Stormcrown', 'Duskbringer', 'Dawnforger', 'Voidwalker', 'Starbinder'];
const T4_DOMAINS = ['the Endless Sky', 'the Shattered Moon', 'the First Flame', 'the Silent Deep',
  'a Thousand Blades', 'the Final Hour', 'the Broken Crown', 'the Astral Sea',
  'Forgotten Kings', 'the Ninth Heaven'];
const MYTH_BEINGS = ['Ouroboros', 'Leviathan', 'Behemoth', 'Ziz', 'Fenrir', 'Jormungandr',
  'Valkyrie', 'Seraphim', 'Ifrit', 'Marid', 'Djinn', 'Basilisk', 'Wyvern', 'Hydra',
  'Chimera', 'Cerberus', 'Phoenix', 'Roc', 'Kraken', 'Banshee', 'Kitsune', 'Tengu',
  'Oni', 'Raiju', 'Orochi', 'Shinigami', 'Amaterasu', 'Susanoo', 'Tsukuyomi', 'Izanami',
  'Tiamat', 'Marduk', 'Anubis', 'Osiris', 'Ra', 'Sekhmet', 'Quetzalcoatl', 'Tezcatlipoca',
  'Baba Yaga', 'Koschei', 'Morrigan', 'Cernunnos', 'Typhon', 'Nyx', 'Erebus', 'Helios',
  'Selene', 'Prometheus', 'Gilgamesh', 'Humbaba'];
const MYTH_TITLES = ['Devourer of Ends', 'Herald of Dawn', 'Warden of the Void',
  'Sovereign of Storms', 'the Flame Eternal', 'Tidebreaker', 'Star-Eater', 'Dreamweaver',
  'Worldrender', 'Lightbringer', 'Night Sovereign', 'the Unbound', 'the Infinite'];

// ---------------------------------------------------------------------------
// Keystones (Tier 4+) — one global passive per power. Engine reads .keystone.
// ---------------------------------------------------------------------------
const KEYSTONES = [
  { key: 'pierce_all',  label: '+1 pierce on all bullets' },
  { key: 'dmg_all',     label: '+20% damage on everything' },
  { key: 'rate_all',    label: '+15% fire rate on everything' },
  { key: 'move',        label: '+12% movement speed' },
  { key: 'kill_nova',   label: 'kills have 10% chance to detonate a nova' },
  { key: 'xp_gain',     label: '+25% XP gained' },
  { key: 'bullet_speed',label: '+20% bullet speed' },
  { key: 'crit_all',    label: '+10% crit chance on everything' },
  { key: 'magnet',      label: 'double gem pickup radius' },
  { key: 'count_all',   label: '+1 projectile on every volley' },
];

// ---------------------------------------------------------------------------
// Auras (Tier 5 only) — persistent field around the player.
// ---------------------------------------------------------------------------
const AURAS = [
  { key: 'blades',  label: 'Blade Halo — orbiting blades shred nearby foes' },
  { key: 'halo',    label: 'Burning Halo — a ring of light sears everything close' },
  { key: 'storm',   label: 'Stormheart — lightning arcs to random nearby foes' },
  { key: 'frost',   label: 'Frostfield — enemies near you are chilled' },
  { key: 'gravity', label: 'Event Horizon — drags enemies toward their doom' },
  { key: 'phoenix', label: 'Phoenix Soul — cheat death once per run' },
];

// ---------------------------------------------------------------------------
// Power construction
// ---------------------------------------------------------------------------
// An emitter is one firing behavior:
//   { pat, el, dmg, rate, count, speed, size, life, pierce, crit, split, volatile }
function makeBaseEmitter(elIdx, patIdx, varIdx) {
  const P = PATTERNS[patIdx].base;
  const V = VARIANTS[varIdx].mods;
  return {
    pat: patIdx,
    el: elIdx,
    dmg:   P.dmg   * (V.dmg   || 1),
    rate:  P.rate  * (V.rate  || 1),
    count: P.count + (V.count || 0),
    speed: P.speed * (V.speed || 1),
    size:  P.size  * (V.size  || 1),
    life:  P.life,
    pierce: (V.pierce || 0),
    crit:   (V.crit   || 0),
    split:    !!V.split,
    volatile: !!V.volatile,
  };
}

function cloneEmitter(e) {
  return { pat: e.pat, el: e.el, dmg: e.dmg, rate: e.rate, count: e.count,
    speed: e.speed, size: e.size, life: e.life, pierce: e.pierce, crit: e.crit,
    split: e.split, volatile: e.volatile };
}

// Deterministically pick n items from arr (seeded), preferring unique patterns.
function pickEmitters(arr, n, rng) {
  const pool = arr.slice();
  // shuffle (Fisher–Yates, seeded)
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
  }
  // prefer distinct patterns first
  const out = [], seen = new Set();
  for (const e of pool) { if (!seen.has(e.pat)) { out.push(e); seen.add(e.pat); if (out.length === n) return out; } }
  for (const e of pool) { if (out.length >= n) break; if (!out.includes(e)) out.push(e); }
  while (out.length < n && pool.length) out.push(pool[out.length % pool.length]);
  return out.slice(0, n);
}

const PowerPool = (() => {
  const powers = new Array(POOL_TOTAL);

  // ---- Tier 1: 5,000 base powers -------------------------------------------
  // id = el*200 + pat*10 + variant   (25 * 20 * 10 = 5,000)
  for (let id = 0; id < 5000; id++) {
    const el = Math.floor(id / 200);
    const pat = Math.floor((id % 200) / 10);
    const v = id % 10;
    powers[id] = {
      id, tier: 1,
      name: `${VARIANTS[v].prefix} ${ELEMENTS[el].adj} ${PATTERNS[pat].noun}`,
      elements: [el],
      emitters: [makeBaseEmitter(el, pat, v)],
      keystone: null, aura: null,
      parents: null,
    };
  }

  // ---- Merged tiers: parents drawn from the tier below ----------------------
  function buildMergedTier(tierIdx, nameFn) {
    const T = TIERS[tierIdx], below = TIERS[tierIdx - 1];
    for (let i = 0; i < T.count; i++) {
      const id = T.start + i;
      const rng = mulberry32(hash32(WORLD_SEED, id, tierIdx));
      // two distinct parents from the tier below
      const pa = below.start + Math.floor(rng() * below.count);
      let pb = below.start + Math.floor(rng() * below.count);
      if (pb === pa) pb = below.start + ((pb + 1 - below.start) % below.count);
      const A = powers[pa], B = powers[pb];

      // gather ancestor emitters, pick this tier's emitter loadout
      const genePool = A.emitters.concat(B.emitters).map(cloneEmitter);
      const emitters = pickEmitters(genePool, T.emitters, rng).map(cloneEmitter);
      // scale to tier: total output grows with mult but is split across emitters
      const perEmitter = T.mult / Math.sqrt(emitters.length);
      for (const e of emitters) {
        e.dmg *= perEmitter;
        e.rate *= 0.90 + rng() * 0.25;
        e.size *= 1 + (tierIdx - 1) * 0.06;
        if (rng() < 0.25 * (tierIdx - 1)) e.pierce += 1;
      }

      const elements = [...new Set(emitters.map(e => e.el))];
      powers[id] = {
        id, tier: tierIdx,
        name: nameFn(i, A, B, emitters, rng),
        elements,
        emitters,
        keystone: tierIdx >= 4 ? KEYSTONES[hash32(WORLD_SEED, id, 77) % KEYSTONES.length] : null,
        aura: tierIdx === 5 ? AURAS[hash32(WORLD_SEED, id, 88) % AURAS.length] : null,
        parents: [pa, pb],
      };
    }
  }

  const rootOf = (p) => ELEMENTS[p.elements[0]].root;
  const T2_SUFFIX = ['Fusion', 'Convergence', 'Amalgam', 'Union', 'Synthesis', 'Communion', 'Paradox', 'Accord'];

  buildMergedTier(2, (i, A, B, emitters) =>
    `${rootOf(A)}${rootOf(B).toLowerCase()} ${T2_SUFFIX[i % T2_SUFFIX.length]}`);

  buildMergedTier(3, (i, A, B, emitters) =>
    `${T3_EPITHETS[i % T3_EPITHETS.length]} ${rootOf(A)}${rootOf(B).toLowerCase()} ${PATTERNS[emitters[0].pat].noun}`);

  buildMergedTier(4, (i) =>
    `${T4_TITLES[i % T4_TITLES.length]} of ${T4_DOMAINS[Math.floor(i / T4_TITLES.length) % T4_DOMAINS.length]}`);

  buildMergedTier(5, (i) =>
    `${MYTH_BEINGS[i % MYTH_BEINGS.length]}, ${MYTH_TITLES[Math.floor(i / MYTH_BEINGS.length) % MYTH_TITLES.length]}`);

  return powers;
})();

// ---------------------------------------------------------------------------
// Merge rules
// ---------------------------------------------------------------------------
// Merging two powers yields a deterministic power one tier above the higher
// input tier (recipes are stable & discoverable). Two Mythics overcharge:
// same recipe hash picks a Mythic and the result gains a ★ (stacking,
// uncapped ×1.5 damage each — the infinite-power endgame).
function mergeResultId(idA, idB) {
  const a = Math.min(idA, idB), b = Math.max(idA, idB);
  const t = Math.min(5, Math.max(tierOf(a), tierOf(b)) + 1);
  const T = TIERS[t];
  return T.start + (hash32(WORLD_SEED, a, b, t) % T.count);
}

function isOvercharge(idA, idB) {
  return tierOf(idA) === 5 && tierOf(idB) === 5;
}

// ---------------------------------------------------------------------------
// Pool stats (exposed for UI + tests)
// ---------------------------------------------------------------------------
const POOL_STATS = (() => {
  const byTier = [0, 0, 0, 0, 0, 0];
  for (const p of PowerPool) byTier[p.tier]++;
  return {
    total: PowerPool.length,
    byTier: byTier.slice(1),                    // [5000, 2500, 1250, 625, 625]
    merged: byTier[2] + byTier[3] + byTier[4] + byTier[5],
  };
})();

// Human description of what a power does (for cards / codex).
function describePower(p) {
  const bits = p.emitters.map(e =>
    `${PATTERNS[e.pat].noun.toLowerCase()} ×${Math.max(1, Math.round(e.count))} · ${ELEMENTS[e.el].key} (${ELEMENTS[e.el].mech})`);
  const lines = [bits.join('  |  ')];
  if (p.keystone) lines.push(`Keystone: ${p.keystone.label}`);
  if (p.aura) lines.push(`Aura: ${p.aura.label}`);
  return lines;
}
