/* =========================================================================
   marvel.js - Mjolnir and lightning, the Infinity Gauntlet and its stones,
   chaos magic, the shield, the Eye of Agamotto and its rewind.
   ========================================================================= */

import { clamp, lerp, rand, TAU } from './fx.js';

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

/* ------------------------------------------------------------ lightning --- */

/** Recursive midpoint displacement - the standard way to get a bolt that
 *  forks and jitters instead of looking like a drawn zigzag. */
export function boltPath(x1, y1, x2, y2, chaos = 0.32, depth = 6) {
  let pts = [{ x: x1, y: y1 }, { x: x2, y: y2 }];
  let offset = Math.hypot(x2 - x1, y2 - y1) * chaos;
  for (let d = 0; d < depth; d++) {
    const next = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const nx = -(b.y - a.y), ny = b.x - a.x;
      const nl = Math.hypot(nx, ny) || 1;
      const o = rand(-offset, offset);
      next.push(a, { x: mx + (nx / nl) * o, y: my + (ny / nl) * o });
    }
    next.push(pts[pts.length - 1]);
    pts = next;
    offset *= 0.55;
  }
  return pts;
}

export function drawBolt(ctx, pts, width, col, alpha) {
  if (pts.length < 2) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const stroke = (w, c) => {
    ctx.strokeStyle = c; ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  };
  stroke(width * 3.2, `rgba(${col},${0.22 * alpha})`);
  stroke(width * 1.6, `rgba(${col},${0.5 * alpha})`);
  stroke(width * 0.55, `rgba(235,245,255,${0.95 * alpha})`);
  ctx.restore();
}

/** A bolt that lives for a few frames, with forks. */
export class Bolt {
  constructor(x1, y1, x2, y2, col, width) {
    this.pts = boltPath(x1, y1, x2, y2);
    this.forks = [];
    for (let i = 0; i < 3; i++) {
      const p = this.pts[(Math.random() * this.pts.length) | 0];
      this.forks.push(boltPath(p.x, p.y,
        p.x + rand(-180, 180), p.y + rand(-120, 180), 0.45, 4));
    }
    this.col = col || '150,210,255';
    this.w = width || 3;
    this.life = 0.16; this.max = 0.16;
  }
  update(dt) { this.life -= dt; return this.life > 0; }
  draw(ctx) {
    const a = Math.pow(clamp(this.life / this.max, 0, 1), 0.6);
    drawBolt(ctx, this.pts, this.w, this.col, a);
    for (const f of this.forks) drawBolt(ctx, f, this.w * 0.5, this.col, a * 0.6);
  }
}

/* -------------------------------------------------------------- mjolnir --- */

