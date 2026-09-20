/* =========================================================================
   ar.js - the holographic workbench.

   A small 3D engine (no WebGL, just projected geometry on the 2D canvas)
   plus the grab/turn/scale/pull-apart interaction that drives it. Models are
   built from parts, and every part knows which way it flies when you pull
   the thing open.
   ========================================================================= */

import { clamp, lerp, rand, TAU } from './fx.js';

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);

/* ------------------------------------------------------------- 3D maths -- */

export const v3 = (x, y, z) => ({ x, y, z });

function rot(p, rx, ry, rz) {
  let { x, y, z } = p;
  // Z
  if (rz) { const c = Math.cos(rz), s = Math.sin(rz);
            const nx = x * c - y * s; y = x * s + y * c; x = nx; }
  // X
  if (rx) { const c = Math.cos(rx), s = Math.sin(rx);
            const ny = y * c - z * s; z = y * s + z * c; y = ny; }
  // Y
  if (ry) { const c = Math.cos(ry), s = Math.sin(ry);
            const nx = x * c + z * s; z = -x * s + z * c; x = nx; }
  return { x, y, z };
}

/** Perspective projection. Returns screen x/y plus the depth scale. */
function project(p, cx, cy, unit, dist) {
  const s = dist / (dist + p.z);
  return { x: cx + p.x * unit * s, y: cy + p.y * unit * s, s, z: p.z };
}

/* ------------------------------------------------------- geometry makers -- */

function ring(radius, segs, axis, offset = 0) {
  const verts = [], edges = [];
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * TAU;
    const c = Math.cos(a) * radius, s = Math.sin(a) * radius;
    if (axis === 'x') verts.push(v3(offset, c, s));
    else if (axis === 'y') verts.push(v3(c, offset, s));
    else verts.push(v3(c, s, offset));
    edges.push([i, (i + 1) % segs]);
  }
  return { verts, edges };
}

function tube(r, len, segs, axis = 'z') {
  const a = ring(r, segs, axis, -len / 2);
  const b = ring(r, segs, axis, len / 2);
  const verts = a.verts.concat(b.verts);
  const edges = a.edges.concat(b.edges.map(([i, j]) => [i + segs, j + segs]));
  const faces = [];
  for (let i = 0; i < segs; i++) {
    edges.push([i, i + segs]);
    faces.push([i, (i + 1) % segs, ((i + 1) % segs) + segs, i + segs]);
  }
  return { verts, edges, faces };
}

function box(w, h, d) {
  const x = w / 2, y = h / 2, z = d / 2;
  const verts = [
    v3(-x, -y, -z), v3(x, -y, -z), v3(x, y, -z), v3(-x, y, -z),
    v3(-x, -y, z), v3(x, -y, z), v3(x, y, z), v3(-x, y, z),
  ];
  const edges = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],
                 [0,4],[1,5],[2,6],[3,7]];
  const faces = [[0,1,2,3],[4,5,6,7],[0,1,5,4],[2,3,7,6],[1,2,6,5],[0,3,7,4]];
  return { verts, edges, faces };
}

function sphere(r, lat, lon) {
  const verts = [], edges = [], grid = [];
  for (let i = 1; i < lat; i++) {
    const th = (i / lat) * Math.PI, row = [];
    for (let j = 0; j < lon; j++) {
      const ph = (j / lon) * TAU;
      row.push(verts.length);
      verts.push(v3(r * Math.sin(th) * Math.cos(ph), r * Math.cos(th),
                    r * Math.sin(th) * Math.sin(ph)));
    }
    grid.push(row);
  }
  for (let i = 0; i < grid.length; i++) {
    for (let j = 0; j < lon; j++) {
      edges.push([grid[i][j], grid[i][(j + 1) % lon]]);
      if (i < grid.length - 1) edges.push([grid[i][j], grid[i + 1][j]]);
    }
  }
  return { verts, edges, faces: [] };
}

