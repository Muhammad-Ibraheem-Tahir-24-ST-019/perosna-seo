/* =========================================================================
   nano.js - the nanotech suit.

   Not a cut to armour-on. A wavefront leaves the chest and crawls outward
   over your real body; particles run ahead of it, and plates lock down
   behind it. Coverage is driven by distance from the reactor, so the suit
   builds in the order it physically would.
   ========================================================================= */

import { clamp, lerp, rand, TAU } from './fx.js';
import { POSE, torsoVisible } from './stark.js';

function mid(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
function unit(x, y) { const m = Math.hypot(x, y) || 1; return { x: x / m, y: y / m }; }

/* A deterministic scatter, so plates do not jitter between frames. */
function hash(i) {
  const s = Math.sin(i * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Build the plate field for the current pose. Each plate carries its own
 * distance from the chest, which is what the wavefront tests against.
 */
function buildPlates(P) {
  const lsh = P[POSE.L_SH], rsh = P[POSE.R_SH];
  const neck = mid(lsh, rsh);
  const shoulderW = Math.hypot(lsh.x - rsh.x, lsh.y - rsh.y) || 1;
  const down = unit(-(lsh.y - rsh.y), lsh.x - rsh.x);
  const side = unit(lsh.x - rsh.x, lsh.y - rsh.y);

  const haveHips = P[POSE.L_HIP] && P[POSE.R_HIP] &&
    (P[POSE.L_HIP].visibility === undefined || P[POSE.L_HIP].visibility > 0.4);
  const hips = haveHips ? mid(P[POSE.L_HIP], P[POSE.R_HIP])
    : { x: neck.x + down.x * shoulderW * 1.25, y: neck.y + down.y * shoulderW * 1.25 };

  const chest = { x: lerp(neck.x, hips.x, 0.34), y: lerp(neck.y, hips.y, 0.34) };
  const plates = [];
  let n = 0;

  const put = (x, y, size) => {
    const d = Math.hypot(x - chest.x, y - chest.y) / shoulderW;
    plates.push({ x, y, size, d, seed: n++ });
  };

  // torso: a jittered grid across the trunk
  const COLS = 7, ROWS = 11;
  for (let r = 0; r < ROWS; r++) {
    const tv = r / (ROWS - 1);
    const halfW = shoulderW * (0.52 - tv * 0.12);
    const cy = { x: lerp(neck.x, hips.x, tv), y: lerp(neck.y, hips.y, tv) };
    for (let c = 0; c < COLS; c++) {
      const tu = (c / (COLS - 1) - 0.5) * 2;
      const jx = (hash(r * 31 + c) - 0.5) * 0.12;
      const jy = (hash(r * 17 + c * 5) - 0.5) * 0.12;
      put(cy.x + side.x * (tu + jx) * halfW + down.x * jy * shoulderW * 0.2,
          cy.y + side.y * (tu + jx) * halfW + down.y * jy * shoulderW * 0.2,
          shoulderW * 0.115);
    }
  }

  // limbs: plates strung along each bone
  const chains = [[POSE.L_SH, POSE.L_EL], [POSE.L_EL, POSE.L_WR],
                  [POSE.R_SH, POSE.R_EL], [POSE.R_EL, POSE.R_WR]];
  for (const [a, b] of chains) {
    const A = P[a], B = P[b];
    if (!A || !B) continue;
    if (B.visibility !== undefined && B.visibility < 0.35) continue;
    const steps = 7;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = lerp(A.x, B.x, t), y = lerp(A.y, B.y, t);
      const jitter = (hash(a * 97 + i) - 0.5) * shoulderW * 0.1;
      const n2 = unit(-(B.y - A.y), B.x - A.x);
      put(x + n2.x * jitter, y + n2.y * jitter, shoulderW * 0.1);
    }
  }

  return { plates, chest, shoulderW, neck, hips, side, down };
}

/**
 * @param amount 0..1 — how far the suit has spread
 */
export function drawNano(ctx, P, amount, t, fx) {
  const a = clamp(amount, 0, 1);
  if (a <= 0.005 || !torsoVisible(P)) return null;

  const rig = buildPlates(P);
  const { plates, chest, shoulderW } = rig;

  // the wavefront: how far from the chest the suit has reached
  const maxD = 4.2;
  const front = a * maxD;
  const band = 0.55;                  // how wide the "still forming" edge is

  ctx.save();

  for (const p of plates) {
    const lead = front - p.d;
    if (lead <= -band) continue;                   // not reached yet
    const solid = clamp(lead / band, 0, 1);        // 0 = forming, 1 = locked
    const s = p.size * (0.35 + solid * 0.65);
    const wob = solid < 1 ? (1 - solid) * p.size * 0.5 : 0;
    const x = p.x + (hash(p.seed) - 0.5) * wob;
    const y = p.y + (hash(p.seed * 3) - 0.5) * wob;

    // hexagonal plate
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const ang = (k / 6) * TAU + p.seed;
      const px = x + Math.cos(ang) * s, py = y + Math.sin(ang) * s;
      if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();

    if (solid > 0.55) {
      // locked down: red and gold plate
      const gold = hash(p.seed * 7) > 0.72;
      const g = ctx.createLinearGradient(x - s, y - s, x + s, y + s);
      if (gold) { g.addColorStop(0, '#8a5f0b'); g.addColorStop(0.5, '#ffe9a8');
                  g.addColorStop(1, '#a5750f'); }
      else { g.addColorStop(0, '#6d0f12'); g.addColorStop(0.45, '#d3262c');
             g.addColorStop(1, '#5a0b0e'); }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = clamp((solid - 0.55) / 0.45, 0, 1);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = 'rgba(20,6,6,0.5)';
      ctx.lineWidth = Math.max(0.5, s * 0.1);
      ctx.stroke();
    } else {
      // still assembling: hot, transparent, flickering
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.35 + solid * 0.5;
      ctx.fillStyle = `rgba(255,${150 + solid * 80 | 0},90,0.5)`;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,220,170,0.8)';
      ctx.lineWidth = Math.max(0.6, s * 0.16);
      ctx.stroke();
    }
  }

  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'lighter';

  // the wavefront itself, as a glowing ring travelling out from the reactor
  if (a < 1) {
    const r = front * shoulderW;
    const g = ctx.createRadialGradient(chest.x, chest.y, Math.max(1, r * 0.82),
                                       chest.x, chest.y, r * 1.18);
    g.addColorStop(0, 'rgba(255,150,60,0)');
    g.addColorStop(0.5, 'rgba(255,190,110,0.35)');
    g.addColorStop(1, 'rgba(255,140,50,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(chest.x, chest.y, r * 1.18, 0, TAU); ctx.fill();

    // motes racing ahead of the front
    if (fx && Math.random() < 0.9) {
      const ang = rand(0, TAU);
      const rr = r * rand(0.9, 1.25);
      fx.spark({
        x: chest.x + Math.cos(ang) * rr, y: chest.y + Math.sin(ang) * rr,
        vx: Math.cos(ang) * 90, vy: Math.sin(ang) * 90 - 30,
        life: rand(0.2, 0.5), size: rand(1, 2.4),
        col: 'rgba(255,200,130,1)', drag: 2.4,
      });
    }
  }

  // the reactor, which is the source of all of it
  const rr = shoulderW * 0.14;
  const pulse = 0.85 + Math.sin(t * 2.6) * 0.15;
  const rg = ctx.createRadialGradient(chest.x, chest.y, 0, chest.x, chest.y, rr * 3.4);
  rg.addColorStop(0, `rgba(255,255,255,${0.95 * a})`);
  rg.addColorStop(0.2, `rgba(190,245,255,${0.9 * a * pulse})`);
  rg.addColorStop(0.5, `rgba(70,190,255,${0.35 * a * pulse})`);
  rg.addColorStop(1, 'rgba(30,120,255,0)');
  ctx.fillStyle = rg;
  ctx.beginPath(); ctx.arc(chest.x, chest.y, rr * 3.4, 0, TAU); ctx.fill();

  ctx.restore();
  return rig;
}
