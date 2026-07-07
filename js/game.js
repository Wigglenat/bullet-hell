'use strict';
/* ============================================================================
 * SPACE SOULS — readable bullet-hell, classic powers, automatic fusion.
 * Requires powers.js (FAMILIES, TIERS, SPECIALS, makeFamilyUnit, autoFuse…).
 *
 * Readability rules this engine follows:
 *   - enemy bullets are magenta/white, biggest glow, drawn ON TOP of everything
 *   - player bullets are cool cyan and visually quiet
 *   - no damage-number spam; text is reserved for events that matter
 *   - the player ship is bright white with a red hitbox dot, always visible
 * ==========================================================================*/

// ---------------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------------
const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');
const IS_TOUCH = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
// Zoomed-out camera: the world is bigger than the window and rendered scaled
// down — more room to weave. Phones zoom out less so bullets stay readable.
const ZOOM = IS_TOUCH ? 0.72 : 0.6;
let W = 0, H = 0, dprCur = 1;
function resize() {
  dprCur = Math.min(window.devicePixelRatio || 1, 2);
  W = Math.round(window.innerWidth / ZOOM);
  H = Math.round(window.innerHeight / ZOOM);
  cv.width = Math.floor(window.innerWidth * dprCur);
  cv.height = Math.floor(window.innerHeight * dprCur);
  ctx.setTransform(dprCur * ZOOM, 0, 0, dprCur * ZOOM, 0, 0);
}
window.addEventListener('resize', resize); resize();

// ---------------------------------------------------------------------------
// Utils
// ---------------------------------------------------------------------------
const TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const fmt = (n) => n.toLocaleString('en-US');

// ---------------------------------------------------------------------------
// Sprites — pre-rendered glow dots
// ---------------------------------------------------------------------------
const spriteCache = new Map();
function glowSprite(key, r, build) {
  const k = key + '|' + (r | 0);
  let s = spriteCache.get(k);
  if (s) return s;
  const R = (r | 0) + 7, size = R * 2;
  const c = document.createElement('canvas'); c.width = size; c.height = size;
  build(c.getContext('2d'), R, r);
  s = { c, R };
  spriteCache.set(k, s);
  return s;
}
function pBulletSprite(r) {
  return glowSprite('p', r, (g, R) => {
    const grad = g.createRadialGradient(R, R, 0, R, R, R);
    grad.addColorStop(0, 'rgba(255,255,255,.95)');
    grad.addColorStop(0.4, 'rgba(110,220,255,.55)');
    grad.addColorStop(1, 'rgba(110,220,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, R * 2, R * 2);
  });
}
function eBulletSprite(r) {
  return glowSprite('e', r, (g, R, rr) => {
    // dark contrast halo → magenta ring → white core: readable on anything
    g.fillStyle = 'rgba(5,5,15,.85)';
    g.beginPath(); g.arc(R, R, rr + 3.5, 0, TAU); g.fill();
    g.fillStyle = '#ff2a7a';
    g.beginPath(); g.arc(R, R, rr + 1.5, 0, TAU); g.fill();
    g.fillStyle = '#ffffff';
    g.beginPath(); g.arc(R, R, Math.max(1.5, rr - 2), 0, TAU); g.fill();
  });
}
function gemSprite() {
  return glowSprite('g', 6, (g, R) => {
    const grad = g.createRadialGradient(R, R, 0, R, R, R);
    grad.addColorStop(0, 'rgba(160,255,190,.9)');
    grad.addColorStop(1, 'rgba(84,214,138,0)');
    g.fillStyle = grad; g.fillRect(0, 0, R * 2, R * 2);
    g.fillStyle = '#54d68a';
    g.beginPath(); g.moveTo(R, R - 5); g.lineTo(R + 4, R); g.lineTo(R, R + 5); g.lineTo(R - 4, R);
    g.closePath(); g.fill();
  });
}
function healSprite() {
  return glowSprite('hl', 7, (g, R) => {
    const grad = g.createRadialGradient(R, R, 0, R, R, R);
    grad.addColorStop(0, 'rgba(255,180,200,.95)');
    grad.addColorStop(1, 'rgba(255,90,130,0)');
    g.fillStyle = grad; g.fillRect(0, 0, R * 2, R * 2);
    g.fillStyle = '#ff5f7d';
    g.fillRect(R - 1.5, R - 5, 3, 10); // little plus sign
    g.fillRect(R - 5, R - 1.5, 10, 3);
  });
}

// ---------------------------------------------------------------------------
// Tiny synth
// ---------------------------------------------------------------------------
const SFX = (() => {
  let ac = null, muted = false;
  function init() { if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } }
  function blip(freq, dur, type, vol) {
    if (!ac || muted) return;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
    o.connect(g); g.connect(ac.destination);
    o.start(); o.stop(ac.currentTime + dur);
  }
  return {
    init, toggle() { muted = !muted; return muted; },
    kill()  { blip(rand(180, 240), 0.06, 'square', 0.02); },
    hurt()  { blip(90, 0.25, 'sawtooth', 0.06); },
    gem()   { blip(rand(900, 1080), 0.04, 'sine', 0.015); },
    level() { blip(520, 0.12, 'triangle', 0.05); setTimeout(() => blip(780, 0.18, 'triangle', 0.05), 90); },
    fuse()  { [330, 440, 660].forEach((f, i) => setTimeout(() => blip(f, 0.2, 'triangle', 0.05), i * 90)); },
    mythic(){ [440, 554, 659, 880].forEach((f, i) => setTimeout(() => blip(f, 0.25, 'triangle', 0.05), i * 100)); },
    shield(){ blip(1200, 0.1, 'sine', 0.05); },
    bomb()  { blip(60, 0.4, 'sawtooth', 0.08); },
  };
})();

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const keys = new Set();
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  keys.add(k);
  if (k === 'tab') e.preventDefault();
  handleKey(k);
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

// ---------------------------------------------------------------------------
// Touch input — floating analog joystick: drag anywhere on the battlefield.
// Full drag = full speed; a light drag moves slowly (mobile "focus" mode).
// Joystick math and drawing live in SCREEN pixels, independent of the zoom.
// ---------------------------------------------------------------------------
const joy = { active: false, id: -1, sx: 0, sy: 0, x: 0, y: 0, R: 64 };
if (IS_TOUCH) document.body.classList.add('touch');

cv.addEventListener('touchstart', (e) => {
  e.preventDefault();
  if (joy.active) return;              // one steering finger; extra fingers ignored
  const t = e.changedTouches[0];
  joy.active = true; joy.id = t.identifier;
  joy.sx = joy.x = t.clientX; joy.sy = joy.y = t.clientY;
}, { passive: false });
cv.addEventListener('touchmove', (e) => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier === joy.id) { joy.x = t.clientX; joy.y = t.clientY; }
  }
}, { passive: false });
function joyEnd(e) {
  for (const t of e.changedTouches) {
    if (t.identifier === joy.id) { joy.active = false; joy.id = -1; }
  }
}
cv.addEventListener('touchend', joyEnd);
cv.addEventListener('touchcancel', joyEnd);

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const ST = { TITLE: 0, PLAY: 1, LEVELUP: 2, PAUSE: 3, DEAD: 4 };
let state = ST.TITLE;

const store = (() => { try { const s = window.localStorage; s.getItem('x'); return s; } catch (e) { return null; } })();
let bestWave = +((store && (store.getItem('spacesouls.bestWave') || store.getItem('myriad.bestWave'))) || 0);

const G = {};
function newRun() {
  Object.assign(G, {
    time: 0, wave: 1, waveT: 0, sector: 1, spoilsQueue: [], ngPlus: 0, kills: 0, fusions: 0, dmgDealt: 0,
    level: 1, xp: 0, xpNeed: xpNeed(1), pendingLevels: 0,
    px: W / 2, py: H * 0.7, pr: 3.5, hp: 100, iT: 0, focus: false,
    faceX: 0, faceY: -1, shake: 0, phoenixUsed: false,
    units: [], ess: { dmg: 0, rate: 0, life: 0 },
    stats: null, shield: 0, shieldT: 0,
    gunAcc: 0, novaT: 3, laserT: 3, echoT: 6, rippleT: 12, barrageT: 18, bombT: 0,
    rippleActive: 0, bladeCd: [], rampStart: null, rampMult: 1, pulseT: 0, rebirthT: 0, adrenT: 0,
    missileT: 2, mortarT: 2.5, turretT: 3, vortexT: 4, heatT: 0,
    eliteT: 20, eliteSpoils: 0,
    enemies: [], pB: [], eB: [], gems: [], parts: [], zones: [], beams: [], floats: [],
    turrets: [], vortices: [],
    spawnT: 1.0, bossAlive: null, bannerQ: [], bannerT: 0,
  });
  // starting kit: +Bullets Lv1 — instantly legible
  G.units.push(makeFamilyUnit('bullets'));
  recompute();
  G.hp = G.stats.maxHp;
}
function xpNeed(lv) { return Math.floor(5 + lv * 3 + lv * lv * 0.2); }
function checkLevel() {
  while (G.xp >= G.xpNeed) { G.xp -= G.xpNeed; G.level++; G.xpNeed = xpNeed(G.level); G.pendingLevels++; }
}

