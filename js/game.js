'use strict';
/* ============================================================================
 * MYRIAD BREAK — infinite bullet-hell with a 10,000-power merge system.
 * Engine: single canvas, pooled entities, fixed-timestep sim, DOM overlays.
 * Requires powers.js (PowerPool, TIERS, ELEMENTS, PATTERNS, mergeResultId…).
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
// Small utils
// ---------------------------------------------------------------------------
const TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const fmt = (n) => n.toLocaleString('en-US');

// ---------------------------------------------------------------------------
// Bullet sprite cache — pre-rendered glowing dots per (color, radius bucket)
// ---------------------------------------------------------------------------
const spriteCache = new Map();
function bulletSprite(color, r) {
  const key = color + '|' + (r | 0);
  let s = spriteCache.get(key);
  if (s) return s;
  const R = (r | 0) + 6, size = R * 2;
  const c = document.createElement('canvas'); c.width = size; c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(R, R, 0, R, R, R);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.35, color);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad; g.fillRect(0, 0, size, size);
  s = { c, R };
  spriteCache.set(key, s);
  return s;
}

// ---------------------------------------------------------------------------
// Tiny WebAudio synth (initialized on first user gesture)
// ---------------------------------------------------------------------------
const SFX = (() => {
  let ac = null, muted = false;
  function init() { if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* no audio */ } } }
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
    init,
    toggle() { muted = !muted; return muted; },
    kill()   { blip(rand(180, 260), 0.08, 'square', 0.025); },
    hurt()   { blip(90, 0.25, 'sawtooth', 0.06); },
    gem()    { blip(rand(880, 1100), 0.05, 'sine', 0.02); },
    level()  { blip(520, 0.12, 'triangle', 0.05); setTimeout(() => blip(780, 0.18, 'triangle', 0.05), 90); },
    forge()  { blip(300, 0.15, 'sawtooth', 0.045); setTimeout(() => blip(600, 0.2, 'triangle', 0.05), 110); },
    mythic() { [440, 554, 659, 880].forEach((f, i) => setTimeout(() => blip(f, 0.25, 'triangle', 0.05), i * 100)); },
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
  handleKey(k, e);
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------
const ST = { TITLE: 0, PLAY: 1, LEVELUP: 2, MERGE: 3, PAUSE: 4, DEAD: 5 };
let state = ST.TITLE;

const G = {};                       // current run, built by newRun()
const store = (() => { try { const s = window.localStorage; s.getItem('x'); return s; } catch (e) { return null; } })();
const codex = new Set(JSON.parse((store && store.getItem('myriad.codex')) || '[]'));
let bestWave = +((store && store.getItem('myriad.bestWave')) || 0);
function saveCodex() {
  if (!store) return;
  try {
    store.setItem('myriad.codex', JSON.stringify([...codex]));
    store.setItem('myriad.bestWave', String(Math.max(bestWave, G.wave || 0)));
  } catch (e) { /* storage full/blocked — codex just won't persist */ }
}

function newRun() {
  Object.assign(G, {
    time: 0, wave: 1, waveT: 0, kills: 0, forges: 0, dmgDealt: 0,
    level: 1, xp: 0, xpNeed: xpNeed(1), pendingLevels: 0,
    px: W / 2, py: H * 0.72, pr: 3.5, hp: 100, hpMax: 100, iT: 0, focus: false,
    faceX: 0, faceY: -1, phoenixUsed: false, shake: 0,
    equipped: [], bench: [],        // power instances {id, level, stars, accs[], spiral}
    enemies: [], pB: [], eB: [], gems: [], parts: [], zones: [], beams: [], floats: [],
    spawnT: 1.2, bossAlive: null, auraT: 0,
  });
  // starting power: a random base power — the first draw of the run
  grantPower((Math.random() * 5000) | 0, true);
  refreshChips();
}

function xpNeed(lv) { return Math.floor(5 + lv * 3 + lv * lv * 0.2); }

// ---------------------------------------------------------------------------
// Power instances — equip / bench / level / merge
// ---------------------------------------------------------------------------
const MAX_EQUIPPED = 6;

function makeInstance(id) {
  const p = PowerPool[id];
  return { id, level: 1, stars: 0, accs: p.emitters.map(() => Math.random() * 0.5), spiral: Math.random() * TAU };
}

function grantPower(id, silent) {
  codex.add(id);
  const dupe = G.equipped.find(i => i.id === id) || G.bench.find(i => i.id === id);
  if (dupe) { dupe.level++; if (!silent) floatText(G.px, G.py - 26, PowerPool[id].name + ' Lv' + dupe.level, TIERS[PowerPool[id].tier].color); }
  else {
    const inst = makeInstance(id);
    if (G.equipped.length < MAX_EQUIPPED) G.equipped.push(inst);
    else G.bench.push(inst);
    if (!silent) floatText(G.px, G.py - 26, '+ ' + PowerPool[id].name, TIERS[PowerPool[id].tier].color);
  }
  saveCodex();
  refreshChips();
  return dupe || null;
}

function removeInstance(inst) {
  let i = G.equipped.indexOf(inst);
  if (i >= 0) { G.equipped.splice(i, 1); return; }
  i = G.bench.indexOf(inst);
  if (i >= 0) G.bench.splice(i, 1);
}

function forgeMerge(instA, instB) {
  const resId = mergeResultId(instA.id, instB.id);
  const overch = isOvercharge(instA.id, instB.id);
  const carryLevel = Math.max(1, Math.round((instA.level + instB.level) / 2));
  const carryStars = overch ? Math.max(instA.stars, instB.stars) + 1
                            : Math.max(instA.stars, instB.stars);
  removeInstance(instA); removeInstance(instB);

  const dupe = G.equipped.find(i => i.id === resId) || G.bench.find(i => i.id === resId);
  let inst;
  if (dupe) { dupe.level += carryLevel; dupe.stars = Math.max(dupe.stars, carryStars); inst = dupe; }
  else {
    inst = makeInstance(resId);
    inst.level = carryLevel; inst.stars = carryStars;
    if (G.equipped.length < MAX_EQUIPPED) G.equipped.push(inst);
    else G.bench.push(inst);
  }
  G.forges++;
  codex.add(resId); saveCodex(); refreshChips();
  const P = PowerPool[resId];
  if (P.tier === 5) SFX.mythic(); else SFX.forge();
  floatText(G.px, G.py - 30, (overch ? '★ OVERCHARGE — ' : 'FORGED — ') + P.name, TIERS[P.tier].color);
  burst(G.px, G.py, TIERS[P.tier].color, 26, 240);
  return inst;
}

// Damage/rate multipliers for an instance.
function instDmgMult(inst) { return (1 + 0.18 * (inst.level - 1)) * Math.pow(1.5, inst.stars); }
function instRateMult(inst) { return 1 + 0.06 * (inst.level - 1) + 0.05 * inst.stars; }

// Aggregate keystones across equipped powers.
function keystones() {
  const k = { dmg: 1, rate: 1, move: 1, killNova: 0, xp: 1, bSpeed: 1, crit: 0, magnet: 1, count: 0, pierce: 0 };
  for (const inst of G.equipped) {
    const ks = PowerPool[inst.id].keystone;
    if (!ks) continue;
    switch (ks.key) {
      case 'pierce_all': k.pierce += 1; break;
      case 'dmg_all': k.dmg *= 1.20; break;
      case 'rate_all': k.rate *= 1.15; break;
      case 'move': k.move *= 1.12; break;
      case 'kill_nova': k.killNova += 0.10; break;
      case 'xp_gain': k.xp *= 1.25; break;
      case 'bullet_speed': k.bSpeed *= 1.20; break;
      case 'crit_all': k.crit += 0.10; break;
      case 'magnet': k.magnet *= 2; break;
      case 'count_all': k.count += 1; break;
    }
  }
  return k;
}
let KS = null; // cached per-frame

