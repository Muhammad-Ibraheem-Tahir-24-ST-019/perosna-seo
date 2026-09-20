/* =========================================================================
   jjk.js - cursed techniques.

   Lapse: Blue (attraction), Reversal: Red (repulsion), Hollow Purple (the
   two forced together), Dismantle, and the two Domain Expansions.
   ========================================================================= */

import { clamp, lerp, rand, TAU } from './fx.js';

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

/* ---------------------------------------------------------------- blue --- */

/**
 * Blue is a vacuum, so the centre is DARKER than the scene, not brighter.
 * The light lives in the shell being crushed inward around it.
 */
export function drawBlue(ctx, x, y, r0, charge, t) {
  if (charge <= 0.005) return;
  const c = clamp(charge, 0, 1);
  const r = r0 * (0.5 + c * 0.85) * (1 + Math.sin(t * 13) * 0.02 * c);

  ctx.save();

  // the hole it makes in the light
  ctx.globalCompositeOperation = 'source-over';
  const core = ctx.createRadialGradient(x, y, 0, x, y, r * 0.8);
  core.addColorStop(0, `rgba(2,6,30,${0.92 * c})`);
  core.addColorStop(0.6, `rgba(4,14,60,${0.6 * c})`);
  core.addColorStop(1, 'rgba(6,20,80,0)');
  ctx.fillStyle = core;
  ctx.beginPath(); ctx.arc(x, y, r * 0.8, 0, TAU); ctx.fill();

  ctx.globalCompositeOperation = 'lighter';

  // compression shell
  const shell = ctx.createRadialGradient(x, y, r * 0.55, x, y, r * 1.5);
  shell.addColorStop(0, 'rgba(20,90,255,0)');
  shell.addColorStop(0.42, `rgba(40,140,255,${0.7 * c})`);
  shell.addColorStop(0.62, `rgba(150,225,255,${0.85 * c})`);
  shell.addColorStop(0.78, `rgba(30,110,255,${0.35 * c})`);
  shell.addColorStop(1, 'rgba(10,60,200,0)');
  ctx.fillStyle = shell;
  ctx.beginPath(); ctx.arc(x, y, r * 1.5, 0, TAU); ctx.fill();

  // matter being dragged in: streaks that spiral and shorten
  ctx.lineCap = 'round';
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * TAU + t * 0.9;
    const phase = ((t * 1.4 + i * 0.37) % 1);
    const from = r * (2.6 - phase * 1.5);
    const to = from - r * 0.45 * (1 - phase);
    ctx.strokeStyle = `rgba(140,215,255,${(1 - phase) * 0.55 * c})`;
    ctx.lineWidth = Math.max(1, r * 0.035 * (1 - phase));
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * from, y + Math.sin(a) * from);
    ctx.lineTo(x + Math.cos(a - 0.22) * to, y + Math.sin(a - 0.22) * to);
    ctx.stroke();
  }

  // rim arcs
  ctx.lineWidth = Math.max(1, r * 0.05);
  for (let k = 0; k < 3; k++) {
    const a0 = -t * (1.6 + k) + k * 2.1;
    ctx.strokeStyle = `rgba(190,235,255,${0.5 * c})`;
    ctx.beginPath();
    ctx.arc(x, y, r * (0.95 + k * 0.13), a0, a0 + 1.1);
    ctx.stroke();
  }
  ctx.restore();
}

/* ----------------------------------------------------------------- red --- */

