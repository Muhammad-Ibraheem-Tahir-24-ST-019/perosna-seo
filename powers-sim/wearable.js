/* =========================================================================
   wearable.js - things you put ON, not things that float.

   A floating hologram never reads as real, because nothing in the frame
   agrees with it. Armour built directly on the hand landmarks does: every
   plate is a real 3D box oriented along an actual finger bone, so it bends
   when you bend, turns when you turn your wrist, and gets bigger when you
   move your hand toward the lens - for free, because the landmarks already
   did that work.

   MediaPipe gives x, y in image space and z as depth relative to the wrist,
   at roughly the same scale as x. Scaling z by the same factor as x gives a
   usable right-handed space to build solid geometry in.
   ========================================================================= */

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/* ------------------------------------------------------------- vectors -- */

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const mul = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a) => Math.hypot(a.x, a.y, a.z);
function norm(a) { const m = len(a) || 1; return { x: a.x / m, y: a.y / m, z: a.z / m }; }
function cross(a, b) {
  return { x: a.y * b.z - a.z * b.y,
           y: a.z * b.x - a.x * b.z,
           z: a.x * b.y - a.y * b.x };
}

/* ------------------------------------------------------- the hand frame -- */

const WRIST = 0, I_MCP = 5, M_MCP = 9, R_MCP = 13, P_MCP = 17;

/**
 * An orthonormal basis sitting on the palm.
 *   ex - across the palm, pinky to index
 *   ey - along the hand, wrist to knuckles
 *   ez - the palm normal (out of the back of the hand)
 */
export function handFrame(L) {
  const w = L[WRIST], i = L[I_MCP], p = L[P_MCP], m = L[M_MCP];
  const across = sub(i, p);
  const along = sub(m, w);
  let ez = norm(cross(along, across));
  let ex = norm(across);
  // re-orthogonalise so a noisy frame cannot shear the geometry
  ex = norm(sub(ex, mul(ez, dot(ex, ez))));
  const ey = cross(ez, ex);
  const span = len(along) || 1;
  const width = len(across) || 1;
  return { o: w, ex, ey, ez, span, width,
           palm: { x: (w.x + m.x) / 2, y: (w.y + m.y) / 2, z: (w.z + m.z) / 2 } };
}

/** Which way is this hand facing the camera? 1 = back of hand toward us. */
export function facing(fr) { return fr.ez.z < 0 ? 1 : -1; }

/* --------------------------------------------------------- box builder -- */

/**
 * A solid, oriented box running from a to b.
 * `up` is the plate's thickness direction (the palm normal).
 */
function boneBox(a, b, halfW, halfT, up, taper = 1) {
  const dir = norm(sub(b, a));
  let side = cross(dir, up);
  if (len(side) < 1e-5) side = { x: 1, y: 0, z: 0 };
  side = norm(side);
  const nUp = norm(cross(side, dir));

  const corner = (base, sw, tw) => add(add(base, mul(side, sw)), mul(nUp, tw));
  const verts = [
    corner(a, -halfW, -halfT), corner(a, halfW, -halfT),
    corner(a, halfW, halfT), corner(a, -halfW, halfT),
    corner(b, -halfW * taper, -halfT * taper), corner(b, halfW * taper, -halfT * taper),
    corner(b, halfW * taper, halfT * taper), corner(b, -halfW * taper, halfT * taper),
  ];
  const faces = [
    [0, 1, 2, 3], [7, 6, 5, 4], [4, 5, 1, 0],
    [5, 6, 2, 1], [6, 7, 3, 2], [7, 4, 0, 3],
  ];
  return { verts, faces };
}

/** A flat plate through four corner points, given a thickness. */
function quadPlate(p0, p1, p2, p3, up, halfT) {
  const t = mul(up, halfT);
  const verts = [
    sub(p0, t), sub(p1, t), sub(p2, t), sub(p3, t),
    add(p0, t), add(p1, t), add(p2, t), add(p3, t),
  ];
  const faces = [
    [3, 2, 1, 0], [4, 5, 6, 7], [4, 0, 1, 5],
    [5, 1, 2, 6], [6, 2, 3, 7], [7, 3, 0, 4],
  ];
  return { verts, faces };
}

