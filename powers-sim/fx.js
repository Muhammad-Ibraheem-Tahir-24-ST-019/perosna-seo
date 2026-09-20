/* =========================================================================
   fx.js - rendering: particles, repulsor, mandala, portal, helmet, gamma.
   Pure canvas 2D. Nothing here knows about the camera or gestures; it just
   draws given a position, a size and an intensity.
   ========================================================================= */

export const TAU = Math.PI * 2;
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const rand = (a, b) => a + Math.random() * (b - a);
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export function norm(x, y) { const m = Math.hypot(x, y) || 1; return { x: x / m, y: y / m }; }
const easeOutBack = (t) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

/* face-mesh indices we rely on */
export const FACE_OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379,
  378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127,
  162, 21, 54, 103, 67, 109,
];
export const F = {
  TOP: 10, CHIN: 152, L_EDGE: 234, R_EDGE: 454, BRIDGE: 168, NOSE: 1,
  L_EYE: 159, R_EYE: 386, L_EYE_IN: 133, R_EYE_IN: 362, MOUTH_T: 13, MOUTH_B: 14,
};

/* ---------------------------------------------------------------- frames -- */

/** Build a face-local coordinate frame: u = -1..1 ear to ear,
 *  v = -1..1 chin to forehead. Carries head roll for free. */
export function faceFrame(L) {
  const top = L[F.TOP], chin = L[F.CHIN], le = L[F.L_EDGE], re = L[F.R_EDGE];
  const cx = (top.x + chin.x) / 2, cy = (top.y + chin.y) / 2;
  const up = norm(top.x - chin.x, top.y - chin.y);
  const rv = norm(re.x - le.x, re.y - le.y);
  const h = Math.hypot(top.x - chin.x, top.y - chin.y);
  const w = Math.hypot(re.x - le.x, re.y - le.y);
  return {
    cx, cy, up, rv, h, w,
    // half-axis vectors, ready to feed straight into ctx.transform
    ax: rv.x * w / 2, ay: rv.y * w / 2,
    bx: up.x * h / 2, by: up.y * h / 2,
    to(u, v) {
      return { x: cx + rv.x * (u * w / 2) + up.x * (v * h / 2),
               y: cy + rv.y * (u * w / 2) + up.y * (v * h / 2) };
    },
  };
}

/** Enter face-local space: after this, draw in (u, v) units. */
function inFace(ctx, fr) {
  ctx.save();
  ctx.transform(fr.ax, fr.ay, fr.bx, fr.by, fr.cx, fr.cy);
}

