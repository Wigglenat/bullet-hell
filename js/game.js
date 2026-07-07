'use strict';
/* ============================================================================
 * MYRIAD BREAK v2 — readable bullet-hell, classic powers, automatic fusion.
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
let W = 0, H = 0;
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth; H = window.innerHeight;
  cv.width = Math.floor(W * dpr); cv.height = Math.floor(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
// State
// ---------------------------------------------------------------------------
const ST = { TITLE: 0, PLAY: 1, LEVELUP: 2, PAUSE: 3, DEAD: 4 };
let state = ST.TITLE;

const store = (() => { try { const s = window.localStorage; s.getItem('x'); return s; } catch (e) { return null; } })();
let bestWave = +((store && store.getItem('myriad.bestWave')) || 0);

const G = {};
function newRun() {
  Object.assign(G, {
    time: 0, wave: 1, waveT: 0, kills: 0, fusions: 0, dmgDealt: 0,
    level: 1, xp: 0, xpNeed: xpNeed(1), pendingLevels: 0,
    px: W / 2, py: H * 0.7, pr: 3.5, hp: 100, iT: 0, focus: false,
    faceX: 0, faceY: -1, shake: 0, phoenixUsed: false,
    units: [], ess: { dmg: 0, rate: 0, life: 0 },
    stats: null, shield: 0, shieldT: 0,
    gunAcc: 0, novaT: 3, laserT: 3, echoT: 6, rippleT: 12, barrageT: 18, bombT: 0,
    rippleActive: 0, bladeCd: [], rampStart: null, rampMult: 1, pulseT: 0, rebirthT: 0,
    enemies: [], pB: [], eB: [], gems: [], parts: [], zones: [], beams: [], floats: [],
    spawnT: 1.0, bossAlive: null, bannerQ: [], bannerT: 0,
  });
  // starting kit: +Bullets Lv1 — instantly legible
  G.units.push(makeFamilyUnit('bullets'));
  recompute();
  G.hp = G.stats.maxHp;
}
function xpNeed(lv) { return Math.floor(5 + lv * 3 + lv * lv * 0.2); }

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
function cardPool() {
  const pool = [];
  for (const u of G.units) {
    if (u.level < TIERS[u.tier].maxLevel) pool.push({ type: 'level', u, w: u.kind === 'primordial' ? 1 : 3 });
  }
  if (G.units.filter(u => u.kind !== 'primordial').length < MAX_UNITS) { // relics don't take slots
    for (const key of FAMILY_KEYS) {
      if (!G.units.some(u => u.kind === 'family' && u.key === key)) pool.push({ type: 'new', key, w: 3 });
    }
  }
  pool.push({ type: 'ess', key: 'dmg', w: 1 }, { type: 'ess', key: 'rate', w: 1 }, { type: 'ess', key: 'life', w: 1 });
  return pool;
}

function drawCards(n) {
  const pool = cardPool(), out = [];
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
  const wrap = document.getElementById('cards');
  wrap.innerHTML = '';
  const cards = drawCards(3);
  // PRIMORDIAL roll — each slot has a 0.01% chance (1 in 10,000)
  for (let i = 0; i < cards.length; i++) {
    if (Math.random() >= PRIMORDIAL_CHANCE) continue;
    const unowned = PRIMORDIAL_KEYS.filter(k => !G.units.some(u => u.kind === 'primordial' && u.key === k));
    if (unowned.length) cards[i] = { type: 'primordial', key: unowned[(Math.random() * unowned.length) | 0] };
    else {
      const owned = G.units.filter(u => u.kind === 'primordial');
      cards[i] = { type: 'level', u: owned[(Math.random() * owned.length) | 0] };
    }
  }
  for (const card of cards) {
    const info = cardHTML(card);
    const el = document.createElement('div');
    el.className = 'card' + (info.cls ? ' ' + info.cls : '');
    el.style.borderColor = info.border;
    el.innerHTML = info.html;
    el.addEventListener('click', () => {
      applyCard(card);
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

function fireVolley() {
  const s = G.stats, n = s.count;
  const a0 = aimAngle();
  const spread = Math.min(0.55, 0.085 * (n - 1));
  for (let i = 0; i < n; i++) {
    const a = n === 1 ? a0 : a0 - spread / 2 + spread * (i / (n - 1));
    poolPush(G.pB, CAP.pB, {
      x: G.px, y: G.py, vx: Math.cos(a) * s.speed, vy: Math.sin(a) * s.speed,
      t: 0, life: 1.5 + s.bounce * 0.5, size: s.size, dmg: s.dmg,
      pierce: s.pierce, bounce: s.bounce, homing: s.homing, hit: null,
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
function hitEnemy(en, dmg) {
  const s = G.stats;
  const isCrit = Math.random() < s.crit;
  const d = dmg * (isCrit ? s.critMult : 1) * (G.rampMult || 1);
  en.hp -= d;
  en.flash = 0.08;
  G.dmgDealt += d;
  if (s.lifesteal > 0) G.hp = Math.min(s.maxHp, G.hp + d * s.lifesteal);
  if (isCrit) burst(en.x, en.y, '#ffd24a', 3, 150);
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
  const gems = en.boss ? 30 : 1;
  for (let i = 0; i < gems; i++) {
    poolPush(G.gems, CAP.gems, { x: en.x + rand(-en.r, en.r), y: en.y + rand(-en.r, en.r), v: Math.max(1, Math.round(en.xp / gems)), t: 0 });
  }
  if (s.splitShards > 0) {
    for (let k = 0; k < s.splitShards; k++) {
      const a = Math.random() * TAU;
      poolPush(G.pB, CAP.pB, { x: en.x, y: en.y, vx: Math.cos(a) * 320, vy: Math.sin(a) * 320, t: 0, life: s.shardHoming ? 1.1 : 0.55, size: 3.5, dmg: s.dmg * 0.4, pierce: 0, bounce: 0, homing: s.shardHoming ? 3.5 : 0, hit: null });
    }
  }
  if (s.sparks) blast(en.x, en.y, 46, s.dmg * 0.5);
  if (s.kilnova > 0 && Math.random() < s.kilnova) blast(en.x, en.y, 90, s.dmg * 1.2);
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
  for (const en of _near) if (en.hp > 0 && dist2(x, y, en.x, en.y) < (r + en.r) * (r + en.r)) hitEnemy(en, dmg);
  burst(x, y, '#ffb454', 6, 180);
}

// ---------------------------------------------------------------------------
// Enemies & waves
// ---------------------------------------------------------------------------
const ETYPES = {
  chaser:   { hp: 16,  speed: 92,  r: 12, dmg: 12, color: '#ff6b5a', xp: 1 },
  shooter:  { hp: 22,  speed: 60,  r: 12, dmg: 10, color: '#ffa04a', xp: 1 },
  spinner:  { hp: 30,  speed: 42,  r: 14, dmg: 12, color: '#d05cff', xp: 2 },
  tank:     { hp: 90,  speed: 30,  r: 20, dmg: 18, color: '#98a8c8', xp: 3 },
  darter:   { hp: 14,  speed: 68,  r: 10, dmg: 12, color: '#4ad8ff', xp: 1 },
  splitter: { hp: 26,  speed: 66,  r: 14, dmg: 12, color: '#9bd820', xp: 2 },
  boss:     { hp: 800, speed: 40,  r: 42, dmg: 24, color: '#ff2a8a', xp: 45 },
};
function waveScale() { return 1 + G.wave * 0.30 + G.wave * G.wave * 0.035; }

function spawnEnemy(type, x, y, hpMult) {
  const T = ETYPES[type], sc = waveScale();
  const en = {
    type, x, y, r: T.r, hp: T.hp * sc * (hpMult || 1), maxHp: T.hp * sc * (hpMult || 1),
    speed: T.speed * (1 + G.wave * 0.008), dmg: T.dmg * (1 + G.wave * 0.05),
    color: T.color, xp: T.xp, t: rand(0, 9), shootT: rand(1.2, 2.6),
    boss: type === 'boss', dashT: 0, dvx: 0, dvy: 0, ang: Math.random() * TAU,
    dead: false, flash: 0,
  };
  if (en.boss) {
    en.name = pick(MYTH_BEINGS) + ' THE DEVOURER';
    en.xp = 45 + G.wave;
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

function updateWave(dt) {
  G.waveT += dt;
  if (G.waveT >= 22) {
    G.waveT = 0; G.wave++;
    announce('WAVE ' + G.wave + (G.wave % 10 === 0 ? ' — BOSS' : ''), G.wave % 10 === 0 ? '#ff2a8a' : '#8aa0ff');
    if (G.wave % 10 === 0) {
      const p = edgeSpawnPos();
      spawnEnemy('boss', p.x, p.y, 1 + G.wave / 18);
    }
  }
  G.spawnT -= dt;
  if (G.spawnT <= 0) {
    G.spawnT = clamp(1.5 - G.wave * 0.045, 0.32, 1.5) * (G.bossAlive ? 1.8 : 1);
    const pack = 1 + ((G.wave / 5) | 0) + ((Math.random() * 2) | 0);
    const table = ['chaser', 'chaser', 'chaser', 'darter', 'shooter'];
    if (G.wave >= 3) table.push('shooter', 'splitter');
    if (G.wave >= 5) table.push('spinner', 'splitter');
    if (G.wave >= 8) table.push('tank', 'spinner');
    for (let i = 0; i < pack; i++) {
      const p = edgeSpawnPos();
      spawnEnemy(pick(table), p.x + rand(-24, 24), p.y + rand(-24, 24));
    }
  }
}

function slowFactorAt(x, y) {
  const s = G.stats;
  if (s.slowR > 0 && dist2(x, y, G.px, G.py) < s.slowR * s.slowR) return 1 - s.slowEnemy;
  return 1;
}

function updateEnemy(en, dt) {
  en.t += dt;
  if (en.flash > 0) en.flash -= dt;
  const sp = en.speed * slowFactorAt(en.x, en.y);
  const dx = G.px - en.x, dy = G.py - en.y, d = Math.hypot(dx, dy) || 1;

  switch (en.type) {
    case 'chaser': case 'splitter':
      en.x += dx / d * sp * dt; en.y += dy / d * sp * dt; break;
    case 'shooter':
      if (d > 240) { en.x += dx / d * sp * dt; en.y += dy / d * sp * dt; }
      else if (d < 170) { en.x -= dx / d * sp * 0.7 * dt; en.y -= dy / d * sp * 0.7 * dt; }
      en.shootT -= dt;
      if (en.shootT <= 0 && d < 560) {
        en.shootT = clamp(2.3 - G.wave * 0.03, 1.0, 2.3);
        spawnEB({ x: en.x, y: en.y, vx: dx / d * 175, vy: dy / d * 175, dmg: en.dmg, size: 5 });
      }
      break;
    case 'spinner':
      en.x += dx / d * sp * dt; en.y += dy / d * sp * dt;
      en.shootT -= dt;
      if (en.shootT <= 0) {
        en.shootT = clamp(2.8 - G.wave * 0.03, 1.4, 2.8);
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
  en.x = clamp(en.x, -60, W + 60); en.y = clamp(en.y, -60, H + 60);
  if (G.iT <= 0 && dist2(en.x, en.y, G.px, G.py) < (en.r + 8) * (en.r + 8)) hurtPlayer(en.dmg);
}

// ---------------------------------------------------------------------------
// Player damage / shields / bombs / phoenix
// ---------------------------------------------------------------------------
function hurtPlayer(dmg) {
  if (G.iT > 0) return;
  const s = G.stats;
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

  // movement
  const up = keys.has('w') || keys.has('arrowup'), dn = keys.has('s') || keys.has('arrowdown');
  const lf = keys.has('a') || keys.has('arrowleft'), rt = keys.has('d') || keys.has('arrowright');
  G.focus = keys.has('shift');
  let mx = (rt ? 1 : 0) - (lf ? 1 : 0), my = (dn ? 1 : 0) - (up ? 1 : 0);
  if (mx || my) {
    const m = Math.hypot(mx, my);
    mx /= m; my /= m;
    G.faceX = mx; G.faceY = my;
    const spd = s.moveSpd * (G.focus ? 0.45 : 1);
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

  // main gun
  G.gunAcc += dt * s.rate;
  let guard = 0;
  while (G.gunAcc >= 1 && guard++ < 6) { G.gunAcc -= 1; fireVolley(); }
  if (G.gunAcc > 6) G.gunAcc = 6;

  // systems
  if (s.novaLv > 0) { G.novaT -= dt; if (G.novaT <= 0) { G.novaT = s.novaCd; fireNova(); } }
  if (s.laserLv > 0) { G.laserT -= dt; if (G.laserT <= 0) { G.laserT = s.laserCd; fireLaser(); } }
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
          hitEnemy(en, b.dmg);
          if (b.pierce > 0) { b.pierce--; (b.hit || (b.hit = [])).push(en); }
          else { dead = true; break; }
        }
      }
    }
    if (dead) { G.pB[i] = G.pB[G.pB.length - 1]; G.pB.pop(); }
  }

  // barrage zones
  for (let i = G.zones.length - 1; i >= 0; i--) {
    const z = G.zones[i];
    z.t += dt;
    if (z.t >= z.tel) {
      bomb(z.x, z.y, z.r, s.dmg * 2);
      G.zones.splice(i, 1);
    }
  }

  // enemy bullets (slowed by slow field / graze / ripple)
  const grazeMult = 1 - s.grazeSlow;
  const rippleMult = G.rippleActive > 0 ? 0.45 : 1;
  for (let i = G.eB.length - 1; i >= 0; i--) {
    const b = G.eB[i];
    b.t += dt;
    let m = grazeMult * rippleMult;
    if (s.slowR > 0 && dist2(b.x, b.y, G.px, G.py) < s.slowR * s.slowR) m *= 1 - s.slowBullet;
    b.x += b.vx * dt * m; b.y += b.vy * dt * m;
    let dead = b.t >= b.life || b.x < -30 || b.x > W + 30 || b.y < -30 || b.y > H + 30;
    if (!dead && G.iT <= 0 && dist2(b.x, b.y, G.px, G.py) < (b.size + G.pr) * (b.size + G.pr)) {
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
      G.xp += g.v;
      if (s.gemHeal > 0) G.hp = Math.min(s.maxHp, G.hp + s.gemHeal);
      SFX.gem();
      G.gems.splice(i, 1);
      while (G.xp >= G.xpNeed) { G.xp -= G.xpNeed; G.level++; G.xpNeed = xpNeed(G.level); G.pendingLevels++; }
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

  // gems
  const gspr = gemSprite();
  for (const g of G.gems) ctx.drawImage(gspr.c, g.x - gspr.R, g.y - gspr.R);

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
    const sides = { chaser: 3, shooter: 4, spinner: 5, tank: 6, darter: 3, splitter: 8, boss: 7 }[en.type] || 4;
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
    if (en.maxHp > 60 && en.hp < en.maxHp && !en.boss) {
      ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(en.x - 16, en.y - en.r - 9, 32, 4);
      ctx.fillStyle = '#ff5a6b'; ctx.fillRect(en.x - 16, en.y - en.r - 9, 32 * clamp(en.hp / en.maxHp, 0, 1), 4);
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
      ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(9, 10); ctx.lineTo(0, 5); ctx.lineTo(-9, 10); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.restore();
    }
    // hitbox — faint always, bright in focus
    ctx.fillStyle = '#ff2a5a';
    ctx.globalAlpha = G.focus ? 1 : 0.55;
    ctx.beginPath(); ctx.arc(G.px, G.py, G.pr, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
    if (G.focus) {
      ctx.strokeStyle = 'rgba(255,255,255,.8)';
      ctx.beginPath(); ctx.arc(G.px, G.py, G.pr + 3, 0, TAU); ctx.stroke();
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
  $('waveNum').textContent = G.wave;
  $('killNum').textContent = fmt(G.kills);
  $('bestNum').textContent = Math.max(bestWave, G.wave);
  $('shieldNum').textContent = s.shieldMax > 0 ? `🛡 ${G.shield}/${s.shieldMax}` : '';
  if (G.bossAlive) $('bossBar').querySelector('i').style.width = clamp(G.bossAlive.hp / G.bossAlive.maxHp * 100, 0, 100) + '%';
}

function unitChipText(u) {
  if (u.kind === 'family') return `${FAMILIES[u.key].name} ${u.level}`;
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
    (s.shieldMax ? ` · shield ${s.shieldMax}` : '') + (s.regen ? ` · regen ${s.regen.toFixed(1)}/s` : '');
  return `<div style="text-align:left;max-width:520px;margin:0 auto">${rows || '<i>nothing yet</i>'}</div>
    <div style="margin-top:10px;color:var(--ink);font-size:13px">${totals}</div>`;
}

function die() {
  state = ST.DEAD;
  bestWave = Math.max(bestWave, G.wave);
  if (store) try { store.setItem('myriad.bestWave', String(bestWave)); } catch (e) {}
  $('deadStats').innerHTML = `
    <div class="sub">Survived to <b>Wave ${G.wave}</b> (best: ${bestWave}) · <b>${fmt(G.kills)}</b> kills ·
    Level <b>${G.level}</b> · <b>${G.fusions}</b> auto-fusions · ${fmt(Math.round(G.dmgDealt))} damage dealt</div>
    ${buildRecapHTML()}`;
  $('ovDead').classList.add('on');
}

function closeOverlays() {
  for (const id of ['ovTitle', 'ovLevel', 'ovPause', 'ovDead']) $(id).classList.remove('on');
}

function handleKey(k) {
  if (state === ST.PLAY) {
    if (k === 'p' || k === 'escape') {
      state = ST.PAUSE;
      $('pauseStats').innerHTML = buildRecapHTML();
      $('ovPause').classList.add('on');
    } else if (k === 'm') SFX.toggle();
  } else if (state === ST.PAUSE && (k === 'p' || k === 'escape')) {
    closeOverlays(); state = ST.PLAY;
  } else if (state === ST.TITLE && k === 'enter') startGame();
  else if (state === ST.DEAD && k === 'enter') startGame();
}

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
  unitSummary, autoFuse, makeFamilyUnit,
};