/** The hammer, drawn in the hand and aligned to the forearm. */
export function drawMjolnir(ctx, x, y, angle, s, charge, t) {
  if (s <= 0.01) return;
  const c = clamp(charge, 0, 1);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(s, s);

  // haft
  const haft = ctx.createLinearGradient(-0.12, 0, 0.12, 0);
  haft.addColorStop(0, '#3a2a1c');
  haft.addColorStop(0.45, '#8a6a46');
  haft.addColorStop(1, '#2c1f14');
  ctx.fillStyle = haft;
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(-0.11, -0.1, 0.22, 1.5, 0.06)
                : ctx.rect(-0.11, -0.1, 0.22, 1.5);
  ctx.fill();
  // leather wrap
  ctx.strokeStyle = 'rgba(30,20,12,0.6)';
  ctx.lineWidth = 0.035;
  for (let i = 0; i < 9; i++) {
    const yy = 0.18 + i * 0.145;
    ctx.beginPath(); ctx.moveTo(-0.11, yy); ctx.lineTo(0.11, yy + 0.05); ctx.stroke();
  }
  // pommel loop
  ctx.strokeStyle = '#9a8266';
  ctx.lineWidth = 0.05;
  ctx.beginPath(); ctx.arc(0, 1.48, 0.09, 0, TAU); ctx.stroke();

  // head
  const head = ctx.createLinearGradient(-0.62, -0.42, 0.62, 0.3);
  head.addColorStop(0, '#5b6370');
  head.addColorStop(0.28, '#cfd6de');
  head.addColorStop(0.5, '#8d96a3');
  head.addColorStop(0.75, '#c3cbd4');
  head.addColorStop(1, '#474e59');
  ctx.fillStyle = head;
  ctx.beginPath();
  ctx.moveTo(-0.62, -0.40);
  ctx.lineTo(0.62, -0.40);
  ctx.lineTo(0.56, 0.30);
  ctx.lineTo(-0.56, 0.30);
  ctx.closePath();
  ctx.fill();
  // the flared faces
  ctx.fillStyle = 'rgba(255,255,255,0.13)';
  ctx.fillRect(-0.62, -0.40, 1.24, 0.1);
  ctx.strokeStyle = 'rgba(30,36,44,0.75)';
  ctx.lineWidth = 0.03;
  ctx.beginPath();
  ctx.moveTo(-0.44, -0.40); ctx.lineTo(-0.40, 0.30);
  ctx.moveTo(0.44, -0.40); ctx.lineTo(0.40, 0.30);
  ctx.stroke();

  // runes, lit by the charge
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = `rgba(190,230,255,${0.35 + 0.65 * c})`;
  ctx.lineWidth = 0.028;
  for (let i = -2; i <= 2; i++) {
    const rx = i * 0.2;
    ctx.beginPath();
    ctx.moveTo(rx - 0.05, -0.24); ctx.lineTo(rx + 0.05, -0.1);
    ctx.lineTo(rx - 0.05, 0.04); ctx.lineTo(rx + 0.05, 0.16);
    ctx.stroke();
  }
  ctx.restore();
}

/* ------------------------------------------------------------- gauntlet --- */

export const STONES = [
  { name: 'space',   col: '90,150,255' },
  { name: 'mind',    col: '255,215,70' },
  { name: 'reality', col: '255,60,90' },
  { name: 'power',   col: '170,90,255' },
  { name: 'time',    col: '110,230,140' },
  { name: 'soul',    col: '255,150,50' },
];

/**
 * The gauntlet, built on the actual hand landmarks so it bends with the
 * fingers instead of floating as a decal.
 */
