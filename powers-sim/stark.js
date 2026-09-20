/* =========================================================================
   stark.js - the body armour (built on pose landmarks) and the holographic
   workbench you grab out of the air and turn.
   ========================================================================= */

import { clamp, lerp, rand, TAU } from './fx.js';

const easeOutBack = (t) => 1 + 2.4 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2);
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

/* MediaPipe pose indices we use */
export const POSE = {
  NOSE: 0, L_SH: 11, R_SH: 12, L_EL: 13, R_EL: 14,
  L_WR: 15, R_WR: 16, L_HIP: 23, R_HIP: 24,
};

/** Is the torso actually visible enough to armour? */
export function torsoVisible(P) {
  if (!P) return false;
  for (const i of [POSE.L_SH, POSE.R_SH]) {
    if (!P[i] || (P[i].visibility !== undefined && P[i].visibility < 0.55)) return false;
  }
  return true;
}

function mid(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y }; }
function unit(v) { const m = Math.hypot(v.x, v.y) || 1; return { x: v.x / m, y: v.y / m }; }

function redGrad(ctx, x0, y0, x1, y1) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, '#5d0a0d');
  g.addColorStop(0.25, '#b81a20');
  g.addColorStop(0.48, '#e94b4b');
  g.addColorStop(0.62, '#9d1418');
  g.addColorStop(1, '#4a0709');
  return g;
}
function goldGrad(ctx, x0, y0, x1, y1) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, '#6b4506');
  g.addColorStop(0.28, '#dda823');
  g.addColorStop(0.5, '#ffe9a8');
  g.addColorStop(0.7, '#cf991c');
  g.addColorStop(1, '#5d3a04');
  return g;
}