function ovalPath(ctx, L, scale, cx, cy) {
  ctx.beginPath();
  for (let i = 0; i < FACE_OVAL.length; i++) {
    const p = L[FACE_OVAL[i]];
    const x = cx + (p.x - cx) * scale, y = cy + (p.y - cy) * scale;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/* ------------------------------------------------------------ particles --- */

class Particle {
  constructor(o) {
    this.x = o.x; this.y = o.y; this.vx = o.vx; this.vy = o.vy;
    this.life = o.life; this.max = o.life;
    this.size = o.size; this.col = o.col;
    this.drag = o.drag ?? 1.6; this.grav = o.grav ?? 0;
    this.add = o.add !== false; this.spin = o.spin ?? 0;
    this.toward = o.toward || null; this.pull = o.pull ?? 0;
  }
  update(dt) {
    if (this.toward && this.pull) {
      const dx = this.toward.x - this.x, dy = this.toward.y - this.y;
      const d = Math.hypot(dx, dy) || 1;
      this.vx += (dx / d) * this.pull * dt;
      this.vy += (dy / d) * this.pull * dt;
    }
    const k = Math.exp(-this.drag * dt);
    this.vx *= k; this.vy *= k;
    this.vy += this.grav * dt;
    this.x += this.vx * dt; this.y += this.vy * dt;
    this.life -= dt;
    return this.life > 0;
  }
  draw(ctx) {
    const t = clamp(this.life / this.max, 0, 1);
    ctx.globalAlpha = t * t;
    ctx.fillStyle = this.col;
    const s = this.size * (0.35 + t * 0.65);
    ctx.beginPath(); ctx.arc(this.x, this.y, s, 0, TAU); ctx.fill();
  }
}

/** Expanding ring shockwave. */
class Shock {
  constructor(x, y, r, col, life, width) {
    this.x = x; this.y = y; this.r0 = r * 0.15; this.r = r;
    this.col = col; this.life = life; this.max = life;
    this.width = width || 6;
  }
  update(dt) { this.life -= dt; return this.life > 0; }
  draw(ctx) {
    const t = 1 - this.life / this.max;
    const e = easeOutCubic(t);
    ctx.globalAlpha = (1 - t) * (1 - t);
    ctx.strokeStyle = this.col;
    ctx.lineWidth = this.width * (1 - t) + 0.6;
    ctx.beginPath();
    ctx.arc(this.x, this.y, lerp(this.r0, this.r, e), 0, TAU);
    ctx.stroke();
  }
}

/** The repulsor bolt itself: a lance that extends, then fades. */
class Beam {
  constructor(x, y, dx, dy, power, len) {
    this.x = x; this.y = y; this.dx = dx; this.dy = dy;
    this.power = power; this.len = len;
    this.life = 0.34; this.max = 0.34;
  }
  update(dt) { this.life -= dt; return this.life > 0; }
  draw(ctx) {
    const t = 1 - this.life / this.max;
    const reach = this.len * easeOutCubic(clamp(t * 2.4, 0, 1));
    const fade = Math.pow(1 - t, 1.5);
    const ex = this.x + this.dx * reach, ey = this.y + this.dy * reach;
    const w = (10 + 34 * this.power) * fade;

    const g = ctx.createLinearGradient(this.x, this.y, ex, ey);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.18, 'rgba(150,240,255,0.85)');
    g.addColorStop(0.65, 'rgba(60,180,255,0.45)');
    g.addColorStop(1, 'rgba(40,140,255,0)');

    ctx.globalAlpha = 1;
    ctx.lineCap = 'round';
    ctx.strokeStyle = g; ctx.lineWidth = w * 2.4;
    ctx.beginPath(); ctx.moveTo(this.x, this.y); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.strokeStyle = g; ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(this.x, this.y); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,' + (0.9 * fade) + ')';
    ctx.lineWidth = w * 0.3;
    ctx.beginPath(); ctx.moveTo(this.x, this.y); ctx.lineTo(ex, ey); ctx.stroke();

    // muzzle bloom
    const mb = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, w * 3);
    mb.addColorStop(0, 'rgba(255,255,255,' + fade + ')');
    mb.addColorStop(0.35, 'rgba(120,225,255,' + 0.6 * fade + ')');
    mb.addColorStop(1, 'rgba(60,170,255,0)');
    ctx.fillStyle = mb;
    ctx.beginPath(); ctx.arc(this.x, this.y, w * 3, 0, TAU); ctx.fill();
  }
}

export class FX {
  constructor() {
    this.parts = []; this.shocks = []; this.beams = [];
    this.shake = 0; this.flash = 0; this.flashCol = [255, 255, 255];
    this.cap = 900;
  }
  reset() { this.parts.length = 0; this.shocks.length = 0; this.beams.length = 0;
            this.shake = 0; this.flash = 0; }
  addShake(a) { this.shake = Math.min(46, this.shake + a); }
  addFlash(a, col) { this.flash = Math.min(1, this.flash + a); if (col) this.flashCol = col; }

  spark(o) { if (this.parts.length < this.cap) this.parts.push(new Particle(o)); }
  shock(x, y, r, col, life, w) { this.shocks.push(new Shock(x, y, r, col, life || 0.5, w)); }

  /** n sparks thrown outward from a point. */
  burst(x, y, n, col, opts) {
    opts = opts || {};
    const sp = opts.speed || 420, spread = opts.spread ?? TAU, base = opts.angle ?? 0;
    for (let i = 0; i < n; i++) {
      const a = base + rand(-spread / 2, spread / 2);
      const v = rand(sp * 0.25, sp);
      this.spark({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        life: rand(0.25, opts.life || 0.8), size: rand(1, opts.size || 3.4),
        col, grav: opts.grav ?? 0, drag: opts.drag ?? 2.2 });
    }
  }