function helix(r, turns, steps, len) {
  const verts = [], edges = [];
  for (let s = 0; s < 2; s++) {
    const base = verts.length;
    for (let i = 0; i <= steps; i++) {
      const p = i / steps, a = p * TAU * turns + s * Math.PI;
      verts.push(v3(Math.cos(a) * r, (p - 0.5) * len, Math.sin(a) * r));
      if (i) edges.push([base + i - 1, base + i]);
    }
  }
  for (let i = 0; i <= steps; i += 2) edges.push([i, i + steps + 1]);   // rungs
  return { verts, edges, faces: [] };
}

function grid(size, n, y) {
  const verts = [], edges = [];
  for (let i = 0; i <= n; i++) {
    const p = (i / n - 0.5) * size;
    const a = verts.length;
    verts.push(v3(p, y, -size / 2), v3(p, y, size / 2));
    verts.push(v3(-size / 2, y, p), v3(size / 2, y, p));
    edges.push([a, a + 1], [a + 2, a + 3]);
  }
  return { verts, edges, faces: [] };
}

function shift(mesh, dx, dy, dz) {
  return { ...mesh, verts: mesh.verts.map((p) => v3(p.x + dx, p.y + dy, p.z + dz)) };
}
function scaleMesh(mesh, sx, sy = sx, sz = sx) {
  return { ...mesh, verts: mesh.verts.map((p) => v3(p.x * sx, p.y * sy, p.z * sz)) };
}

/* ----------------------------------------------------------- the models -- */
/* Each part carries `dir`: the way it travels when you pull the model open. */

const CY = '150,235,255', GOLD = '255,205,110', RED = '255,110,110',
      GRN = '150,255,180', VIO = '200,160,255';

function arcReactor() {
  return {
    name: 'ARC REACTOR', scale: 1,
    parts: [
      { n: 'housing', m: tube(1.0, 0.34, 20), dir: v3(0, 0, 0), c: CY, a: 0.10 },
      { n: 'outer coil', m: ring(0.86, 10, 'z', 0).verts ? ringPart(0.86, 10) : null,
        dir: v3(0, 0, -0.9), c: CY, a: 0.16 },
      { n: 'stator', m: ring(0.62, 24, 'z', 0), dir: v3(0, 0, 0.9), c: GOLD, a: 0.2 },
      { n: 'core', m: sphere(0.3, 6, 10), dir: v3(0, 0.9, 0), c: '255,255,255', a: 0.3 },
      { n: 'mount', m: ring(1.12, 6, 'z', 0), dir: v3(0, -0.9, 0), c: CY, a: 0.14 },
    ].filter((p) => p.m),
  };
}
function ringPart(r, n) {
  // a ring of little coil boxes
  const verts = [], edges = [], faces = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const b = shift(box(0.16, 0.16, 0.22), Math.cos(a) * r, Math.sin(a) * r, 0);
    const off = verts.length;
    verts.push(...b.verts);
    edges.push(...b.edges.map(([x, y]) => [x + off, y + off]));
    faces.push(...b.faces.map((f) => f.map((x) => x + off)));
  }
  return { verts, edges, faces };
}

function nanoCore() {
  return {
    name: 'NANO CORE', scale: 1,
    parts: [
      { n: 'shell', m: sphere(1.15, 8, 14), dir: v3(0, 0, 0), c: CY, a: 0.10 },
      { n: 'lattice', m: sphere(0.8, 5, 8), dir: v3(0.9, 0.5, 0), c: GOLD, a: 0.16 },
      { n: 'cage', m: ring(1.15, 4, 'y', 0), dir: v3(-0.9, 0.5, 0), c: CY, a: 0.16 },
      { n: 'core', m: box(0.42, 0.42, 0.42), dir: v3(0, -1.0, 0), c: '255,255,255', a: 0.3 },
      { n: 'emitter', m: tube(0.2, 1.8, 8, 'y'), dir: v3(0, 0, 1.0), c: VIO, a: 0.2 },
    ],
  };
}