// ---------------------------------------------------------------------------
// Stats — one aggregate, recomputed only when the build changes
// ---------------------------------------------------------------------------
function recompute() {
  const s = {
    dmg: 10, rate: 2.0, count: 1, speed: 400, size: 5,
    pierce: 0, bounce: 0, homing: 0, splitShards: 0, crit: 0.03,
    lifesteal: 0, shieldMax: 0, shieldRegen: 10,
    maxHp: 100, regen: 0, moveSpd: 270, ghostT: 0.9,
    magnetR: 90, slowR: 0, slowEnemy: 0, slowBullet: 0,
    bombR: 0, bombCd: 0, novaLv: 0, novaCd: 0, laserLv: 0, laserCd: 0,
    orbitals: 0, grazeSlow: 0, gemHeal: 0, sparks: false, kilnova: 0,
    echo: false, ripple: false, guardian: false, phoenix: false, barrage: false,
    allMult: 1, critMult: 2.5, ramp: 0, pulse: 0, rebirth: false, barrageCd: 18,
    shardHoming: false,
    rear: 0, side: 0, arc: 0, cull: 0, thorns: 0, armor: 0, dodge: 0,
    scav: 0, xpMult: 1, adren: 0, hitR: 3.5,
    drones: 0, missiles: 0, missileCd: 0, mortar: 0, mortarCd: 0, boom: 0,
    frost: 0, knock: 0, turrets: 0, turretCd: 0, vortex: 0, vortexCd: 0,
    graze: 0, grazeR: 0, grazeHeat: 0, ram: 0,
  };
  s.dmg *= 1 + 0.04 * G.ess.dmg;
  s.rate *= 1 + 0.03 * G.ess.rate;
  s.maxHp += 10 * G.ess.life;

  for (const u of G.units) walkUnit(u, (key, L) => {
    switch (key) {
      case 'bullets':   s.count += Math.round(L); break;
      case 'chase':     s.homing += 1.8 * L; break;
      case 'pierce':    s.pierce += Math.round(L); break;
      case 'bounce':    s.bounce += Math.round(L); break;
      case 'rapid':     s.rate *= 1 + 0.14 * L; break;
      case 'big':       s.size *= 1 + 0.18 * Math.min(L, 8); s.dmg *= 1 + 0.12 * L; break;
      case 'split':     s.splitShards += Math.round(L); break;
      case 'crit':      s.crit += 0.07 * L; break;
      case 'orbitals':  s.orbitals += Math.round(L); break;
      case 'nova':      s.novaLv += L; break;
      case 'laser':     s.laserLv += L; break;
      case 'lifesteal': s.lifesteal += 0.03 * L; break;
      case 'shield':    s.shieldMax += Math.round(L); s.shieldRegen = Math.max(4, 10 - 0.4 * L); break;
      case 'vitality':  s.maxHp += 20 * L; break;
      case 'regen':     s.regen += 0.8 * L; break;
      case 'ghost':     s.ghostT += 0.3 * L; break;
      case 'speed':     s.moveSpd *= 1 + 0.07 * Math.min(L, 10); break;
      case 'magnet':    s.magnetR *= 1 + 0.45 * L; break;
      case 'slow':      s.slowR = Math.max(s.slowR, 90 + 22 * L);
                        s.slowEnemy = Math.min(0.7, Math.max(s.slowEnemy, 0.18 + 0.04 * L));
                        s.slowBullet = Math.min(0.6, Math.max(s.slowBullet, 0.10 + 0.035 * L)); break;
      case 'bomb':      s.bombR = Math.max(s.bombR, 120 + 14 * L);
                        s.bombCd = s.bombCd ? Math.min(s.bombCd, Math.max(6, 20 - 1.6 * L)) : Math.max(6, 20 - 1.6 * L); break;
      case 'rear':      s.rear += Math.round(L); break;
      case 'side':      s.side += Math.round(L); break;
      case 'arc':       s.arc = Math.min(0.65, s.arc + 0.08 * L); break;
      case 'cull':      s.cull = Math.min(0.32, Math.max(s.cull, 0.06 + 0.02 * L)); break;
      case 'velocity':  s.speed *= 1 + 0.12 * Math.min(L, 10); s.dmg *= 1 + 0.06 * L; break;
      case 'thorns':    s.thorns += L; break;
      case 'armor':     s.armor += 1.5 * L; break;
      case 'dodge':     s.dodge = Math.min(0.5, s.dodge + 0.04 * L); break;
      case 'scavenger': s.scav = Math.min(0.55, s.scav + 0.05 * L); break;
      case 'greed':     s.xpMult += 0.10 * L; break;
      case 'adrenaline':s.adren = Math.max(s.adren, 3 + 0.5 * L); break;
      case 'shrink':    s.hitR = Math.min(s.hitR, Math.max(1.6, 3.5 * (1 - 0.06 * Math.min(L, 9)))); break;
      case 'drones':    s.drones = Math.min(6, s.drones + Math.round(L)); break;
      case 'missiles':  s.missiles = Math.min(8, s.missiles + Math.round(L));
                        s.missileCd = Math.max(1.2, 2.4 - 0.15 * L); break;
      case 'mortar':    s.mortar += L; s.mortarCd = Math.max(1.6, 3.2 - 0.18 * L); break;
      case 'boom':      s.boom = Math.min(0.6, s.boom + 0.08 * L); break;
      case 'frost':     s.frost = Math.min(0.8, s.frost + 0.10 * L); break;
      case 'impact':    s.knock += 90 * L; break;
      case 'turret':    s.turrets = Math.min(4, Math.max(s.turrets, 1 + Math.floor(L / 3)));
                        s.turretCd = Math.max(3, 6 - 0.3 * L); break;
      case 'vortex':    s.vortex += L; s.vortexCd = Math.max(3.5, 7 - 0.3 * L); break;
      case 'graze':     s.graze += L; s.grazeR = Math.min(64, 30 + 2.5 * L);
                        s.grazeHeat = Math.min(0.35, 0.02 * L + s.grazeHeat); break;
      case 'ram':       s.ram += 0.35 * L; break;
    }
  });
  for (const u of G.units) walkSpecials(u, (sp) => {
    switch (sp.key) {
      case 'dmg15': s.dmg *= 1.15; break;
      case 'rate12': s.rate *= 1.12; break;
      case 'pierce1': s.pierce += 1; break;
      case 'sparks': s.sparks = true; break;
      case 'crit10': s.crit += 0.10; break;
      case 'bullet1': s.count += 1; break;
      case 'graze': s.grazeSlow = Math.min(0.4, s.grazeSlow + 0.10); break;
      case 'gemheal': s.gemHeal += 1; break;
      case 'echo': s.echo = true; break;
      case 'dmg25': s.dmg *= 1.25; break;
      case 'bullet2': s.count += 2; break;
      case 'kilnova': s.kilnova = Math.min(0.5, s.kilnova + 0.10); break;
      case 'steel': s.pierce += 1; s.bounce += 1; break;
      case 'ripple': s.ripple = true; break;
      case 'dmg40': s.dmg *= 1.40; break;
      case 'guardian': s.guardian = true; break;
      case 'drain': s.lifesteal += 0.05; break;
      case 'phoenix': s.phoenix = true; break;
      case 'barrage': s.barrage = true; break;
      case 'infinity': s.allMult *= 1.2; break;
    }
  });
  s.dmg *= s.allMult;
  s.rate *= 1 + (s.allMult - 1) * 0.5;
  s.moveSpd *= 1 + (s.allMult - 1) * 0.25;
  // readability caps — damage scales forever, the SCREEN stays legible
  s.rate = Math.min(s.rate, 14);
  s.count = Math.min(s.count, 24);
  s.size = Math.min(s.size, 15);
  s.orbitals = Math.min(s.orbitals, 12);
  s.slowR = Math.min(s.slowR, 260);
  s.splitShards = Math.min(s.splitShards, 12);
  s.magnetR = Math.min(s.magnetR, 900);
  s.moveSpd = Math.min(s.moveSpd, 460);
  s.novaCd = s.novaLv > 0 ? Math.max(2.2, 6 - 0.4 * s.novaLv) : 0;
  s.laserCd = s.laserLv > 0 ? Math.max(2.2, 7 - 0.5 * s.laserLv) : 0;

  // PRIMORDIAL relics — applied last, deliberately beyond the normal caps
  for (const u of G.units) {
    if (u.kind !== 'primordial') continue;
    const k = unitAmp(u); // 1 + 0.25 per level
    switch (u.key) {
      case 'genesis':
        s.dmg *= 1 + 1.0 * k;
        s.rate = Math.min(20, s.rate * (1 + 0.5 * k));
        s.count = Math.min(32, s.count + Math.round(4 * k));
        s.ramp += 0.01 * k;
        break;
      case 'worldheart':
        s.maxHp += Math.round(300 * k);
        s.regen += 10 * k;
        s.lifesteal = Math.min(0.6, s.lifesteal + 0.25);
        s.rebirth = true;
        break;
      case 'horizon':
        s.slowR = Math.max(s.slowR, 480);
        s.slowEnemy = Math.max(s.slowEnemy, 0.6);
        s.slowBullet = Math.max(s.slowBullet, 0.6);
        s.pulse = 10;
        break;
      case 'firstlight':
        s.laserLv += 8 * k;
        s.laserCd = 1.5;
        s.crit += 0.5;
        s.critMult = 4;
        break;
      case 'swarm':
        s.orbitals = Math.min(20, s.orbitals + 8);
        s.splitShards = Math.min(20, s.splitShards + 6);
        s.shardHoming = true;
        break;
      case 'omega':
        s.barrage = true;
        s.barrageCd = Math.max(6, 12 / k);
        s.shieldMax += 3;
        s.shieldRegen *= 0.5;
        s.bombR = Math.max(s.bombR, 220);
        s.bombCd = Math.min(s.bombCd || 6, 2);
        break;
    }
  }

  const oldMax = G.stats ? G.stats.maxHp : s.maxHp;
  G.stats = s;
  if (s.maxHp > oldMax) G.hp = Math.min(s.maxHp, G.hp + (s.maxHp - oldMax)); // growing maxHp heals the difference
  G.shield = Math.min(G.shield, s.shieldMax);
  if (G.bladeCd.length !== s.orbitals) G.bladeCd = new Array(s.orbitals).fill(0);
  refreshChips();
}

// ---------------------------------------------------------------------------
// Build changes
// ---------------------------------------------------------------------------
const MAX_UNITS = 6;

function applyCard(card) {
  if (card.type === 'new') {
    if (!FAMILIES[card.key]) return;
    G.units.push(makeFamilyUnit(card.key));
    announce(FAMILIES[card.key].name + ' acquired', CATS[FAMILIES[card.key].cat].color);
  } else if (card.type === 'level') {
    card.u.level++;
  } else if (card.type === 'ess') {
    G.ess[card.key]++;
    if (card.key === 'life') G.hp = Math.min((G.stats ? G.stats.maxHp : 100) + 10, G.hp + 40);
  } else if (card.type === 'primordial') {
    G.units.push(makePrimordialUnit(card.key));
    if (card.key === 'genesis' && G.rampStart === null) G.rampStart = G.time;
    G.bannerQ.push({
      title: '🜏 PRIMORDIAL — ' + PRIMORDIALS[card.key].name,
      subtitle: PRIMORDIALS[card.key].desc,
    });
    if (G.bannerQ.length > 6) G.bannerQ.shift();
    G.shake = Math.max(G.shake, 10);
    SFX.mythic();
  }
  // automatic fusions — may ladder (Fused → Ascended → …), one banner each
  let f;
  while ((f = autoFuse(G.units))) {
    G.fusions++;
    G.bannerQ.push(f);
    if (G.bannerQ.length > 6) G.bannerQ.shift();
    if (f.unit.tier === 5 || f.kind === 'overcharge') SFX.mythic(); else SFX.fuse();
  }
  recompute();
}

function announce(txt, color) {
  G.floats.push({ x: G.px, y: G.py - 30, txt, color: color || '#dfe6ff', t: 0, life: 1.2 });
  if (G.floats.length > 24) G.floats.shift();
}

// ---------------------------------------------------------------------------
// Level-up cards
// ---------------------------------------------------------------------------
function cardPool(spoils) {
  const pool = [];
  for (const u of G.units) {
    if (u.level >= TIERS[u.tier].maxLevel) continue;
    // deepening beats widening: level-ups outweigh new families, and a family
    // one pick from fusion-ready (Lv2 → Lv3) is pushed hard so merges HAPPEN
    let w = 4;
    if (u.kind === 'primordial') w = 1;
    else if (u.kind === 'family' && u.level === 2) w = 8;
    else if (u.kind === 'fusion' && u.level === 1) w = 6; // one pick from the next tier
    pool.push({ type: 'level', u, w });
  }
  if (spoils && pool.length) return pool; // elite spoils: pure deepening
  if (G.units.filter(u => u.kind !== 'primordial').length < MAX_UNITS) { // relics don't take slots
    for (const key of FAMILY_KEYS) {
      if (!G.units.some(u => u.kind === 'family' && u.key === key)) pool.push({ type: 'new', key, w: 2 });
    }
  }
  pool.push({ type: 'ess', key: 'dmg', w: 1 }, { type: 'ess', key: 'rate', w: 1 }, { type: 'ess', key: 'life', w: 1 });
  return pool;
}

function drawCards(n, spoils) {
  const pool = cardPool(spoils), out = [];
  for (let k = 0; k < n && pool.length; k++) {
    let total = 0;
    for (const c of pool) total += c.w;
    let r = Math.random() * total, idx = 0;
    for (; idx < pool.length - 1; idx++) { r -= pool[idx].w; if (r <= 0) break; }
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}

const ESS_INFO = {
  dmg:  { name: 'Essence of Power', desc: 'Permanent +4% damage.',           color: '#ff8a5a' },
  rate: { name: 'Essence of Haste', desc: 'Permanent +3% fire rate.',        color: '#6fd8ff' },
  life: { name: 'Essence of Life',  desc: 'Heal 40 HP and gain +10 max HP.', color: '#54d68a' },
};

function cardHTML(card) {
  if (card.type === 'primordial') {
    const P = PRIMORDIALS[card.key], T = TIERS[6];
    return { border: T.color, cls: 'cardPrimordial', html: `
      <span class="tierTag" style="border-color:${T.color};color:${T.color}">${T.jp} PRIMORDIAL · 1 in 10,000</span>
      <h3>🜏 ${P.name}</h3>
      <div class="desc">${P.desc}</div>` };
  }
  if (card.type === 'new') {
    const F = FAMILIES[card.key], C = CATS[F.cat];
    return { border: C.color, html: `
      <span class="tierTag" style="border-color:${C.color};color:${C.color}">NEW · ${C.label}</span>
      <h3>${F.name}</h3>
      <div class="desc">${F.desc}</div>` };
  }
  if (card.type === 'level') {
    const u = card.u;
    if (u.kind === 'primordial') {
      const P = PRIMORDIALS[u.key], T = TIERS[6];
      return { border: T.color, cls: 'cardPrimordial', html: `
        <span class="tierTag" style="border-color:${T.color};color:${T.color}">${T.jp} Primordial · Lv ${u.level} → ${u.level + 1}</span>
        <h3>🜏 ${P.name}</h3>
        <div class="desc">${P.desc}<br><b style="color:${T.color}">Next: all of it, +25% stronger</b></div>` };
    }
    if (u.kind === 'family') {
      const F = FAMILIES[u.key], C = CATS[F.cat];
      return { border: C.color, html: `
        <span class="tierTag" style="border-color:${C.color};color:${C.color}">${C.label} · Lv ${u.level} → ${u.level + 1}</span>
        <h3>${F.name}</h3>
        <div class="desc">${F.desc}<br><b style="color:${C.color}">Next: ${F.next}</b></div>` };
    }
    const T = TIERS[u.tier], sum = unitSummary(u);
    return { border: T.color, html: `
      <span class="tierTag" style="border-color:${T.color};color:${T.color}">${T.jp} ${T.name} · Lv ${u.level} → ${u.level + 1}</span>
      <h3>${'★'.repeat(Math.min(u.stars, 5))} ${u.name}</h3>
      <div class="desc">All of it, +10% stronger:<br>${sum.effects.join(' · ')}
      ${sum.specials.length ? '<br><b>' + sum.specials.join(' · ') + '</b>' : ''}</div>` };
  }
  const E = ESS_INFO[card.key];
  return { border: E.color, html: `
    <span class="tierTag" style="border-color:${E.color};color:${E.color}">Essence</span>
    <h3>${E.name}</h3>
    <div class="desc">${E.desc}</div>` };
}

function openLevelUp() {
  state = ST.LEVELUP;
  G.pendingLevels--;
  SFX.level();
  let spoils = null; // warden spoils outrank elite spoils
  if (G.spoilsQueue.length) spoils = G.spoilsQueue.shift();
  else if (G.eliteSpoils > 0) { G.eliteSpoils--; spoils = 'elite'; }
  const SPOILS_INFO = {
    sector:   { chance: PRIMORDIAL_CHANCE + 0.01, force: 0, label: '⚔ SECTOR SPOILS — DOUBLE levels · Primordial odds 1.01% (0.01% + 1%)' },
    galaxy:   { chance: PRIMORDIAL_CHANCE + 0.02, force: 0, label: '⚔ GALAXY SPOILS — DOUBLE levels · Primordial odds 2.01%' },
    universe: { chance: PRIMORDIAL_CHANCE + 0.05, force: 1, label: '⚔ UNIVERSE SPOILS — DOUBLE levels · 5.01% + one GUARANTEED Primordial' },
    final:    { chance: 1,                        force: 3, label: '☠ THE LAST SPOILS — pure Primordial' },
    elite:    { chance: PRIMORDIAL_CHANCE * 50,   force: 0, label: '★ ELITE SPOILS — cards grant DOUBLE levels · Primordial odds ×50' },
  };
  const SP = spoils ? SPOILS_INFO[spoils] : null;
  const subEl = document.querySelector('#ovLevel .sub');
  if (subEl) subEl.textContent = SP ? SP.label : 'Choose one.';
  const wrap = document.getElementById('cards');
  wrap.innerHTML = '';
  const cards = drawCards(3, !!spoils);
  // PRIMORDIAL roll — 0.01% base, boosted by spoils tier
  const primChance = SP ? SP.chance : PRIMORDIAL_CHANCE;
  function primCard() {
    const unowned = PRIMORDIAL_KEYS.filter(k => !G.units.some(u => u.kind === 'primordial' && u.key === k));
    if (unowned.length) return { type: 'primordial', key: unowned[(Math.random() * unowned.length) | 0] };
    const owned = G.units.filter(u => u.kind === 'primordial');
    return { type: 'level', u: owned[(Math.random() * owned.length) | 0] };
  }
  for (let i = 0; i < cards.length; i++) {
    if (SP && i < SP.force) { cards[i] = primCard(); continue; } // guaranteed slots
    if (Math.random() >= primChance) continue;
    cards[i] = primCard();
  }
  for (const card of cards) {
    const info = cardHTML(card);
    const el = document.createElement('div');
    el.className = 'card' + (info.cls ? ' ' + info.cls : '');
    el.style.borderColor = info.border;
    el.innerHTML = info.html;
    el.addEventListener('click', () => {
      applyCard(card);
      if (spoils && card.type === 'level' && card.u.level < TIERS[card.u.tier].maxLevel) {
        applyCard(card); // elite spoils: double level
      }
      G.hp = Math.min(G.stats.maxHp, G.hp + G.stats.maxHp * 0.15);
      closeOverlays();
      if (G.pendingLevels > 0) openLevelUp();
      else state = ST.PLAY;
    });
    wrap.appendChild(el);
  }
  document.getElementById('ovLevel').classList.add('on');
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------
const CAP = { pB: 1400, eB: 700, enemies: 200, parts: 350, gems: 400 };
function poolPush(arr, cap, obj) { if (arr.length >= cap) arr.shift(); arr.push(obj); return obj; }

function spawnEB(o) {
  return poolPush(G.eB, CAP.eB, Object.assign({ x: 0, y: 0, vx: 0, vy: 0, t: 0, life: 7, size: 5, dmg: 10 }, o));
}
function burst(x, y, color, n, speed) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, sp = rand(speed * 0.3, speed);
    poolPush(G.parts, CAP.parts, { x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: 0, life: rand(0.2, 0.45), color, size: rand(1.5, 3) });
  }
}

