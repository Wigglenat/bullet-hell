'use strict';
/* ============================================================================
 * POWERS.JS v2 — legible bullet-hell powers + automatic fusion.
 *
 * The build is a set of UNITS (no cap — buffs stack without limit):
 *   - family unit : one classic upgrade (Lifesteal, Chase, +Bullets…), Lv 1-9
 *   - fusion unit : created AUTOMATICALLY when two units qualify; keeps both
 *                   parents' effects, amplifies them, and adds a special.
 *
 * Fusion ladder (all automatic, no menus):
 *   two families at Lv 3+          →  FUSED        (Tier 2)
 *   two Fused    at Lv 2+          →  ASCENDED     (Tier 3)
 *   two Ascended at Lv 2+          →  TRANSCENDENT (Tier 4)
 *   two Transcendent at Lv 2+      →  MYTHIC       (Tier 5, levels uncapped)
 *   two Mythics                    →  ★ OVERCHARGE (stacking, uncapped)
 *
 * A fused-away family can be picked up again fresh — so deep runs keep
 * stacking the same classics into ever-bigger fusions. Fusion names come
 * from FUSION_NAMES (js/fusion-names.js): a curated thematic name for every
 * pair, e.g. Lifesteal+Thorns = "Blood Barrier".
 * ==========================================================================*/