function helmetModel() {
  const skull = sphere(1.0, 8, 14);
  const jaw = scaleMesh(shift(sphere(0.72, 5, 10), 0, 0.62, 0.12), 1, 0.7, 1);
  return {
    name: 'MK HELMET', scale: 1,
    parts: [
      { n: 'skull', m: skull, dir: v3(0, -0.9, 0), c: RED, a: 0.12 },
      { n: 'faceplate', m: scaleMesh(shift(sphere(0.92, 6, 12), 0, 0, -0.18), 1, 1.1, 0.7),
        dir: v3(0, 0, -1.1), c: GOLD, a: 0.18 },
      { n: 'jaw', m: jaw, dir: v3(0, 1.0, 0), c: GOLD, a: 0.16 },
      { n: 'optics', m: shift(box(1.3, 0.16, 0.2), 0, -0.2, -0.78),
        dir: v3(0, 0, -1.6), c: '190,250,255', a: 0.4 },
    ],
  };
}

function repulsorEngine() {
  return {
    name: 'REPULSOR', scale: 1,
    parts: [
      { n: 'barrel', m: tube(0.7, 1.4, 16, 'z'), dir: v3(0, 0, 0), c: CY, a: 0.10 },
      { n: 'focus ring', m: ring(0.9, 18, 'z', -0.75), dir: v3(0, 0, -1.1), c: GOLD, a: 0.2 },
      { n: 'coils', m: ringPart(0.5, 8), dir: v3(1.0, 0, 0), c: CY, a: 0.16 },
      { n: 'feed', m: tube(0.22, 1.1, 8, 'y'), dir: v3(0, 1.0, 0), c: RED, a: 0.18 },
      { n: 'emitter', m: sphere(0.34, 5, 8), dir: v3(0, 0, -1.7), c: '255,255,255', a: 0.3 },
    ],
  };
}

function webShooter() {
  return {
    name: 'WEB-SHOOTER', scale: 1,
    parts: [
      { n: 'cuff', m: tube(0.85, 0.7, 16, 'x'), dir: v3(0, 0, 0), c: RED, a: 0.12 },
      { n: 'cartridges', m: ringPart(0.55, 6), dir: v3(0, -1.0, 0), c: CY, a: 0.16 },
      { n: 'nozzle', m: tube(0.18, 0.6, 8, 'z'), dir: v3(0, 0, -1.2), c: GOLD, a: 0.2 },
      { n: 'trigger', m: box(0.3, 0.2, 0.4), dir: v3(0, 1.0, 0), c: '255,255,255', a: 0.24 },
    ],
  };
}

function dnaModel() {
  return {
    name: 'GENOME', scale: 1,
    parts: [
      { n: 'strand A/B', m: helix(0.6, 2.4, 46, 2.6), dir: v3(0, 0, 0), c: GRN, a: 0.16 },
      { n: 'shell', m: sphere(1.15, 6, 12), dir: v3(0.9, 0, 0), c: CY, a: 0.08 },
      { n: 'marker', m: box(0.3, 0.3, 0.3), dir: v3(-0.9, 0.6, 0), c: GOLD, a: 0.26 },
    ],
  };
}

function towerModel() {
  const blocks = { verts: [], edges: [], faces: [] };
  let h = 1.6;
  for (let i = 0; i < 5; i++) {
    const w = 0.9 - i * 0.13;
    const b = shift(box(w, h / 5, w), 0, 0.8 - (i * h) / 5 - h / 10, 0);
    const off = blocks.verts.length;
    blocks.verts.push(...b.verts);
    blocks.edges.push(...b.edges.map(([x, y]) => [x + off, y + off]));
    blocks.faces.push(...b.faces.map((f) => f.map((x) => x + off)));
  }
  return {
    name: 'TOWER', scale: 1,
    parts: [
      { n: 'structure', m: blocks, dir: v3(0, -0.9, 0), c: CY, a: 0.10 },
      { n: 'ground grid', m: grid(3.2, 8, 0.95), dir: v3(0, 0.8, 0), c: CY, a: 0.10 },
      { n: 'beacon', m: sphere(0.18, 4, 8), dir: v3(0, -1.6, 0), c: '255,255,255', a: 0.35 },
      { n: 'ring', m: ring(1.3, 24, 'y', 0.2), dir: v3(0.9, 0, 0), c: GOLD, a: 0.16 },
    ],
  };
}