function ringMesh(center, ex, ey, ez, r, thick, halfT, seg) {
  const verts = [], faces = [];
  for (const rr of [r - thick, r + thick]) {
    for (const t of [-halfT, halfT]) {
      for (let i = 0; i < seg; i++) {
        const a = (i / seg) * TAU;
        verts.push(add(add(add(center, mul(ex, Math.cos(a) * rr)),
                           mul(ey, Math.sin(a) * rr)), mul(ez, t)));
      }
    }
  }
  const IN0 = 0, IN1 = seg, OUT0 = seg * 2, OUT1 = seg * 3;
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    faces.push([OUT0 + i, OUT0 + j, OUT1 + j, OUT1 + i]);
    faces.push([IN1 + i, IN1 + j, IN0 + j, IN0 + i]);
    faces.push([OUT1 + i, OUT1 + j, IN1 + j, IN1 + i]);
    faces.push([IN0 + i, IN0 + j, OUT0 + j, OUT0 + i]);
  }
  return { verts, faces };
}

/* ------------------------------------------------------------- palette -- */

export const SKINS = {
  mk: {
    label: 'MARK ARMOUR',
    plate: [215, 45, 50], trim: [255, 200, 90], deep: [90, 16, 20],
    glow: [190, 245, 255],
  },
  stealth: {
    label: 'STEALTH',
    plate: [58, 66, 80], trim: [120, 140, 165], deep: [22, 26, 34],
    glow: [140, 220, 255],
  },
  nano: {
    label: 'NANO GOLD',
    plate: [200, 150, 40], trim: [255, 228, 160], deep: [80, 55, 10],
    glow: [255, 220, 140],
  },
  web: {
    label: 'WEB-SHOOTER',
    plate: [190, 40, 48], trim: [40, 60, 120], deep: [70, 14, 18],
    glow: [235, 245, 255],
  },
};

/* ------------------------------------------------------- the gauntlet --- */

const CHAINS = [
  { name: 'thumb',  idx: [1, 2, 3, 4],   w: 0.115 },
  { name: 'index',  idx: [5, 6, 7, 8],   w: 0.105 },
  { name: 'middle', idx: [9, 10, 11, 12], w: 0.108 },
  { name: 'ring',   idx: [13, 14, 15, 16], w: 0.10 },
  { name: 'pinky',  idx: [17, 18, 19, 20], w: 0.088 },
];

/**
 * Build the armour for one hand, this frame.
 *
 * Returns parts in the same screen-space-plus-depth coordinates as the
 * landmarks, ready to be projected.
 */