// ---------------------------------------------------------------------------
// The 20 families — every one a bullet-hell classic, described in plain words.
// cat: ATK | DEF | UTIL   adj/noun: used to build readable fusion names.
// ---------------------------------------------------------------------------
const FAMILIES = {
  bullets:   { name: '+ Bullets',   cat: 'ATK',  adj: 'Manifold', noun: 'Barrage',
    desc: 'Fire one extra bullet per volley.',            next: '+1 bullet' },
  chase:     { name: 'Chase',       cat: 'ATK',  adj: 'Seeking',  noun: 'Seekers',
    desc: 'Your bullets curve toward enemies.',           next: 'stronger homing' },
  pierce:    { name: 'Pierce',      cat: 'ATK',  adj: 'Piercing', noun: 'Lances',
    desc: 'Bullets punch through an extra enemy.',        next: '+1 pierce' },
  bounce:    { name: 'Bounce',      cat: 'ATK',  adj: 'Ricochet', noun: 'Ricochets',
    desc: 'Bullets bounce off the arena edges.',          next: '+1 bounce' },
  rapid:     { name: 'Rapid Fire',  cat: 'ATK',  adj: 'Rapid',    noun: 'Salvo',
    desc: 'Shoot faster.',                                next: '+14% fire rate' },
  big:       { name: 'Big Shots',   cat: 'ATK',  adj: 'Colossal', noun: 'Cannonade',
    desc: 'Bigger, harder-hitting bullets.',              next: '+18% size, +12% damage' },
  split:     { name: 'Split',       cat: 'ATK',  adj: 'Splitting',noun: 'Shards',
    desc: 'Kills burst into shrapnel.',                   next: '+1 shard on kill' },
  crit:      { name: 'Critical',    cat: 'ATK',  adj: 'Deadly',   noun: 'Edge',
    desc: 'Chance to deal 2.5× damage.',                  next: '+7% crit chance' },
  orbitals:  { name: 'Orbitals',    cat: 'ATK',  adj: 'Orbital',  noun: 'Blades',
    desc: 'Blades circle you and shred what they touch.', next: '+1 blade' },
  nova:      { name: 'Nova',        cat: 'ATK',  adj: 'Radiant',  noun: 'Nova',
    desc: 'Periodic ring of bullets in all directions.',  next: 'bigger, faster nova' },
  laser:     { name: 'Laser',       cat: 'ATK',  adj: 'Focused',  noun: 'Ray',
    desc: 'A piercing beam fires at the nearest enemy.',  next: 'faster, stronger beam' },
  lifesteal: { name: 'Lifesteal',   cat: 'DEF',  adj: 'Vampiric', noun: 'Leech',
    desc: 'Heal for a share of damage you deal.',         next: '+3% lifesteal' },
  shield:    { name: 'Shield',      cat: 'DEF',  adj: 'Bulwark',  noun: 'Aegis',
    desc: 'Charges that each block one hit, then recharge.', next: '+1 shield charge' },
  vitality:  { name: 'Vitality',    cat: 'DEF',  adj: 'Titan',    noun: 'Heart',
    desc: 'More max HP (and heals you now).',             next: '+20 max HP' },
  regen:     { name: 'Regen',       cat: 'DEF',  adj: 'Mending',  noun: 'Bloom',
    desc: 'Recover HP every second.',                     next: '+0.8 HP/s' },
  ghost:     { name: 'Ghost',       cat: 'DEF',  adj: 'Phantom',  noun: 'Veil',
    desc: 'Longer invincibility after taking a hit.',     next: '+0.3s invincibility' },
  speed:     { name: 'Speed',       cat: 'UTIL', adj: 'Swift',    noun: 'Dash',
    desc: 'Move faster.',                                 next: '+7% move speed' },
  magnet:    { name: 'Magnetic',    cat: 'UTIL', adj: 'Magnetic', noun: 'Pull',
    desc: 'Pull XP gems from farther away.',              next: '+45% pull radius' },
  slow:      { name: 'Slow Field',  cat: 'UTIL', adj: 'Temporal', noun: 'Field',
    desc: 'Enemies AND their bullets crawl near you.',    next: 'wider, stronger field' },
  bomb:      { name: 'Fire Rounds', cat: 'ATK',  adj: 'Burning',  noun: 'Inferno',
    desc: 'Your bullets ignite enemies — they keep burning after the hit.', next: '+22% burn damage' },
  rear:      { name: 'Rear Guard',  cat: 'ATK',  adj: 'Vengeful', noun: 'Rearguard',
    desc: 'Also fire a volley backwards.',                next: '+1 rear bullet' },
  side:      { name: 'Side Cannons',cat: 'ATK',  adj: 'Flanking', noun: 'Broadside',
    desc: 'Also fire volleys out of both sides.',         next: '+1 bullet per side' },
  arc:       { name: 'Chain Arc',   cat: 'ATK',  adj: 'Voltaic',  noun: 'Arc',
    desc: 'Hits can arc lightning to a nearby enemy.',    next: '+8% arc chance' },
  cull:      { name: 'Executioner', cat: 'ATK',  adj: 'Reaping',  noun: 'Scythe',
    desc: 'Instantly finish weakened enemies (not bosses).', next: 'cull at higher HP' },
  velocity:  { name: 'Velocity',    cat: 'ATK',  adj: 'Hypersonic', noun: 'Bolts',
    desc: 'Faster bullets that hit harder.',              next: '+12% bullet speed, +6% damage' },
  thorns:    { name: 'Thorns',      cat: 'DEF',  adj: 'Thorned',  noun: 'Bramble',
    desc: 'Taking a hit sears everything around you.',    next: 'stronger burst' },
  armor:     { name: 'Armor',       cat: 'DEF',  adj: 'Ironclad', noun: 'Plating',
    desc: 'Flat damage reduction on every hit taken.',    next: '−1.5 damage taken' },
  dodge:     { name: 'Evasion',     cat: 'DEF',  adj: 'Elusive',  noun: 'Mirage',
    desc: 'Chance to completely ignore a hit.',           next: '+4% dodge chance' },
  scavenger: { name: 'Scavenger',   cat: 'DEF',  adj: 'Feasting', noun: 'Harvest',
    desc: 'Kills can drop healing orbs.',                 next: '+5% orb chance' },
  greed:     { name: 'Greed',       cat: 'UTIL', adj: 'Gilded',   noun: 'Fortune',
    desc: 'XP gems are worth more.',                      next: '+10% XP value' },
  adrenaline:{ name: 'Adrenaline',  cat: 'UTIL', adj: 'Frenzied', noun: 'Rush',
    desc: 'Taking a hit supercharges your fire rate for a while.', next: 'longer rush' },
  shrink:    { name: 'Shrink',      cat: 'UTIL', adj: 'Slight',   noun: 'Needle',
    desc: 'Your hitbox gets smaller. Pure dodge power.',  next: '−6% hitbox size' },
  drones:    { name: 'Drones',      cat: 'ATK',  adj: 'Attendant', noun: 'Drones',
    desc: 'Option ships circle you and copy your shots.', next: '+1 drone' },
  missiles:  { name: 'Missiles',    cat: 'ATK',  adj: 'Ballistic', noun: 'Missiles',
    desc: 'Launch homing missiles that explode on impact.', next: '+1 missile, faster salvos' },
  mortar:    { name: 'Splash Rounds', cat: 'ATK', adj: 'Bursting', noun: 'Payload',
    desc: 'Every bullet hit splashes damage in an area around it.', next: 'wider, harder splash' },
  boom:      { name: 'Explosive Rounds', cat: 'ATK', adj: 'Explosive', noun: 'Rounds',
    desc: 'Your bullets can detonate on hit.',            next: '+8% detonation chance' },
  frost:     { name: 'Frost Shot',  cat: 'ATK',  adj: 'Frozen',   noun: 'Frost',
    desc: 'Hits can chill enemies, slowing them hard.',   next: '+10% chill chance' },
  impact:    { name: 'Impact',      cat: 'ATK',  adj: 'Concussive', noun: 'Impact',
    desc: 'Your bullets shove enemies backwards.',        next: 'stronger knockback' },
  turret:    { name: 'Turret',      cat: 'ATK',  adj: 'Bastion',  noun: 'Turrets',
    desc: 'Deploy auto-firing turrets where you fly.',    next: 'more turrets, faster deploys' },
  vortex:    { name: 'Vortex',      cat: 'ATK',  adj: 'Spiraling', noun: 'Vortex',
    desc: 'Rifts tear open, dragging enemies in and grinding them.', next: 'faster rifts' },
  graze:     { name: 'Graze',       cat: 'UTIL', adj: 'Grazing',  noun: 'Halo',
    desc: 'Bullets that barely miss you grant XP and heat up your damage.', next: 'wider ring, more heat' },
  ram:       { name: 'Ram',         cat: 'DEF',  adj: 'Rampaging', noun: 'Ram',
    desc: 'Slamming into enemies hurts THEM.',            next: 'harder ramming' },
};
const FAMILY_KEYS = Object.keys(FAMILIES);
const FAMILY_MAX = 9;