export const MODEL_LIST = [
  arcReactor, nanoCore, helmetModel, repulsorEngine, webShooter, dnaModel, towerModel,
];

/* ------------------------------------------------------------- the scene -- */

export class Workbench {
  constructor() {
    this.open = 0;              // 0..1 presence
    this.index = 0;
    this.model = MODEL_LIST[0]();
    this.rx = -0.25; this.ry = 0.6; this.rz = 0;
    this.spin = 0.3;
    this.scale = 1;
    this.explode = 0;
    this.pos = { x: 0, y: 0 };  // offset from centre, in screen px
    this.grabbed = false;
    this.twoHand = false;
    this.swap = 0;              // model-change animation
    this.label = '';
    this.hint = '';
  }

  setModel(i) {
    this.index = ((i % MODEL_LIST.length) + MODEL_LIST.length) % MODEL_LIST.length;
    this.model = MODEL_LIST[this.index]();
    this.swap = 1;
    this.label = this.model.name;
  }

  update(dt) {
    this.swap = Math.max(0, this.swap - dt * 1.6);
    if (!this.grabbed) this.ry += dt * this.spin;
    // ease back toward centre when let go
    if (!this.grabbed) {
      this.pos.x = lerp(this.pos.x, 0, 1 - Math.exp(-2.2 * dt));
      this.pos.y = lerp(this.pos.y, 0, 1 - Math.exp(-2.2 * dt));
    }
  }