/** Red pushes. Hot core, pressure fronts rolling outward. */
export function drawRed(ctx, x, y, r0, charge, t) {
  if (charge <= 0.005) return;
  const c = clamp(charge, 0, 1);
  const r = r0 * (0.5 + c * 0.9) * (1 + Math.sin(t * 17) * 0.03 * c);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  const core = ctx.createRadialGradient(x, y, 0, x, y, r * 1.6);
  core.addColorStop(0, `rgba(255,250,235,${0.95 * c})`);
  core.addColorStop(0.16, `rgba(255,170,90,${0.9 * c})`);
  core.addColorStop(0.42, `rgba(255,60,30,${0.6 * c})`);
  core.addColorStop(0.72, `rgba(190,20,10,${0.28 * c})`);
  core.addColorStop(1, 'rgba(120,10,0,0)');
  ctx.fillStyle = core;
  ctx.beginPath(); ctx.arc(x, y, r * 1.6, 0, TAU); ctx.fill();

  // pressure fronts leaving the sphere
  for (let i = 0; i < 3; i++) {
    const phase = ((t * 1.7 + i / 3) % 1);
    const rr = r * (1 + phase * 1.6);
    ctx.strokeStyle = `rgba(255,140,70,${(1 - phase) * 0.55 * c})`;
    ctx.lineWidth = Math.max(1, r * 0.09 * (1 - phase));
    ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU); ctx.stroke();
  }

  // spitting embers
  ctx.lineWidth = Math.max(1, r * 0.04);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * TAU - t * 1.3;
    const from = r * 0.9, to = r * (1.25 + Math.sin(t * 9 + i) * 0.25);
    ctx.strokeStyle = `rgba(255,200,120,${0.5 * c})`;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * from, y + Math.sin(a) * from);
    ctx.lineTo(x + Math.cos(a) * to, y + Math.sin(a) * to);
    ctx.stroke();
  }
  ctx.restore();
}

/* -------------------------------------------------------------- purple --- */