  /** Motes spiralling inward while a repulsor charges. */
  inhale(x, y, r, col) {
    const a = rand(0, TAU), d = r * rand(1.6, 3.2);
    const px = x + Math.cos(a) * d, py = y + Math.sin(a) * d;
    this.spark({ x: px, y: py, vx: -Math.sin(a) * 70, vy: Math.cos(a) * 70,
      life: 0.55, size: rand(1, 2.4), col, drag: 0.2,
      toward: { x, y }, pull: 1500 });
  }

  fire(x, y, dx, dy, power, len) {
    this.beams.push(new Beam(x, y, dx, dy, power, len));
    this.shock(x, y, 70 + 260 * power, 'rgba(160,235,255,0.9)', 0.55, 9);
    this.shock(x, y, 40 + 150 * power, 'rgba(255,255,255,0.9)', 0.35, 5);
    const a = Math.atan2(dy, dx);
    this.burst(x, y, 34, 'rgba(190,245,255,1)',
      { speed: 900 * power, spread: 1.1, angle: a, life: 0.5, drag: 2.6 });
    this.burst(x, y, 16, 'rgba(255,255,255,1)', { speed: 300, life: 0.35 });
    this.addShake(9 + 16 * power);
    this.addFlash(0.18 + 0.3 * power, [180, 235, 255]);
  }

  update(dt) {
    for (let i = this.parts.length - 1; i >= 0; i--)
      if (!this.parts[i].update(dt)) this.parts.splice(i, 1);
    for (let i = this.shocks.length - 1; i >= 0; i--)
      if (!this.shocks[i].update(dt)) this.shocks.splice(i, 1);
    for (let i = this.beams.length - 1; i >= 0; i--)
      if (!this.beams[i].update(dt)) this.beams.splice(i, 1);
    this.shake *= Math.exp(-7 * dt);
    this.flash *= Math.exp(-9 * dt);
  }