const CATS = {
  ATK:  { label: 'Attack',  color: '#6fd8ff' },
  DEF:  { label: 'Defense', color: '#54d68a' },
  UTIL: { label: 'Utility', color: '#c8a0ff' },
};

// ---------------------------------------------------------------------------
// Fusion tiers
// ---------------------------------------------------------------------------
const TIERS = [
  null,
  { tier: 1, name: 'Base',         color: '#9fb4c8', jp: '基', baseMult: 1.00, perLevel: 0,    maxLevel: FAMILY_MAX },
  { tier: 2, name: 'Fused',        color: '#54d68a', jp: '融', baseMult: 1.15, perLevel: 0.10, maxLevel: 9 },
  { tier: 3, name: 'Ascended',     color: '#4aa8ff', jp: '昇', baseMult: 1.35, perLevel: 0.10, maxLevel: 9 },
  { tier: 4, name: 'Transcendent', color: '#c063ff', jp: '超', baseMult: 1.60, perLevel: 0.12, maxLevel: 9 },
  { tier: 5, name: 'Mythic',       color: '#ffb454', jp: '神', baseMult: 2.00, perLevel: 0.15, maxLevel: 999 },
  { tier: 6, name: 'Primordial',   color: '#ff5f6d', jp: '原', baseMult: 1.00, perLevel: 0.25, maxLevel: 999 },
];

// ---------------------------------------------------------------------------
// PRIMORDIAL relics — tier 6. Not craftable, not fusable: a 0.01% roll on any
// level-up card slot (1 in 10,000). They ignore normal stat caps, never take
// a build slot, and each warps the game in its own way. +25% per level.
// ---------------------------------------------------------------------------
const PRIMORDIALS = {
  genesis:    { name: 'GENESIS ENGINE',
    desc: '+100% damage · +50% fire rate · +4 bullets · and your damage grows another +1% every second, forever' },
  worldheart: { name: 'WORLDHEART',
    desc: '+300 max HP · +10 HP/s regen · +25% lifesteal · you resurrect at full HP (90s cooldown)' },
  horizon:    { name: 'EVENT HORIZON',
    desc: 'a vast field slows enemies AND their bullets by 60% · every 10s a shockwave erases every enemy bullet on screen' },
  firstlight: { name: 'FIRST LIGHT',
    desc: 'a mega-laser fires every 1.5s · +50% crit chance · crits deal 4× damage' },
  swarm:      { name: 'ALPHA SWARM',
    desc: '+8 orbital blades · every kill bursts into homing shards' },
  omega:      { name: 'OMEGA PROTOCOL',
    desc: 'apocalypse barrage every 12s · +3 shield charges at double regen · massive splash on every bullet' },
};
const PRIMORDIAL_KEYS = Object.keys(PRIMORDIALS);
const PRIMORDIAL_CHANCE = 0.0001; // 0.01% per level-up card slot