// ---------------------------------------------------------------------------
// Entity pools
// ---------------------------------------------------------------------------
const CAP = { pB: 2200, eB: 900, enemies: 220, parts: 600, gems: 400, floats: 60 };

function poolPush(arr, cap, obj) {
  if (arr.length >= cap) arr.shift();
  arr.push(obj);
  return obj;
}

function spawnPB(o) {
  // player bullet defaults
  return poolPush(G.pB, CAP.pB, Object.assign({
    x: 0, y: 0, vx: 0, vy: 0, t: 0, life: 1.5, size: 5, dmg: 5, el: 0,
    pierce: 0, crit: 0, hit: null, kind: 0, delay: 0,
    dirX: 0, dirY: 0, amp: 0, homing: 0, split: false, volatile: false,
    orbit: null, phase: 0, ret: false, cd: 0, grow: 0, hitSet: null, src: null,
  }, o));
}
function spawnEB(o) {
  return poolPush(G.eB, CAP.eB, Object.assign({ x: 0, y: 0, vx: 0, vy: 0, t: 0, life: 6, size: 5, dmg: 10, color: '#ff5a8a' }, o));
}

function burst(x, y, color, n, speed) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, s = rand(speed * 0.3, speed);
    poolPush(G.parts, CAP.parts, { x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0, life: rand(0.3, 0.7), color, size: rand(1.5, 3.5) });
  }
}
function floatText(x, y, txt, color) {
  poolPush(G.floats, CAP.floats, { x, y, txt, color, t: 0, life: 1.1 });
}
function dmgNumber(x, y, dmg, crit) {
  if (G.floats.length > 40 && !crit && Math.random() < 0.5) return; // decongest
  poolPush(G.floats, CAP.floats, { x: x + rand(-8, 8), y, txt: String(Math.round(dmg)), color: crit ? '#ffd24a' : '#cfd8ff', t: 0, life: 0.55, small: true });
}

// ---------------------------------------------------------------------------
// Spatial hash for enemies (rebuilt each frame)
// ---------------------------------------------------------------------------
const CELL = 72;
const grid = new Map();
function gridKey(cx, cy) { return cx * 4096 + cy; }
function rebuildGrid() {
  grid.clear();
  for (const en of G.enemies) {
    const cx = (en.x / CELL) | 0, cy = (en.y / CELL) | 0;
    const key = gridKey(cx, cy);
    let cell = grid.get(key);
    if (!cell) { cell = []; grid.set(key, cell); }
    cell.push(en);
  }
}
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
const _near = [];