  /**
   * Draw the model. `size` is the on-screen radius of one world unit.
   */
  draw(ctx, cx, cy, size, t) {
    const a = clamp(this.open, 0, 1);
    if (a <= 0.01) return;
    const appear = easeOutCubic(a);
    const unit = size * this.scale * appear;
    const ox = cx + this.pos.x, oy = cy + this.pos.y;
    const dist = 5.2;
    const swapWobble = this.swap * this.swap;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    this.drawPedestal(ctx, ox, oy, unit, a, t);

    // collect every face and edge with its depth, then paint back to front
    const faces = [], lines = [];
    for (const part of this.model.parts) {
      const ex = this.explode * 1.5 + swapWobble * 2.2;
      const d = part.dir;
      const px = d.x * ex, py = d.y * ex, pz = d.z * ex;
      const pv = part.m.verts.map((p) => {
        const r = rot(v3(p.x + px, p.y + py, p.z + pz), this.rx, this.ry, this.rz);
        return project(r, ox, oy, unit, dist);
      });
      const alpha = a * (1 - swapWobble * 0.6);
      for (const f of (part.m.faces || [])) {
        let z = 0;
        for (const i of f) z += pv[i].z;
        faces.push({ pts: f.map((i) => pv[i]), z: z / f.length, c: part.c,
                     a: part.a * alpha });
      }
      for (const [i, j] of part.m.edges) {
        lines.push({ p: pv[i], q: pv[j], z: (pv[i].z + pv[j].z) / 2,
                     c: part.c, a: alpha });
      }
      part._screen = pv;
    }

    faces.sort((A, B) => B.z - A.z);
    for (const f of faces) {
      ctx.fillStyle = `rgba(${f.c},${f.a})`;
      ctx.beginPath();
      ctx.moveTo(f.pts[0].x, f.pts[0].y);
      for (let i = 1; i < f.pts.length; i++) ctx.lineTo(f.pts[i].x, f.pts[i].y);
      ctx.closePath(); ctx.fill();
    }

    lines.sort((A, B) => B.z - A.z);
    ctx.lineCap = 'round';
    for (const l of lines) {
      const depth = clamp(1 - (l.z + 1.6) / 3.6, 0.15, 1);
      ctx.strokeStyle = `rgba(${l.c},${(0.2 + depth * 0.7) * l.a})`;
      ctx.lineWidth = Math.max(0.6, unit * 0.007 * (0.5 + depth));
      ctx.beginPath();
      ctx.moveTo(l.p.x, l.p.y); ctx.lineTo(l.q.x, l.q.y);
      ctx.stroke();
    }

    // vertex sparkle on the nearest points
    for (const part of this.model.parts) {
      if (!part._screen) continue;
      for (let i = 0; i < part._screen.length; i += 3) {
        const p = part._screen[i];
        if (p.s < 1.02) continue;
        ctx.fillStyle = `rgba(230,250,255,${0.35 * a})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, unit * 0.008, 0, TAU); ctx.fill();
      }
    }

    // part labels appear once you pull it open
    if (this.explode > 0.12) {
      ctx.font = `${Math.max(8, Math.round(unit * 0.075))}px ui-monospace, monospace`;
      ctx.textAlign = 'center';
      for (const part of this.model.parts) {
        if (!part._screen || !part._screen.length) continue;
        let sx = 0, sy = 0;
        for (const p of part._screen) { sx += p.x; sy += p.y; }
        sx /= part._screen.length; sy /= part._screen.length;
        ctx.fillStyle = `rgba(190,240,255,${0.65 * a * clamp(this.explode * 2, 0, 1)})`;
        ctx.fillText(part.n, sx, sy);
      }
    }

    this.drawFrame(ctx, ox, oy, unit, a, t);
    ctx.restore();
  }

  drawPedestal(ctx, cx, cy, unit, a, t) {
    // projector cone and floor ring, so it looks emitted rather than pasted
    const base = cy + unit * 1.9;
    const cone = ctx.createLinearGradient(cx, base, cx, cy - unit * 0.4);
    cone.addColorStop(0, `rgba(90,210,255,${0.16 * a})`);
    cone.addColorStop(1, 'rgba(90,210,255,0)');
    ctx.fillStyle = cone;
    ctx.beginPath();
    ctx.moveTo(cx - unit * 0.14, base);
    ctx.lineTo(cx + unit * 0.14, base);
    ctx.lineTo(cx + unit * 1.7, cy - unit * 0.3);
    ctx.lineTo(cx - unit * 1.7, cy - unit * 0.3);
    ctx.closePath(); ctx.fill();

    ctx.strokeStyle = `rgba(120,225,255,${0.4 * a})`;
    ctx.lineWidth = Math.max(1, unit * 0.012);
    for (let k = 0; k < 3; k++) {
      const p = ((t * 0.5 + k / 3) % 1);
      ctx.globalAlpha = (1 - p) * a;
      ctx.beginPath();
      ctx.ellipse(cx, base, unit * (0.3 + p * 1.4), unit * (0.09 + p * 0.4), 0, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  drawFrame(ctx, cx, cy, unit, a, t) {
    const b = unit * 1.75, k = unit * 0.24;
    ctx.strokeStyle = `rgba(140,230,255,${(this.grabbed ? 0.85 : 0.45) * a})`;
    ctx.lineWidth = Math.max(1, unit * 0.014);
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      ctx.beginPath();
      ctx.moveTo(cx + sx * b, cy + sy * b - sy * k);
      ctx.lineTo(cx + sx * b, cy + sy * b);
      ctx.lineTo(cx + sx * b - sx * k, cy + sy * b);
      ctx.stroke();
    }

    ctx.font = `${Math.max(9, Math.round(unit * 0.085))}px ui-monospace, monospace`;
    ctx.textAlign = 'left';
    ctx.fillStyle = `rgba(150,235,255,${0.8 * a})`;
    const rows = [
      this.model.name,
      'ROT  ' + ((this.ry * 57.3) % 360).toFixed(0).padStart(4) + '°',
      'SCALE ' + this.scale.toFixed(2) + 'x',
      'OPEN  ' + Math.round(this.explode * 100) + '%',
      this.grabbed ? (this.twoHand ? 'TWO-HAND' : 'HELD') : 'IDLE',
    ];
    rows.forEach((r, i) => ctx.fillText(r, cx + b + unit * 0.08,
                                        cy - b + unit * 0.14 + i * unit * 0.13));
    if (this.hint) {
      ctx.textAlign = 'center';
      ctx.fillStyle = `rgba(150,235,255,${0.5 * a})`;
      ctx.fillText(this.hint, cx, cy + b + unit * 0.22);
    }
  }
}

/* --------------------------------------------------------- interaction --- */

/**
 * Drive the workbench from the tracked hands.
 *
 *  - one pinched hand   : drag to move, and turn it as you drag
 *  - two pinched hands  : spread to scale, twist to roll, and pull apart
 *                         along the view to open the model up
 *  - a fist             : let go
 */
export function driveWorkbench(wb, hands, dt, cfg) {
  const pinched = hands.filter((h) => h.active && h.gesture === 'PINCH');
  wb.twoHand = pinched.length >= 2;

  if (pinched.length >= 2) {
    const [a, b] = pinched;
    const dx = b.palm.x - a.palm.x, dy = b.palm.y - a.palm.y;
    const d = Math.hypot(dx, dy);
    const ang = Math.atan2(dy, dx);

    if (wb._lastD) {
      // spreading the hands scales it up
      wb.scale = clamp(wb.scale * (1 + (d - wb._lastD) * cfg.scaleGain), 0.35, 3.2);
      // twisting rolls it
      let dA = ang - wb._lastA;
      while (dA > Math.PI) dA -= TAU;
      while (dA < -Math.PI) dA += TAU;
      wb.rz += dA;
      // ...and the same spread, held open, pulls the model apart
      wb.explode = clamp(wb.explode + (d - wb._lastD) * cfg.explodeGain, 0, 1);
    }
    wb._lastD = d; wb._lastA = ang;
    wb.pos.x = lerp(wb.pos.x, (a.palm.x + b.palm.x) / 2 - wb._cx, 0.25);
    wb.pos.y = lerp(wb.pos.y, (a.palm.y + b.palm.y) / 2 - wb._cy, 0.25);
    wb.grabbed = true;
    return;
  }
  wb._lastD = 0; wb._lastA = 0;

  if (pinched.length === 1) {
    const h = pinched[0];
    wb.grabbed = true;
    if (wb._grabX === undefined || !wb._wasGrabbed) {
      wb._grabX = h.palm.x; wb._grabY = h.palm.y;
      wb._baseX = wb.pos.x; wb._baseY = wb.pos.y;
    }
    // drag moves it; the horizontal component also spins it, which is what
    // makes it feel like a physical object rather than a sprite
    wb.pos.x = lerp(wb.pos.x, wb._baseX + (h.palm.x - wb._grabX), 0.3);
    wb.pos.y = lerp(wb.pos.y, wb._baseY + (h.palm.y - wb._grabY), 0.3);
    wb.ry += h.vel.x * cfg.rotateGain * dt;
    wb.rx = clamp(wb.rx - h.vel.y * cfg.rotateGain * dt, -1.35, 1.35);
    wb._wasGrabbed = true;
    return;
  }

  wb._wasGrabbed = false;
  wb.grabbed = false;

  // an open palm sweeping across closes the model back up
  const opened = hands.find((h) => h.active && h.gesture === 'OPEN');
  if (opened && wb.explode > 0) {
    wb.explode = Math.max(0, wb.explode - dt * 0.8);
  }
}