  draw(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const b of this.beams) b.draw(ctx);
    for (const s of this.shocks) s.draw(ctx);
    for (const p of this.parts) p.draw(ctx);
    ctx.restore();
  }

  drawFlash(ctx, W, H) {
    if (this.flash <= 0.004) return;
    const c = this.flashCol;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${this.flash * 0.6})`;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
}

/* ------------------------------------------------------------- repulsor --- */

export function drawRepulsor(ctx, x, y, r, charge, t) {
  if (charge <= 0.005) return;
  const c = clamp(charge, 0, 1);
  const R = r * (0.35 + c * 0.75);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  const g = ctx.createRadialGradient(x, y, 0, x, y, R * 2.1);
  g.addColorStop(0, `rgba(255,255,255,${0.92 * c})`);
  g.addColorStop(0.22, `rgba(165,240,255,${0.8 * c})`);
  g.addColorStop(0.55, `rgba(60,170,255,${0.32 * c})`);
  g.addColorStop(1, 'rgba(30,120,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, R * 2.1, 0, TAU); ctx.fill();

  // containment ring: three arcs counter-rotating as it spins up
  ctx.lineWidth = Math.max(1.5, R * 0.09);
  ctx.strokeStyle = `rgba(200,248,255,${0.75 * c})`;
  for (let k = 0; k < 3; k++) {
    const a0 = t * (1.8 + k * 0.9) * (k % 2 ? -1 : 1) + (k * TAU) / 3;
    ctx.beginPath();
    ctx.arc(x, y, R * (1.05 + k * 0.26), a0, a0 + 1.5);
    ctx.stroke();
  }
  // triangular iris at full charge
  if (c > 0.55) {
    const a = (c - 0.55) / 0.45;
    ctx.globalAlpha = a;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = Math.max(1, R * 0.07);
    ctx.beginPath();
    for (let k = 0; k < 3; k++) {
      const ang = -t * 2.6 + (k * TAU) / 3;
      const px = x + Math.cos(ang) * R * 0.62, py = y + Math.sin(ang) * R * 0.62;
      if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath(); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

/* -------------------------------------------------------------- mandala --- */

export function drawMandala(ctx, x, y, r, t, alpha, tilt) {
  if (alpha <= 0.01) return;
  const A = clamp(alpha, 0, 1);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.translate(x, y);
  ctx.rotate(tilt || 0);
  ctx.scale(1, 0.62); // seen at an angle, like a shield held up
  ctx.globalAlpha = A;

  const HOT = 'rgba(255,214,140,';
  const EMBER = 'rgba(255,140,26,';

  const ring = (rad, segs, gap, speed, lw) => {
    ctx.lineWidth = lw;
    const step = TAU / segs;
    for (let i = 0; i < segs; i++) {
      const a0 = i * step + t * speed;
      ctx.strokeStyle = HOT + (0.85 * A) + ')';
      ctx.beginPath(); ctx.arc(0, 0, rad, a0, a0 + step * (1 - gap)); ctx.stroke();
      ctx.strokeStyle = EMBER + (0.5 * A) + ')';
      ctx.lineWidth = lw * 2.6;
      ctx.beginPath(); ctx.arc(0, 0, rad, a0, a0 + step * (1 - gap)); ctx.stroke();
      ctx.lineWidth = lw;
    }
  };

  const lw = Math.max(1.4, r * 0.016);
  ring(r, 14, 0.42, 0.55, lw * 1.5);
  ring(r * 0.82, 24, 0.55, -0.85, lw);
  ring(r * 0.55, 9, 0.35, 1.25, lw * 1.2);
  ring(r * 0.3, 6, 0.3, -1.9, lw);

  // radial runes between the outer rings
  ctx.strokeStyle = HOT + (0.7 * A) + ')';
  ctx.lineWidth = lw;
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * TAU + t * 0.28;
    const r0 = r * 0.86, r1 = r * (i % 4 === 0 ? 0.99 : 0.93);
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
    ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
    ctx.stroke();
  }

  // inner sigil: two counter-rotating triangles
  ctx.lineWidth = lw * 1.1;
  ctx.strokeStyle = HOT + (0.8 * A) + ')';
  for (let s = 0; s < 2; s++) {
    ctx.beginPath();
    for (let k = 0; k < 3; k++) {
      const a = t * (s ? -0.9 : 0.9) + (k * TAU) / 3 + (s ? Math.PI / 3 : 0);
      const px = Math.cos(a) * r * 0.42, py = Math.sin(a) * r * 0.42;
      if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath(); ctx.stroke();
  }

  // warm haze behind the whole disc
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 1.12);
  g.addColorStop(0, `rgba(255,170,60,${0.1 * A})`);
  g.addColorStop(0.75, `rgba(255,140,30,${0.14 * A})`);
  g.addColorStop(1, 'rgba(255,120,20,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, r * 1.12, 0, TAU); ctx.fill();
  ctx.restore();
}

/* --------------------------------------------------------------- portal --- */

export function drawPortal(ctx, x, y, r, t, alpha) {
  if (alpha <= 0.01) return;
  const A = clamp(alpha, 0, 1);
  ctx.save();
  ctx.translate(x, y);

  // the hole: darkened interior so it reads as depth, not a sticker
  ctx.globalCompositeOperation = 'source-over';
  const hole = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
  hole.addColorStop(0, `rgba(6,4,12,${0.92 * A})`);
  hole.addColorStop(0.72, `rgba(20,8,10,${0.8 * A})`);
  hole.addColorStop(1, `rgba(40,12,6,${0.15 * A})`);
  ctx.fillStyle = hole;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();

  ctx.globalCompositeOperation = 'lighter';
  // swirling interior streaks
  ctx.lineWidth = Math.max(1, r * 0.012);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU + t * 0.6;
    const rr = r * (0.2 + ((i * 37) % 70) / 100);
    ctx.strokeStyle = `rgba(255,${120 + (i % 5) * 20},40,${0.18 * A})`;
    ctx.beginPath();
    ctx.arc(0, 0, rr, a, a + 0.9);
    ctx.stroke();
  }

  // the burning rim
  const rim = ctx.createRadialGradient(0, 0, r * 0.82, 0, 0, r * 1.22);
  rim.addColorStop(0, 'rgba(255,90,10,0)');
  rim.addColorStop(0.45, `rgba(255,150,40,${0.85 * A})`);
  rim.addColorStop(0.62, `rgba(255,232,180,${0.9 * A})`);
  rim.addColorStop(1, 'rgba(255,80,0,0)');
  ctx.fillStyle = rim;
  ctx.beginPath(); ctx.arc(0, 0, r * 1.22, 0, TAU); ctx.fill();

  // crackling edge detail
  ctx.strokeStyle = `rgba(255,236,190,${0.8 * A})`;
  ctx.lineWidth = Math.max(1, r * 0.02);
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * TAU + t * 1.4;
    const j = 0.94 + Math.sin(t * 9 + i * 2.3) * 0.06;
    ctx.beginPath();
    ctx.arc(0, 0, r * j, a, a + 0.08);
    ctx.stroke();
  }
  ctx.restore();
}

/* --------------------------------------------------------------- helmet --- */

/** p: 0 = fully retracted, 1 = fully assembled. glow: eye intensity 0..1+. */
export function drawHelmet(ctx, fr, p, glow, t) {
  if (p <= 0.004) return;
  const e = clamp(p, 0, 1);
  const slide = 1 - easeOutBack(clamp(e, 0, 1));   // plates fly in from outside
  const A = clamp(e * 1.4, 0, 1);

  inFace(ctx, fr);
  ctx.globalAlpha = A;
  ctx.lineJoin = 'round';

  /* --- red outer shell, drops in from above ------------------------------ */
  ctx.save();
  ctx.translate(0, slide * 1.5);
  const shell = ctx.createLinearGradient(-1, 1.4, 1, -1.3);
  shell.addColorStop(0, '#7e0d10');
  shell.addColorStop(0.35, '#c4161c');
  shell.addColorStop(0.6, '#8c1013');
  shell.addColorStop(1, '#4d0709');
  ctx.fillStyle = shell;
  ctx.beginPath();
  ctx.moveTo(-1.24, 0.35);
  ctx.bezierCurveTo(-1.32, 1.08, -0.72, 1.46, 0, 1.46);
  ctx.bezierCurveTo(0.72, 1.46, 1.32, 1.08, 1.24, 0.35);
  ctx.lineTo(1.12, -0.2);
  ctx.bezierCurveTo(1.07, -0.88, 0.56, -1.34, 0, -1.34);
  ctx.bezierCurveTo(-0.56, -1.34, -1.07, -0.88, -1.12, -0.2);
  ctx.closePath();
  ctx.fill();
  // crown highlight
  ctx.strokeStyle = 'rgba(255,190,190,0.35)';
  ctx.lineWidth = 0.022;
  ctx.beginPath();
  ctx.moveTo(-0.95, 0.75);
  ctx.bezierCurveTo(-0.6, 1.24, 0.6, 1.24, 0.95, 0.75);
  ctx.stroke();
  ctx.restore();

  /* --- gold faceplate, swings up from the chin --------------------------- */
  ctx.save();
  ctx.translate(0, slide * -1.2);
  const gold = ctx.createLinearGradient(-0.9, 1.1, 0.9, -1.1);
  gold.addColorStop(0, '#6d4a06');
  gold.addColorStop(0.2, '#d9a520');
  gold.addColorStop(0.42, '#ffe9a3');
  gold.addColorStop(0.58, '#e8b52c');
  gold.addColorStop(0.85, '#8a5f0b');
  gold.addColorStop(1, '#5b3d05');
  ctx.fillStyle = gold;
  ctx.beginPath();
  ctx.moveTo(-0.97, 0.3);
  ctx.bezierCurveTo(-1.03, 0.96, -0.62, 1.2, 0, 1.2);
  ctx.bezierCurveTo(0.62, 1.2, 1.03, 0.96, 0.97, 0.3);
  ctx.lineTo(0.87, -0.18);
  ctx.bezierCurveTo(0.83, -0.8, 0.46, -1.16, 0, -1.16);
  ctx.bezierCurveTo(-0.46, -1.16, -0.83, -0.8, -0.87, -0.18);
  ctx.closePath();
  ctx.fill();

  // panel seams
  ctx.strokeStyle = 'rgba(60,40,0,0.5)';
  ctx.lineWidth = 0.016;
  ctx.beginPath();
  ctx.moveTo(-0.87, -0.14); ctx.lineTo(-0.4, -0.5);
  ctx.moveTo(0.87, -0.14); ctx.lineTo(0.4, -0.5);
  ctx.moveTo(-0.5, 0.86); ctx.lineTo(0.5, 0.86);
  ctx.moveTo(0, 0.86); ctx.lineTo(0, 0.6);
  ctx.stroke();

  // brow ridge
  ctx.fillStyle = 'rgba(255,240,190,0.22)';
  ctx.beginPath();
  ctx.moveTo(-0.82, 0.66);
  ctx.bezierCurveTo(-0.4, 0.86, 0.4, 0.86, 0.82, 0.66);
  ctx.lineTo(0.78, 0.58);
  ctx.bezierCurveTo(0.4, 0.76, -0.4, 0.76, -0.78, 0.58);
  ctx.closePath(); ctx.fill();

  // mouth grille
  ctx.fillStyle = '#2b1d02';
  ctx.beginPath();
  ctx.moveTo(-0.33, -0.5); ctx.lineTo(0.33, -0.5);
  ctx.lineTo(0.27, -0.72); ctx.lineTo(-0.27, -0.72);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(230,200,120,0.55)';
  ctx.lineWidth = 0.014;
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(i * 0.11, -0.505); ctx.lineTo(i * 0.1, -0.715);
    ctx.stroke();
  }

  /* --- eye slits --------------------------------------------------------- */
  const eyeShape = (s) => {
    ctx.beginPath();
    ctx.moveTo(s * 0.74, 0.33);
    ctx.lineTo(s * 0.26, 0.47);
    ctx.lineTo(s * 0.23, 0.29);
    ctx.lineTo(s * 0.71, 0.16);
    ctx.closePath();
  };
  for (const s of [-1, 1]) {
    ctx.fillStyle = '#0a1820';
    eyeShape(s); ctx.fill();
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const gi = clamp(glow, 0, 1.6);
    ctx.fillStyle = `rgba(190,248,255,${0.55 + 0.45 * gi})`;
    eyeShape(s); ctx.fill();
    // bloom spilling past the slit
    const ex = s * 0.48, ey = 0.31;
    const bg = ctx.createRadialGradient(ex, ey, 0, ex, ey, 0.5);
    bg.addColorStop(0, `rgba(170,240,255,${0.5 * gi})`);
    bg.addColorStop(1, 'rgba(90,200,255,0)');
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.arc(ex, ey, 0.5, 0, TAU); ctx.fill();
    ctx.restore();
  }
  ctx.restore();

  /* --- side plates slide in from the ears -------------------------------- */
  for (const s of [-1, 1]) {
    ctx.save();
    ctx.translate(s * slide * 1.6, 0);
    const sg = ctx.createLinearGradient(s * 0.9, 0.6, s * 1.3, -0.4);
    sg.addColorStop(0, '#b0141a');
    sg.addColorStop(1, '#5c0a0d');
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.moveTo(s * 0.96, 0.62);
    ctx.lineTo(s * 1.26, 0.5);
    ctx.lineTo(s * 1.22, -0.22);
    ctx.lineTo(s * 0.9, -0.3);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,215,120,0.5)';
    ctx.lineWidth = 0.018;
    ctx.stroke();
    ctx.restore();
  }

  ctx.globalAlpha = 1;
  ctx.restore();

  /* --- assembly sparks while the plates are still moving ----------------- */
  if (e < 0.99) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const seam = fr.to(0, 1.2 + (1 - e) * 0.4);
    const g = ctx.createRadialGradient(seam.x, seam.y, 0, seam.x, seam.y, fr.w * 0.6);
    g.addColorStop(0, `rgba(255,220,150,${0.5 * (1 - e)})`);
    g.addColorStop(1, 'rgba(255,160,40,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(seam.x, seam.y, fr.w * 0.6, 0, TAU); ctx.fill();
    ctx.restore();
  }
}

/* ----------------------------------------------------------------- gamma --- */

const VEINS = [
  [[-0.72, 0.55], [-0.5, 0.35], [-0.58, 0.05], [-0.36, -0.2]],
  [[-0.85, 0.2], [-0.62, -0.05], [-0.68, -0.35]],
  [[0.72, 0.55], [0.5, 0.35], [0.58, 0.05], [0.36, -0.2]],
  [[0.85, 0.2], [0.62, -0.05], [0.68, -0.35]],
  [[-0.25, 0.95], [-0.32, 0.72], [-0.16, 0.6]],
  [[0.25, 0.95], [0.32, 0.72], [0.16, 0.6]],
  [[0, 1.0], [0.06, 0.78]],
];

/* one scratch layer, reused every frame */
let gammaLayer = null;
function layerFor(W, H) {
  if (!gammaLayer) gammaLayer = document.createElement('canvas');
  if (gammaLayer.width !== W || gammaLayer.height !== H) {
    gammaLayer.width = W; gammaLayer.height = H;
  }
  return gammaLayer;
}

/**
 * Recolours and swells the real face from the camera frame.
 * `src` is the already-mirrored video frame, drawn to fill W x H.
 *
 * Built on a scratch layer so the finished head can be feathered into the
 * real one - a hard-clipped oval reads as a sticker, a soft edge reads as skin.
 */
export function drawGamma(ctx0, src, L, fr, amount, t, W, H) {
  if (amount <= 0.005) return;
  const a = clamp(amount, 0, 1);
  const cx = fr.cx, cy = fr.cy;
  const grow = 1 + 0.3 * a + Math.sin(t * 9) * 0.012 * a; // swell + a breathing pulse

  // only touch the pixels the head can reach
  const rx = (fr.w / 2) * grow * 1.35, ry = (fr.h / 2) * grow * 1.35;
  const bx = Math.max(0, Math.floor(cx - rx)), by = Math.max(0, Math.floor(cy - ry));
  const bw = Math.min(W, Math.ceil(cx + rx)) - bx, bh = Math.min(H, Math.ceil(cy + ry)) - by;
  if (bw <= 0 || bh <= 0) return;

  const layer = layerFor(W, H);
  const ctx = layer.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.clearRect(bx, by, bw, bh);

  ctx.save();
  ovalPath(ctx, L, grow * 1.12, cx, cy);
  ctx.clip();

  // 1. redraw the face bigger so the skull actually broadens
  ctx.save();
  ctx.translate(cx, cy); ctx.scale(grow, grow); ctx.translate(-cx, -cy);
  ctx.drawImage(src, 0, 0, W, H);
  ctx.restore();

  // 2. keep the real lighting, swap the hue -> living skin, not paint
  ctx.globalCompositeOperation = 'color';
  ctx.fillStyle = `rgba(63,168,42,${a})`;
  ctx.fillRect(bx, by, bw, bh);

  ctx.globalCompositeOperation = 'overlay';
  ctx.fillStyle = `rgba(34,110,24,${0.35 * a})`;
  ctx.fillRect(bx, by, bw, bh);

  // 3. deepen the shadows around the brow and jaw
  ctx.globalCompositeOperation = 'multiply';
  const sh = ctx.createRadialGradient(cx, cy - fr.h * 0.1, fr.w * 0.15,
                                      cx, cy, fr.w * 0.95);
  sh.addColorStop(0, 'rgba(255,255,255,1)');
  sh.addColorStop(1, `rgba(${lerp(255, 120, a)},${lerp(255, 190, a)},${lerp(255, 110, a)},1)`);
  ctx.fillStyle = sh;
  ctx.fillRect(bx, by, bw, bh);

  // 4. veins under the skin
  ctx.globalCompositeOperation = 'multiply';
  ctx.strokeStyle = `rgba(40,95,30,${0.5 * a})`;
  ctx.lineWidth = Math.max(1, fr.w * 0.012);
  ctx.lineCap = 'round';
  const pulse = 0.9 + Math.sin(t * 5) * 0.1;
  for (const v of VEINS) {
    ctx.beginPath();
    for (let i = 0; i < v.length; i++) {
      const p = fr.to(v[i][0] * grow * pulse, v[i][1] * grow * pulse);
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }

  // 5. eyes light up
  ctx.globalCompositeOperation = 'lighter';
  for (const idx of [F.L_EYE, F.R_EYE]) {
    const p = L[idx];
    const ex = cx + (p.x - cx) * grow, ey = cy + (p.y - cy) * grow;
    const r = fr.w * 0.13;
    const g = ctx.createRadialGradient(ex, ey, 0, ex, ey, r);
    g.addColorStop(0, `rgba(226,255,190,${0.95 * a})`);
    g.addColorStop(0.3, `rgba(120,255,90,${0.6 * a})`);
    g.addColorStop(1, 'rgba(60,200,40,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(ex, ey, r, 0, TAU); ctx.fill();
  }
  ctx.restore();

  // 6. rim light along the silhouette
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = `rgba(120,255,110,${0.26 * a})`;
  ctx.lineWidth = Math.max(2, fr.w * 0.035);
  ovalPath(ctx, L, grow * 1.06, cx, cy);
  ctx.stroke();
  ctx.restore();

  // 7. feather the edge so the new head melts into the real one
  ctx.globalCompositeOperation = 'destination-in';
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, (fr.h / fr.w) || 1);
  const R = (fr.w / 2) * grow * 1.16;
  const mask = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
  mask.addColorStop(0, 'rgba(0,0,0,1)');
  mask.addColorStop(0.74, 'rgba(0,0,0,1)');
  mask.addColorStop(0.9, 'rgba(0,0,0,0.55)');
  mask.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = mask;
  ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill();
  ctx.restore();
  ctx.globalCompositeOperation = 'source-over';

  // 8. paste the finished head back over the camera frame
  ctx0.drawImage(layer, bx, by, bw, bh, bx, by, bw, bh);
}

/** Full-frame green grade while the gamma is up. */
export function gammaGrade(ctx, amount, W, H, t) {
  if (amount <= 0.005) return;
  const a = clamp(amount, 0, 1);
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25,
                                     W / 2, H / 2, Math.max(W, H) * 0.72);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(1, `rgba(${lerp(255, 90, a)},${lerp(255, 160, a)},${lerp(255, 90, a)},1)`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  ctx.globalCompositeOperation = 'lighter';
  const p = (0.03 + Math.sin(t * 4.5) * 0.015) * a;
  ctx.fillStyle = `rgba(60,200,60,${p})`;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

/* ------------------------------------------------------------ debug view --- */

const BONES = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],
  [10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],
  [19,20],[0,17]];

export function drawSkeleton(ctx, L) {
  ctx.save();
  ctx.strokeStyle = 'rgba(90,220,255,0.75)';
  ctx.lineWidth = 2;
  for (const [a, b] of BONES) {
    ctx.beginPath(); ctx.moveTo(L[a].x, L[a].y); ctx.lineTo(L[b].x, L[b].y); ctx.stroke();
  }
  ctx.fillStyle = '#fff';
  for (const p of L) { ctx.beginPath(); ctx.arc(p.x, p.y, 2.5, 0, TAU); ctx.fill(); }
  ctx.restore();
}

export function drawFaceDots(ctx, L) {
  ctx.save();
  ctx.fillStyle = 'rgba(255,160,60,0.5)';
  for (let i = 0; i < L.length; i += 3) {
    ctx.beginPath(); ctx.arc(L[i].x, L[i].y, 1.1, 0, TAU); ctx.fill();
  }
  ctx.restore();
}