function nearestEnemy(x, y) {
  let best = null, bd = Infinity;
  for (const en of G.enemies) {
    const d = dist2(x, y, en.x, en.y);
    if (d < bd) { bd = d; best = en; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Firing — the 20 patterns
// ---------------------------------------------------------------------------
function aimDir() {
  const t = nearestEnemy(G.px, G.py);
  if (t) { const d = Math.hypot(t.x - G.px, t.y - G.py) || 1; return { x: (t.x - G.px) / d, y: (t.y - G.py) / d, t }; }
  return { x: G.faceX, y: G.faceY, t: null };
}

function fireEmitter(inst, ei) {
  const P = PowerPool[inst.id], e = P.emitters[ei], EL = ELEMENTS[e.el];
  const dmg = e.dmg * instDmgMult(inst) * KS.dmg;
  const speed = e.speed * KS.bSpeed;
  const count = Math.max(1, Math.round(e.count)) + KS.count;
  let pierce = e.pierce + KS.pierce + (EL.mech === 'pierce' ? EL.p : 0);
  let crit = e.crit + KS.crit + (EL.mech === 'crit' ? EL.p : 0);
  const A = aimDir();
  const base = {
    size: e.size, dmg, el: e.el, pierce, crit, life: e.life,
    split: e.split, volatile: e.volatile, src: inst,
  };
  const aimed = (n, spreadAngle, opts) => {
    const a0 = Math.atan2(A.y, A.x);
    for (let i = 0; i < n; i++) {
      const a = n === 1 ? a0 : a0 - spreadAngle / 2 + spreadAngle * (i / (n - 1));
      spawnPB(Object.assign({}, base, { x: G.px, y: G.py, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, dirX: Math.cos(a), dirY: Math.sin(a) }, opts));
    }
  };
  switch (PATTERNS[e.pat].key) {
    case 'fan': aimed(count, 0.62); break;
    case 'ring': {
      const off = Math.random() * TAU;
      for (let i = 0; i < count; i++) {
        const a = off + TAU * i / count;
        spawnPB(Object.assign({}, base, { x: G.px, y: G.py, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed }));
      }
      break;
    }
    case 'spiral': {
      inst.spiral += 0.42;
      for (let i = 0; i < count; i++) {
        const a = inst.spiral + TAU * i / count;
        spawnPB(Object.assign({}, base, { x: G.px, y: G.py, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed }));
      }
      break;
    }
    case 'wave': aimed(count, 0.5, { kind: 1, amp: 110 }); break;
    case 'seeker': aimed(count, 0.9, { homing: 4.2, life: e.life }); break;
    case 'orbitals': {
      // keep `count` orbitals alive per emitter
      let alive = 0;
      for (const b of G.pB) if (b.src === inst && b.orbit && b.orbit.ei === ei) alive++;
      for (let i = alive; i < count; i++) {
        spawnPB(Object.assign({}, base, {
          x: G.px, y: G.py, life: e.life, pierce: 9999,
          orbit: { ei, a: Math.random() * TAU, r: 24, tr: 64 + e.size * 3, av: e.speed },
        }));
      }
      break;
    }
    case 'nova': spawnPB(Object.assign({}, base, { x: G.px, y: G.py, kind: 2, grow: speed, size: e.size, pierce: 9999, hitSet: [] })); break;
    case 'lance': aimed(count, 0.3, { pierce: pierce + 3 }); break;
    case 'scatter': {
      const a0 = Math.atan2(A.y, A.x);
      for (let i = 0; i < count; i++) {
        const a = a0 + rand(-0.5, 0.5), s = speed * rand(0.75, 1.2);
        spawnPB(Object.assign({}, base, { x: G.px, y: G.py, vx: Math.cos(a) * s, vy: Math.sin(a) * s }));
      }
      break;
    }
    case 'flak': aimed(count, 0.4, { kind: 3 }); break;
    case 'boomerang': aimed(count, 0.5, { kind: 4, pierce: 9999 }); break;
    case 'cross': {
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2 + (count > 4 ? Math.PI / 4 : 0);
        spawnPB(Object.assign({}, base, { x: G.px, y: G.py, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed }));
      }
      break;
    }
    case 'starburst': {
      inst.spiral += 0.7;
      for (let i = 0; i < count; i++) {
        const a = inst.spiral + TAU * i / count;
        spawnPB(Object.assign({}, base, { x: G.px, y: G.py, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed }));
      }
      break;
    }
    case 'wall': {
      const a0 = Math.atan2(A.y, A.x), px = -Math.sin(a0), py = Math.cos(a0);
      for (let i = 0; i < count; i++) {
        const off = (i - (count - 1) / 2) * (e.size * 3.2);
        spawnPB(Object.assign({}, base, { x: G.px + px * off, y: G.py + py * off, vx: Math.cos(a0) * speed, vy: Math.sin(a0) * speed }));
      }
      break;
    }
    case 'meteor': {
      const t = A.t;
      const tx = t ? t.x + rand(-30, 30) : G.px + G.faceX * 160, ty = t ? t.y + rand(-30, 30) : G.py + G.faceY * 160;
      G.zones.push({ x: tx, y: ty, r: e.size, t: 0, tel: 0.55, dmg, el: e.el, color: EL.color, crit, src: inst });
      break;
    }
    case 'serpent': aimed(count, 0.4, { kind: 1, amp: 190, homing: 1.4 }); break;
    case 'burst': {
      const a0 = Math.atan2(A.y, A.x);
      for (let i = 0; i < count; i++) {
        spawnPB(Object.assign({}, base, { x: G.px, y: G.py, vx: Math.cos(a0) * speed, vy: Math.sin(a0) * speed, delay: i * 0.07 }));
      }
      break;
    }
    case 'mine': {
      for (let i = 0; i < count; i++) {
        spawnPB(Object.assign({}, base, {
          x: G.px + rand(-40, 40), y: G.py + rand(-40, 40), kind: 5, life: e.life, phase: 0.3,
        }));
      }
      break;
    }
    case 'beam': {
      const a0 = Math.atan2(A.y, A.x), range = 520, w = e.size + 3;
      const cos = Math.cos(a0), sin = Math.sin(a0);
      nearEnemies(G.px + cos * range / 2, G.py + sin * range / 2, range / 2 + 80, _near);
      for (const en of _near) {
        const rx = en.x - G.px, ry = en.y - G.py;
        const fwd = rx * cos + ry * sin;
        if (fwd < 0 || fwd > range) continue;
        const side = Math.abs(rx * -sin + ry * cos);
        if (side < w + en.r) hitEnemy(en, dmg, e.el, crit, cos, sin, inst);
      }
      G.beams.push({ x: G.px, y: G.py, a: a0, len: range, w, color: EL.color, t: 0, life: 0.14 });
      break;
    }
    case 'echoshot': {
      aimed(count, 0.3);
      aimed(count, 0.3, { delay: 0.22 });
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Damage & element mechanics
// ---------------------------------------------------------------------------
function hitEnemy(en, dmg, el, critCh, dx, dy, srcInst, noEcho) {
  const EL = ELEMENTS[el];
  const isCrit = Math.random() < critCh;
  let d = dmg * (isCrit ? 2.2 : 1);
  if (en.vulnT > 0) d *= 1 + en.vulnF;
  if (EL.mech === 'crit' && ELEMENTS[el].key === 'chaos') d *= 1 + Math.random() * (isCrit ? 0 : 0.6);
  en.hp -= d; G.dmgDealt += d;
  dmgNumber(en.x, en.y - en.r, d, isCrit);

  switch (EL.mech) {
    case 'dot': en.dotDps = Math.max(en.dotDps, dmg * EL.p); en.dotT = 2; en.dotEl = el; break;
    case 'slow': en.slowT = 1.5; en.slowF = Math.max(en.slowF, EL.p); break;
    case 'chain': {
      if (!noEcho) {
        nearEnemies(en.x, en.y, 170, _near);
        let best = null, bd = 170 * 170;
        for (const o of _near) { if (o === en || o.hp <= 0) continue; const q = dist2(en.x, en.y, o.x, o.y); if (q < bd) { bd = q; best = o; } }
        if (best) {
          hitEnemy(best, dmg * EL.p, el, 0, 0, 0, srcInst, true);
          G.beams.push({ x: en.x, y: en.y, a: Math.atan2(best.y - en.y, best.x - en.x), len: Math.sqrt(bd), w: 2, color: EL.color, t: 0, life: 0.1 });
        }
      }
      break;
    }
    case 'vuln': en.vulnT = 2; en.vulnF = Math.max(en.vulnF, EL.p); break;
    case 'knock': if (!en.boss) { en.kx += dx * EL.p; en.ky += dy * EL.p; } break;
    case 'stun': if (Math.random() < EL.p && !en.boss) en.stunT = 0.5; break;
    case 'leech': G.hp = Math.min(G.hpMax, G.hp + d * EL.p); break;
    case 'aoe': {
      if (!noEcho) {
        nearEnemies(en.x, en.y, EL.p, _near);
        for (const o of _near) if (o !== en && o.hp > 0 && dist2(en.x, en.y, o.x, o.y) < EL.p * EL.p) hitEnemy(o, dmg * 0.4, el, 0, 0, 0, srcInst, true);
        burst(en.x, en.y, EL.color, 4, 120);
      }
      break;
    }
    case 'echo': if (!noEcho && Math.random() < EL.p) hitEnemy(en, dmg * 0.6, el, 0, dx, dy, srcInst, true); break;
    case 'pull': {
      if (!en.boss) {
        nearEnemies(en.x, en.y, 110, _near);
        for (const o of _near) {
          if (o.boss) continue;
          const dd = Math.hypot(en.x - o.x, en.y - o.y) || 1;
          o.kx += (en.x - o.x) / dd * EL.p; o.ky += (en.y - o.y) / dd * EL.p;
        }
      }
      break;
    }
  }
  if (en.hp <= 0) killEnemy(en, srcInst);
  return d;
}

function blast(x, y, r, dmg, el, crit, srcInst) {
  nearEnemies(x, y, r, _near);
  for (const en of _near) {
    if (en.hp <= 0) continue;
    if (dist2(x, y, en.x, en.y) < (r + en.r) * (r + en.r)) {
      const dd = Math.hypot(en.x - x, en.y - y) || 1;
      hitEnemy(en, dmg, el, crit, (en.x - x) / dd, (en.y - y) / dd, srcInst, true);
    }
  }
  burst(x, y, ELEMENTS[el].color, 12, 200);
}

// ---------------------------------------------------------------------------
// Enemies & waves
// ---------------------------------------------------------------------------
const ETYPES = {
  chaser:   { hp: 16,  speed: 95,  r: 12, dmg: 12, color: '#ff5a6b', xp: 1 },
  shooter:  { hp: 22,  speed: 62,  r: 12, dmg: 10, color: '#ff9a4a', xp: 1 },
  spinner:  { hp: 30,  speed: 44,  r: 14, dmg: 12, color: '#d05cff', xp: 2 },
  tank:     { hp: 90,  speed: 30,  r: 20, dmg: 18, color: '#8a93b8', xp: 3 },
  darter:   { hp: 14,  speed: 70,  r: 10, dmg: 12, color: '#4ad8ff', xp: 1 },
  splitter: { hp: 26,  speed: 68,  r: 14, dmg: 12, color: '#9bd820', xp: 2 },
  boss:     { hp: 750, speed: 40,  r: 42, dmg: 26, color: '#ff2a8a', xp: 40 },
};
function waveScale() { return 1 + G.wave * 0.30 + G.wave * G.wave * 0.035; }

function spawnEnemy(type, x, y, hpMult) {
  const T = ETYPES[type], s = waveScale();
  const en = {
    type, x, y, r: T.r, hp: T.hp * s * (hpMult || 1), maxHp: T.hp * s * (hpMult || 1),
    speed: T.speed * (1 + G.wave * 0.008), dmg: T.dmg * (1 + G.wave * 0.05),
    color: T.color, xp: T.xp, t: rand(0, 9), shootT: rand(1, 2.4),
    kx: 0, ky: 0, slowT: 0, slowF: 0, dotDps: 0, dotT: 0, dotEl: 0,
    vulnT: 0, vulnF: 0, stunT: 0, boss: type === 'boss', dashT: 0, dvx: 0, dvy: 0,
    ang: Math.random() * TAU, dead: false,
  };
  if (en.boss) {
    en.name = pick(MYTH_BEINGS) + ' the Devourer';
    en.xp = 40 + G.wave;
    G.bossAlive = en;
    document.getElementById('bossName').textContent = '― ' + en.name + ' ―';
    document.getElementById('bossBar').classList.add('on');
    // a boss always spawns — make room if the horde is at cap
    if (G.enemies.length >= CAP.enemies) {
      const idx = G.enemies.findIndex(e => !e.boss);
      if (idx >= 0) G.enemies.splice(idx, 1);
    }
    G.enemies.push(en);
    return en;
  }
  if (G.enemies.length < CAP.enemies) G.enemies.push(en);
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
  const waveLen = 22;
  if (G.waveT >= waveLen) {
    G.waveT = 0; G.wave++;
    floatText(W / 2, H * 0.25, 'WAVE ' + G.wave + (G.wave % 10 === 0 ? ' — 警告 BOSS' : ''), G.wave % 10 === 0 ? '#ff2a8a' : '#8aa0ff');
    if (G.wave % 10 === 0) {
      const p = edgeSpawnPos();
      spawnEnemy('boss', p.x, p.y, 1 + G.wave / 18);
    }
  }
  G.spawnT -= dt;
  if (G.spawnT <= 0) {
    G.spawnT = clamp(1.5 - G.wave * 0.045, 0.3, 1.5) * (G.bossAlive ? 1.8 : 1);
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

function killEnemy(en, srcInst) {
  if (en.dead) return;   // guard: echo/chain/aoe can re-hit a dying enemy
  en.dead = true;
  en.hp = -1e9; // mark dead; removed in update sweep
  G.kills++;
  SFX.kill();
  burst(en.x, en.y, en.color, en.boss ? 60 : 8, en.boss ? 380 : 160);
  const gems = en.boss ? 30 : 1;
  for (let i = 0; i < gems; i++) {
    poolPush(G.gems, CAP.gems, {
      x: en.x + rand(-en.r, en.r), y: en.y + rand(-en.r, en.r),
      v: Math.max(1, Math.round(en.xp / gems)), t: 0,
    });
  }
  if (en.boss) {
    G.bossAlive = null;
    document.getElementById('bossBar').classList.remove('on');
    G.shake = Math.max(G.shake, 14);
    floatText(en.x, en.y, '討伐 — BOSS DOWN', '#ffd24a');
  }
  // splitter spawns children
  if (en.type === 'splitter' && !en.isChild) {
    for (let i = 0; i < 2; i++) {
      const c = spawnEnemy('chaser', en.x + rand(-12, 12), en.y + rand(-12, 12), 0.4);
      c.r = 8; c.isChild = true;
    }
  }
  // splitting variant shards + kill nova keystone
  if (srcInst) {
    const P = PowerPool[srcInst.id];
    if (KS.killNova > 0 && Math.random() < KS.killNova) blast(en.x, en.y, 70, 18 * waveScale(), P.emitters[0].el, 0, null);
  }
}

// ---------------------------------------------------------------------------
// Enemy behaviors
// ---------------------------------------------------------------------------
function updateEnemy(en, dt) {
  en.t += dt;
  // status effects
  if (en.dotT > 0) { en.dotT -= dt; en.hp -= en.dotDps * dt; G.dmgDealt += en.dotDps * dt; if (en.hp <= 0) { killEnemy(en, null); return; } }
  if (en.slowT > 0) en.slowT -= dt; else en.slowF = 0;
  if (en.vulnT > 0) en.vulnT -= dt; else en.vulnF = 0;
  if (en.stunT > 0) { en.stunT -= dt; en.kx *= 0.9; en.ky *= 0.9; return; }

  const sp = en.speed * (1 - (en.slowT > 0 ? en.slowF : 0));
  const dx = G.px - en.x, dy = G.py - en.y, d = Math.hypot(dx, dy) || 1;

  switch (en.type) {
    case 'chaser': case 'splitter':
      en.x += dx / d * sp * dt; en.y += dy / d * sp * dt; break;
    case 'shooter':
      if (d > 240) { en.x += dx / d * sp * dt; en.y += dy / d * sp * dt; }
      else if (d < 170) { en.x -= dx / d * sp * 0.7 * dt; en.y -= dy / d * sp * 0.7 * dt; }
      en.shootT -= dt;
      if (en.shootT <= 0 && d < 560) {
        en.shootT = clamp(2.2 - G.wave * 0.03, 0.9, 2.2);
        spawnEB({ x: en.x, y: en.y, vx: dx / d * 190, vy: dy / d * 190, dmg: en.dmg, size: 5, color: '#ff8a5a' });
      }
      break;
    case 'spinner':
      en.x += dx / d * sp * dt; en.y += dy / d * sp * dt;
      en.shootT -= dt;
      if (en.shootT <= 0) {
        en.shootT = clamp(2.6 - G.wave * 0.03, 1.2, 2.6);
        const n = 8, off = en.ang; en.ang += 0.5;
        for (let i = 0; i < n; i++) {
          const a = off + TAU * i / n;
          spawnEB({ x: en.x, y: en.y, vx: Math.cos(a) * 130, vy: Math.sin(a) * 130, dmg: en.dmg, size: 5, color: '#d08aff' });
        }
      }
      break;
    case 'tank':
      en.x += dx / d * sp * dt; en.y += dy / d * sp * dt;
      en.shootT -= dt;
      if (en.shootT <= 0 && d < 480) {
        en.shootT = 2.8;
        const a0 = Math.atan2(dy, dx);
        for (let i = -1; i <= 1; i++) {
          const a = a0 + i * 0.22;
          spawnEB({ x: en.x, y: en.y, vx: Math.cos(a) * 150, vy: Math.sin(a) * 150, dmg: en.dmg, size: 6, color: '#b8c8ff' });
        }
      }
      break;
    case 'darter':
      en.dashT -= dt;
      if (en.dashT <= 0) { en.dashT = rand(0.9, 1.6); en.dvx = dx / d * sp * 3.4; en.dvy = dy / d * sp * 3.4; }
      en.dvx *= 0.96; en.dvy *= 0.96;
      en.x += en.dvx * dt; en.y += en.dvy * dt;
      break;
    case 'boss': {
      if (d > 260) { en.x += dx / d * sp * dt; en.y += dy / d * sp * dt; }
      en.shootT -= dt;
      if (en.shootT <= 0) {
        const phase = ((en.t * 0.5) | 0) % 3;
        if (phase === 0) { // aimed fans
          en.shootT = 0.55;
          const a0 = Math.atan2(dy, dx);
          for (let i = -2; i <= 2; i++) {
            const a = a0 + i * 0.16;
            spawnEB({ x: en.x, y: en.y, vx: Math.cos(a) * 210, vy: Math.sin(a) * 210, dmg: en.dmg, size: 6, color: '#ff5aa0' });
          }
        } else if (phase === 1) { // rings
          en.shootT = 0.9;
          const n = 18, off = en.ang; en.ang += 0.35;
          for (let i = 0; i < n; i++) {
            const a = off + TAU * i / n;
            spawnEB({ x: en.x, y: en.y, vx: Math.cos(a) * 150, vy: Math.sin(a) * 150, dmg: en.dmg, size: 5, color: '#c85aff' });
          }
        } else { // spiral stream
          en.shootT = 0.08;
          en.ang += 0.32;
          for (let k = 0; k < 2; k++) {
            const a = en.ang + k * Math.PI;
            spawnEB({ x: en.x, y: en.y, vx: Math.cos(a) * 180, vy: Math.sin(a) * 180, dmg: en.dmg, size: 5, color: '#ff8ad8' });
          }
        }
      }
      break;
    }
  }
  // knockback decay
  en.x += en.kx * dt; en.y += en.ky * dt;
  en.kx *= Math.pow(0.02, dt); en.ky *= Math.pow(0.02, dt);
  // soft separation from other enemies is skipped for perf; enemies may overlap.
  en.x = clamp(en.x, -60, W + 60); en.y = clamp(en.y, -60, H + 60);

  // contact damage
  if (G.iT <= 0 && dist2(en.x, en.y, G.px, G.py) < (en.r + 9) * (en.r + 9)) hurtPlayer(en.dmg);
}

function hurtPlayer(dmg) {
  if (G.iT > 0) return;
  G.hp -= dmg; G.iT = 0.9; G.shake = Math.max(G.shake, 8);
  SFX.hurt();
  burst(G.px, G.py, '#ff3a6b', 14, 220);
  if (G.hp <= 0) {
    // Phoenix Soul aura — cheat death once per run
    const hasPhoenix = !G.phoenixUsed && G.equipped.some(i => { const a = PowerPool[i.id].aura; return a && a.key === 'phoenix'; });
    if (hasPhoenix) {
      G.phoenixUsed = true;
      G.hp = G.hpMax * 0.5; G.iT = 2.5;
      G.eB.length = 0;
      burst(G.px, G.py, '#ffb454', 80, 420);
      floatText(G.px, G.py - 40, '不死鳥 — PHOENIX SOUL', '#ffb454');
      return;
    }
    G.hp = 0;
    die();
  }
}

// ---------------------------------------------------------------------------
// Auras (Tier 5)
// ---------------------------------------------------------------------------
function updateAuras(dt) {
  G.auraT += dt;
  for (const inst of G.equipped) {
    const P = PowerPool[inst.id];
    if (!P.aura) continue;
    const power = 14 * instDmgMult(inst) * KS.dmg * waveScale() * 0.35;
    switch (P.aura.key) {
      case 'blades': {
        const R = 74, n = 3;
        for (let i = 0; i < n; i++) {
          const a = G.auraT * 3.2 + TAU * i / n;
          const bx = G.px + Math.cos(a) * R, by = G.py + Math.sin(a) * R;
          nearEnemies(bx, by, 20, _near);
          for (const en of _near) if (en.hp > 0 && dist2(bx, by, en.x, en.y) < (16 + en.r) * (16 + en.r)) hitEnemy(en, power * dt * 8, P.emitters[0].el, 0, 0, 0, inst, true);
        }
        break;
      }
      case 'halo': {
        nearEnemies(G.px, G.py, 105, _near);
        for (const en of _near) if (en.hp > 0 && dist2(G.px, G.py, en.x, en.y) < 105 * 105) hitEnemy(en, power * dt * 4, P.emitters[0].el, 0, 0, 0, inst, true);
        break;
      }
      case 'storm': {
        if ((G.auraT % 0.8) < dt) {
          nearEnemies(G.px, G.py, 280, _near);
          const t = _near.filter(e => e.hp > 0);
          if (t.length) {
            const en = pick(t);
            hitEnemy(en, power * 3, P.emitters[0].el, 0.2, 0, 0, inst, true);
            G.beams.push({ x: G.px, y: G.py, a: Math.atan2(en.y - G.py, en.x - G.px), len: Math.hypot(en.x - G.px, en.y - G.py), w: 2.5, color: '#ffe94a', t: 0, life: 0.12 });
          }
        }
        break;
      }
      case 'frost': {
        nearEnemies(G.px, G.py, 140, _near);
        for (const en of _near) if (dist2(G.px, G.py, en.x, en.y) < 140 * 140) { en.slowT = Math.max(en.slowT, 0.3); en.slowF = Math.max(en.slowF, 0.45); }
        break;
      }
      case 'gravity': {
        nearEnemies(G.px, G.py, 210, _near);
        for (const en of _near) {
          if (en.boss) continue;
          const d = Math.hypot(G.px - en.x, G.py - en.y) || 1;
          if (d < 210 && d > 60) { en.kx += (G.px - en.x) / d * 26 * dt * 60; en.ky += (G.py - en.y) / d * 26 * dt * 60; }
          if (d <= 210 && en.hp > 0) hitEnemy(en, power * dt * 1.5, P.emitters[0].el, 0, 0, 0, inst, true);
        }
        break;
      }
      // phoenix handled in hurtPlayer
    }
  }
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------
function update(dt) {
  G.time += dt;
  KS = keystones();

  // ---- player movement
  const up = keys.has('w') || keys.has('arrowup'), dn = keys.has('s') || keys.has('arrowdown');
  const lf = keys.has('a') || keys.has('arrowleft'), rt = keys.has('d') || keys.has('arrowright');
  G.focus = keys.has('shift');
  let mx = (rt ? 1 : 0) - (lf ? 1 : 0), my = (dn ? 1 : 0) - (up ? 1 : 0);
  if (mx || my) {
    const m = Math.hypot(mx, my);
    mx /= m; my /= m;
    G.faceX = mx; G.faceY = my;
    const spd = 265 * KS.move * (G.focus ? 0.45 : 1);
    G.px = clamp(G.px + mx * spd * dt, 14, W - 14);
    G.py = clamp(G.py + my * spd * dt, 14, H - 14);
  }
  if (G.iT > 0) G.iT -= dt;

  rebuildGrid();
  updateWave(dt);

  // ---- enemies
  for (const en of G.enemies) if (en.hp > 0) updateEnemy(en, dt);
  for (let i = G.enemies.length - 1; i >= 0; i--) if (G.enemies[i].hp <= 0) {
    const en = G.enemies[i];
    G.enemies[i] = G.enemies[G.enemies.length - 1]; G.enemies.pop();
    if (en === G.bossAlive) { G.bossAlive = null; document.getElementById('bossBar').classList.remove('on'); }
  }

  // ---- fire equipped powers
  for (const inst of G.equipped) {
    const P = PowerPool[inst.id];
    for (let ei = 0; ei < P.emitters.length; ei++) {
      inst.accs[ei] += dt * P.emitters[ei].rate * instRateMult(inst) * KS.rate;
      let guard = 0;
      while (inst.accs[ei] >= 1 && guard++ < 8) { inst.accs[ei] -= 1; fireEmitter(inst, ei); }
      if (inst.accs[ei] > 8) inst.accs[ei] = 8;
    }
  }
  updateAuras(dt);

  // ---- player bullets
  for (let i = G.pB.length - 1; i >= 0; i--) {
    const b = G.pB[i];
    if (b.delay > 0) { b.delay -= dt; continue; }
    b.t += dt;
    let dead = b.t >= b.life;

    if (b.orbit) { // orbital
      const o = b.orbit;
      o.r += (o.tr - o.r) * dt * 3;
      o.a += o.av * dt;
      b.x = G.px + Math.cos(o.a) * o.r; b.y = G.py + Math.sin(o.a) * o.r;
      if (b.cd > 0) b.cd -= dt;
    } else if (b.kind === 2) { // nova — expanding ring
      b.size += b.grow * dt;
    } else if (b.kind === 4) { // boomerang
      if (b.t > b.life * 0.42 && !b.ret) { b.ret = true; }
      if (b.ret) {
        const dx = G.px - b.x, dy = G.py - b.y, d = Math.hypot(dx, dy) || 1;
        const sp = Math.hypot(b.vx, b.vy) * 1.02 + 8;
        b.vx = dx / d * sp; b.vy = dy / d * sp;
        if (d < 16) dead = true;
      }
      b.x += b.vx * dt; b.y += b.vy * dt;
    } else if (b.kind === 5) { // mine
      if (b.phase > 0) b.phase -= dt;
      else {
        nearEnemies(b.x, b.y, 52, _near);
        for (const en of _near) if (en.hp > 0 && dist2(b.x, b.y, en.x, en.y) < (52 + en.r) * (52 + en.r)) {
          blast(b.x, b.y, 64, b.dmg, b.el, b.crit, b.src); dead = true; break;
        }
      }
    } else {
      if (b.homing > 0) {
        const t = nearestEnemy(b.x, b.y);
        if (t) {
          const want = Math.atan2(t.y - b.y, t.x - b.x), cur = Math.atan2(b.vy, b.vx);
          let da = want - cur;
          while (da > Math.PI) da -= TAU; while (da < -Math.PI) da += TAU;
          const turn = clamp(da, -b.homing * dt, b.homing * dt);
          const sp = Math.hypot(b.vx, b.vy);
          b.vx = Math.cos(cur + turn) * sp; b.vy = Math.sin(cur + turn) * sp;
        }
      }
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.kind === 1) { // wave / serpent wobble
        b.phase += dt * 9;
        const px = -b.dirY, py = b.dirX;
        const w = Math.cos(b.phase) * b.amp * dt;
        b.x += px * w; b.y += py * w;
      }
      if (b.kind === 3 && b.t > b.life * 0.6) { // flak detonation
        for (let k = 0; k < 6; k++) {
          const a = Math.random() * TAU;
          spawnPB({ x: b.x, y: b.y, vx: Math.cos(a) * 300, vy: Math.sin(a) * 300, dmg: b.dmg * 0.45, size: 3.5, el: b.el, life: 0.5, crit: b.crit, src: b.src });
        }
        dead = true;
      }
      if (b.x < -40 || b.x > W + 40 || b.y < -40 || b.y > H + 40) dead = true;
    }

    // collisions (mines handle their own proximity trigger above)
    if (!dead) {
      if (b.kind === 2) { // nova ring band
        nearEnemies(b.x, b.y, b.size + 40, _near);
        for (const en of _near) {
          if (en.hp <= 0 || b.hitSet.includes(en)) continue;
          const d = Math.hypot(en.x - b.x, en.y - b.y);
          if (Math.abs(d - b.size) < en.r + 12) {
            b.hitSet.push(en);
            const dd = d || 1;
            hitEnemy(en, b.dmg, b.el, b.crit, (en.x - b.x) / dd, (en.y - b.y) / dd, b.src);
          }
        }
      } else if (b.kind !== 5) {
        nearEnemies(b.x, b.y, b.size + 26, _near);
        for (const en of _near) {
          if (en.hp <= 0) continue;
          if (dist2(b.x, b.y, en.x, en.y) < (b.size + en.r) * (b.size + en.r)) {
            if (b.orbit) {
              if (b.cd > 0) continue;
              b.cd = 0.3;
              const dv = Math.hypot(en.x - G.px, en.y - G.py) || 1;
              hitEnemy(en, b.dmg, b.el, b.crit, (en.x - G.px) / dv, (en.y - G.py) / dv, b.src);
              continue;
            }
            if (b.hit && b.hit.includes(en)) continue;
            const sp = Math.hypot(b.vx, b.vy) || 1;
            const wasAlive = en.hp > 0;
            hitEnemy(en, b.dmg, b.el, b.crit, b.vx / sp, b.vy / sp, b.src);
            if (wasAlive && en.hp <= 0 && b.split) { // splitting variant shards
              for (let k = 0; k < 2; k++) {
                const a = Math.random() * TAU;
                spawnPB({ x: en.x, y: en.y, vx: Math.cos(a) * 280, vy: Math.sin(a) * 280, dmg: b.dmg * 0.4, size: 3.5, el: b.el, life: 0.6, src: b.src });
              }
            }
            if (b.pierce > 0) { b.pierce--; (b.hit || (b.hit = [])).push(en); }
            else { dead = true; break; }
          }
        }
      }
    }

    if (dead) {
      if (b.volatile && b.kind !== 3) blast(b.x, b.y, 36, b.dmg * 0.6, b.el, 0, b.src);
      G.pB[i] = G.pB[G.pB.length - 1]; G.pB.pop();
    }
  }

  // ---- zones (meteors)
  for (let i = G.zones.length - 1; i >= 0; i--) {
    const z = G.zones[i];
    z.t += dt;
    if (z.t >= z.tel) {
      blast(z.x, z.y, z.r, z.dmg, z.el, z.crit, z.src);
      G.shake = Math.max(G.shake, 3);
      G.zones.splice(i, 1);
    }
  }

  // ---- enemy bullets
  for (let i = G.eB.length - 1; i >= 0; i--) {
    const b = G.eB[i];
    b.t += dt; b.x += b.vx * dt; b.y += b.vy * dt;
    let dead = b.t >= b.life || b.x < -30 || b.x > W + 30 || b.y < -30 || b.y > H + 30;
    if (!dead && G.iT <= 0 && dist2(b.x, b.y, G.px, G.py) < (b.size + G.pr) * (b.size + G.pr)) {
      hurtPlayer(b.dmg); dead = true;
    }
    if (dead) { G.eB[i] = G.eB[G.eB.length - 1]; G.eB.pop(); }
  }

  // ---- gems
  const magR = 80 * KS.magnet;
  for (let i = G.gems.length - 1; i >= 0; i--) {
    const g = G.gems[i];
    g.t += dt;
    const d2 = dist2(g.x, g.y, G.px, G.py);
    if (d2 < magR * magR) {
      const d = Math.sqrt(d2) || 1;
      const sp = 460;
      g.x += (G.px - g.x) / d * sp * dt; g.y += (G.py - g.y) / d * sp * dt;
    }
    if (d2 < 18 * 18) {
      G.xp += g.v * KS.xp; SFX.gem();
      G.gems.splice(i, 1);
      while (G.xp >= G.xpNeed) { G.xp -= G.xpNeed; G.level++; G.xpNeed = xpNeed(G.level); G.pendingLevels++; }
    }
  }
  if (G.pendingLevels > 0 && state === ST.PLAY) openLevelUp();

  // ---- particles / floats / beams
  for (let i = G.parts.length - 1; i >= 0; i--) {
    const p = G.parts[i];
    p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.94; p.vy *= 0.94;
    if (p.t >= p.life) { G.parts[i] = G.parts[G.parts.length - 1]; G.parts.pop(); }
  }
  for (let i = G.floats.length - 1; i >= 0; i--) {
    const f = G.floats[i];
    f.t += dt; f.y -= 34 * dt;
    if (f.t >= f.life) G.floats.splice(i, 1);
  }
  for (let i = G.beams.length - 1; i >= 0; i--) {
    const bm = G.beams[i];
    bm.t += dt;
    if (bm.t >= bm.life) G.beams.splice(i, 1);
  }

  if (G.shake > 0) G.shake = Math.max(0, G.shake - dt * 30);
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
function render() {
  ctx.fillStyle = '#07080f';
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  if (G.shake > 0) ctx.translate(rand(-G.shake, G.shake) * 0.5, rand(-G.shake, G.shake) * 0.5);

  // grid backdrop
  ctx.strokeStyle = 'rgba(90, 110, 200, 0.07)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  const gs = 56, ox = (G.time * 8) % gs;
  for (let x = -ox; x < W; x += gs) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
  for (let y = -ox; y < H; y += gs) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
  ctx.stroke();

  // zones (meteor telegraphs)
  for (const z of G.zones) {
    const k = z.t / z.tel;
    ctx.strokeStyle = z.color; ctx.globalAlpha = 0.5;
    ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = z.color;
    ctx.beginPath(); ctx.arc(z.x, z.y, z.r * k, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  }

  // gems
  ctx.fillStyle = '#54d68a';
  for (const g of G.gems) {
    const s = 4 + Math.sin(g.t * 6) * 1;
    ctx.beginPath();
    ctx.moveTo(g.x, g.y - s); ctx.lineTo(g.x + s, g.y); ctx.lineTo(g.x, g.y + s); ctx.lineTo(g.x - s, g.y);
    ctx.fill();
  }

  // player bullets (sprites)
  for (const b of G.pB) {
    if (b.delay > 0) continue;
    const color = ELEMENTS[b.el].color;
    if (b.kind === 2) { // nova ring
      ctx.strokeStyle = color; ctx.lineWidth = 10; ctx.globalAlpha = clamp(1 - b.t / b.life, 0, 1) * 0.8;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.size, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1; ctx.lineWidth = 1;
      continue;
    }
    const s = bulletSprite(color, b.size);
    ctx.drawImage(s.c, b.x - s.R, b.y - s.R);
    if (b.kind === 5 && b.phase <= 0) { // armed mine blink
      ctx.strokeStyle = color; ctx.globalAlpha = 0.4 + 0.4 * Math.sin(b.t * 12);
      ctx.beginPath(); ctx.arc(b.x, b.y, b.size + 5, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  // beams
  for (const bm of G.beams) {
    const k = 1 - bm.t / bm.life;
    ctx.save();
    ctx.translate(bm.x, bm.y); ctx.rotate(bm.a);
    ctx.globalAlpha = k * 0.85;
    ctx.fillStyle = bm.color;
    ctx.fillRect(0, -bm.w * k, bm.len, bm.w * 2 * k);
    ctx.globalAlpha = k * 0.5;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, -bm.w * k * 0.35, bm.len, bm.w * 0.7 * k);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // enemies
  for (const en of G.enemies) {
    ctx.save();
    ctx.translate(en.x, en.y);
    ctx.rotate(en.t * (en.boss ? 0.6 : 1.4));
    ctx.strokeStyle = en.color;
    ctx.fillStyle = en.color + '33';
    ctx.lineWidth = en.boss ? 3 : 2;
    const sides = { chaser: 3, shooter: 4, spinner: 5, tank: 6, darter: 3, splitter: 8, boss: 7 }[en.type] || 4;
    ctx.beginPath();
    for (let i = 0; i < sides; i++) {
      const a = TAU * i / sides;
      const rr = en.r * (en.type === 'darter' ? (i === 0 ? 1.5 : 0.8) : 1);
      if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // status tint
    if (en.slowT > 0) { ctx.strokeStyle = '#6fd8ff'; ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.arc(0, 0, en.r + 3, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1; }
    if (en.dotT > 0) { ctx.fillStyle = ELEMENTS[en.dotEl].color; ctx.globalAlpha = 0.35 + 0.2 * Math.sin(en.t * 10); ctx.beginPath(); ctx.arc(0, 0, en.r * 0.5, 0, TAU); ctx.fill(); ctx.globalAlpha = 1; }
    ctx.restore();
    // hp bar for tough enemies
    if (en.maxHp > 60 && en.hp < en.maxHp && !en.boss) {
      ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(en.x - 16, en.y - en.r - 9, 32, 4);
      ctx.fillStyle = '#ff5a6b'; ctx.fillRect(en.x - 16, en.y - en.r - 9, 32 * clamp(en.hp / en.maxHp, 0, 1), 4);
    }
  }

  // enemy bullets
  for (const b of G.eB) {
    const s = bulletSprite(b.color, b.size);
    ctx.drawImage(s.c, b.x - s.R, b.y - s.R);
  }

  // auras visuals
  for (const inst of G.equipped) {
    const P = PowerPool[inst.id];
    if (!P.aura) continue;
    const col = ELEMENTS[P.emitters[0].el].color;
    ctx.globalAlpha = 0.16;
    if (P.aura.key === 'halo') { ctx.strokeStyle = col; ctx.lineWidth = 20; ctx.beginPath(); ctx.arc(G.px, G.py, 95, 0, TAU); ctx.stroke(); ctx.lineWidth = 1; }
    if (P.aura.key === 'frost') { ctx.fillStyle = '#6fd8ff'; ctx.beginPath(); ctx.arc(G.px, G.py, 140, 0, TAU); ctx.fill(); }
    if (P.aura.key === 'gravity') { ctx.strokeStyle = '#a88aff'; ctx.beginPath(); ctx.arc(G.px, G.py, 210 - (G.auraT * 60 % 150), 0, TAU); ctx.stroke(); }
    ctx.globalAlpha = 1;
    if (P.aura.key === 'blades') {
      ctx.fillStyle = col;
      for (let i = 0; i < 3; i++) {
        const a = G.auraT * 3.2 + TAU * i / 3;
        const bx = G.px + Math.cos(a) * 74, by = G.py + Math.sin(a) * 74;
        ctx.save(); ctx.translate(bx, by); ctx.rotate(a + Math.PI / 2);
        ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(5, 8); ctx.lineTo(-5, 8); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }
  }

  // player
  if (G.hp > 0) {
    const blink = G.iT > 0 && (G.time * 14 | 0) % 2 === 0;
    if (!blink) {
      ctx.save();
      ctx.translate(G.px, G.py);
      const ang = Math.atan2(G.faceY, G.faceX) + Math.PI / 2;
      ctx.rotate(ang);
      // scarf trail
      ctx.strokeStyle = '#ff3a6b'; ctx.lineWidth = 3; ctx.globalAlpha = 0.8;
      ctx.beginPath(); ctx.moveTo(0, 8); ctx.quadraticCurveTo(Math.sin(G.time * 9) * 6, 18, Math.sin(G.time * 7) * 10, 26); ctx.stroke();
      ctx.globalAlpha = 1;
      // body
      ctx.fillStyle = '#e8ecff'; ctx.strokeStyle = '#8aa0ff'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(8, 9); ctx.lineTo(0, 4); ctx.lineTo(-8, 9); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    if (G.focus) { // hitbox
      ctx.fillStyle = '#ff2a5a';
      ctx.beginPath(); ctx.arc(G.px, G.py, G.pr, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.7)';
      ctx.beginPath(); ctx.arc(G.px, G.py, G.pr + 2.5, 0, TAU); ctx.stroke();
    }
  }

  // particles
  for (const p of G.parts) {
    ctx.globalAlpha = clamp(1 - p.t / p.life, 0, 1);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;

  // floating text
  ctx.textAlign = 'center';
  for (const f of G.floats) {
    ctx.globalAlpha = clamp(1 - f.t / f.life, 0, 1);
    ctx.font = f.small ? '11px Segoe UI, sans-serif' : 'bold 15px Segoe UI, sans-serif';
    ctx.fillStyle = f.color;
    ctx.fillText(f.txt, f.x, f.y);
  }
  ctx.globalAlpha = 1;

  ctx.restore();

  // vignette
  const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.38, W / 2, H / 2, Math.max(W, H) * 0.72);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,10,0.55)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
}

// ---------------------------------------------------------------------------
// HUD / UI
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
function updateHUD() {
  $('hpBar').firstElementChild.style.width = clamp(G.hp / G.hpMax * 100, 0, 100) + '%';
  $('xpBar').firstElementChild.style.width = clamp(G.xp / G.xpNeed * 100, 0, 100) + '%';
  $('lvNum').textContent = G.level;
  $('waveNum').textContent = G.wave;
  $('killNum').textContent = fmt(G.kills);
  $('codexNum').textContent = fmt(codex.size);
  if (G.bossAlive) $('bossBar').querySelector('i').style.width = clamp(G.bossAlive.hp / G.bossAlive.maxHp * 100, 0, 100) + '%';
}

function refreshChips() {
  const el = $('powerChips');
  el.innerHTML = '';
  for (const inst of G.equipped || []) {
    const P = PowerPool[inst.id], T = TIERS[P.tier];
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.style.borderColor = T.color; chip.style.color = T.color;
    chip.textContent = `${'★'.repeat(Math.min(inst.stars, 5))}${inst.stars > 5 ? '×' + inst.stars : ''} ${P.name} Lv${inst.level}`;
    el.appendChild(chip);
  }
  if (G.bench && G.bench.length) {
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.style.borderColor = '#8a93b8'; chip.style.color = '#8a93b8';
    chip.textContent = `+${G.bench.length} benched — press E to merge`;
    el.appendChild(chip);
  }
}

// ---- Level-up overlay -------------------------------------------------------
function drawChoices() {
  // three uniform draws from the full pool of 10,000 — rarity emerges from
  // the pool's composition (5000/2500/1250/625/625)
  const ids = new Set();
  while (ids.size < 3) ids.add((Math.random() * POOL_TOTAL) | 0);
  return [...ids];
}

function openLevelUp() {
  state = ST.LEVELUP;
  G.pendingLevels--;
  SFX.level();
  const wrap = $('cards');
  wrap.innerHTML = '';
  $('oddsLine').textContent = 'Pool odds — Base 50% · Fused 25% · Ascended 12.5% · Transcendent 6.25% · Mythic 6.25%';
  for (const id of drawChoices()) {
    const P = PowerPool[id], T = TIERS[P.tier];
    const card = document.createElement('div');
    card.className = 'card t' + P.tier;
    const owned = (G.equipped.find(i => i.id === id) || G.bench.find(i => i.id === id));
    card.innerHTML = `
      <span class="tierTag t${P.tier}">${T.jp} ${T.name}${P.tier > 1 ? ' · merged' : ''}</span>
      <span class="num">No.${id + 1}</span>
      <h3>${P.name}</h3>
      <div class="desc">${describePower(P).join('<br>')}</div>
      ${owned ? `<div class="dupe">Owned — picks as Lv${owned.level + 1}</div>` : ''}`;
    card.addEventListener('click', () => {
      grantPower(id);
      G.hp = Math.min(G.hpMax, G.hp + G.hpMax * 0.2);
      closeOverlays();
      if (G.pendingLevels > 0) openLevelUp();
      else state = ST.PLAY;
    });
    wrap.appendChild(card);
  }
  $('ovLevel').classList.add('on');
}

// ---- Merge lab ---------------------------------------------------------------
let mergeSel = [];
function openMerge() {
  state = ST.MERGE;
  mergeSel = [];
  renderMergeGrid();
  $('ovMerge').classList.add('on');
}
function renderMergeGrid() {
  const grid = $('mergeGrid');
  grid.innerHTML = '';
  const all = [...G.equipped.map(i => ({ i, eq: true })), ...G.bench.map(i => ({ i, eq: false }))];
  for (const { i: inst, eq } of all) {
    const P = PowerPool[inst.id], T = TIERS[P.tier];
    const el = document.createElement('div');
    el.className = 'invItem' + (mergeSel.includes(inst) ? ' sel' : '');
    el.style.borderColor = T.color; el.style.color = T.color;
    el.innerHTML = `${'★'.repeat(Math.min(inst.stars, 5))} ${P.name}
      <small>${T.name} · Lv${inst.level}${eq ? ' · equipped' : ' · bench'}</small>`;
    el.addEventListener('click', () => {
      if (mergeSel.includes(inst)) mergeSel = mergeSel.filter(x => x !== inst);
      else { mergeSel.push(inst); if (mergeSel.length > 2) mergeSel.shift(); }
      renderMergeGrid();
    });
    grid.appendChild(el);
  }
  // preview
  const pv = $('mergePreview'), btn = $('btnMerge');
  if (mergeSel.length === 2) {
    const [a, b] = mergeSel;
    const resId = mergeResultId(a.id, b.id);
    const P = PowerPool[resId], T = TIERS[P.tier];
    const known = codex.has(resId);
    const overch = isOvercharge(a.id, b.id);
    pv.innerHTML = `<span style="color:${TIERS[PowerPool[a.id].tier].color}">${PowerPool[a.id].name}</span>
      <span class="arrow">+</span>
      <span style="color:${TIERS[PowerPool[b.id].tier].color}">${PowerPool[b.id].name}</span>
      <span class="arrow">→</span>
      <span style="color:${T.color}">${overch ? '★ ' : ''}${known ? P.name : '??? '} <small>(${T.name} No.${resId + 1})</small></span>`;
    btn.disabled = false;
  } else {
    pv.innerHTML = `<span style="color:var(--dim)">Select ${2 - mergeSel.length} more power${mergeSel.length === 1 ? '' : 's'}…</span>`;
    btn.disabled = true;
  }
}
$('btnMerge').addEventListener('click', () => {
  if (mergeSel.length !== 2) return;
  forgeMerge(mergeSel[0], mergeSel[1]);
  mergeSel = [];
  renderMergeGrid();
});
$('btnMergeClose').addEventListener('click', () => { closeOverlays(); state = ST.PLAY; });

// ---- Death -------------------------------------------------------------------
function die() {
  state = ST.DEAD;
  bestWave = Math.max(bestWave, G.wave);
  saveCodex();
  const tiersOwned = [...G.equipped, ...G.bench].map(i => PowerPool[i.id].tier);
  $('deadStats').innerHTML = `
    Survived to <b>Wave ${G.wave}</b> (best: ${Math.max(bestWave, G.wave)}) · <b>${fmt(G.kills)}</b> kills<br>
    Level <b>${G.level}</b> · <b>${G.forges}</b> powers forged · highest tier
    <b>${tiersOwned.length ? TIERS[Math.max(...tiersOwned)].name : '—'}</b><br>
    Damage dealt <b>${fmt(Math.round(G.dmgDealt))}</b> ·
    Codex <b>${fmt(codex.size)}</b> / 10,000 powers discovered`;
  $('ovDead').classList.add('on');
}

// ---- Overlay helpers -----------------------------------------------------------
function closeOverlays() {
  for (const id of ['ovTitle', 'ovLevel', 'ovMerge', 'ovPause', 'ovDead']) $(id).classList.remove('on');
}

function handleKey(k, e) {
  if (state === ST.PLAY) {
    if (k === 'e' || k === 'tab') openMerge();
    else if (k === 'p' || k === 'escape') {
      state = ST.PAUSE;
      $('pauseStats').innerHTML = `Wave ${G.wave} · Level ${G.level} · ${fmt(G.kills)} kills ·
        Codex ${fmt(codex.size)}/10,000<br>Equipped ${G.equipped.length}/6 · Bench ${G.bench.length}`;
      $('ovPause').classList.add('on');
    }
    else if (k === 'm') SFX.toggle();
  } else if (state === ST.MERGE && (k === 'e' || k === 'tab' || k === 'escape')) {
    closeOverlays(); state = ST.PLAY;
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
// Main loop — fixed timestep
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

// ambient title background
const titleStars = Array.from({ length: 90 }, () => ({ x: Math.random(), y: Math.random(), s: rand(0.4, 2), v: rand(6, 40) }));
function renderTitleBG(dt) {
  ctx.fillStyle = '#07080f'; ctx.fillRect(0, 0, W, H);
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
  POOL_STATS, PowerPool, TIERS, mergeResultId, tierOf, isOvercharge,
  get state() { return state; },
  get G() { return G; },
  codex,
  start: startGame,
  grant: (id) => grantPower(id),
  forceLevelUp: () => { G.pendingLevels++; },
  forge: (a, b) => forgeMerge(a, b),
  openMerge, describePower,
};