function makePrimordialUnit(key) {
  return { kind: 'primordial', key, tier: 6, level: 1, stars: 0 };
}

// How ready a unit must be to auto-fuse.
const FUSE_READY_FAMILY_LEVEL = 3; // two Lv3+ families → Fused
const FUSE_READY_FUSION_LEVEL = 2; // two Lv2+ same-tier fusions → next tier

// ---------------------------------------------------------------------------
// Fusion specials — plain-language bonuses, deterministic per fusion name.
// game.js interprets `key`.
// ---------------------------------------------------------------------------
const SPECIALS = {
  2: [
    { key: 'dmg15',    label: '+15% damage' },
    { key: 'rate12',   label: '+12% fire rate' },
    { key: 'pierce1',  label: '+1 pierce' },
    { key: 'sparks',   label: 'kills spark a small blast' },
    { key: 'crit10',   label: '+10% crit chance' },
    { key: 'bullet1',  label: '+1 bullet' },
    { key: 'graze',    label: 'enemy bullets fly 10% slower' },
    { key: 'gemheal',  label: 'gems heal 1 HP' },
  ],
  3: [
    { key: 'echo',     label: 'every 6s: your volley echoes for free' },
    { key: 'dmg25',    label: '+25% damage' },
    { key: 'bullet2',  label: '+2 bullets' },
    { key: 'kilnova',  label: 'kills have 10% chance to burst into a nova' },
    { key: 'steel',    label: '+1 pierce and +1 bounce' },
  ],
  4: [
    { key: 'ripple',   label: 'every 12s: a time-ripple slows all enemy bullets' },
    { key: 'dmg40',    label: '+40% damage' },
    { key: 'guardian', label: 'shield breaks detonate a huge nova' },
    { key: 'drain',    label: '+5% lifesteal on everything' },
  ],
  5: [
    { key: 'phoenix',  label: 'PHOENIX — cheat death once per run' },
    { key: 'barrage',  label: 'APOCALYPSE — every 18s, bombs rain across the arena' },
    { key: 'infinity', label: 'INFINITY — ALL your effects +20%' },
  ],
};

const MYTH_BEINGS = ['OUROBOROS', 'LEVIATHAN', 'FENRIR', 'PHOENIX', 'BAHAMUT', 'AMATERASU',
  'SUSANOO', 'TIAMAT', 'CERBERUS', 'JORMUNGANDR', 'GILGAMESH', 'NYX'];

// ---------------------------------------------------------------------------
// Deterministic string hash (for picking specials / myth names)
// ---------------------------------------------------------------------------
function strHash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------
function makeFamilyUnit(key) {
  return { kind: 'family', key, tier: 1, level: 1, stars: 0 };
}

// First family key in a unit's tree — donates the adjective/noun for names.
function leadFamily(unit) {
  return unit.kind === 'family' ? unit.key : leadFamily(unit.members[0]);
}

function fusionName(a, b, tier) {
  // curated thematic names per pair (e.g. Lifesteal+Thorns = "Blood Barrier"),
  // falling back to adjective+noun if a pair is somehow missing
  const ka = leadFamily(a), kb = leadFamily(b);
  const ia = FAMILY_KEYS.indexOf(ka), ib = FAMILY_KEYS.indexOf(kb);
  const key = ia <= ib ? ka + '|' + kb : kb + '|' + ka;
  const core = (typeof FUSION_NAMES !== 'undefined' && FUSION_NAMES[key]) ||
    `${FAMILIES[ka].adj} ${FAMILIES[kb].noun}`;
  if (tier === 3) return `Ascended ${core}`;
  if (tier === 4) return `Transcendent ${core}`;
  if (tier === 5) return `${MYTH_BEINGS[strHash(core) % MYTH_BEINGS.length]} — ${core}`;
  return core;
}