/** A tapered plated limb segment from a to b. */
function limb(ctx, a, b, w0, w1, grad, seams) {
  const d = unit(sub(b, a));
  const n = { x: -d.y, y: d.x };
  const p = [
    { x: a.x + n.x * w0, y: a.y + n.y * w0 },
    { x: b.x + n.x * w1, y: b.y + n.y * w1 },
    { x: b.x - n.x * w1, y: b.y - n.y * w1 },
    { x: a.x - n.x * w0, y: a.y - n.y * w0 },
  ];
  ctx.fillStyle = grad(ctx, p[0].x, p[0].y, p[2].x, p[2].y);
  ctx.beginPath();
  ctx.moveTo(p[0].x, p[0].y);
  ctx.lineTo(p[1].x, p[1].y);
  ctx.lineTo(p[2].x, p[2].y);
  ctx.lineTo(p[3].x, p[3].y);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(20,6,6,0.55)';
  ctx.lineWidth = Math.max(1, w0 * 0.12);
  ctx.stroke();

  if (seams) {
    ctx.strokeStyle = 'rgba(255,220,150,0.35)';
    ctx.lineWidth = Math.max(1, w0 * 0.08);
    for (let i = 1; i <= seams; i++) {
      const t = i / (seams + 1);
      const w = lerp(w0, w1, t);
      const c = { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
      ctx.beginPath();
      ctx.moveTo(c.x + n.x * w, c.y + n.y * w);
      ctx.lineTo(c.x - n.x * w, c.y - n.y * w);
      ctx.stroke();
    }
  }
}

/**
 * The suit. `amount` 0..1 drives an assembly sequence: chest first, then
 * pauldrons, then arms, each flying in from outside and locking.
 */
export function drawArmor(ctx, P, amount, t, opts = {}) {
  const a = clamp(amount, 0, 1);
  if (a <= 0.01 || !torsoVisible(P)) return null;

  const lsh = P[POSE.L_SH], rsh = P[POSE.R_SH];
  const neck = mid(lsh, rsh);
  const shoulderW = Math.hypot(lsh.x - rsh.x, lsh.y - rsh.y) || 1;

  // hips are often out of frame; fall back to a proportional torso
  const haveHips = P[POSE.L_HIP] && P[POSE.R_HIP] &&
    (P[POSE.L_HIP].visibility === undefined || P[POSE.L_HIP].visibility > 0.4);
  const down = unit({ x: -(lsh.y - rsh.y), y: (lsh.x - rsh.x) });
  const hips = haveHips ? mid(P[POSE.L_HIP], P[POSE.R_HIP])
    : { x: neck.x + down.x * shoulderW * 1.25, y: neck.y + down.y * shoulderW * 1.25 };

  // staged assembly
  const stage = (from, to) => clamp((a - from) / (to - from), 0, 1);
  const sChest = easeOutBack(stage(0.00, 0.55));
  const sPauld = easeOutBack(stage(0.25, 0.80));
  const sArms  = easeOutBack(stage(0.45, 1.00));

  ctx.save();
  ctx.lineJoin = 'round';

  /* --- torso ----------------------------------------------------------- */
  ctx.save();
  ctx.globalAlpha = clamp(stage(0, 0.35) * 1.3, 0, 1);
  const drop = (1 - sChest) * shoulderW * 1.1;
  ctx.translate(down.x * -drop, down.y * -drop);

  const halfW = shoulderW * 0.52;
  const side = unit(sub(lsh, rsh));
  const corner = (p, s, w, o) => ({
    x: p.x + side.x * s * w + down.x * o,
    y: p.y + side.y * s * w + down.y * o,
  });
  const tl = corner(neck, 1, halfW, shoulderW * 0.06);
  const tr = corner(neck, -1, halfW, shoulderW * 0.06);
  const bl = corner(hips, 1, halfW * 0.72, 0);
  const br = corner(hips, -1, halfW * 0.72, 0);

  ctx.fillStyle = redGrad(ctx, tl.x, tl.y, br.x, br.y);
  ctx.beginPath();
  ctx.moveTo(tl.x, tl.y); ctx.lineTo(tr.x, tr.y);
  ctx.lineTo(br.x, br.y); ctx.lineTo(bl.x, bl.y);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(20,6,6,0.6)';
  ctx.lineWidth = Math.max(1, shoulderW * 0.02);
  ctx.stroke();

  // gold sternum panel
  const chest = { x: lerp(neck.x, hips.x, 0.34), y: lerp(neck.y, hips.y, 0.34) };
  const gl = corner(chest, 1, halfW * 0.5, -shoulderW * 0.16);
  const gr = corner(chest, -1, halfW * 0.5, -shoulderW * 0.16);
  const gl2 = corner(chest, 1, halfW * 0.34, shoulderW * 0.3);
  const gr2 = corner(chest, -1, halfW * 0.34, shoulderW * 0.3);
  ctx.fillStyle = goldGrad(ctx, gl.x, gl.y, gr2.x, gr2.y);
  ctx.beginPath();
  ctx.moveTo(gl.x, gl.y); ctx.lineTo(gr.x, gr.y);
  ctx.lineTo(gr2.x, gr2.y); ctx.lineTo(gl2.x, gl2.y);
  ctx.closePath(); ctx.fill();

  // abdominal bands
  ctx.strokeStyle = 'rgba(255,215,140,0.3)';
  ctx.lineWidth = Math.max(1, shoulderW * 0.015);
  for (let i = 1; i <= 4; i++) {
    const p = 0.45 + i * 0.12;
    const l = corner({ x: lerp(neck.x, hips.x, p), y: lerp(neck.y, hips.y, p) },
                     1, halfW * (0.82 - i * 0.03), 0);
    const r = corner({ x: lerp(neck.x, hips.x, p), y: lerp(neck.y, hips.y, p) },
                     -1, halfW * (0.82 - i * 0.03), 0);
    ctx.beginPath(); ctx.moveTo(l.x, l.y); ctx.lineTo(r.x, r.y); ctx.stroke();
  }

  /* --- arc reactor ----------------------------------------------------- */
  const rr = shoulderW * 0.14;
  const reactorOn = clamp(stage(0.3, 0.7), 0, 1);
  ctx.fillStyle = '#2b2f36';
  ctx.beginPath(); ctx.arc(chest.x, chest.y, rr * 1.35, 0, TAU); ctx.fill();
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const pulse = 0.85 + Math.sin(t * 2.6) * 0.15;
  const rg = ctx.createRadialGradient(chest.x, chest.y, 0, chest.x, chest.y, rr * 3.2);
  rg.addColorStop(0, `rgba(255,255,255,${0.95 * reactorOn})`);
  rg.addColorStop(0.2, `rgba(190,245,255,${0.9 * reactorOn * pulse})`);
  rg.addColorStop(0.45, `rgba(70,190,255,${0.4 * reactorOn * pulse})`);
  rg.addColorStop(1, 'rgba(30,120,255,0)');
  ctx.fillStyle = rg;
  ctx.beginPath(); ctx.arc(chest.x, chest.y, rr * 3.2, 0, TAU); ctx.fill();
  // the triangle inside
  ctx.strokeStyle = `rgba(230,250,255,${0.8 * reactorOn})`;
  ctx.lineWidth = Math.max(1, rr * 0.12);
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const ang = -Math.PI / 2 + (i / 3) * TAU;
    const px = chest.x + Math.cos(ang) * rr * 0.6;
    const py = chest.y + Math.sin(ang) * rr * 0.6;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath(); ctx.stroke();
  ctx.restore();
  ctx.restore();

  /* --- pauldrons ------------------------------------------------------- */
  for (const [sh, s] of [[lsh, 1], [rsh, -1]]) {
    ctx.save();
    ctx.globalAlpha = clamp(stage(0.25, 0.5) * 1.4, 0, 1);
    const off = (1 - sPauld) * shoulderW * 0.9 * s;
    ctx.translate(side.x * off, side.y * off);
    const r = shoulderW * 0.23;
    ctx.fillStyle = redGrad(ctx, sh.x - r, sh.y - r, sh.x + r, sh.y + r);
    ctx.beginPath();
    ctx.ellipse(sh.x, sh.y, r * 1.15, r, Math.atan2(down.y, down.x) + Math.PI / 2,
                0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,215,140,0.4)';
    ctx.lineWidth = Math.max(1, r * 0.12);
    ctx.stroke();
    ctx.restore();
  }

  /* --- arms ------------------------------------------------------------ */
  const pairs = [[POSE.L_SH, POSE.L_EL, POSE.L_WR], [POSE.R_SH, POSE.R_EL, POSE.R_WR]];
  for (const [si, ei, wi] of pairs) {
    const s = P[si], e = P[ei], w = P[wi];
    const okE = e && (e.visibility === undefined || e.visibility > 0.4);
    const okW = w && (w.visibility === undefined || w.visibility > 0.4);
    ctx.save();
    ctx.globalAlpha = clamp(stage(0.45, 0.72) * 1.4, 0, 1);
    const slide = (1 - sArms) * shoulderW * 0.7;
    ctx.translate(rand(-slide, slide) * 0.15, -slide);
    if (okE) limb(ctx, s, e, shoulderW * 0.16, shoulderW * 0.125, redGrad, 2);
    if (okE && okW) {
      limb(ctx, e, w, shoulderW * 0.13, shoulderW * 0.10, goldGrad, 3);
      // repulsor in the palm side of the gauntlet
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const rg2 = ctx.createRadialGradient(w.x, w.y, 0, w.x, w.y, shoulderW * 0.14);
      rg2.addColorStop(0, `rgba(210,250,255,${0.55 * a})`);
      rg2.addColorStop(1, 'rgba(60,170,255,0)');
      ctx.fillStyle = rg2;
      ctx.beginPath(); ctx.arc(w.x, w.y, shoulderW * 0.14, 0, TAU); ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  ctx.restore();
  return { chest, shoulderW, neck, hips };
}

/* ----------------------------------------------------------- hologram --- */

/** Wireframe schematic you can grab out of the air and turn. */
export class Hologram {
  constructor() {
    this.open = 0;
    this.rx = -0.35; this.ry = 0.6; this.rz = 0;
    this.scale = 1; this.spin = 0.25;
    this.grabbed = false;
    this.build();
  }

  build() {
    const V = [], E = [];
    const add = (x, y, z) => (V.push({ x, y, z }), V.length - 1);

    // lat/long sphere
    const LAT = 7, LON = 12, R = 1;
    const grid = [];
    for (let i = 1; i < LAT; i++) {
      const th = (i / LAT) * Math.PI;
      const row = [];
      for (let j = 0; j < LON; j++) {
        const ph = (j / LON) * TAU;
        row.push(add(R * Math.sin(th) * Math.cos(ph), R * Math.cos(th),
                     R * Math.sin(th) * Math.sin(ph)));
      }
      grid.push(row);
    }
    for (let i = 0; i < grid.length; i++) {
      for (let j = 0; j < LON; j++) {
        E.push([grid[i][j], grid[i][(j + 1) % LON]]);
        if (i < grid.length - 1) E.push([grid[i][j], grid[i + 1][j]]);
      }
    }
    // three orthogonal gimbal rings
    const ring = (ax) => {
      const first = V.length;
      const N = 30;
      for (let i = 0; i < N; i++) {
        const t = (i / N) * TAU;
        const c = Math.cos(t) * 1.45, s = Math.sin(t) * 1.45;
        if (ax === 0) add(0, c, s);
        else if (ax === 1) add(c, 0, s);
        else add(c, s, 0);
      }
      for (let i = 0; i < N; i++) E.push([first + i, first + ((i + 1) % N)]);
    };
    ring(0); ring(1); ring(2);

    // core
    const core = [];
    for (let i = 0; i < 6; i++) {
      const t = (i / 6) * TAU;
      core.push(add(Math.cos(t) * 0.32, Math.sin(t) * 0.32, 0));
    }
    for (let i = 0; i < 6; i++) E.push([core[i], core[(i + 1) % 6]]);
    for (let i = 0; i < 6; i++) E.push([core[i], core[(i + 3) % 6]]);

    this.V = V; this.E = E;
  }

  project(v, cx, cy, s) {
    const cx1 = Math.cos(this.rx), sx1 = Math.sin(this.rx);
    const cy1 = Math.cos(this.ry), sy1 = Math.sin(this.ry);
    let y = v.y * cx1 - v.z * sx1;
    let z = v.y * sx1 + v.z * cx1;
    let x = v.x * cy1 + z * sy1;
    z = -v.x * sy1 + z * cy1;
    const d = 4.2;
    const p = d / (d + z);
    return { x: cx + x * s * p, y: cy + y * s * p, p, z };
  }

  draw(ctx, cx, cy, size, t) {
    const a = clamp(this.open, 0, 1);
    if (a <= 0.01) return;
    const s = size * this.scale * easeOutCubic(a);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // projector cone from below
    const cone = ctx.createLinearGradient(cx, cy + s * 1.9, cx, cy - s * 0.4);
    cone.addColorStop(0, `rgba(90,210,255,${0.16 * a})`);
    cone.addColorStop(1, 'rgba(90,210,255,0)');
    ctx.fillStyle = cone;
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.12, cy + s * 1.9);
    ctx.lineTo(cx + s * 0.12, cy + s * 1.9);
    ctx.lineTo(cx + s * 1.5, cy - s * 0.3);
    ctx.lineTo(cx - s * 1.5, cy - s * 0.3);
    ctx.closePath(); ctx.fill();

    // edges, depth-faded
    ctx.lineWidth = Math.max(1, s * 0.006);
    for (const [i, j] of this.E) {
      const p = this.project(this.V[i], cx, cy, s);
      const q = this.project(this.V[j], cx, cy, s);
      const depth = clamp((p.p + q.p) / 2 - 0.55, 0, 1);
      ctx.strokeStyle = `rgba(120,225,255,${(0.14 + depth * 0.7) * a})`;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
    }

    // vertices
    for (const v of this.V) {
      const p = this.project(v, cx, cy, s);
      if (p.p < 0.85) continue;
      ctx.fillStyle = `rgba(215,250,255,${0.5 * a})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, s * 0.008, 0, TAU); ctx.fill();
    }

    // scan line sweeping the model
    const sy = cy + Math.sin(t * 1.4) * s * 1.3;
    const sg = ctx.createLinearGradient(0, sy - s * 0.09, 0, sy + s * 0.09);
    sg.addColorStop(0, 'rgba(150,235,255,0)');
    sg.addColorStop(0.5, `rgba(170,240,255,${0.3 * a})`);
    sg.addColorStop(1, 'rgba(150,235,255,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(cx - s * 1.6, sy - s * 0.09, s * 3.2, s * 0.18);

    // readout
    ctx.globalCompositeOperation = 'lighter';
    ctx.font = `${Math.max(9, Math.round(s * 0.075))}px ui-monospace, monospace`;
    ctx.fillStyle = `rgba(150,235,255,${0.75 * a})`;
    ctx.textAlign = 'left';
    const rows = [
      'MK L  ASSEMBLY',
      'ROT  ' + (this.ry * 57.3).toFixed(0).padStart(4) + '° / ' +
                (this.rx * 57.3).toFixed(0).padStart(4) + '°',
      'SCALE ' + this.scale.toFixed(2) + 'x',
      this.grabbed ? 'STATUS  LOCKED' : 'STATUS  IDLE',
    ];
    rows.forEach((r, i) => ctx.fillText(r, cx + s * 1.15, cy - s * 0.9 + i * s * 0.13));

    // bracket corners
    ctx.strokeStyle = `rgba(140,230,255,${0.5 * a})`;
    ctx.lineWidth = Math.max(1, s * 0.012);
    const b = s * 1.55, k = s * 0.22;
    for (const [sx2, sy2] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      ctx.beginPath();
      ctx.moveTo(cx + sx2 * b, cy + sy2 * b - sy2 * k);
      ctx.lineTo(cx + sx2 * b, cy + sy2 * b);
      ctx.lineTo(cx + sx2 * b - sx2 * k, cy + sy2 * b);
      ctx.stroke();
    }
    ctx.restore();
  }
}