export function drawGauntlet(ctx, L, amount, t, stoneGlow = 1) {
  const a = clamp(amount, 0, 1);
  if (a <= 0.01) return;

  const W = L[0], I = L[5], P = L[17], M = L[9];
  const span = Math.hypot(M.x - W.x, M.y - W.y) || 1;
  const grow = easeOutCubic(a);

  ctx.save();
  ctx.globalAlpha = a;

  const gold = (c) => {
    const g = ctx.createLinearGradient(W.x - span, W.y - span, W.x + span, W.y + span);
    g.addColorStop(0, '#6b4506');
    g.addColorStop(0.3, '#e0aa27');
    g.addColorStop(0.5, '#ffe8a8');
    g.addColorStop(0.72, '#d09a1e');
    g.addColorStop(1, '#5d3a04');
    return g;
  };

  // back of the hand
  ctx.fillStyle = gold();
  ctx.beginPath();
  ctx.moveTo(lerp(W.x, I.x, -0.25), lerp(W.y, I.y, -0.25));
  ctx.lineTo(I.x, I.y);
  ctx.lineTo(M.x, M.y);
  ctx.lineTo(P.x, P.y);
  ctx.lineTo(lerp(W.x, P.x, -0.25), lerp(W.y, P.y, -0.25));
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(70,45,0,0.6)';
  ctx.lineWidth = Math.max(1, span * 0.05);
  ctx.stroke();

  // finger plates: one segment per bone, so they articulate
  const chains = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12],
                  [13, 14, 15, 16], [17, 18, 19, 20]];
  ctx.lineCap = 'round';
  for (const chain of chains) {
    for (let i = 0; i < chain.length - 1; i++) {
      const p = L[chain[i]], q = L[chain[i + 1]];
      ctx.strokeStyle = gold();
      ctx.lineWidth = span * (0.30 - i * 0.05) * grow;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
      ctx.strokeStyle = 'rgba(80,52,0,0.45)';
      ctx.lineWidth = Math.max(1, span * 0.02);
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
    }
  }

  // knuckle housings and their stones
  const seats = [L[5], L[9], L[13], L[17], L[2]];
  for (let i = 0; i < 5; i++) {
    const s = seats[i], st = STONES[i];
    const r = span * 0.17 * grow;
    ctx.fillStyle = '#3a2600';
    ctx.beginPath(); ctx.arc(s.x, s.y, r * 1.35, 0, TAU); ctx.fill();
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const pulse = 0.72 + Math.sin(t * 3 + i * 1.1) * 0.28;
    const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r * 2.6);
    g.addColorStop(0, `rgba(255,255,255,${0.95 * a * stoneGlow})`);
    g.addColorStop(0.22, `rgba(${st.col},${0.95 * a * pulse * stoneGlow})`);
    g.addColorStop(0.5, `rgba(${st.col},${0.35 * a * pulse * stoneGlow})`);
    g.addColorStop(1, `rgba(${st.col},0)`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(s.x, s.y, r * 2.6, 0, TAU); ctx.fill();
    ctx.restore();
  }

  // the sixth stone sits on the back of the hand
  const back = { x: (W.x + M.x) / 2, y: (W.y + M.y) / 2 };
  const st = STONES[5];
  const r = span * 0.2 * grow;
  ctx.fillStyle = '#3a2600';
  ctx.beginPath(); ctx.arc(back.x, back.y, r * 1.3, 0, TAU); ctx.fill();
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g2 = ctx.createRadialGradient(back.x, back.y, 0, back.x, back.y, r * 3);
  g2.addColorStop(0, `rgba(255,255,255,${0.95 * a * stoneGlow})`);
  g2.addColorStop(0.2, `rgba(${st.col},${0.9 * a * stoneGlow})`);
  g2.addColorStop(1, `rgba(${st.col},0)`);
  ctx.fillStyle = g2;
  ctx.beginPath(); ctx.arc(back.x, back.y, r * 3, 0, TAU); ctx.fill();
  ctx.restore();

  ctx.restore();
}

/* ---------------------------------------------------------- chaos magic --- */

/**
 * Scarlet Witch: not a beam and not a ball. Ribbons of red that coil around
 * the hand and trail behind it, with the hex pattern showing through.
 */