function makeFusion(a, b) {
  const tier = Math.min(5, Math.max(a.tier, b.tier) + 1);
  const name = fusionName(a, b, tier);
  const pool = SPECIALS[tier];
  return {
    kind: 'fusion', tier, name, level: 1, stars: 0,
    special: pool[strHash(name) % pool.length],
    members: [a, b],
  };
}

// ★ Overcharge: Mythic + Mythic → one Mythic, stars +1, members pooled.
function overcharge(a, b) {
  const keep = a.stars >= b.stars ? a : b, eat = keep === a ? b : a;
  keep.stars += 1;
  keep.level = Math.max(keep.level, eat.level);
  keep.members = keep.members.concat(eat.members);
  return keep;
}

// ---------------------------------------------------------------------------
// Walking a build — every family in the tree contributes its frozen level,
// amplified by every fusion above it (and ★s), so fusing is always a buff.
// ---------------------------------------------------------------------------
function unitAmp(unit) {
  const T = TIERS[unit.tier];
  let amp = T.baseMult + T.perLevel * (unit.level - 1);
  amp *= Math.pow(1.5, unit.stars || 0);
  return amp;
}

// Calls cb(familyKey, effectiveLevel) for each family in the unit's tree.
// Primordial relics don't map to families — the engine applies them directly.
function walkUnit(unit, cb, amp) {
  amp = (amp || 1) * unitAmp(unit);
  if (unit.kind === 'family') { cb(unit.key, unit.level * amp); return; }
  if (unit.kind !== 'fusion') return;
  for (const m of unit.members) walkUnit(m, cb, amp);
}

// Calls cb(special, fusionLevel) for each fusion special in the tree.
function walkSpecials(unit, cb) {
  if (unit.kind !== 'fusion') return;
  cb(unit.special, unit.level);
  for (const m of unit.members) walkSpecials(m, cb);
}

// Plain-language summary lines for a unit (cards, pause screen, death screen).
function unitSummary(unit) {
  if (unit.kind === 'primordial') {
    return { effects: [PRIMORDIALS[unit.key].desc], specials: [] };
  }
  const fams = new Map();
  walkUnit(unit, (key, lv) => fams.set(key, (fams.get(key) || 0) + lv));
  const lines = [...fams.entries()].map(([key, lv]) =>
    `${FAMILIES[key].name} ${lv >= 10 ? String(Math.round(lv)) : lv.toFixed(1).replace(/\.0$/, '')}`);
  const specials = [];
  walkSpecials(unit, (sp) => specials.push(sp.label));
  return { effects: lines, specials };
}

// ---------------------------------------------------------------------------
// Automatic fusion check — returns a description of what fused (or null).
// Mutates `units` in place. Call after every acquisition/level-up.
// ---------------------------------------------------------------------------
function autoFuse(units) {
  // lowest tier fuses first so ladders build bottom-up
  for (let tier = 1; tier <= 5; tier++) {
    const ready = units.filter(u =>
      u.tier === tier &&
      (tier === 1 ? (u.kind === 'family' && u.level >= FUSE_READY_FAMILY_LEVEL)
       : tier === 5 ? (u.kind === 'fusion')                                   // two Mythics overcharge on sight
                    : (u.kind === 'fusion' && u.level >= FUSE_READY_FUSION_LEVEL)));
    if (ready.length < 2) continue;
    const [a, b] = ready;                    // acquisition order — oldest first
    const ia = units.indexOf(a), ib = units.indexOf(b);
    if (tier === 5) {
      const merged = overcharge(a, b);
      units.splice(Math.max(ia, ib), 1);
      return { kind: 'overcharge', unit: merged,
        title: `★ OVERCHARGE — ${merged.name}`,
        subtitle: `now ★${merged.stars} — everything ×1.5, forever stackable` };
    }
    const fusion = makeFusion(a, b);
    units.splice(Math.max(ia, ib), 1);
    units.splice(Math.min(ia, ib), 1, fusion);
    const nameA = a.kind === 'family' ? FAMILIES[a.key].name : a.name;
    const nameB = b.kind === 'family' ? FAMILIES[b.key].name : b.name;
    return { kind: 'fusion', unit: fusion,
      title: `⚡ AUTO-FUSION — ${fusion.name}`,
      subtitle: `${nameA} + ${nameB} merged · bonus: ${fusion.special.label}` };
  }
  return null;
}