export function buildGauntlet(L, skin, opts = {}) {
  const fr = handFrame(L);
  const S = fr.span;                 // wrist-to-knuckle length: the size unit
  const up = fr.ez;
  const parts = [];
  const thick = S * (opts.thickness ?? 0.085);
  const fit = opts.fit ?? 1.0;       // how far the plates sit off the skin

  const push = (name, m, col, o = {}) => {
    parts.push({ n: name, verts: m.verts, faces: m.faces, c: col,
                 alpha: o.alpha ?? 0.95, glow: o.glow ?? 0, metal: o.metal ?? 1 });
  };

  // lift everything slightly off the skin so it reads as worn, not painted
  const lift = mul(up, thick * 0.9 * fit);
  const L2 = L.map((p) => add(p, lift));

  /* ---- forearm cuff: extends back from the wrist, away from the hand --- */
  const backDir = norm(sub(L[WRIST], fr.palm));
  const cuffEnd = add(L2[WRIST], mul(backDir, S * (opts.cuff ?? 1.05)));
  push('forearm cuff',
       boneBox(L2[WRIST], cuffEnd, fr.width * 0.46, thick * 1.25, up, 1.06),
       skin.plate, { alpha: 0.96 });
  push('cuff trim',
       ringMesh(add(cuffEnd, mul(backDir, -S * 0.06)), fr.ex, fr.ey, up,
                fr.width * 0.46, thick * 0.55, thick * 0.9, 14),
       skin.trim, { alpha: 0.95 });
  push('wrist ring',
       ringMesh(L2[WRIST], fr.ex, fr.ey, up, fr.width * 0.44, thick * 0.5,
                thick * 0.8, 14),
       skin.trim, { alpha: 0.95 });

  /* ---- back-of-hand plate, spanning the knuckles ---------------------- */
  const wIn = (a, b, t) => add(mul(a, 1 - t), mul(b, t));
  const backPlate = quadPlate(
    wIn(L2[WRIST], L2[P_MCP], 0.12), wIn(L2[WRIST], L2[I_MCP], 0.12),
    add(L2[I_MCP], mul(fr.ey, S * 0.06)), add(L2[P_MCP], mul(fr.ey, S * 0.06)),
    up, thick * 1.1);
  push('hand plate', backPlate, skin.plate, { alpha: 0.96 });

  // a gold spine down the middle of it
  const spine = quadPlate(
    wIn(L2[WRIST], L2[M_MCP], 0.08), add(wIn(L2[WRIST], L2[M_MCP], 0.08), mul(fr.ex, S * 0.09)),
    add(add(L2[M_MCP], mul(fr.ey, S * 0.05)), mul(fr.ex, S * 0.09)),
    add(L2[M_MCP], mul(fr.ey, S * 0.05)),
    up, thick * 1.35);
  push('dorsal spine', spine, skin.trim, { alpha: 0.95 });

  /* ---- knuckle caps ---------------------------------------------------- */
  for (const idx of [I_MCP, M_MCP, R_MCP, P_MCP]) {
    push('knuckle',
         ringMesh(add(L2[idx], mul(up, thick * 0.2)), fr.ex, fr.ey, up,
                  S * 0.085, S * 0.03, thick * 0.85, 8),
         skin.trim, { alpha: 0.95 });
  }

  /* ---- finger segments: one plate per real bone ------------------------ */
  for (const ch of CHAINS) {
    for (let k = 0; k < 3; k++) {
      const a = L2[ch.idx[k]], b = L2[ch.idx[k + 1]];
      const hw = S * ch.w * (1 - k * 0.14);
      const ht = thick * (0.92 - k * 0.12);
      // the last segment tapers to the fingertip
      push(`${ch.name} ${k === 0 ? 'proximal' : k === 1 ? 'middle' : 'distal'}`,
           boneBox(a, b, hw, ht, up, k === 2 ? 0.62 : 0.9),
           k === 1 ? skin.trim : skin.plate, { alpha: 0.95 });
      // a joint collar at every knuckle
      if (k < 2) {
        push('joint',
             ringMesh(b, fr.ex, fr.ey, up, hw * 1.12, S * 0.018, ht * 0.95, 7),
             skin.deep, { alpha: 0.9 });
      }
    }
  }

  /* ---- the repulsor, in the middle of the palm -------------------------- */
  const palmSide = mul(up, -thick * 1.2 * fit);
  const palmC = add(fr.palm, palmSide);
  push('repulsor housing',
       ringMesh(palmC, fr.ex, fr.ey, mul(up, -1), S * 0.2, S * 0.05, thick * 0.9, 12),
       skin.trim, { alpha: 0.95 });
  push('repulsor',
       ringMesh(palmC, fr.ex, fr.ey, mul(up, -1), S * 0.1, S * 0.1, thick * 0.55, 12),
       skin.glow, { alpha: 0.85, glow: 1 });

  return { parts, frame: fr, unit: S, palmC };
}

/* ------------------------------------------------------------ renderer -- */

/**
 * Project and draw a wearable. Points are already in screen space with a
 * depth channel, so this only has to apply a weak perspective around the
 * hand and paint the faces back to front.
 */