export function drawChaos(ctx, x, y, r0, amount, t, trail) {
  const a = clamp(amount, 0, 1);
  if (a <= 0.005) return;
  const r = r0 * (0.6 + a * 0.7);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  // core
  const g = ctx.createRadialGradient(x, y, 0, x, y, r * 1.7);
  g.addColorStop(0, `rgba(255,235,225,${0.85 * a})`);
  g.addColorStop(0.18, `rgba(255,90,60,${0.8 * a})`);
  g.addColorStop(0.45, `rgba(210,20,30,${0.5 * a})`);
  g.addColorStop(1, 'rgba(120,0,15,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r * 1.7, 0, TAU); ctx.fill();

  // coiling ribbons
  ctx.lineCap = 'round';
  for (let k = 0; k < 5; k++) {
    ctx.strokeStyle = `rgba(255,${70 + k * 22},${50 + k * 14},${0.5 * a})`;
    ctx.lineWidth = Math.max(1, r * (0.11 - k * 0.015));
    ctx.beginPath();
    for (let i = 0; i <= 26; i++) {
      const p = i / 26;
      const ang = p * TAU * 1.6 + t * (1.3 + k * 0.4) + k * 1.2;
      const rr = r * (0.45 + p * 1.05) * (1 + Math.sin(t * 3 + p * 8) * 0.12);
      const px = x + Math.cos(ang) * rr;
      const py = y + Math.sin(ang) * rr * 0.72;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  // hex lattice
  ctx.strokeStyle = `rgba(255,150,120,${0.28 * a})`;
  ctx.lineWidth = Math.max(1, r * 0.02);
  for (let ring = 1; ring <= 2; ring++) {
    ctx.beginPath();
    for (let i = 0; i <= 6; i++) {
      const ang = (i / 6) * TAU + t * (ring % 2 ? 0.5 : -0.5);
      const rr = r * (0.55 + ring * 0.42);
      const px = x + Math.cos(ang) * rr, py = y + Math.sin(ang) * rr;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  // smoke trailing the hand
  if (trail && trail.length > 3) {
    ctx.lineCap = 'round';
    for (let i = 1; i < trail.length; i++) {
      const p = i / trail.length;
      ctx.strokeStyle = `rgba(230,40,40,${0.3 * p * a})`;
      ctx.lineWidth = r * 0.5 * p;
      ctx.beginPath();
      ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
      ctx.lineTo(trail[i].x, trail[i].y);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/* -------------------------------------------------------------- shield --- */

export function drawShield(ctx, x, y, r, spin, tilt, t) {
  if (r <= 1) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(spin);
  ctx.scale(1, clamp(tilt, 0.25, 1));

  const bands = [
    ['#c8102e', 1.00], ['#f5f5f5', 0.80], ['#c8102e', 0.62], ['#1b3a8f', 0.44],
  ];
  for (const [col, rr] of bands) {
    const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.05, 0, 0, r * rr);
    g.addColorStop(0, col);
    g.addColorStop(0.7, col);
    g.addColorStop(1, shade(col, -0.35));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, r * rr, 0, TAU); ctx.fill();
  }
  // star
  ctx.fillStyle = '#f5f5f5';
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rr = r * (i % 2 ? 0.16 : 0.38);
    const ang = -Math.PI / 2 + (i / 10) * TAU;
    const px = Math.cos(ang) * rr, py = Math.sin(ang) * rr;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath(); ctx.fill();

  // hard specular edge so it reads as metal
  ctx.globalCompositeOperation = 'lighter';
  const sg = ctx.createLinearGradient(-r, -r, r, r);
  sg.addColorStop(0, 'rgba(255,255,255,0.45)');
  sg.addColorStop(0.4, 'rgba(255,255,255,0.05)');
  sg.addColorStop(1, 'rgba(255,255,255,0.3)');
  ctx.strokeStyle = sg;
  ctx.lineWidth = Math.max(2, r * 0.06);
  ctx.beginPath(); ctx.arc(0, 0, r * 0.97, 0, TAU); ctx.stroke();
  ctx.restore();
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp(((n >> 16) & 255) * (1 + amt), 0, 255) | 0;
  const g = clamp(((n >> 8) & 255) * (1 + amt), 0, 255) | 0;
  const b = clamp((n & 255) * (1 + amt), 0, 255) | 0;
  return `rgb(${r},${g},${b})`;
}

/** Thrown shield: flies out, ricochets off the frame edges, comes back. */
export class ShieldThrow {
  constructor(x, y, dx, dy, r, W, H) {
    this.x = x; this.y = y; this.vx = dx * 1500; this.vy = dy * 1500;
    this.r = r; this.spin = 0; this.life = 2.4; this.max = 2.4;
    this.W = W; this.H = H; this.home = { x, y }; this.bounces = 0;
  }
  update(dt) {
    this.life -= dt;
    const back = this.life < this.max * 0.45;
    if (back) {                       // called home
      const dx = this.home.x - this.x, dy = this.home.y - this.y;
      const d = Math.hypot(dx, dy) || 1;
      this.vx = lerp(this.vx, (dx / d) * 1700, 0.08);
      this.vy = lerp(this.vy, (dy / d) * 1700, 0.08);
      if (d < this.r) return false;
    }
    this.x += this.vx * dt; this.y += this.vy * dt;
    if (!back) {
      if (this.x < this.r || this.x > this.W - this.r) { this.vx *= -1; this.bounces++; }
      if (this.y < this.r || this.y > this.H - this.r) { this.vy *= -1; this.bounces++; }
      this.x = clamp(this.x, this.r, this.W - this.r);
      this.y = clamp(this.y, this.r, this.H - this.r);
    }
    this.spin += dt * 22;
    return this.life > 0;
  }
  draw(ctx) {
    // motion blur: a few ghosts behind the disc
    for (let i = 3; i >= 1; i--) {
      ctx.save();
      ctx.globalAlpha = 0.12 * i;
      drawShield(ctx, this.x - this.vx * 0.006 * i, this.y - this.vy * 0.006 * i,
                 this.r, this.spin - i * 0.4, 1, 0);
      ctx.restore();
    }
    drawShield(ctx, this.x, this.y, this.r, this.spin, 1, 0);
  }
}

/* --------------------------------------------------- eye of agamotto --- */

export function drawEye(ctx, x, y, r, open, t) {
  const a = clamp(open, 0, 1);
  if (a <= 0.01) return;
  ctx.save();
  ctx.translate(x, y);

  // casing
  ctx.fillStyle = '#c9a227';
  ctx.strokeStyle = '#6d5311';
  ctx.lineWidth = Math.max(1, r * 0.08);
  ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill(); ctx.stroke();

  // the leaves that iris open
  const spread = a * r * 0.85;
  ctx.fillStyle = '#e0b52e';
  for (const s of [-1, 1]) {
    ctx.save();
    ctx.translate(s * spread * 0.45, 0);
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.55, r * 0.95, s * 0.2 * a, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  // the stone
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * (0.2 + a * 1.9));
  g.addColorStop(0, `rgba(255,255,255,${0.95 * a})`);
  g.addColorStop(0.18, `rgba(150,255,170,${0.9 * a})`);
  g.addColorStop(0.45, `rgba(40,200,90,${0.45 * a})`);
  g.addColorStop(1, 'rgba(10,120,40,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, r * (0.2 + a * 1.9), 0, TAU); ctx.fill();

  // mandala ticks around it
  ctx.strokeStyle = `rgba(160,255,180,${0.55 * a})`;
  ctx.lineWidth = Math.max(1, r * 0.06);
  for (let i = 0; i < 16; i++) {
    const ang = (i / 16) * TAU + t * 0.8;
    ctx.beginPath();
    ctx.moveTo(Math.cos(ang) * r * 1.25, Math.sin(ang) * r * 1.25);
    ctx.lineTo(Math.cos(ang) * r * 1.45, Math.sin(ang) * r * 1.45);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Time rewind. Keeps a ring of recent frames and plays them back over the
 * live picture, so the room genuinely runs backwards instead of just
 * turning green.
 */
export class TimeStream {
  constructor(maxFrames = 72, w = 256) {
    this.max = maxFrames; this.w = w; this.frames = []; this.i = 0;
    this.playhead = 0;
  }
  push(src, sw, sh) {
    const h = Math.round(this.w * (sh / sw));
    let c = this.frames[this.i];
    if (!c) {
      c = document.createElement('canvas');
      c.width = this.w; c.height = h;
      this.frames[this.i] = c;
    }
    if (c.height !== h) { c.height = h; }
    const g = c.getContext('2d');
    g.drawImage(src, 0, 0, this.w, h);
    this.i = (this.i + 1) % this.max;
    if (this.frames.length < this.max) this.playhead = this.frames.length - 1;
  }
  /** amount 0..1; rate is how many stored frames to step back per second. */
  draw(ctx, W, H, amount, dt, rate = 90) {
    const a = clamp(amount, 0, 1);
    if (a <= 0.01 || this.frames.length < 4) return;
    this.playhead -= dt * rate;
    const n = this.frames.length;
    if (this.playhead < 0) this.playhead += n;

    ctx.save();
    // three taps, smeared, so it reads as motion not a slideshow
    for (let k = 0; k < 3; k++) {
      const idx = (((Math.round(this.playhead) - k * 3) % n) + n) % n;
      const f = this.frames[idx];
      if (!f) continue;
      ctx.globalAlpha = a * (k === 0 ? 0.85 : 0.3 / k);
      ctx.globalCompositeOperation = k === 0 ? 'source-over' : 'lighter';
      ctx.drawImage(f, 0, 0, W, H);
    }
    ctx.restore();
  }
}

/** Green time-rings, the visual signature of the rewind. */
export function drawTimeRings(ctx, x, y, R, amount, t) {
  const a = clamp(amount, 0, 1);
  if (a <= 0.01) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineWidth = Math.max(1, R * 0.008);
  for (let k = 0; k < 5; k++) {
    const p = ((-t * 0.5 + k / 5) % 1 + 1) % 1;   // note: inward, not outward
    const rr = R * (0.25 + p * 1.1);
    ctx.strokeStyle = `rgba(120,255,160,${(1 - Math.abs(p - 0.5) * 2) * 0.5 * a})`;
    ctx.beginPath();
    ctx.ellipse(x, y, rr, rr * 0.35, 0, 0, TAU);
    ctx.stroke();
  }
  // running glyph ring
  ctx.strokeStyle = `rgba(170,255,190,${0.5 * a})`;
  ctx.lineWidth = Math.max(1, R * 0.012);
  for (let i = 0; i < 40; i++) {
    const ang = (i / 40) * TAU - t * 1.1;
    const rr = R * 0.95;
    ctx.beginPath();
    ctx.arc(x, y, rr, ang, ang + 0.07);
    ctx.stroke();
  }
  ctx.restore();
}

/* ---------------------------------------------------------- mind stone --- */

/** Vision's forehead stone plus its beam. */
export function drawMindStone(ctx, fr, amount, t) {
  const a = clamp(amount, 0, 1);
  if (a <= 0.01) return;
  const p = fr.to(0, 0.72);
  const r = fr.w * 0.09;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 3.4);
  g.addColorStop(0, `rgba(255,255,240,${0.95 * a})`);
  g.addColorStop(0.16, `rgba(255,225,80,${0.92 * a})`);
  g.addColorStop(0.42, `rgba(255,170,20,${0.45 * a})`);
  g.addColorStop(1, 'rgba(180,110,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(p.x, p.y, r * 3.4, 0, TAU); ctx.fill();

  // faceted stone body
  ctx.fillStyle = `rgba(255,236,150,${0.9 * a})`;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const ang = -Math.PI / 2 + (i / 6) * TAU + Math.sin(t) * 0.05;
    const px = p.x + Math.cos(ang) * r, py = p.y + Math.sin(ang) * r * 1.25;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

/** A straight energy lance in any colour - used by the mind beam. */
export class EnergyBeam {
  constructor(x, y, dx, dy, len, w, col, life = 0.5) {
    this.x = x; this.y = y; this.dx = dx; this.dy = dy;
    this.len = len; this.w = w; this.col = col;
    this.life = life; this.max = life;
  }
  update(dt) { this.life -= dt; return this.life > 0; }
  draw(ctx) {
    const t = 1 - this.life / this.max;
    const reach = this.len * easeOutCubic(clamp(t * 3, 0, 1));
    const fade = Math.pow(1 - t, 1.2);
    const ex = this.x + this.dx * reach, ey = this.y + this.dy * reach;
    const w = this.w * fade;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    const g = ctx.createLinearGradient(this.x, this.y, ex, ey);
    g.addColorStop(0, `rgba(255,255,255,${0.95 * fade})`);
    g.addColorStop(0.2, `rgba(${this.col},${0.85 * fade})`);
    g.addColorStop(1, `rgba(${this.col},0)`);
    ctx.strokeStyle = g; ctx.lineWidth = w * 2.2;
    ctx.beginPath(); ctx.moveTo(this.x, this.y); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.strokeStyle = `rgba(255,255,255,${0.9 * fade})`;
    ctx.lineWidth = w * 0.3;
    ctx.beginPath(); ctx.moveTo(this.x, this.y); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.restore();
  }
}