/** Blue and Red held in the same place, refusing to cancel. */
export function drawPurple(ctx, x, y, r0, charge, t) {
  if (charge <= 0.005) return;
  const c = clamp(charge, 0, 1);
  const r = r0 * (0.55 + c * 1.05);
  const jitter = (1 - c) * r * 0.12;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  // the two halves still orbiting, not yet merged
  const sep = r * 0.55 * (1 - c);
  const a0 = t * 4.2;
  drawBlueDot(ctx, x + Math.cos(a0) * sep, y + Math.sin(a0) * sep, r * 0.5, c);
  drawRedDot(ctx, x - Math.cos(a0) * sep, y - Math.sin(a0) * sep, r * 0.5, c);

  // the merged body
  const g = ctx.createRadialGradient(x, y, 0, x, y, r * 1.8);
  g.addColorStop(0, `rgba(255,255,255,${0.95 * c})`);
  g.addColorStop(0.12, `rgba(225,170,255,${0.9 * c})`);
  g.addColorStop(0.34, `rgba(150,60,240,${0.72 * c})`);
  g.addColorStop(0.62, `rgba(90,20,180,${0.35 * c})`);
  g.addColorStop(1, 'rgba(50,0,120,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x + rand(-jitter, jitter), y + rand(-jitter, jitter), r * 1.8, 0, TAU);
  ctx.fill();

  // arcs whipping off the surface
  ctx.lineCap = 'round';
  for (let i = 0; i < 10; i++) {
    const a = rand(0, TAU);
    const len = r * rand(0.8, 2.1) * c;
    ctx.strokeStyle = `rgba(225,180,255,${rand(0.2, 0.7) * c})`;
    ctx.lineWidth = Math.max(1, r * rand(0.02, 0.06));
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * r * 0.7, y + Math.sin(a) * r * 0.7);
    let px = x + Math.cos(a) * r * 0.7, py = y + Math.sin(a) * r * 0.7;
    for (let k = 0; k < 4; k++) {
      px += Math.cos(a + rand(-0.7, 0.7)) * len / 4;
      py += Math.sin(a + rand(-0.7, 0.7)) * len / 4;
      ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  // containment rings
  ctx.lineWidth = Math.max(1.5, r * 0.05);
  for (let k = 0; k < 2; k++) {
    const aa = t * (k ? -2.4 : 2.0);
    ctx.strokeStyle = `rgba(240,215,255,${0.55 * c})`;
    ctx.beginPath();
    ctx.ellipse(x, y, r * (1.25 + k * 0.2), r * (0.42 + k * 0.1), aa, 0, TAU);
    ctx.stroke();
  }
  ctx.restore();
}

function drawBlueDot(ctx, x, y, r, c) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(190,235,255,${0.9 * c})`);
  g.addColorStop(0.5, `rgba(40,130,255,${0.6 * c})`);
  g.addColorStop(1, 'rgba(10,60,200,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
}
function drawRedDot(ctx, x, y, r, c) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(255,225,190,${0.9 * c})`);
  g.addColorStop(0.5, `rgba(255,70,30,${0.6 * c})`);
  g.addColorStop(1, 'rgba(140,10,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
}

/** The beam. Fired once, it owns the screen for about a second. */
export class PurpleBeam {
  constructor(x, y, dx, dy, len, width) {
    this.x = x; this.y = y; this.dx = dx; this.dy = dy;
    this.len = len; this.w = width;
    this.life = 1.0; this.max = 1.0;
  }
  update(dt) { this.life -= dt; return this.life > 0; }
  draw(ctx) {
    const t = 1 - this.life / this.max;
    const reach = this.len * easeOutCubic(clamp(t * 3.2, 0, 1));
    const fade = t < 0.12 ? t / 0.12 : Math.pow(1 - (t - 0.12) / 0.88, 1.4);
    const ex = this.x + this.dx * reach, ey = this.y + this.dy * reach;
    const w = this.w * fade;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';

    const g = ctx.createLinearGradient(this.x, this.y, ex, ey);
    g.addColorStop(0, `rgba(255,255,255,${0.95 * fade})`);
    g.addColorStop(0.1, `rgba(220,160,255,${0.9 * fade})`);
    g.addColorStop(0.55, `rgba(140,50,235,${0.6 * fade})`);
    g.addColorStop(1, 'rgba(70,10,160,0)');

    ctx.strokeStyle = g; ctx.lineWidth = w * 2.6;
    ctx.beginPath(); ctx.moveTo(this.x, this.y); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.strokeStyle = g; ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(this.x, this.y); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.strokeStyle = `rgba(255,255,255,${0.95 * fade})`;
    ctx.lineWidth = w * 0.26;
    ctx.beginPath(); ctx.moveTo(this.x, this.y); ctx.lineTo(ex, ey); ctx.stroke();

    // rings racing along the shaft
    const nx = -this.dy, ny = this.dx;
    for (let i = 0; i < 9; i++) {
      const p = ((t * 2.2 + i / 9) % 1);
      const px = this.x + this.dx * reach * p, py = this.y + this.dy * reach * p;
      const rr = w * (0.8 + p * 1.5);
      ctx.strokeStyle = `rgba(215,170,255,${(1 - p) * 0.5 * fade})`;
      ctx.lineWidth = Math.max(1, w * 0.1);
      ctx.beginPath();
      ctx.ellipse(px, py, rr * 0.35, rr,
                  Math.atan2(ny, nx) + Math.PI / 2, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }
}

/* ----------------------------------------------------------- dismantle --- */

/** One cut. White-hot at the moment of the slash, then a red wound. */
export class Slash {
  constructor(x, y, dx, dy, len, w) {
    this.x = x; this.y = y; this.dx = dx; this.dy = dy;
    this.len = len; this.w = w || 10;
    this.life = 0.55; this.max = 0.55;
  }
  update(dt) { this.life -= dt; return this.life > 0; }
  draw(ctx) {
    const t = 1 - this.life / this.max;
    const grow = easeOutCubic(clamp(t * 4, 0, 1));
    const fade = Math.pow(1 - t, 1.3);
    const hl = (this.len * grow) / 2;
    const x1 = this.x - this.dx * hl, y1 = this.y - this.dy * hl;
    const x2 = this.x + this.dx * hl, y2 = this.y + this.dy * hl;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'butt';

    ctx.strokeStyle = `rgba(255,40,30,${0.45 * fade})`;
    ctx.lineWidth = this.w * 2.4 * fade;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();

    ctx.strokeStyle = `rgba(255,190,170,${0.8 * fade})`;
    ctx.lineWidth = this.w * fade;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();

    ctx.strokeStyle = `rgba(255,255,255,${fade})`;
    ctx.lineWidth = Math.max(1, this.w * 0.28 * fade);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.restore();
  }
}


/* One column of glyphs, rendered once and reused by every stream. */
let _strip = null, _stripSize = 0;
function glyphStrip(size) {
  if (_strip && _stripSize === size) return _strip;
  _stripSize = size;
  const c = document.createElement('canvas');
  c.width = Math.max(8, size * 2);
  c.height = Math.max(64, size * 34);
  const g = c.getContext('2d');
  g.font = `${size}px ui-monospace, monospace`;
  g.textAlign = 'center';
  const rows = Math.floor(c.height / (size * 1.9));
  for (let j = 0; j < rows; j++) {
    const ch = String.fromCharCode(0x30a0 + ((j * 13 + 7) % 90));
    g.fillStyle = `rgba(190,225,255,${j === 0 ? 1 : 0.55})`;
    g.fillText(ch, c.width / 2, (j + 1) * size * 1.9);
  }
  _strip = c;
  return c;
}

/* ---------------------------------------------------- domain expansion --- */

/**
 * Unlimited Void: every piece of information at once. Cold, black, endless,
 * with the user lit from behind by something far too large.
 */
export function drawVoid(ctx, W, H, amount, t, head) {
  const a = clamp(amount, 0, 1);
  if (a <= 0.004) return;
  const cx = head ? head.x : W / 2, cy = head ? head.y : H * 0.45;

  ctx.save();

  // the dark
  ctx.globalCompositeOperation = 'source-over';
  const dark = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.9);
  dark.addColorStop(0, `rgba(4,6,22,${0.55 * a})`);
  dark.addColorStop(0.5, `rgba(2,3,14,${0.85 * a})`);
  dark.addColorStop(1, `rgba(0,0,6,${0.96 * a})`);
  ctx.fillStyle = dark;
  ctx.fillRect(0, 0, W, H);

  ctx.globalCompositeOperation = 'lighter';

  // starfield
  for (let i = 0; i < 150; i++) {
    const sx = ((i * 7919) % 1000) / 1000 * W;
    const sy = ((i * 6271) % 1000) / 1000 * H;
    const tw = 0.35 + Math.sin(t * 2.4 + i) * 0.35;
    ctx.fillStyle = `rgba(210,230,255,${tw * 0.7 * a})`;
    ctx.beginPath(); ctx.arc(sx, sy, (i % 4 === 0 ? 1.8 : 1) * a, 0, TAU); ctx.fill();
  }

  // the halo behind the head
  const R = Math.min(W, H) * 0.42;
  const halo = ctx.createRadialGradient(cx, cy, R * 0.72, cx, cy, R * 1.12);
  halo.addColorStop(0, 'rgba(120,170,255,0)');
  halo.addColorStop(0.55, `rgba(180,215,255,${0.5 * a})`);
  halo.addColorStop(0.72, `rgba(255,255,255,${0.75 * a})`);
  halo.addColorStop(1, 'rgba(120,170,255,0)');
  ctx.fillStyle = halo;
  ctx.beginPath(); ctx.arc(cx, cy, R * 1.12, 0, TAU); ctx.fill();

  // rings of information, tilted away
  ctx.lineWidth = Math.max(1, R * 0.008);
  for (let k = 0; k < 7; k++) {
    const p = ((t * 0.16 + k / 7) % 1);
    const rr = R * (0.4 + p * 1.5);
    ctx.strokeStyle = `rgba(170,205,255,${(1 - p) * 0.4 * a})`;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rr, rr * 0.3, Math.sin(t * 0.3 + k) * 0.25, 0, TAU);
    ctx.stroke();
  }

  // streams of unreadable information falling past. The glyphs are baked
  // into one strip up front and scrolled: laying out ~180 pieces of text
  // every frame costs far more than blitting a cached column.
  const strip = glyphStrip(Math.round(Math.min(W, H) * 0.018));
  const cols = 22;
  const colW = W / cols;
  for (let i = 0; i < cols; i++) {
    const speed = 60 + ((i * 37) % 90);
    const off = (t * speed) % strip.height;
    ctx.globalAlpha = (0.16 + ((i * 7) % 5) * 0.03) * a;
    // drawn twice so the column wraps seamlessly
    ctx.drawImage(strip, (i + 0.5) * colW - strip.width / 2, off - strip.height);
    ctx.drawImage(strip, (i + 0.5) * colW - strip.width / 2, off);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

/**
 * Malevolent Shrine: no barrier, no walls. A skull-shrine of bone hanging
 * over everything, and the cuts never stop landing.
 */
export function drawShrine(ctx, W, H, amount, t) {
  const a = clamp(amount, 0, 1);
  if (a <= 0.004) return;
  const cx = W / 2, cy = H * 0.52;
  const S = Math.min(W, H);

  ctx.save();

  // blood grade
  ctx.globalCompositeOperation = 'multiply';
  const g = ctx.createRadialGradient(cx, cy, S * 0.12, cx, cy, S * 0.95);
  g.addColorStop(0, `rgba(${lerp(255, 190, a)},${lerp(255, 90, a)},${lerp(255, 80, a)},1)`);
  g.addColorStop(1, `rgba(${lerp(255, 60, a)},${lerp(255, 10, a)},${lerp(255, 14, a)},1)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  ctx.globalCompositeOperation = 'lighter';

  // bone arches rising behind
  ctx.strokeStyle = `rgba(235,220,200,${0.2 * a})`;
  ctx.lineWidth = Math.max(2, S * 0.012);
  for (let i = -3; i <= 3; i++) {
    const w = S * (0.2 + Math.abs(i) * 0.12);
    ctx.beginPath();
    ctx.moveTo(cx + i * S * 0.14, H);
    ctx.quadraticCurveTo(cx + i * S * 0.2, cy - S * 0.3, cx + i * S * 0.08, cy - S * 0.44);
    ctx.stroke();
  }

  // the skull, low and wide above the head
  const sy = cy - S * 0.36, sw = S * 0.3, sh = S * 0.22;
  ctx.fillStyle = `rgba(30,6,8,${0.55 * a})`;
  ctx.beginPath(); ctx.ellipse(cx, sy, sw, sh, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = `rgba(240,225,205,${0.32 * a})`;
  ctx.lineWidth = Math.max(2, S * 0.006);
  ctx.beginPath(); ctx.ellipse(cx, sy, sw, sh, 0, 0, TAU); ctx.stroke();
  // sockets
  for (const s of [-1, 1]) {
    const ex = cx + s * sw * 0.42, ey = sy - sh * 0.1;
    const eg = ctx.createRadialGradient(ex, ey, 0, ex, ey, sw * 0.3);
    eg.addColorStop(0, `rgba(255,70,40,${0.8 * a})`);
    eg.addColorStop(0.4, `rgba(180,20,10,${0.4 * a})`);
    eg.addColorStop(1, 'rgba(90,0,0,0)');
    ctx.fillStyle = eg;
    ctx.beginPath(); ctx.arc(ex, ey, sw * 0.3, 0, TAU); ctx.fill();
  }
  // teeth
  ctx.strokeStyle = `rgba(240,225,205,${0.3 * a})`;
  ctx.lineWidth = Math.max(1, S * 0.004);
  for (let i = -5; i <= 5; i++) {
    const tx = cx + i * sw * 0.16;
    ctx.beginPath();
    ctx.moveTo(tx, sy + sh * 0.55); ctx.lineTo(tx, sy + sh * 0.95);
    ctx.stroke();
  }

  // the cuts, everywhere, always
  ctx.lineCap = 'butt';
  for (let i = 0; i < 16; i++) {
    const seed = Math.sin(i * 12.9898 + Math.floor(t * 7) * 78.233) * 43758.5453;
    const f = seed - Math.floor(seed);
    const seed2 = Math.sin(i * 4.1414 + Math.floor(t * 7) * 21.11) * 2371.71;
    const f2 = seed2 - Math.floor(seed2);
    const x = f * W, y = f2 * H;
    const ang = f * TAU;
    const len = S * (0.08 + f2 * 0.2);
    ctx.strokeStyle = `rgba(255,${120 + f * 80 | 0},${90 + f2 * 60 | 0},${0.5 * a})`;
    ctx.lineWidth = Math.max(1, S * 0.004 * (0.5 + f2));
    ctx.beginPath();
    ctx.moveTo(x - Math.cos(ang) * len, y - Math.sin(ang) * len);
    ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    ctx.stroke();
  }
  ctx.restore();
}

/** The barrier sweeping out when a domain opens. */
export function drawDomainBurst(ctx, x, y, r, t01, col) {
  if (t01 <= 0 || t01 >= 1) return;
  const e = easeOutCubic(t01);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 1 - t01;
  ctx.strokeStyle = col;
  ctx.lineWidth = Math.max(2, r * 0.05 * (1 - t01));
  ctx.beginPath(); ctx.arc(x, y, r * e, 0, TAU); ctx.stroke();
  ctx.lineWidth = Math.max(1, r * 0.02 * (1 - t01));
  ctx.beginPath(); ctx.arc(x, y, r * e * 0.82, 0, TAU); ctx.stroke();
  ctx.restore();
}