export function drawWearable(ctx, built, opts = {}) {
  const { parts, frame, unit } = built;
  const f = opts.focal ?? 1100;
  const cz = frame.o.z;
  const cx = frame.palm.x, cy = frame.palm.y;
  const light = opts.light || { x: -0.35, y: -0.55, z: -0.75 };
  const alpha = clamp(opts.alpha ?? 1, 0, 1);
  if (alpha <= 0.01) return;

  const faces = [];
  const glows = [];

  for (const p of parts) {
    const pv = new Array(p.verts.length);
    for (let i = 0; i < pv.length; i++) {
      const q = p.verts[i];
      const s = f / (f + (q.z - cz));
      pv[i] = { x: cx + (q.x - cx) * s, y: cy + (q.y - cy) * s, z: q.z, s };
    }
    for (const fc of p.faces) {
      // 3D normal, for lighting
      const A = p.verts[fc[0]], B = p.verts[fc[1]], C = p.verts[fc[2]];
      const n = norm(cross(sub(B, A), sub(C, A)));
      const a2 = pv[fc[0]], b2 = pv[fc[1]], c2 = pv[fc[2]];
      // screen winding, for back-face rejection
      const wind = (b2.x - a2.x) * (c2.y - a2.y) - (b2.y - a2.y) * (c2.x - a2.x);
      if (wind >= 0) continue;
      let z = 0;
      for (const i of fc) z += p.verts[i].z;
      z /= fc.length;
      const lam = clamp(-dot(n, light), 0, 1);
      const spec = Math.pow(lam, 14) * p.metal;
      faces.push({ fc, pv, z, c: p.c, lam, spec, alpha: p.alpha, glow: p.glow });
    }
    if (p.glow > 0) {
      let sx = 0, sy = 0;
      for (const q of pv) { sx += q.x; sy += q.y; }
      glows.push({ x: sx / pv.length, y: sy / pv.length, c: p.c, g: p.glow,
                   r: unit * 0.55 });
    }
  }

  faces.sort((a, b) => b.z - a.z);

  ctx.save();
  ctx.globalAlpha = alpha;
  for (const fa of faces) {
    const k = 0.26 + fa.lam * 0.85;
    const r = clamp(fa.c[0] * k + fa.spec * 190, 0, 255) | 0;
    const g = clamp(fa.c[1] * k + fa.spec * 190, 0, 255) | 0;
    const b = clamp(fa.c[2] * k + fa.spec * 190, 0, 255) | 0;
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    const pv = fa.pv, idx = fa.fc;
    ctx.beginPath();
    ctx.moveTo(pv[idx[0]].x, pv[idx[0]].y);
    for (let i = 1; i < idx.length; i++) ctx.lineTo(pv[idx[i]].x, pv[idx[i]].y);
    ctx.closePath();
    ctx.fill();
    // a thin darker seam keeps neighbouring plates from merging into a blob
    ctx.strokeStyle = 'rgba(0,0,0,0.30)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }

  ctx.globalCompositeOperation = 'lighter';
  for (const gl of glows) {
    const rg = ctx.createRadialGradient(gl.x, gl.y, 0, gl.x, gl.y, gl.r);
    rg.addColorStop(0, `rgba(255,255,255,${0.85 * gl.g * alpha})`);
    rg.addColorStop(0.28, `rgba(${gl.c[0]},${gl.c[1]},${gl.c[2]},${0.6 * gl.g * alpha})`);
    rg.addColorStop(1, `rgba(${gl.c[0]},${gl.c[1]},${gl.c[2]},0)`);
    ctx.fillStyle = rg;
    ctx.beginPath(); ctx.arc(gl.x, gl.y, gl.r, 0, TAU); ctx.fill();
  }
  ctx.restore();
}

/** Face count, for the HUD. */
export function gauntletFaceCount(built) {
  let n = 0;
  for (const p of built.parts) n += p.faces.length;
  return n;
}