// ---------------------------------------------------------------------------
// Spatial hash
// ---------------------------------------------------------------------------
const CELL = 72;
const grid = new Map();
function gridKey(cx, cy) { return cx * 4096 + cy; }
function rebuildGrid() {
  grid.clear();
  for (const en of G.enemies) {
    const key = gridKey((en.x / CELL) | 0, (en.y / CELL) | 0);
    let cell = grid.get(key);
    if (!cell) { cell = []; grid.set(key, cell); }
    cell.push(en);
  }
}
const _near = [];
function nearEnemies(x, y, r, out) {
  out.length = 0;
  const x0 = ((x - r) / CELL) | 0, x1 = ((x + r) / CELL) | 0;
  const y0 = ((y - r) / CELL) | 0, y1 = ((y + r) / CELL) | 0;
  for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
    const cell = grid.get(gridKey(cx, cy));
    if (cell) for (const en of cell) out.push(en);
  }
  return out;
}
function nearestEnemy(x, y) {
  let best = null, bd = Infinity;
  for (const en of G.enemies) {
    const d = dist2(x, y, en.x, en.y);
    if (d < bd) { bd = d; best = en; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Firing
// ---------------------------------------------------------------------------
function aimAngle() {
  const t = nearestEnemy(G.px, G.py);
  if (t) return Math.atan2(t.y - G.py, t.x - G.px);
  return Math.atan2(G.faceY, G.faceX);
}

function fireFan(a0, n, dmgMult) {
  const s = G.stats;
  const spread = Math.min(0.55, 0.085 * (n - 1));
  for (let i = 0; i < n; i++) {
    const a = n === 1 ? a0 : a0 - spread / 2 + spread * (i / (n - 1));
    poolPush(G.pB, CAP.pB, {
      x: G.px, y: G.py, vx: Math.cos(a) * s.speed, vy: Math.sin(a) * s.speed,
      t: 0, life: 1.5 + s.bounce * 0.5, size: s.size, dmg: s.dmg * dmgMult,
      pierce: s.pierce, bounce: s.bounce, homing: s.homing, hit: null,
    });
  }
}

function dronePos(i, n) {
  const a = G.time * 2 + TAU * i / n;
  return { x: G.px + Math.cos(a) * 38, y: G.py + Math.sin(a) * 38 };
}

function fireVolley() {
  const s = G.stats;
  const a0 = aimAngle();
  fireFan(a0, s.count, 1);
  if (s.rear > 0) fireFan(a0 + Math.PI, Math.min(s.rear, s.count), 0.7);        // Rear Guard
  if (s.side > 0) {                                                             // Side Cannons
    const nSide = Math.min(s.side, 8);
    fireFan(a0 + Math.PI / 2, nSide, 0.6);
    fireFan(a0 - Math.PI / 2, nSide, 0.6);
  }
  for (let i = 0; i < s.drones; i++) {                                          // Drones copy your shot
    const p = dronePos(i, s.drones);
    poolPush(G.pB, CAP.pB, {
      x: p.x, y: p.y, vx: Math.cos(a0) * s.speed, vy: Math.sin(a0) * s.speed,
      t: 0, life: 1.5, size: s.size * 0.8, dmg: s.dmg * 0.5,
      pierce: s.pierce, bounce: 0, homing: s.homing, hit: null,
    });
  }
}

function fireMissiles() {
  const s = G.stats;
  for (let i = 0; i < s.missiles; i++) {
    const a = Math.atan2(G.faceY, G.faceX) + Math.PI + rand(-0.6, 0.6); // launch backward, curl in
    poolPush(G.pB, CAP.pB, {
      x: G.px, y: G.py, vx: Math.cos(a) * 240, vy: Math.sin(a) * 240,
      t: 0, life: 2.6, size: 5, dmg: s.dmg * 0.9,
      pierce: 0, bounce: 0, homing: 4.5, hit: null, mBlast: true,
    });
  }
}

function fireNova() {
  const s = G.stats, n = Math.round(10 + 2 * s.novaLv);
  const off = Math.random() * TAU;
  for (let i = 0; i < n; i++) {
    const a = off + TAU * i / n;
    poolPush(G.pB, CAP.pB, {
      x: G.px, y: G.py, vx: Math.cos(a) * 300, vy: Math.sin(a) * 300,
      t: 0, life: 1.1, size: s.size * 0.9, dmg: s.dmg * 0.8,
      pierce: s.pierce, bounce: 0, homing: 0, hit: null,
    });
  }
}

function fireLaser() {
  const s = G.stats, t = nearestEnemy(G.px, G.py);
  if (!t) return;
  const a = Math.atan2(t.y - G.py, t.x - G.px);
  const range = 620, w = 9 + s.laserLv;
  const cos = Math.cos(a), sin = Math.sin(a);
  const dmg = s.dmg * (1.2 + 0.35 * s.laserLv);
  nearEnemies(G.px + cos * range / 2, G.py + sin * range / 2, range / 2 + 90, _near);
  for (const en of _near) {
    const rx = en.x - G.px, ry = en.y - G.py;
    const fwd = rx * cos + ry * sin;
    if (fwd < 0 || fwd > range) continue;
    if (Math.abs(rx * -sin + ry * cos) < w + en.r) hitEnemy(en, dmg);
  }
  G.beams.push({ x: G.px, y: G.py, a, len: range, w, color: '#8af0ff', t: 0, life: 0.16 });
}

function bomb(x, y, r, dmg) {
  SFX.bomb();
  G.shake = Math.max(G.shake, 9);
  for (let i = G.eB.length - 1; i >= 0; i--) {
    if (dist2(G.eB[i].x, G.eB[i].y, x, y) < r * r) { G.eB[i] = G.eB[G.eB.length - 1]; G.eB.pop(); }
  }
  nearEnemies(x, y, r, _near);
  for (const en of _near) if (en.hp > 0 && dist2(x, y, en.x, en.y) < (r + en.r) * (r + en.r)) hitEnemy(en, dmg);
  burst(x, y, '#ffd24a', 22, 340);
  G.beams.push({ ring: true, x, y, r, t: 0, life: 0.3, color: '#ffd24a' });
}

// ---------------------------------------------------------------------------
// Damage
// ---------------------------------------------------------------------------
function hitEnemy(en, dmg, noArc) {
  const s = G.stats;
  const isCrit = Math.random() < s.crit;
  const d = dmg * (isCrit ? s.critMult : 1) * (G.rampMult || 1)
    * (G.heatT > 0 ? 1 + s.grazeHeat : 1); // Graze heat
  en.hp -= d;
  en.flash = 0.08;
  G.dmgDealt += d;
  if (s.lifesteal > 0) G.hp = Math.min(s.maxHp, G.hp + d * s.lifesteal);
  if (isCrit) burst(en.x, en.y, '#ffd24a', 3, 150);
  // Chain Arc — lightning jumps to the nearest other enemy
  if (!noArc && s.arc > 0 && Math.random() < s.arc) {
    nearEnemies(en.x, en.y, 180, _near);
    let best = null, bd = 180 * 180;
    for (const o of _near) { if (o === en || o.hp <= 0) continue; const q = dist2(en.x, en.y, o.x, o.y); if (q < bd) { bd = q; best = o; } }
    if (best) {
      G.beams.push({ x: en.x, y: en.y, a: Math.atan2(best.y - en.y, best.x - en.x), len: Math.sqrt(bd), w: 2, color: '#ffe94a', t: 0, life: 0.1 });
      hitEnemy(best, dmg * 0.6, true);
    }
  }
  // Frost Shot — chill
  if (s.frost > 0 && Math.random() < s.frost) { en.chillT = 1.2; en.chillF = 0.4; }
  // Impact — shove away from the player (elites and brutes resist, bosses immune)
  if (s.knock > 0 && !en.boss) {
    const kdx = en.x - G.px, kdy = en.y - G.py, kd = Math.hypot(kdx, kdy) || 1;
    const kk = s.knock * (en.elite ? 0.35 : en.type === 'brute' ? 0.5 : 1);
    en.kx += kdx / kd * kk; en.ky += kdy / kd * kk;
  }
  // Executioner — finish weakened non-boss enemies
  if (s.cull > 0 && !en.boss && en.hp > 0 && en.hp < en.maxHp * s.cull) {
    en.hp = 0;
    burst(en.x, en.y, '#ff2a5a', 5, 160);
  }
  if (en.hp <= 0) killEnemy(en);
  return d;
}

function killEnemy(en) {
  if (en.dead) return;
  en.dead = true; en.hp = -1e9;
  G.kills++;
  SFX.kill();
  burst(en.x, en.y, en.color, en.boss ? 50 : 6, en.boss ? 380 : 150);
  const s = G.stats;
  const gems = en.superBoss ? 40 : en.phantom ? 3 : en.boss ? 30 : en.elite ? 8 : 1;
  for (let i = 0; i < gems; i++) {
    poolPush(G.gems, CAP.gems, { x: en.x + rand(-en.r, en.r), y: en.y + rand(-en.r, en.r), v: Math.max(1, Math.round(en.xp / gems)), t: 0 });
  }
  if (en.superBoss) { // a Warden falls
    const tier = en.wtier || 'sector';
    const T = WARDEN_TIERS[tier];
    for (let k = 0; k < T.spoils; k++) { G.spoilsQueue.push(tier); G.pendingLevels++; }
    const cleared = G.sector;
    G.eliteT = 20;
    G.eB.length = 0;
    G.bossAlive = null;
    document.getElementById('bossBar').classList.remove('on');
    G.shake = Math.max(G.shake, 18);
    burst(en.x, en.y, T.color, 110, 500);
    // clear leftover phantoms/echoes
    for (const e of G.enemies) if (e.phantom && e !== en) e.hp = 0;
    if (tier === 'final') { // NEW GAME + — the cycle continues with your whole build
      G.ngPlus++;
      G.sector = 1; G.wave = 1; G.waveT = 0;
      G.hp = s.maxHp;
      G.bannerQ.push({
        title: '☠ THE LAST SOUL FALLS — NG+' + G.ngPlus,
        subtitle: 'The cycle begins anew. Your arsenal endures — the universe grows crueler.',
      });
    } else {
      G.sector++; G.wave = 1; G.waveT = 0;
      G.hp = Math.min(s.maxHp, G.hp + s.maxHp * 0.5);
      G.bannerQ.push({
        title: tier === 'universe' ? '⚔ THE UNIVERSE YIELDS — SECTOR ' + cleared + ' CLEARED'
          : tier === 'galaxy' ? '⚔ GALAXY BROKEN — SECTOR ' + cleared + ' CLEARED'
          : '⚔ SECTOR ' + cleared + ' CLEARED',
        subtitle: (en.name || 'The Warden') + ' falls — ' + T.spoils + ' spoils draw' + (T.spoils > 1 ? 's' : '') + ' · Sector ' + G.sector + ' begins',
      });
    }
    if (G.bannerQ.length > 6) G.bannerQ.shift();
    SFX.mythic();
  } else if (en.elite) { // spoils: a bonus draw with double levels and 50× Primordial odds
    G.eliteSpoils++;
    G.pendingLevels++;
    G.shake = Math.max(G.shake, 9);
    announce('★ ' + (en.name || 'ELITE') + ' DOWN — SPOILS', '#ffd24a');
    burst(en.x, en.y, '#ffd24a', 30, 320);
  }
  if (s.splitShards > 0) {
    for (let k = 0; k < s.splitShards; k++) {
      const a = Math.random() * TAU;
      poolPush(G.pB, CAP.pB, { x: en.x, y: en.y, vx: Math.cos(a) * 320, vy: Math.sin(a) * 320, t: 0, life: s.shardHoming ? 1.1 : 0.55, size: 3.5, dmg: s.dmg * 0.4, pierce: 0, bounce: 0, homing: s.shardHoming ? 3.5 : 0, hit: null });
    }
  }
  if (s.sparks) blast(en.x, en.y, 46, s.dmg * 0.5);
  if (s.kilnova > 0 && Math.random() < s.kilnova) blast(en.x, en.y, 90, s.dmg * 1.2);
  if (s.scav > 0 && Math.random() < s.scav) {
    poolPush(G.gems, CAP.gems, { x: en.x, y: en.y, v: 0, heal: 7, t: 0 }); // Scavenger orb
  }
  if (en.boss) {
    G.bossAlive = null;
    document.getElementById('bossBar').classList.remove('on');
    G.shake = Math.max(G.shake, 12);
    announce('BOSS DOWN — 討伐', '#ffd24a');
  }
  if (en.type === 'splitter' && !en.isChild) {
    for (let i = 0; i < 2; i++) {
      const c = spawnEnemy('chaser', en.x + rand(-12, 12), en.y + rand(-12, 12), 0.4);
      if (c) { c.r = 8; c.isChild = true; }
    }
  }
}

function blast(x, y, r, dmg) {
  nearEnemies(x, y, r, _near);
  for (const en of _near) if (en.hp > 0 && dist2(x, y, en.x, en.y) < (r + en.r) * (r + en.r)) hitEnemy(en, dmg, true);
  burst(x, y, '#ffb454', 6, 180);
}

// ---------------------------------------------------------------------------
// Enemies & waves
// ---------------------------------------------------------------------------
const ETYPES = {
  chaser:   { hp: 16,  speed: 92,  r: 12, dmg: 11, color: '#ff6b5a', xp: 1 },
  shooter:  { hp: 22,  speed: 60,  r: 12, dmg: 9,  color: '#ffa04a', xp: 1 },
  spinner:  { hp: 30,  speed: 42,  r: 14, dmg: 11, color: '#d05cff', xp: 2 },
  tank:     { hp: 85,  speed: 30,  r: 20, dmg: 16, color: '#98a8c8', xp: 3 },
  darter:   { hp: 14,  speed: 68,  r: 10, dmg: 11, color: '#4ad8ff', xp: 1 },
  splitter: { hp: 26,  speed: 66,  r: 14, dmg: 11, color: '#9bd820', xp: 2 },
  weaver:   { hp: 12,  speed: 108, r: 10, dmg: 10, color: '#5affc8', xp: 1 },
  brute:    { hp: 110, speed: 42,  r: 23, dmg: 18, color: '#d87a5a', xp: 3 },
  charger:  { hp: 20,  speed: 62,  r: 13, dmg: 15, color: '#c8ff5a', xp: 2 },
  boss:     { hp: 800, speed: 40,  r: 42, dmg: 22, color: '#ff2a8a', xp: 45 },
  superboss:{ hp: 1800,speed: 58,  r: 54, dmg: 24, color: '#ff5f6d', xp: 120 },
  echo:     { hp: 260, speed: 210, r: 12, dmg: 16, color: '#454a68', xp: 8 },
};
// 100 waves per sector; difficulty scales with the TOTAL wave count
function totalWave() { return (G.sector - 1) * 100 + G.wave; }
// gentler curve than before: wave 10 ≈ 5.4× (was 7.5×), wave 20 ≈ 14× (was 21×)
function waveScale() { const w = totalWave(); return (1 + w * 0.22 + w * w * 0.022) * (1 + (G.ngPlus || 0) * 1.5); }

const SHOOT_TYPES = new Set(['shooter', 'spinner', 'tank']);
function shooterCount() {
  let n = 0;
  for (const e of G.enemies) if (SHOOT_TYPES.has(e.type)) n++;
  return n;
}
function maxShooters() { return Math.min(9, 2 + Math.floor(totalWave() / 4)); }

function spawnEnemy(type, x, y, hpMult) {
  const T = ETYPES[type], sc = waveScale();
  const boss = type === 'boss';
  // per-enemy variance so hordes feel organic instead of uniform
  const jHp = boss ? 1 : rand(0.85, 1.15), jSp = boss ? 1 : rand(0.9, 1.15), jR = boss ? 1 : rand(0.92, 1.12);
  const en = {
    type, x, y, r: T.r * jR, hp: T.hp * sc * (hpMult || 1) * jHp, maxHp: T.hp * sc * (hpMult || 1) * jHp,
    speed: T.speed * (1 + totalWave() * 0.008) * jSp, dmg: T.dmg * (1 + totalWave() * 0.035) * (1 + (G.ngPlus || 0) * 0.75),
    color: T.color, xp: T.xp, t: rand(0, 9), shootT: rand(1.2, 2.6),
    boss, dashT: 0, dvx: 0, dvy: 0, ang: Math.random() * TAU,
    dead: false, flash: 0, kx: 0, ky: 0, chillT: 0, chillF: 0, ramCd: 0, elite: false,
    mode: 'approach', modeT: 0, lockX: 0, lockY: 0,
  };
  if (en.boss) {
    en.name = pick(MYTH_BEINGS) + ' THE DEVOURER';
    en.xp = 45 + totalWave();
    G.bossAlive = en;
    document.getElementById('bossName').textContent = '― ' + en.name + ' ―';
    document.getElementById('bossBar').classList.add('on');
    if (G.enemies.length >= CAP.enemies) {
      const idx = G.enemies.findIndex(e => !e.boss);
      if (idx >= 0) G.enemies.splice(idx, 1);
    }
    G.enemies.push(en);
    return en;
  }
  if (G.enemies.length >= CAP.enemies) return null;
  G.enemies.push(en);
  return en;
}

function edgeSpawnPos() {
  const side = (Math.random() * 4) | 0, m = 36;
  if (side === 0) return { x: rand(0, W), y: -m };
  if (side === 1) return { x: rand(0, W), y: H + m };
  if (side === 2) return { x: -m, y: rand(0, H) };
  return { x: W + m, y: rand(0, H) };
}

// ---------------------------------------------------------------------------
// Named elites — rare, gold-ringed, worth a fortune. Killing one grants an
// ELITE SPOILS level-up: double-level cards and 50× Primordial odds.
// ---------------------------------------------------------------------------
const ELITE_NAMES = ['VORAX', 'SERAKH', 'MALGRIM', 'KZARR', 'NYXA', 'THAROK',
  'VELMIRA', 'OZGUTH', 'RHAEN', 'ZYKKAR', 'DREXA', 'MOLOCH'];
const ELITE_TITLES = ['THE HUNGERING', 'THE UNBLINKING', 'VOID-CALLER', 'STAR-EATER',
  'THE SWIFT', 'THE ADAMANT', 'GRAVEMAKER', 'THE BOUNDLESS', 'SOUL-RENDER',
  'THE RADIANT', 'STORM-BEARER', 'THE ENDLESS'];

function spawnElite() {
  const base = pick(['chaser', 'shooter', 'spinner', 'tank', 'darter', 'splitter']);
  const p = edgeSpawnPos();
  if (G.enemies.length >= CAP.enemies) { // an elite always finds room
    const idx = G.enemies.findIndex(e => !e.boss && !e.elite);
    if (idx >= 0) G.enemies.splice(idx, 1);
  }
  const en = spawnEnemy(base, p.x, p.y, 7);
  if (!en) return null;
  en.elite = true;
  en.name = pick(ELITE_NAMES) + ' ' + pick(ELITE_TITLES);
  en.r *= 1.45;
  en.speed *= 1.15;
  en.dmg *= 1.3;
  en.xp = 20 + totalWave() * 2;
  announce('⚠ ' + en.name, '#ffd24a');
  return en;
}

function updateWave(dt) {
  // wave 100 belongs to the Sector Warden alone: no timer, no trash, no elites
  if (G.wave >= 100) return;
  G.waveT += dt;
  if (G.waveT >= 22) {
    G.waveT = 0; G.wave++;
    if (G.wave >= 100) { startSuperBoss(); return; }
    announce('WAVE ' + G.sector + '-' + G.wave + (G.wave % 10 === 0 ? ' — BOSS' : ''), G.wave % 10 === 0 ? '#ff2a8a' : '#8aa0ff');
    if (G.wave % 10 === 0) {
      const p = edgeSpawnPos();
      spawnEnemy('boss', p.x, p.y, 1 + totalWave() / 18);
    }
  }
  const tw = totalWave();
  // elite cadence: first around 20s, then every 30–45s, max 2 alive
  G.eliteT -= dt;
  if (G.eliteT <= 0 && tw >= 2) {
    G.eliteT = rand(30, 45);
    let alive = 0;
    for (const e of G.enemies) if (e.elite) alive++;
    if (alive < 2) spawnElite();
  }
  G.spawnT -= dt;
  if (G.spawnT <= 0) {
    G.spawnT = clamp(1.5 - tw * 0.045, 0.32, 1.5) * (G.bossAlive ? 1.8 : 1);
    const pack = 1 + ((tw / 5) | 0) + ((Math.random() * 2) | 0);
    // melee-heavy table; gun-carriers (shooter/spinner/tank) are the minority
    const table = ['chaser', 'chaser', 'darter', 'weaver'];
    if (tw >= 2) table.push('weaver', 'chaser');
    if (tw >= 3) table.push('splitter', 'shooter');
    if (tw >= 4) table.push('charger');
    if (tw >= 5) table.push('spinner', 'brute');
    if (tw >= 8) table.push('tank', 'charger', 'brute');
    const MELEE = ['chaser', 'darter', 'weaver'];
    for (let i = 0; i < pack; i++) {
      let type = pick(table);
      // cap on how many shooting enemies can be alive at once
      if (SHOOT_TYPES.has(type) && shooterCount() >= maxShooters()) type = pick(MELEE);
      const p = edgeSpawnPos();
      spawnEnemy(type, p.x + rand(-24, 24), p.y + rand(-24, 24));
    }
  }
}

// ---------------------------------------------------------------------------
// The SECTOR WARDEN — wave 100's only enemy. It watches your bullets and
// sidesteps them (3 dodges, then 4s of exhaustion — that's your window),
// repositions by range, and enrages below 40% HP. Killing it clears the
// sector and grants a spoils draw at 1.01% Primordial odds (0.01% + 1%).
// ---------------------------------------------------------------------------
const SUPER_NAMES = ['APOPHIS', 'TYPHON', 'SURTR', 'NIDHOGG', 'KHARYBDIS', 'ABADDON', 'FAFNIR', 'AZHDAHA'];
const GALAXY_NAMES = ['ANDROMEDA', 'MAELSTROM', 'HELIX', 'TRIANGULUM', 'CYGNUS X', 'MAGELLAN'];
const UNIVERSE_NAMES = ['THE AXIOM', 'ETERNITY', 'FIRMAMENT', 'THE DEEP', 'OMEGA POINT'];

// Warden hierarchy: sector (every 100 waves) < galaxy (1,000) < universe
// (10,000) < THE LAST SOUL (100,000 — beat it for NG+ with your whole build).
const WARDEN_TIERS = {
  sector:   { hpMult: 1,  r: 54, color: '#ff5f6d', stamina: 3, spoils: 1, blink: false, clones: false, eater: false, weakpoint: false, echo: false, reaim: false, storm: false },
  galaxy:   { hpMult: 4,  r: 64, color: '#b06bff', stamina: 4, spoils: 2, blink: true,  clones: true,  eater: true,  weakpoint: false, echo: false, reaim: false, storm: false },
  universe: { hpMult: 16, r: 76, color: '#9ff0ff', stamina: 5, spoils: 3, blink: true,  clones: true,  eater: true,  weakpoint: true,  echo: true,  reaim: true,  storm: false },
  final:    { hpMult: 64, r: 92, color: '#ffffff', stamina: 6, spoils: 3, blink: true,  clones: true,  eater: true,  weakpoint: true,  echo: true,  reaim: true,  storm: true },
};

function wardenTier() {
  const tw = totalWave();
  if (tw >= 100000) return 'final';
  if (tw % 10000 === 0) return 'universe';
  if (tw % 1000 === 0) return 'galaxy';
  return 'sector';
}

function startSuperBoss() {
  G.wave = 100;
  G.waveT = 0;
  for (const en of G.enemies) if (!en.boss) burst(en.x, en.y, en.color, 3, 140);
  G.enemies.length = 0; // the arena empties — the Warden comes alone
  G.eB.length = 0;
  const tier = wardenTier();
  const T = WARDEN_TIERS[tier];
  const p = edgeSpawnPos();
  const en = spawnEnemy('superboss', p.x, p.y, (1 + (G.sector - 1) * 0.8) * T.hpMult);
  if (!en) return;
  en.boss = true; // boss-grade immunities (knockback/cull/pull)
  en.superBoss = true;
  en.wtier = tier;
  en.r = T.r;
  en.color = T.color;
  en.weakpoint = T.weakpoint;
  en.name = tier === 'final' ? 'THE LAST SOUL — END OF ALL THINGS'
    : tier === 'universe' ? pick(UNIVERSE_NAMES) + ' — UNIVERSE WARDEN'
    : tier === 'galaxy' ? pick(GALAXY_NAMES) + ' — GALAXY WARDEN'
    : pick(SUPER_NAMES) + ' — WARDEN OF SECTOR ' + G.sector;
  en.xp = 120 * T.hpMult + totalWave() * 2;
  en.stamina = T.stamina; en.dodgeCd = 0; en.tiredT = 0; en.dodgeCount = 0;
  en.cloneStage = 0; en.eaterT = 9; en.eaterActive = 0; en.reaimT = 12; en.reaimWarned = false;
  en.echoT = 1; en.stormT = 2.5;
  G.bossAlive = en;
  document.getElementById('bossName').textContent = '― ' + en.name + ' ―';
  document.getElementById('bossBar').classList.add('on');
  announce(tier === 'final' ? '☠ THE LAST SOUL AWAKENS'
    : tier === 'universe' ? '⚠⚠⚠ THE UNIVERSE ITSELF ANSWERS'
    : tier === 'galaxy' ? '⚠⚠ A GALAXY WARDEN DESCENDS'
    : '⚠ THE WARDEN COMES ALONE', T.color);
  G.shake = Math.max(G.shake, 12);
  SFX.mythic();
  return en;
}

function spawnPhantom(en) {
  const keep = G.bossAlive;
  const c = spawnEnemy('boss', en.x + rand(-90, 90), en.y + rand(-90, 90), 0.001);
  G.bossAlive = keep;
  if (keep) document.getElementById('bossName').textContent = '― ' + keep.name + ' ―';
  if (!c) return;
  c.phantom = true;
  c.boss = false;
  c.color = '#b06bff';
  c.hp = c.maxHp = en.maxHp * 0.08;
  c.r = 30;
  c.xp = 10;
}

function slowFactorAt(x, y) {
  const s = G.stats;
  if (s.slowR > 0 && dist2(x, y, G.px, G.py) < s.slowR * s.slowR) return 1 - s.slowEnemy;
  return 1;
}

function updateEnemy(en, dt) {
  en.t += dt;
  if (en.flash > 0) en.flash -= dt;
  if (en.chillT > 0) en.chillT -= dt;
  if (en.ramCd > 0) en.ramCd -= dt;
  const sp = en.speed * slowFactorAt(en.x, en.y) * (en.chillT > 0 ? 1 - en.chillF : 1);
  const dx = G.px - en.x, dy = G.py - en.y, d = Math.hypot(dx, dy) || 1;

  switch (en.type) {
    case 'chaser': case 'splitter': case 'brute': {
      // slight heading wobble so packs don't form single-file lines
      const wob = Math.sin(en.t * 3 + en.ang * 4) * (en.type === 'brute' ? 0.15 : 0.45);
      let vx = dx / d - dy / d * wob, vy = dy / d + dx / d * wob;
      const m = Math.hypot(vx, vy) || 1;
      en.x += vx / m * sp * dt; en.y += vy / m * sp * dt;
      break;
    }
    case 'weaver': {
      // strafes hard side-to-side while closing in
      const wob = Math.sin(en.t * 4.5 + en.ang) * 1.1;
      let vx = dx / d - dy / d * wob, vy = dy / d + dx / d * wob;
      const m = Math.hypot(vx, vy) || 1;
      en.x += vx / m * sp * dt; en.y += vy / m * sp * dt;
      break;
    }
    case 'charger': {
      // approach → wind up → dash in a locked line → recover
      en.modeT -= dt;
      if (en.mode === 'approach') {
        en.x += dx / d * sp * dt; en.y += dy / d * sp * dt;
        if (d < 460) { en.mode = 'wind'; en.modeT = 0.7; }
      } else if (en.mode === 'wind') {
        if (en.modeT <= 0) { en.mode = 'dash'; en.modeT = 0.55; en.lockX = dx / d; en.lockY = dy / d; }
      } else if (en.mode === 'dash') {
        const dashSp = 520 * (sp / en.speed); // chill/slow fields still apply
        en.x += en.lockX * dashSp * dt; en.y += en.lockY * dashSp * dt;
        if (en.modeT <= 0) { en.mode = 'rest'; en.modeT = 0.8; }
      } else if (en.modeT <= 0) en.mode = 'approach';
      break;
    }
    case 'shooter':
      if (d > 240) { en.x += dx / d * sp * dt; en.y += dy / d * sp * dt; }
      else if (d < 170) { en.x -= dx / d * sp * 0.7 * dt; en.y -= dy / d * sp * 0.7 * dt; }
      en.shootT -= dt;
      if (en.shootT <= 0 && d < 560) {
        en.shootT = clamp(2.3 - totalWave() * 0.03, 1.0, 2.3);
        spawnEB({ x: en.x, y: en.y, vx: dx / d * 175, vy: dy / d * 175, dmg: en.dmg, size: 5 });
      }
      break;
    case 'spinner':
      en.x += dx / d * sp * dt; en.y += dy / d * sp * dt;
      en.shootT -= dt;
      if (en.shootT <= 0) {
        en.shootT = clamp(2.8 - totalWave() * 0.03, 1.4, 2.8);
        const n = 8, off = en.ang; en.ang += 0.5;
        for (let i = 0; i < n; i++) {
          const a = off + TAU * i / n;
          spawnEB({ x: en.x, y: en.y, vx: Math.cos(a) * 120, vy: Math.sin(a) * 120, dmg: en.dmg, size: 5 });
        }
      }
      break;
    case 'tank':
      en.x += dx / d * sp * dt; en.y += dy / d * sp * dt;
      en.shootT -= dt;
      if (en.shootT <= 0 && d < 480) {
        en.shootT = 2.9;
        const a0 = Math.atan2(dy, dx);
        for (let i = -1; i <= 1; i++) {
          const a = a0 + i * 0.22;
          spawnEB({ x: en.x, y: en.y, vx: Math.cos(a) * 145, vy: Math.sin(a) * 145, dmg: en.dmg, size: 6 });
        }
      }
      break;
    case 'darter':
      en.dashT -= dt;
      if (en.dashT <= 0) { en.dashT = rand(0.9, 1.6); en.dvx = dx / d * sp * 3.2; en.dvy = dy / d * sp * 3.2; }
      en.dvx *= 0.96; en.dvy *= 0.96;
      en.x += en.dvx * dt * slowFactorAt(en.x, en.y); en.y += en.dvy * dt * slowFactorAt(en.x, en.y);
      break;
    case 'echo': { // your dark twin: orbits you, fires player-like fans
      const orbitR = 250;
      const tx = -dy / d, ty = dx / d; // tangential drift
      const rad = d > orbitR + 40 ? 1 : d < orbitR - 40 ? -0.8 : 0;
      let vx = dx / d * rad + tx * 0.85, vy = dy / d * rad + ty * 0.85;
      const vm = Math.hypot(vx, vy) || 1;
      en.x += vx / vm * sp * dt; en.y += vy / vm * sp * dt;
      en.shootT -= dt;
      if (en.shootT <= 0) {
        en.shootT = 1.2;
        const a0 = Math.atan2(dy, dx);
        for (let i = -1; i <= 1; i++) {
          const a = a0 + i * 0.14;
          spawnEB({ x: en.x, y: en.y, vx: Math.cos(a) * 210, vy: Math.sin(a) * 210, dmg: en.dmg, size: 5 });
        }
      }
      break;
    }
    case 'superboss': {
      // stamina / exhaustion cycle
      if (en.dodgeCd > 0) en.dodgeCd -= dt;
      if (en.tiredT > 0) { en.tiredT -= dt; if (en.tiredT <= 0) en.stamina = 3; }
      const WT = WARDEN_TIERS[en.wtier || 'sector'];
      // REACTIVE DODGE — reads your bullets; sector Wardens sidestep, higher
      // tiers BLINK (teleport) out of the line of fire entirely
      if (en.dodgeCd <= 0 && en.tiredT <= 0 && en.stamina > 0) {
        for (const b of G.pB) {
          const bdx = en.x - b.x, bdy = en.y - b.y;
          const bd = Math.hypot(bdx, bdy);
          if (bd > 180 || bd < 1) continue;
          const bv = Math.hypot(b.vx, b.vy);
          if (bv < 40) continue;
          if ((b.vx * bdx + b.vy * bdy) / (bv * bd) > 0.92) { // heading straight at it
            en.stamina--;
            en.dodgeCount = (en.dodgeCount || 0) + 1;
            if (WT.blink) { // teleport to a fresh angle at mid range
              burst(en.x, en.y, en.color, 16, 300);
              const a = Math.random() * TAU;
              en.x = clamp(G.px + Math.cos(a) * 330, 60, W - 60);
              en.y = clamp(G.py + Math.sin(a) * 330, 60, H - 60);
              burst(en.x, en.y, en.color, 16, 300);
              en.dodgeCd = 1.6;
            } else {
              const side = Math.random() < 0.5 ? 1 : -1;
              en.dvx = -b.vy / bv * 660 * side;
              en.dvy = b.vx / bv * 660 * side;
              en.dodgeCd = 1.1;
              burst(en.x, en.y, '#ffffff', 8, 220);
            }
            if (en.stamina <= 0) { en.tiredT = 4; announce('THE WARDEN TIRES — STRIKE NOW', '#ffd24a'); }
            break;
          }
        }
      }
      en.x += en.dvx * dt; en.y += en.dvy * dt;
      en.dvx *= Math.pow(0.03, dt); en.dvy *= Math.pow(0.03, dt);
      // PHANTOM CLONES at 2/3 and 1/3 HP (galaxy+)
      if (WT.clones) {
        const frac = en.hp / en.maxHp;
        if (en.cloneStage === 0 && frac < 0.66) { en.cloneStage = 1; spawnPhantom(en); spawnPhantom(en); announce('IT SPLITS', en.color); }
        else if (en.cloneStage === 1 && frac < 0.33) { en.cloneStage = 2; spawnPhantom(en); spawnPhantom(en); announce('IT SPLITS AGAIN', en.color); }
      }
      // BULLET EATER (galaxy+): inhales your bullets and drags you closer
      if (WT.eater) {
        if (en.eaterActive > 0) {
          en.eaterActive -= dt;
          for (let bi = G.pB.length - 1; bi >= 0; bi--) {
            const b = G.pB[bi];
            if (dist2(b.x, b.y, en.x, en.y) < 260 * 260) {
              burst(b.x, b.y, en.color, 1, 60);
              G.pB[bi] = G.pB[G.pB.length - 1]; G.pB.pop();
            }
          }
          const pd = Math.hypot(en.x - G.px, en.y - G.py) || 1;
          G.px += (en.x - G.px) / pd * 85 * dt; // gravity well — fight the pull
          G.py += (en.y - G.py) / pd * 85 * dt;
        } else {
          en.eaterT -= dt;
          if (en.eaterT <= 0) { en.eaterT = 9; en.eaterActive = 1.6; announce('IT INHALES', en.color); }
        }
      }
      // ECHO OF YOU (universe+): a dark copy of your ship hunts you
      if (WT.echo) {
        en.echoT -= dt;
        if (en.echoT <= 0) {
          en.echoT = 20;
          if (!G.enemies.some(e => e.type === 'echo')) {
            const c = spawnEnemy('echo', en.x, en.y, 1);
            if (c) { c.phantom = true; announce('IT WEARS YOUR FACE', '#9ff0ff'); }
          }
        }
      }
      // REALIGNMENT (universe+): warning ring, then every bullet re-aims at you
      if (WT.reaim) {
        en.reaimT -= dt;
        if (en.reaimT <= 0.8 && !en.reaimWarned) {
          en.reaimWarned = true;
          G.beams.push({ ring: true, x: en.x, y: en.y, r: 300, t: 0, life: 0.8, color: '#ffd24a' });
          announce('!! REALIGNMENT', '#ffd24a');
        }
        if (en.reaimT <= 0) {
          en.reaimT = 12; en.reaimWarned = false;
          for (const b of G.eB) {
            const spd2 = Math.hypot(b.vx, b.vy) || 1;
            const rd = Math.hypot(G.px - b.x, G.py - b.y) || 1;
            b.vx = (G.px - b.x) / rd * spd2; b.vy = (G.py - b.y) / rd * spd2;
          }
          G.shake = Math.max(G.shake, 6);
        }
      }
      // DESPERATION STORM (final, below 15% HP): edge walls with gaps
      if (WT.storm && en.hp < en.maxHp * 0.15) {
        en.stormT -= dt;
        if (en.stormT <= 0) {
          en.stormT = 2.5;
          const vert = Math.random() < 0.5;
          const len = vert ? H : W;
          const g1 = rand(0.1, 0.45) * len, g2 = rand(0.55, 0.9) * len, gap = 95;
          const fromStart = Math.random() < 0.5;
          for (let q = 0; q < len; q += 26) {
            if (Math.abs(q - g1) < gap || Math.abs(q - g2) < gap) continue;
            const bx = vert ? (fromStart ? -20 : W + 20) : q;
            const by = vert ? q : (fromStart ? -20 : H + 20);
            const vx = vert ? (fromStart ? 150 : -150) : 0;
            const vy = vert ? 0 : (fromStart ? 150 : -150);
            spawnEB({ x: bx, y: by, vx, vy, dmg: en.dmg, size: 5, life: 14 });
          }
          announce('THE WALLS CLOSE IN', '#ffffff');
        }
      }
      // hold mid range: close in when far, back off when crowded
      if (d > 340) { en.x += dx / d * sp * dt; en.y += dy / d * sp * dt; }
      else if (d < 200) { en.x -= dx / d * sp * 0.8 * dt; en.y -= dy / d * sp * 0.8 * dt; }
      // attacks adapt to your range; enrages below 40% HP
      const enraged = en.hp < en.maxHp * 0.4;
      en.shootT -= dt * (enraged ? 1.6 : 1);
      if (en.shootT <= 0) {
        const bSpd = enraged ? 1.15 : 1;
        if (d > 380) { // you're far: precise aimed fans
          en.shootT = 0.5;
          const a0 = Math.atan2(dy, dx);
          for (let i = -2; i <= 2; i++) {
            const a = a0 + i * 0.09;
            spawnEB({ x: en.x, y: en.y, vx: Math.cos(a) * 235 * bSpd, vy: Math.sin(a) * 235 * bSpd, dmg: en.dmg, size: 6 });
          }
        } else { // you're close: rings and twin spirals
          const phase = ((en.t * 0.6) | 0) % 2;
          if (phase === 0) {
            en.shootT = 0.85;
            const n = 20, off = en.ang; en.ang += 0.4;
            for (let i = 0; i < n; i++) {
              const a = off + TAU * i / n;
              spawnEB({ x: en.x, y: en.y, vx: Math.cos(a) * 145 * bSpd, vy: Math.sin(a) * 145 * bSpd, dmg: en.dmg, size: 5 });
            }
          } else {
            en.shootT = 0.09;
            en.ang += 0.31;
            for (let k = 0; k < 2; k++) {
              const a = en.ang + k * Math.PI;
              spawnEB({ x: en.x, y: en.y, vx: Math.cos(a) * 175 * bSpd, vy: Math.sin(a) * 175 * bSpd, dmg: en.dmg, size: 5 });
            }
          }
        }
      }
      break;
    }
    case 'boss': {
      if (d > 260) { en.x += dx / d * sp * dt; en.y += dy / d * sp * dt; }
      en.shootT -= dt;
      if (en.shootT <= 0) {
        const phase = ((en.t * 0.5) | 0) % 3;
        if (phase === 0) {
          en.shootT = 0.6;
          const a0 = Math.atan2(dy, dx);
          for (let i = -2; i <= 2; i++) {
            const a = a0 + i * 0.17;
            spawnEB({ x: en.x, y: en.y, vx: Math.cos(a) * 195, vy: Math.sin(a) * 195, dmg: en.dmg, size: 6 });
          }
        } else if (phase === 1) {
          en.shootT = 1.0;
          const n = 16, off = en.ang; en.ang += 0.35;
          for (let i = 0; i < n; i++) {
            const a = off + TAU * i / n;
            spawnEB({ x: en.x, y: en.y, vx: Math.cos(a) * 140, vy: Math.sin(a) * 140, dmg: en.dmg, size: 5 });
          }
        } else {
          en.shootT = 0.1;
          en.ang += 0.30;
          for (let k = 0; k < 2; k++) {
            const a = en.ang + k * Math.PI;
            spawnEB({ x: en.x, y: en.y, vx: Math.cos(a) * 170, vy: Math.sin(a) * 170, dmg: en.dmg, size: 5 });
          }
        }
      }
      break;
    }
  }
  // knockback / vortex-pull velocity with decay
  if (en.kx || en.ky) {
    en.x += en.kx * dt; en.y += en.ky * dt;
    const kdec = Math.pow(0.02, dt);
    en.kx *= kdec; en.ky *= kdec;
    if (Math.abs(en.kx) < 1 && Math.abs(en.ky) < 1) { en.kx = 0; en.ky = 0; }
  }
  en.x = clamp(en.x, -60, W + 60); en.y = clamp(en.y, -60, H + 60);
  if (dist2(en.x, en.y, G.px, G.py) < (en.r + 8) * (en.r + 8)) {
    const s = G.stats;
    if (s.ram > 0 && en.ramCd <= 0) {         // Ram — contact hurts THEM
      en.ramCd = 0.3;
      hitEnemy(en, s.dmg * s.ram, true);
      if (en.hp <= 0) return;
    }
    if (G.iT <= 0) hurtPlayer(en.dmg);
  }
}

// ---------------------------------------------------------------------------
// Player damage / shields / bombs / phoenix
// ---------------------------------------------------------------------------
function hurtPlayer(dmg) {
  if (G.iT > 0) return;
  const s = G.stats;
  if (s.dodge > 0 && Math.random() < s.dodge) { // Evasion — the hit never happened
    G.iT = 0.2;
    burst(G.px, G.py, '#baffc8', 6, 160);
    return;
  }
  if (s.thorns > 0) blast(G.px, G.py, 90, s.dmg * (0.4 + 0.2 * s.thorns)); // Thorns
  if (s.adren > 0) G.adrenT = s.adren;                                     // Adrenaline
  if (G.shield > 0) {
    G.shield--;
    G.iT = 0.6;
    SFX.shield();
    burst(G.px, G.py, '#6fd8ff', 10, 200);
    for (let i = G.eB.length - 1; i >= 0; i--) {
      if (dist2(G.eB[i].x, G.eB[i].y, G.px, G.py) < 80 * 80) { G.eB[i] = G.eB[G.eB.length - 1]; G.eB.pop(); }
    }
    if (s.guardian) blast(G.px, G.py, 160, s.dmg * 2.5);
    return;
  }
  dmg = Math.max(1, dmg - s.armor); // Armor — flat reduction
  G.hp -= dmg;
  G.iT = s.ghostT;
  G.shake = Math.max(G.shake, 7);
  SFX.hurt();
  burst(G.px, G.py, '#ff3a6b', 12, 220);
  if (s.bombR > 0 && G.bombT <= 0) { G.bombT = s.bombCd; bomb(G.px, G.py, s.bombR, s.dmg * 2); }
  if (G.hp <= 0) {
    if (s.rebirth && G.rebirthT <= 0) { // WORLDHEART — full resurrection on cooldown
      G.rebirthT = 90;
      G.hp = s.maxHp; G.iT = 3;
      G.eB.length = 0;
      burst(G.px, G.py, '#ff5f6d', 80, 440);
      announce('WORLDHEART — REBIRTH', '#ff5f6d');
      return;
    }
    if (s.phoenix && !G.phoenixUsed) {
      G.phoenixUsed = true;
      G.hp = s.maxHp * 0.5; G.iT = 2.5;
      G.eB.length = 0;
      burst(G.px, G.py, '#ffb454', 70, 420);
      announce('PHOENIX — 不死鳥', '#ffb454');
      return;
    }
    G.hp = 0;
    die();
  }
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------
function update(dt) {
  G.time += dt;
  const s = G.stats;
  // GENESIS ENGINE ramp — +1%/s (per level) since the relic was acquired
  G.rampMult = s.ramp > 0 && G.rampStart !== null ? 1 + s.ramp * Math.max(0, G.time - G.rampStart) : 1;
  if (G.rebirthT > 0) G.rebirthT -= dt;

  // movement — keyboard, or the touch joystick when no keys are held
  const up = keys.has('w') || keys.has('arrowup'), dn = keys.has('s') || keys.has('arrowdown');
  const lf = keys.has('a') || keys.has('arrowleft'), rt = keys.has('d') || keys.has('arrowright');
  G.focus = keys.has('shift');
  let mx = (rt ? 1 : 0) - (lf ? 1 : 0), my = (dn ? 1 : 0) - (up ? 1 : 0);
  let speedK = G.focus ? 0.45 : 1;
  if (!mx && !my && joy.active) {
    const jdx = joy.x - joy.sx, jdy = joy.y - joy.sy;
    const jd = Math.hypot(jdx, jdy);
    const mag = Math.min(1, jd / joy.R);
    if (mag > 0.12) {
      mx = jdx / jd; my = jdy / jd;
      speedK = 0.2 + 0.8 * ((mag - 0.12) / 0.88); // analog: light drag = slow, precise
      G.focus = mag < 0.5;                        // creeping shows the hitbox
    }
  }
  if (mx || my) {
    const m = Math.hypot(mx, my);
    mx /= m; my /= m;
    G.faceX = mx; G.faceY = my;
    const spd = s.moveSpd * speedK;
    G.px = clamp(G.px + mx * spd * dt, 14, W - 14);
    G.py = clamp(G.py + my * spd * dt, 14, H - 14);
  }
  if (G.iT > 0) G.iT -= dt;
  if (s.regen > 0) G.hp = Math.min(s.maxHp, G.hp + s.regen * dt);

  rebuildGrid();
  updateWave(dt);

  // enemies
  for (const en of G.enemies) if (en.hp > 0) updateEnemy(en, dt);
  for (let i = G.enemies.length - 1; i >= 0; i--) if (G.enemies[i].hp <= 0) {
    const en = G.enemies[i];
    G.enemies[i] = G.enemies[G.enemies.length - 1]; G.enemies.pop();
    if (en === G.bossAlive) { G.bossAlive = null; document.getElementById('bossBar').classList.remove('on'); }
  }

  // main gun (Adrenaline rush: +50% rate after taking a hit)
  if (G.adrenT > 0) G.adrenT -= dt;
  G.gunAcc += dt * s.rate * (G.adrenT > 0 ? 1.5 : 1);
  let guard = 0;
  while (G.gunAcc >= 1 && guard++ < 6) { G.gunAcc -= 1; fireVolley(); }
  if (G.gunAcc > 6) G.gunAcc = 6;

  // systems
  if (G.heatT > 0) G.heatT -= dt;
  if (s.novaLv > 0) { G.novaT -= dt; if (G.novaT <= 0) { G.novaT = s.novaCd; fireNova(); } }
  if (s.laserLv > 0) { G.laserT -= dt; if (G.laserT <= 0) { G.laserT = s.laserCd; fireLaser(); } }
  if (s.missiles > 0) { G.missileT -= dt; if (G.missileT <= 0 && G.enemies.length) { G.missileT = s.missileCd; fireMissiles(); } }
  if (s.mortar > 0) {                                             // Mortar — telegraphed artillery
    G.mortarT -= dt;
    if (G.mortarT <= 0 && G.enemies.length) {
      G.mortarT = s.mortarCd;
      const t = pick(G.enemies);
      G.zones.push({ x: t.x + rand(-24, 24), y: t.y + rand(-24, 24), r: Math.min(150, 70 + 3 * s.mortar), t: 0, tel: 0.7, dmg: s.dmg * 1.6 });
    }
  }
  if (s.turrets > 0) {                                            // Turret deployment
    G.turretT -= dt;
    if (G.turretT <= 0 && G.turrets.length < s.turrets) { G.turretT = s.turretCd; G.turrets.push({ x: G.px, y: G.py, t: 0, acc: 0 }); }
  }
  for (let i = G.turrets.length - 1; i >= 0; i--) {
    const tr = G.turrets[i];
    tr.t += dt;
    if (tr.t >= 9) { G.turrets.splice(i, 1); continue; }
    tr.acc += dt * 2;
    if (tr.acc > 2) tr.acc = 2;
    while (tr.acc >= 1) {
      tr.acc -= 1;
      const t = nearestEnemy(tr.x, tr.y);
      if (!t) break;
      const a = Math.atan2(t.y - tr.y, t.x - tr.x);
      poolPush(G.pB, CAP.pB, { x: tr.x, y: tr.y, vx: Math.cos(a) * 380, vy: Math.sin(a) * 380, t: 0, life: 1.4, size: 4.5, dmg: s.dmg * 0.55, pierce: 0, bounce: 0, homing: 0, hit: null });
    }
  }
  if (s.vortex > 0) {                                             // Vortex rifts
    G.vortexT -= dt;
    if (G.vortexT <= 0 && G.enemies.length) {
      G.vortexT = s.vortexCd;
      const t = pick(G.enemies);
      G.vortices.push({ x: t.x, y: t.y, t: 0, dur: 1.4 });
    }
  }
  for (let i = G.vortices.length - 1; i >= 0; i--) {
    const v = G.vortices[i];
    v.t += dt;
    if (v.t >= v.dur) { G.vortices.splice(i, 1); continue; }
    nearEnemies(v.x, v.y, 170, _near);
    for (const en of _near) {
      if (en.hp <= 0 || en.boss) continue;
      const vd = Math.hypot(v.x - en.x, v.y - en.y) || 1;
      if (vd > 170) continue;
      en.kx += (v.x - en.x) / vd * 700 * dt; // pull acceleration
      en.ky += (v.y - en.y) / vd * 700 * dt;
      en.hp -= s.dmg * 1.1 * dt;
      G.dmgDealt += s.dmg * 1.1 * dt;
      if (en.hp <= 0) killEnemy(en);
    }
  }
  if (s.echo) { G.echoT -= dt; if (G.echoT <= 0) { G.echoT = 6; fireVolley(); G.beams.push({ ring: true, x: G.px, y: G.py, r: 40, t: 0, life: 0.2, color: '#8af0ff' }); } }
  if (s.ripple) { G.rippleT -= dt; if (G.rippleT <= 0) { G.rippleT = 12; G.rippleActive = 3; G.beams.push({ ring: true, x: G.px, y: G.py, r: Math.max(W, H), t: 0, life: 0.5, color: '#8affff' }); } }
  if (s.pulse > 0) { // EVENT HORIZON shockwave — wipes every enemy bullet
    G.pulseT -= dt;
    if (G.pulseT <= 0) {
      G.pulseT = s.pulse;
      G.eB.length = 0;
      G.beams.push({ ring: true, x: G.px, y: G.py, r: Math.max(W, H), t: 0, life: 0.45, color: '#ff5f6d' });
    }
  }
  if (s.barrage) {
    G.barrageT -= dt;
    if (G.barrageT <= 0) {
      G.barrageT = s.barrageCd;
      for (let i = 0; i < 6; i++) {
        const t = G.enemies.length ? pick(G.enemies) : { x: rand(60, W - 60), y: rand(60, H - 60) };
        G.zones.push({ x: t.x + rand(-40, 40), y: t.y + rand(-40, 40), r: 90, t: 0, tel: 0.6 + i * 0.12 });
      }
    }
  }
  if (G.rippleActive > 0) G.rippleActive -= dt;
  if (G.bombT > 0) G.bombT -= dt;

  // shield regen
  if (s.shieldMax > 0 && G.shield < s.shieldMax) {
    G.shieldT += dt;
    if (G.shieldT >= s.shieldRegen) { G.shieldT = 0; G.shield++; SFX.shield(); }
  } else G.shieldT = 0;

  // orbitals
  if (s.orbitals > 0) {
    const R = 72, n = s.orbitals;
    for (let i = 0; i < n; i++) {
      if (G.bladeCd[i] > 0) { G.bladeCd[i] -= dt; continue; }
      const a = G.time * 3 + TAU * i / n;
      const bx = G.px + Math.cos(a) * R, by = G.py + Math.sin(a) * R;
      nearEnemies(bx, by, 24, _near);
      for (const en of _near) {
        if (en.hp > 0 && dist2(bx, by, en.x, en.y) < (16 + en.r) * (16 + en.r)) {
          hitEnemy(en, s.dmg * 0.8);
          G.bladeCd[i] = 0.28;
          break;
        }
      }
    }
  }

  // player bullets
  for (let i = G.pB.length - 1; i >= 0; i--) {
    const b = G.pB[i];
    b.t += dt;
    let dead = b.t >= b.life;
    if (b.homing > 0) {
      const t = nearestEnemy(b.x, b.y);
      if (t) {
        const want = Math.atan2(t.y - b.y, t.x - b.x), cur = Math.atan2(b.vy, b.vx);
        let da = want - cur;
        while (da > Math.PI) da -= TAU; while (da < -Math.PI) da += TAU;
        const turn = clamp(da, -b.homing * dt, b.homing * dt);
        const spd = Math.hypot(b.vx, b.vy);
        b.vx = Math.cos(cur + turn) * spd; b.vy = Math.sin(cur + turn) * spd;
      }
    }
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (b.bounce > 0) {
      if ((b.x < 6 && b.vx < 0) || (b.x > W - 6 && b.vx > 0)) { b.vx = -b.vx; b.bounce--; }
      if ((b.y < 6 && b.vy < 0) || (b.y > H - 6 && b.vy > 0)) { b.vy = -b.vy; b.bounce--; }
    } else if (b.x < -30 || b.x > W + 30 || b.y < -30 || b.y > H + 30) dead = true;

    if (!dead) {
      nearEnemies(b.x, b.y, b.size + 26, _near);
      for (const en of _near) {
        if (en.hp <= 0) continue;
        if (dist2(b.x, b.y, en.x, en.y) < (b.size + en.r) * (b.size + en.r)) {
          if (b.hit && b.hit.includes(en)) continue;
          let dmgMod = 1;
          if (en.weakpoint) { // Universe+ Wardens: armored face, glowing back
            const fd = Math.hypot(G.px - en.x, G.py - en.y) || 1;
            const fx = (G.px - en.x) / fd, fy = (G.py - en.y) / fd;
            const bvm = Math.hypot(b.vx, b.vy) || 1;
            const dot = (b.vx * fx + b.vy * fy) / bvm;
            dmgMod = dot < -0.25 ? 0.25 : dot > 0.25 ? 1.5 : 1;
          }
          hitEnemy(en, b.dmg * dmgMod);
          if (b.mBlast) { blast(b.x, b.y, 46, b.dmg * 0.6); dead = true; break; } // Missiles
          if (s.boom > 0 && Math.random() < s.boom) blast(b.x, b.y, 46, b.dmg * 0.45); // Explosive Rounds
          if (b.pierce > 0) { b.pierce--; (b.hit || (b.hit = [])).push(en); }
          else { dead = true; break; }
        }
      }
    }
    if (dead) { G.pB[i] = G.pB[G.pB.length - 1]; G.pB.pop(); }
  }

  // telegraphed blast zones (barrage + mortar)
  for (let i = G.zones.length - 1; i >= 0; i--) {
    const z = G.zones[i];
    z.t += dt;
    if (z.t >= z.tel) {
      bomb(z.x, z.y, z.r, z.dmg || s.dmg * 2);
      G.zones.splice(i, 1);
    }
  }

  // enemy bullets (slowed by slow field / graze special / ripple)
  const grazeMult = 1 - s.grazeSlow;
  const rippleMult = G.rippleActive > 0 ? 0.45 : 1;
  for (let i = G.eB.length - 1; i >= 0; i--) {
    const b = G.eB[i];
    b.t += dt;
    let m = grazeMult * rippleMult;
    const pd2 = dist2(b.x, b.y, G.px, G.py);
    if (s.slowR > 0 && pd2 < s.slowR * s.slowR) m *= 1 - s.slowBullet;
    // Graze (Touhou-style): a bullet skimming past grants XP and heats your damage
    if (s.graze > 0 && !b.grazed && pd2 < s.grazeR * s.grazeR && pd2 > (b.size + s.hitR + 5) * (b.size + s.hitR + 5)) {
      b.grazed = true;
      G.xp += 0.2 + 0.1 * s.graze;
      G.heatT = 3;
      burst(b.x, b.y, '#ffffff', 1, 60);
      checkLevel();
    }
    b.x += b.vx * dt * m; b.y += b.vy * dt * m;
    let dead = b.t >= b.life || b.x < -30 || b.x > W + 30 || b.y < -30 || b.y > H + 30;
    if (!dead && G.iT <= 0 && pd2 < (b.size + s.hitR) * (b.size + s.hitR)) {
      hurtPlayer(b.dmg); dead = true;
    }
    if (dead) { G.eB[i] = G.eB[G.eB.length - 1]; G.eB.pop(); }
  }

  // gems
  const magR = s.magnetR;
  for (let i = G.gems.length - 1; i >= 0; i--) {
    const g = G.gems[i];
    g.t += dt;
    const d2 = dist2(g.x, g.y, G.px, G.py);
    if (d2 < magR * magR) {
      const d = Math.sqrt(d2) || 1;
      g.x += (G.px - g.x) / d * 480 * dt; g.y += (G.py - g.y) / d * 480 * dt;
    }
    if (d2 < 20 * 20) {
      if (g.heal) G.hp = Math.min(s.maxHp, G.hp + g.heal); // Scavenger healing orb
      else G.xp += g.v * s.xpMult;                          // Greed multiplies gem value
      if (s.gemHeal > 0) G.hp = Math.min(s.maxHp, G.hp + s.gemHeal);
      SFX.gem();
      G.gems.splice(i, 1);
      checkLevel();
    }
  }
  if (G.pendingLevels > 0 && state === ST.PLAY) openLevelUp();

  // fusion banners (level-ups never wait on these; queued banners play faster)
  if (G.bannerT > 0) G.bannerT -= dt;
  if (G.bannerT <= 0 && G.bannerQ.length) {
    const f = G.bannerQ.shift();
    G.bannerT = G.bannerQ.length ? 1.4 : 2.6;
    const el = document.getElementById('fusionBanner');
    el.querySelector('.fTitle').textContent = f.title;
    el.querySelector('.fSub').textContent = f.subtitle;
    el.classList.remove('show'); void el.offsetWidth; // restart animation
    el.classList.add('show');
  }

  // particles / floats / beams
  for (let i = G.parts.length - 1; i >= 0; i--) {
    const p = G.parts[i];
    p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.93; p.vy *= 0.93;
    if (p.t >= p.life) { G.parts[i] = G.parts[G.parts.length - 1]; G.parts.pop(); }
  }
  for (let i = G.floats.length - 1; i >= 0; i--) {
    const f = G.floats[i];
    f.t += dt; f.y -= 30 * dt;
    if (f.t >= f.life) G.floats.splice(i, 1);
  }
  for (let i = G.beams.length - 1; i >= 0; i--) {
    if ((G.beams[i].t += dt) >= G.beams[i].life) G.beams.splice(i, 1);
  }
  if (G.shake > 0) G.shake = Math.max(0, G.shake - dt * 30);
}

// ---------------------------------------------------------------------------
// Render — draw order is the readability contract
// ---------------------------------------------------------------------------
function render() {
  ctx.fillStyle = '#0b0e1a';
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  if (G.shake > 0) ctx.translate(rand(-G.shake, G.shake) * 0.5, rand(-G.shake, G.shake) * 0.5);

  // subtle grid
  ctx.strokeStyle = 'rgba(110, 130, 220, 0.05)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  const gs = 64, ox = (G.time * 6) % gs;
  for (let x = -ox; x < W; x += gs) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
  for (let y = -ox; y < H; y += gs) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
  ctx.stroke();

  const s = G.stats;

  // slow field
  if (s && s.slowR > 0) {
    ctx.fillStyle = 'rgba(130, 240, 255, 0.05)';
    ctx.beginPath(); ctx.arc(G.px, G.py, s.slowR, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(130, 240, 255, 0.22)';
    ctx.beginPath(); ctx.arc(G.px, G.py, s.slowR, 0, TAU); ctx.stroke();
  }
  // graze ring (glows while heat is active)
  if (s && s.graze > 0) {
    ctx.strokeStyle = G.heatT > 0 ? 'rgba(255,255,255,.5)' : 'rgba(255,255,255,.16)';
    ctx.beginPath(); ctx.arc(G.px, G.py, s.grazeR, 0, TAU); ctx.stroke();
  }

  // barrage telegraphs
  for (const z of G.zones) {
    const k = z.t / z.tel;
    ctx.strokeStyle = '#ffd24a'; ctx.globalAlpha = 0.6;
    ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = '#ffd24a';
    ctx.beginPath(); ctx.arc(z.x, z.y, z.r * k, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  }

  // turrets
  for (const tr of G.turrets) {
    const fade = tr.t > 7.5 ? 0.35 + 0.65 * Math.abs(Math.sin(tr.t * 8)) : 1;
    ctx.globalAlpha = fade;
    ctx.strokeStyle = '#7fe8ff'; ctx.fillStyle = 'rgba(127,232,255,.18)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = TAU * k / 6 + tr.t;
      if (k === 0) ctx.moveTo(tr.x + Math.cos(a) * 11, tr.y + Math.sin(a) * 11);
      else ctx.lineTo(tr.x + Math.cos(a) * 11, tr.y + Math.sin(a) * 11);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.globalAlpha = 1; ctx.lineWidth = 1;
  }

  // gems + healing orbs
  const gspr = gemSprite(), hspr = healSprite();
  for (const g of G.gems) {
    const spr = g.heal ? hspr : gspr;
    ctx.drawImage(spr.c, g.x - spr.R, g.y - spr.R);
  }

  // player bullets (quiet cyan)
  for (const b of G.pB) {
    const spr = pBulletSprite(b.size);
    ctx.drawImage(spr.c, b.x - spr.R, b.y - spr.R);
  }

  // enemies — solid, outlined, flash on hit
  for (const en of G.enemies) {
    ctx.save();
    ctx.translate(en.x, en.y);
    ctx.rotate(en.t * (en.boss ? 0.5 : 1.2));
    const sides = { chaser: 3, shooter: 4, spinner: 5, tank: 6, darter: 3, splitter: 8, weaver: 4, brute: 5, charger: 3, boss: 7, superboss: 9, echo: 3 }[en.type] || 4;
    ctx.beginPath();
    for (let i = 0; i < sides; i++) {
      const a = TAU * i / sides;
      const rr = en.r * (en.type === 'darter' ? (i === 0 ? 1.5 : 0.8) : 1);
      if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fillStyle = en.flash > 0 ? '#ffffff' : en.color;
    ctx.globalAlpha = en.flash > 0 ? 0.95 : 0.8;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = en.flash > 0 ? '#ffffff' : 'rgba(255,255,255,.55)';
    ctx.lineWidth = en.boss ? 3 : 1.5;
    ctx.stroke();
    ctx.restore();
    if (en.superBoss) { // Warden aura: tier ring; gold when exhausted (punish window)
      const tired = en.tiredT > 0;
      const ringCol = en.wtier === 'final' ? `hsl(${(G.time * 90) % 360}, 100%, 70%)` : en.color;
      ctx.strokeStyle = tired ? '#ffd24a' : ringCol;
      ctx.globalAlpha = tired ? 0.8 : 0.45 + 0.3 * Math.sin(en.t * 5);
      ctx.lineWidth = tired ? 4 : 3;
      ctx.beginPath(); ctx.arc(en.x, en.y, en.r + 10, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1; ctx.lineWidth = 1;
      if (tired) {
        ctx.textAlign = 'center';
        ctx.font = 'bold 12px Segoe UI, sans-serif';
        ctx.fillStyle = '#ffd24a';
        ctx.fillText('EXHAUSTED', en.x, en.y - en.r - 18);
      }
      if (en.weakpoint) { // glowing weak spot on its back (away from you)
        const fd = Math.hypot(G.px - en.x, G.py - en.y) || 1;
        const wx = en.x - (G.px - en.x) / fd * (en.r + 6), wy = en.y - (G.py - en.y) / fd * (en.r + 6);
        ctx.fillStyle = '#ffd24a';
        ctx.globalAlpha = 0.6 + 0.4 * Math.sin(en.t * 7);
        ctx.beginPath(); ctx.arc(wx, wy, 6, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
      }
      if (en.eaterActive > 0) { // inhale visual
        ctx.strokeStyle = en.color;
        ctx.globalAlpha = 0.5;
        ctx.beginPath(); ctx.arc(en.x, en.y, 260 * (en.eaterActive / 1.6), 0, TAU); ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    if (en.type === 'charger' && en.mode === 'wind') { // dash telegraph
      ctx.strokeStyle = '#ffffff';
      ctx.globalAlpha = 0.4 + 0.5 * Math.abs(Math.sin(en.t * 18));
      ctx.beginPath(); ctx.arc(en.x, en.y, en.r + 6, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (en.elite) { // gold elite ring + name
      ctx.strokeStyle = '#ffd24a';
      ctx.globalAlpha = 0.55 + 0.35 * Math.sin(en.t * 6);
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(en.x, en.y, en.r + 7, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1; ctx.lineWidth = 1;
      ctx.textAlign = 'center';
      ctx.font = 'bold 11px Segoe UI, sans-serif';
      ctx.fillStyle = '#ffd24a';
      ctx.fillText(en.name, en.x, en.y - en.r - 14);
    }
    if (en.maxHp > 60 && en.hp < en.maxHp && !en.boss) {
      ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(en.x - 16, en.y - en.r - 9, 32, 4);
      ctx.fillStyle = '#ff5a6b'; ctx.fillRect(en.x - 16, en.y - en.r - 9, 32 * clamp(en.hp / en.maxHp, 0, 1), 4);
    }
  }

  // vortex rifts
  for (const v of G.vortices) {
    const k = v.t / v.dur;
    ctx.strokeStyle = '#c08aff';
    ctx.globalAlpha = 0.7 * (1 - k * 0.5);
    ctx.lineWidth = 2.5;
    for (let ring = 0; ring < 3; ring++) {
      const rr = (170 - ring * 48) * (1 - k * 0.35);
      ctx.beginPath();
      ctx.arc(v.x, v.y, Math.max(6, rr), v.t * 5 + ring, v.t * 5 + ring + TAU * 0.7);
      ctx.stroke();
    }
    ctx.globalAlpha = 1; ctx.lineWidth = 1;
  }

  // drones (Gradius-style options)
  if (s && s.drones > 0) {
    ctx.fillStyle = '#a8d8ff';
    for (let i = 0; i < s.drones; i++) {
      const p = dronePos(i, s.drones);
      ctx.save(); ctx.translate(p.x, p.y);
      ctx.rotate(Math.atan2(G.faceY, G.faceX) + Math.PI / 2);
      ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 5); ctx.lineTo(-5, 5); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }

  // orbital blades
  if (s && s.orbitals > 0) {
    ctx.fillStyle = '#bfe8ff';
    for (let i = 0; i < s.orbitals; i++) {
      const a = G.time * 3 + TAU * i / s.orbitals;
      const bx = G.px + Math.cos(a) * 72, by = G.py + Math.sin(a) * 72;
      ctx.save(); ctx.translate(bx, by); ctx.rotate(a + Math.PI / 2);
      ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(5, 8); ctx.lineTo(-5, 8); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }

  // beams / rings
  for (const bm of G.beams) {
    const k = 1 - bm.t / bm.life;
    if (bm.ring) {
      ctx.strokeStyle = bm.color; ctx.globalAlpha = k * 0.7; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(bm.x, bm.y, bm.r * (1 - k * 0.4), 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1; ctx.lineWidth = 1;
      continue;
    }
    ctx.save();
    ctx.translate(bm.x, bm.y); ctx.rotate(bm.a);
    ctx.globalAlpha = k * 0.85;
    ctx.fillStyle = bm.color;
    ctx.fillRect(0, -bm.w * k, bm.len, bm.w * 2 * k);
    ctx.globalAlpha = k * 0.6;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, -bm.w * k * 0.3, bm.len, bm.w * 0.6 * k);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // player — bright, unmissable
  if (G.hp > 0) {
    const blink = G.iT > 0 && ((G.time * 14) | 0) % 2 === 0;
    if (s && s.shieldMax > 0) {
      for (let i = 0; i < G.shield; i++) {
        const a = G.time * 1.6 + TAU * i / Math.max(1, s.shieldMax);
        ctx.fillStyle = '#6fd8ff';
        ctx.globalAlpha = 0.9;
        ctx.beginPath(); ctx.arc(G.px + Math.cos(a) * 26, G.py + Math.sin(a) * 26, 3.4, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    if (!blink) {
      ctx.save();
      ctx.translate(G.px, G.py);
      ctx.rotate(Math.atan2(G.faceY, G.faceX) + Math.PI / 2);
      ctx.shadowColor = '#8ad8ff'; ctx.shadowBlur = 14;
      ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#6fd8ff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, -16); ctx.lineTo(10, 11); ctx.lineTo(0, 6); ctx.lineTo(-10, 11); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.restore();
    }
    // hitbox — faint always, bright in focus (Shrink makes it truly smaller)
    const hr = s ? s.hitR : G.pr;
    ctx.fillStyle = '#ff2a5a';
    ctx.globalAlpha = G.focus ? 1 : 0.55;
    ctx.beginPath(); ctx.arc(G.px, G.py, hr, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
    if (G.focus) {
      ctx.strokeStyle = 'rgba(255,255,255,.8)';
      ctx.beginPath(); ctx.arc(G.px, G.py, hr + 3, 0, TAU); ctx.stroke();
    }
  }

  // ENEMY BULLETS — always on top: if it can kill you, you can see it
  for (const b of G.eB) {
    const spr = eBulletSprite(b.size);
    ctx.drawImage(spr.c, b.x - spr.R, b.y - spr.R);
  }

  // particles
  for (const p of G.parts) {
    ctx.globalAlpha = clamp(1 - p.t / p.life, 0, 1) * 0.9;
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;

  // announcements
  ctx.textAlign = 'center';
  ctx.font = 'bold 16px Segoe UI, sans-serif';
  for (const f of G.floats) {
    ctx.globalAlpha = clamp(1 - f.t / f.life, 0, 1);
    ctx.fillStyle = f.color;
    ctx.fillText(f.txt, f.x, f.y);
  }
  ctx.globalAlpha = 1;

  ctx.restore();

  // touch joystick (true screen space — unaffected by zoom or shake)
  if (joy.active) {
    ctx.save();
    ctx.setTransform(dprCur, 0, 0, dprCur, 0, 0);
    ctx.strokeStyle = 'rgba(140, 180, 255, .35)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(joy.sx, joy.sy, joy.R, 0, TAU); ctx.stroke();
    const jdx = joy.x - joy.sx, jdy = joy.y - joy.sy, jd = Math.hypot(jdx, jdy) || 1;
    const k = Math.min(jd, joy.R);
    ctx.fillStyle = 'rgba(180, 210, 255, .5)';
    ctx.beginPath(); ctx.arc(joy.sx + jdx / jd * k, joy.sy + jdy / jd * k, 17, 0, TAU); ctx.fill();
    ctx.restore();
  }

  // faint vignette only
  const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.5, W / 2, H / 2, Math.max(W, H) * 0.78);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,12,0.30)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
}

// ---------------------------------------------------------------------------
// HUD / overlays
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
function updateHUD() {
  const s = G.stats;
  $('hpBar').firstElementChild.style.width = clamp(G.hp / s.maxHp * 100, 0, 100) + '%';
  $('xpBar').firstElementChild.style.width = clamp(G.xp / G.xpNeed * 100, 0, 100) + '%';
  $('lvNum').textContent = G.level;
  $('waveNum').textContent = (G.ngPlus ? 'NG+' + G.ngPlus + ' ' : '') + G.sector + '-' + G.wave;
  $('killNum').textContent = fmt(G.kills);
  $('bestNum').textContent = Math.max(bestWave, totalWave());
  $('shieldNum').textContent = s.shieldMax > 0 ? `🛡 ${G.shield}/${s.shieldMax}` : '';
  if (G.bossAlive) $('bossBar').querySelector('i').style.width = clamp(G.bossAlive.hp / G.bossAlive.maxHp * 100, 0, 100) + '%';
}

function unitChipText(u) {
  // ⚡ marks fusion fuel: Lv2 is one pick away, Lv3+ is ready and waiting
  if (u.kind === 'family') return `${FAMILIES[u.key].name} ${u.level}${u.level >= 3 ? ' ⚡rdy' : u.level === 2 ? ' ⚡' : ''}`;
  if (u.kind === 'primordial') return `🜏 ${PRIMORDIALS[u.key].name} Lv${u.level}`;
  return `${'★'.repeat(Math.min(u.stars, 5))}${u.stars > 5 ? '×' + u.stars : ''} ${u.name} Lv${u.level}`;
}
function unitChipColor(u) {
  return u.kind === 'family' ? CATS[FAMILIES[u.key].cat].color : TIERS[u.tier].color;
}

function refreshChips() {
  const el = $('powerChips');
  if (!el) return;
  el.innerHTML = '';
  for (const u of G.units || []) {
    const chip = document.createElement('div');
    chip.className = 'chip';
    const col = unitChipColor(u);
    chip.style.borderColor = col; chip.style.color = col;
    chip.textContent = unitChipText(u);
    el.appendChild(chip);
  }
}

function buildRecapHTML() {
  const s = G.stats;
  const rows = G.units.map(u => {
    const sum = unitSummary(u);
    const col = unitChipColor(u);
    const tierTag = u.kind === 'family' ? ` <small>Lv${u.level}</small>`
      : ` <small>(${TIERS[u.tier].name} Lv${u.level}${u.stars ? ' ★' + u.stars : ''})</small>`;
    const name = u.kind === 'family' ? FAMILIES[u.key].name
      : u.kind === 'primordial' ? '🜏 ' + PRIMORDIALS[u.key].name : u.name;
    return `<div style="color:${col};margin:3px 0"><b>${name}</b>${tierTag}<br>
      <small style="color:var(--dim)">${sum.effects.join(' · ')}${sum.specials.length ? ' · ' + sum.specials.join(' · ') : ''}</small></div>`;
  }).join('');
  const totals = `${s.count} bullets · ${s.rate.toFixed(1)}/s · ${Math.round(s.dmg)} dmg` +
    (s.pierce ? ` · pierce ${s.pierce}` : '') + (s.bounce ? ` · bounce ${s.bounce}` : '') +
    (s.homing ? ' · homing' : '') + (s.crit > 0.04 ? ` · crit ${Math.round(s.crit * 100)}%` : '') +
    (s.lifesteal ? ` · lifesteal ${Math.round(s.lifesteal * 100)}%` : '') +
    (s.shieldMax ? ` · shield ${s.shieldMax}` : '') + (s.regen ? ` · regen ${s.regen.toFixed(1)}/s` : '') +
    (s.armor ? ` · armor ${s.armor}` : '') + (s.dodge ? ` · dodge ${Math.round(s.dodge * 100)}%` : '') +
    (s.rear ? ` · rear ${s.rear}` : '') + (s.side ? ` · side ${s.side}×2` : '') +
    (s.arc ? ` · arc ${Math.round(s.arc * 100)}%` : '') + (s.cull ? ` · cull <${Math.round(s.cull * 100)}%` : '') +
    (s.xpMult > 1 ? ` · xp +${Math.round((s.xpMult - 1) * 100)}%` : '') +
    (s.hitR < 3.5 ? ` · hitbox −${Math.round((1 - s.hitR / 3.5) * 100)}%` : '');
  return `<div style="text-align:left;max-width:520px;margin:0 auto">${rows || '<i>nothing yet</i>'}</div>
    <div style="margin-top:10px;color:var(--ink);font-size:13px">${totals}</div>`;
}

function die() {
  state = ST.DEAD;
  bestWave = Math.max(bestWave, (G.ngPlus || 0) * 100000 + totalWave());
  if (store) try { store.setItem('spacesouls.bestWave', String(bestWave)); } catch (e) {}
  $('deadStats').innerHTML = `
    <div class="sub">Survived to <b>${G.ngPlus ? 'NG+' + G.ngPlus + ' · ' : ''}Sector ${G.sector} · Wave ${G.wave}</b> (best: ${bestWave} total waves) · <b>${fmt(G.kills)}</b> kills ·
    Level <b>${G.level}</b> · <b>${G.fusions}</b> auto-fusions · ${fmt(Math.round(G.dmgDealt))} damage dealt</div>
    ${buildRecapHTML()}`;
  $('ovDead').classList.add('on');
}

function closeOverlays() {
  for (const id of ['ovTitle', 'ovLevel', 'ovPause', 'ovDead']) $(id).classList.remove('on');
}

function openPause() {
  state = ST.PAUSE;
  $('pauseStats').innerHTML = buildRecapHTML();
  $('ovPause').classList.add('on');
}

function handleKey(k) {
  if (state === ST.PLAY) {
    if (k === 'p' || k === 'escape') openPause();
    else if (k === 'm') SFX.toggle();
  } else if (state === ST.PAUSE && (k === 'p' || k === 'escape')) {
    closeOverlays(); state = ST.PLAY;
  } else if (state === ST.TITLE && k === 'enter') startGame();
  else if (state === ST.DEAD && k === 'enter') startGame();
}
$('btnPause').addEventListener('click', () => {
  if (state === ST.PLAY) openPause();
  else if (state === ST.PAUSE) { closeOverlays(); state = ST.PLAY; }
});

function startGame() {
  SFX.init();
  closeOverlays();
  newRun();
  $('hud').classList.add('on');
  state = ST.PLAY;
}
$('btnStart').addEventListener('click', startGame);
$('btnRetry').addEventListener('click', startGame);
$('btnResume').addEventListener('click', () => { closeOverlays(); state = ST.PLAY; });

// touch devices get touch instructions
if (IS_TOUCH) {
  const keysEl = document.querySelector('#ovTitle .keys');
  if (keysEl) keysEl.innerHTML = 'Touch controls: <b>drag anywhere</b> to steer — a light drag moves you ' +
    'slowly for precise dodging.<br>Your ship fires by itself. Tap <b>⏸</b> for pause &amp; your build.';
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
let last = performance.now(), acc = 0;
const STEP = 1 / 60;
function frame(now) {
  requestAnimationFrame(frame);
  let ft = (now - last) / 1000;
  last = now;
  if (ft > 0.1) ft = 0.1;
  if (state === ST.PLAY) {
    acc += ft;
    let n = 0;
    while (acc >= STEP && n++ < 4) { update(STEP); acc -= STEP; }
    if (acc >= STEP) acc = 0;
    updateHUD();
  }
  if (state !== ST.TITLE) render();
  else renderTitleBG(ft);
}
const titleStars = Array.from({ length: 90 }, () => ({ x: Math.random(), y: Math.random(), s: rand(0.4, 2), v: rand(6, 40) }));
function renderTitleBG(dt) {
  ctx.fillStyle = '#0b0e1a'; ctx.fillRect(0, 0, W, H);
  for (const st of titleStars) {
    st.y += st.v * dt / H;
    if (st.y > 1) { st.y = 0; st.x = Math.random(); }
    ctx.fillStyle = 'rgba(180,200,255,' + (st.s / 2.4) + ')';
    ctx.fillRect(st.x * W, st.y * H, st.s, st.s);
  }
}
requestAnimationFrame(frame);

// ---------------------------------------------------------------------------
// Debug / test API
// ---------------------------------------------------------------------------
window.__GAME__ = {
  FAMILIES, FAMILY_KEYS, TIERS, SPECIALS, CATS, PRIMORDIALS, PRIMORDIAL_KEYS, PRIMORDIAL_CHANCE,
  get state() { return state; },
  get G() { return G; },
  get stats() { return G.stats; },
  start: startGame,
  grantFamily(key) { applyCard({ type: 'new', key }); },
  grantPrimordial(key) { applyCard({ type: 'primordial', key }); },
  levelUnit(i, n) { const u = G.units[i]; for (let k = 0; k < (n || 1); k++) applyCard({ type: 'level', u }); return u; },
  forceLevelUp() { G.pendingLevels++; },
  hurt(d) { hurtPlayer(d); },
  fireVolley, spawnElite, startSuperBoss, totalWave, wardenTier, WARDEN_TIERS, ETYPES, waveScale, maxShooters, shooterCount,
  kill(en) { killEnemy(en); },
  get world() { return { W, H, zoom: ZOOM }; },
  unitSummary, autoFuse, makeFamilyUnit,
};
