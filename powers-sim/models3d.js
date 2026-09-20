/* =========================================================================
   models3d.js - solid geometry for the AR lab.

   Real meshes with faces and normals, not wireframes: primitives that can be
   transformed and merged, and a model library built from them. Every part is
   a named component that knows which way it travels when the model is pulled
   open.

   Segment counts scale with a quality factor so the same model can be cheap
   on a slow machine and dense on a fast one.
   ========================================================================= */

const TAU = Math.PI * 2;

/* ---------------------------------------------------------- transforms -- */

export const v = (x, y, z) => ({ x, y, z });

function mesh(verts, faces) {
  return { verts, faces: faces.filter((f) => f.length >= 3) };
}

export function translate(m, dx, dy, dz) {
  return mesh(m.verts.map((p) => v(p.x + dx, p.y + dy, p.z + dz)), m.faces);
}
export function scale(m, sx, sy = sx, sz = sx) {
  return mesh(m.verts.map((p) => v(p.x * sx, p.y * sy, p.z * sz)), m.faces);
}
export function rotateX(m, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return mesh(m.verts.map((p) => v(p.x, p.y * c - p.z * s, p.y * s + p.z * c)), m.faces);
}
export function rotateY(m, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return mesh(m.verts.map((p) => v(p.x * c + p.z * s, p.y, -p.x * s + p.z * c)), m.faces);
}
export function rotateZ(m, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return mesh(m.verts.map((p) => v(p.x * c - p.y * s, p.x * s + p.y * c, p.z)), m.faces);
}

/** Glue several meshes into one, re-indexing their faces. */
export function merge(list) {
  const verts = [], faces = [];
  for (const m of list) {
    const off = verts.length;
    verts.push(...m.verts);
    for (const f of m.faces) faces.push(f.map((i) => i + off));
  }
  return mesh(verts, faces);
}

/* ---------------------------------------------------------- primitives -- */

export function boxMesh(w, h, d) {
  const x = w / 2, y = h / 2, z = d / 2;
  return mesh([
    v(-x, -y, -z), v(x, -y, -z), v(x, y, -z), v(-x, y, -z),
    v(-x, -y, z), v(x, -y, z), v(x, y, z), v(-x, y, z),
  ], [
    [3, 2, 1, 0], [4, 5, 6, 7], [0, 1, 5, 4],
    [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7],
  ]);
}

/** Cylinder along Y. */
export function cylinder(r, h, seg, capped = true, r2 = r) {
  const verts = [], faces = [];
  const y0 = -h / 2, y1 = h / 2;
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * TAU;
    verts.push(v(Math.cos(a) * r, y0, Math.sin(a) * r));
  }
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * TAU;
    verts.push(v(Math.cos(a) * r2, y1, Math.sin(a) * r2));
  }
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    faces.push([i, j, j + seg, i + seg]);
  }
  if (capped) {
    const bot = [], top = [];
    for (let i = 0; i < seg; i++) { bot.push(seg - 1 - i); top.push(i + seg); }
    faces.push(bot, top);
  }
  return mesh(verts, faces);
}

/** Hollow tube along Y - a cylinder with a hole down the middle. */
export function pipe(rOuter, rInner, h, seg) {
  const verts = [], faces = [];
  const y0 = -h / 2, y1 = h / 2;
  for (const [r, y] of [[rOuter, y0], [rOuter, y1], [rInner, y0], [rInner, y1]]) {
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * TAU;
      verts.push(v(Math.cos(a) * r, y, Math.sin(a) * r));
    }
  }
  const O0 = 0, O1 = seg, I0 = seg * 2, I1 = seg * 3;
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    faces.push([O0 + i, O0 + j, O1 + j, O1 + i]);   // outer wall
    faces.push([I1 + i, I1 + j, I0 + j, I0 + i]);   // inner wall
    faces.push([O1 + i, O1 + j, I1 + j, I1 + i]);   // top rim
    faces.push([I0 + i, I0 + j, O0 + j, O0 + i]);   // bottom rim
  }
  return mesh(verts, faces);
}

export function sphereMesh(r, lat, lon) {
  const verts = [], faces = [];
  verts.push(v(0, r, 0));
  for (let i = 1; i < lat; i++) {
    const th = (i / lat) * Math.PI;
    for (let j = 0; j < lon; j++) {
      const ph = (j / lon) * TAU;
      verts.push(v(r * Math.sin(th) * Math.cos(ph), r * Math.cos(th),
                   r * Math.sin(th) * Math.sin(ph)));
    }
  }
  verts.push(v(0, -r, 0));
  const idx = (i, j) => 1 + (i - 1) * lon + (j % lon);
  for (let j = 0; j < lon; j++) faces.push([0, idx(1, j + 1), idx(1, j)]);
  for (let i = 1; i < lat - 1; i++) {
    for (let j = 0; j < lon; j++) {
      faces.push([idx(i, j), idx(i, j + 1), idx(i + 1, j + 1), idx(i + 1, j)]);
    }
  }
  const last = verts.length - 1;
  for (let j = 0; j < lon; j++) faces.push([last, idx(lat - 1, j), idx(lat - 1, j + 1)]);
  return mesh(verts, faces);
}

export function cone(r, h, seg) {
  const verts = [v(0, h / 2, 0)], faces = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * TAU;
    verts.push(v(Math.cos(a) * r, -h / 2, Math.sin(a) * r));
  }
  for (let i = 0; i < seg; i++) faces.push([0, 1 + i, 1 + ((i + 1) % seg)]);
  const base = [];
  for (let i = seg; i >= 1; i--) base.push(i);
  faces.push(base);
  return mesh(verts, faces);
}

export function torus(R, r, su, sv) {
  const verts = [], faces = [];
  for (let i = 0; i < su; i++) {
    const u = (i / su) * TAU;
    for (let j = 0; j < sv; j++) {
      const w = (j / sv) * TAU;
      const rr = R + r * Math.cos(w);
      verts.push(v(Math.cos(u) * rr, r * Math.sin(w), Math.sin(u) * rr));
    }
  }
  const id = (i, j) => (i % su) * sv + (j % sv);
  for (let i = 0; i < su; i++) {
    for (let j = 0; j < sv; j++) {
      faces.push([id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)]);
    }
  }
  return mesh(verts, faces);
}

/** A slab bent around an arc - housings, vanes, shoulder plates. */
export function arcPlate(r0, r1, a0, a1, thick, seg) {
  const verts = [], faces = [];
  const t = thick / 2;
  for (const y of [-t, t]) {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + ((a1 - a0) * i) / seg;
      verts.push(v(Math.cos(a) * r0, y, Math.sin(a) * r0));
      verts.push(v(Math.cos(a) * r1, y, Math.sin(a) * r1));
    }
  }
  const per = (seg + 1) * 2;
  for (let i = 0; i < seg; i++) {
    const b = i * 2, n = (i + 1) * 2;
    faces.push([b, n, n + 1, b + 1]);                                  // bottom
    faces.push([per + b + 1, per + n + 1, per + n, per + b]);          // top
    faces.push([b, b + 1, per + b + 1, per + b]);                      // inner-ish
    faces.push([b + 1, n + 1, per + n + 1, per + b + 1]);              // outer edge
    faces.push([n, b, per + b, per + n]);                              // inner edge
  }
  return mesh(verts, faces);
}

/** A ring of identical blocks - coils, bolts, thrusters. */
export function blockRing(count, R, w, h, d, axis = 'y') {
  const parts = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * TAU;
    let b = boxMesh(w, h, d);
    if (axis === 'y') {
      b = rotateY(b, -a);
      b = translate(b, Math.cos(a) * R, 0, Math.sin(a) * R);
    } else {
      b = rotateZ(b, a);
      b = translate(b, Math.cos(a) * R, Math.sin(a) * R, 0);
    }
    parts.push(b);
  }
  return merge(parts);
}

/* ------------------------------------------------------------- palette -- */

const C = {
  cyan: [120, 220, 255], ice: [200, 245, 255], gold: [255, 200, 90],
  amber: [255, 165, 60], red: [255, 105, 105], white: [255, 255, 255],
  green: [140, 255, 175], violet: [195, 150, 255], steel: [160, 190, 215],
};

const part = (n, m, dir, c, opts = {}) => ({
  n, m, dir, c,
  alpha: opts.alpha ?? 0.30,
  glow: opts.glow ?? 0,
  wire: opts.wire ?? 0.55,
});

/* -------------------------------------------------------------- models -- */
/* q is the quality factor: 0.6 cheap, 1 normal, 1.5 dense. */

function seg(n, q) { return Math.max(6, Math.round(n * q)); }

function arcReactor(q) {
  const s = (n) => seg(n, q);
  return {
    name: 'ARC REACTOR',
    blurb: 'palladium core, 8-coil stator',
    parts: [
      part('outer housing', pipe(1.0, 0.86, 0.34, s(24)), v(0, 0, 0), C.steel, { alpha: 0.22 }),
      part('containment ring', torus(0.93, 0.05, s(24), s(8)), v(0, 0, -1), C.cyan, { alpha: 0.4 }),
      part('stator coils', blockRing(8, 0.62, 0.17, 0.3, 0.17), v(0, 0, 1), C.gold, { alpha: 0.38 }),
      part('coil windings', torus(0.62, 0.1, s(20), s(8)), v(0.9, 0.4, 0), C.amber, { alpha: 0.3 }),
      part('inner shroud', pipe(0.44, 0.34, 0.26, s(18)), v(-0.9, 0.4, 0), C.steel, { alpha: 0.26 }),
      part('plasma core', sphereMesh(0.26, s(8), s(12)), v(0, 1, 0), C.ice,
           { alpha: 0.55, glow: 1 }),
      part('triangle gate', blockRing(3, 0.3, 0.05, 0.34, 0.05, 'z'), v(0, 1.4, 0), C.white,
           { alpha: 0.6, glow: 0.7 }),
      part('mount flange', arcPlate(1.0, 1.2, 0, TAU, 0.1, s(24)), v(0, -1, 0), C.steel,
           { alpha: 0.22 }),
      part('lead conduit', translate(cylinder(0.07, 0.9, s(10)), 0, -0.6, 0),
           v(0, -1.3, 0.4), C.amber, { alpha: 0.32 }),
    ],
  };
}

function helmet(q) {
  const s = (n) => seg(n, q);
  const skull = scale(sphereMesh(1, s(10), s(16)), 0.95, 1.05, 1.05);
  const face = scale(translate(sphereMesh(0.95, s(8), s(14)), 0, -0.05, -0.16), 0.92, 1.0, 0.72);
  return {
    name: 'MK HELMET',
    blurb: 'faceplate, optics, comms',
    parts: [
      part('skull shell', skull, v(0, 0, 0), C.red, { alpha: 0.2 }),
      part('faceplate', face, v(0, 0, -1.2), C.gold, { alpha: 0.4 }),
      part('brow ridge', translate(scale(boxMesh(1.4, 0.16, 0.5), 1, 1, 1), 0, 0.34, -0.62),
           v(0, 0.9, -0.7), C.gold, { alpha: 0.42 }),
      part('optics', translate(boxMesh(1.24, 0.15, 0.2), 0, 0.12, -0.86),
           v(0, 0, -1.9), C.ice, { alpha: 0.7, glow: 1 }),
      part('jaw', scale(translate(sphereMesh(0.72, s(7), s(12)), 0, -0.6, 0.06), 1.05, 0.68, 0.95),
           v(0, -1.2, 0), C.gold, { alpha: 0.38 }),
      part('mouth grille', translate(blockRing(5, 0.2, 0.05, 0.22, 0.06, 'z'), 0, -0.56, -0.66),
           v(0, -1.6, -0.5), C.steel, { alpha: 0.45 }),
      part('ear comms', merge([
        translate(cylinder(0.16, 0.2, s(10)), -0.92, 0.05, 0),
        translate(cylinder(0.16, 0.2, s(10)), 0.92, 0.05, 0),
      ].map((m) => rotateZ(m, Math.PI / 2))), v(1.4, 0.2, 0), C.cyan, { alpha: 0.4 }),
      part('neck ring', torus(0.72, 0.08, s(18), s(8)), v(0, -1.5, 0.3), C.steel, { alpha: 0.3 }),
    ],
  };
}

function gauntlet(q) {
  const s = (n) => seg(n, q);
  return {
    name: 'REPULSOR GAUNTLET',
    blurb: 'forearm assembly, emitter stack',
    parts: [
      part('forearm shell', rotateX(pipe(0.56, 0.44, 1.5, s(18)), Math.PI / 2),
           v(0, 0, 0), C.red, { alpha: 0.22 }),
      part('wrist collar', rotateX(torus(0.56, 0.08, s(18), s(8)), Math.PI / 2),
           v(0, 0.9, 0), C.gold, { alpha: 0.4 }),
      part('knuckle plate', translate(boxMesh(0.9, 0.5, 0.24), 0, 0, -0.9),
           v(0, 0, -1.2), C.red, { alpha: 0.3 }),
      part('emitter housing', rotateX(cylinder(0.34, 0.24, s(16)), Math.PI / 2),
           v(0, -0.9, -0.4), C.steel, { alpha: 0.3 }),
      part('focus lens', rotateX(cylinder(0.26, 0.06, s(16)), Math.PI / 2),
           v(0, -1.4, -0.9), C.ice, { alpha: 0.65, glow: 1 }),
      part('capacitor bank', blockRing(6, 0.5, 0.14, 0.5, 0.14), v(1.2, 0.3, 0),
           C.amber, { alpha: 0.35 }),
      part('vent fins', merge([0, 1, 2].map((i) =>
        translate(boxMesh(0.7, 0.05, 0.3), 0, 0.28 - i * 0.12, 0.5))),
        v(0, 1.2, 0.6), C.steel, { alpha: 0.3 }),
      part('power cable', rotateX(torus(0.42, 0.05, s(16), s(6)), Math.PI / 3),
           v(-1.2, 0.3, 0), C.cyan, { alpha: 0.35 }),
    ],
  };
}

function turbine(q) {
  const s = (n) => seg(n, q);
  const blades = [];
  const B = Math.max(6, Math.round(9 * q));
  for (let i = 0; i < B; i++) {
    let b = boxMesh(0.12, 0.68, 0.04);
    b = rotateZ(b, 0.5);
    b = rotateY(b, (i / B) * TAU);
    b = translate(b, Math.cos((i / B) * TAU) * 0.5, 0, Math.sin((i / B) * TAU) * 0.5);
    blades.push(b);
  }
  return {
    name: 'TURBINE',
    blurb: 'compressor, combustor, nozzle',
    parts: [
      part('nacelle', pipe(1.0, 0.9, 2.0, s(22)), v(0, 0, 0), C.steel, { alpha: 0.18 }),
      part('intake lip', torus(0.98, 0.09, s(22), s(8)), v(0, 1.3, 0), C.cyan, { alpha: 0.4 }),
      part('fan blades', merge(blades), v(0, 0.9, 0), C.ice, { alpha: 0.4 }),
      part('compressor', translate(cylinder(0.42, 0.5, s(16)), 0, 0.2, 0),
           v(1.2, 0, 0), C.gold, { alpha: 0.35 }),
      part('combustor', translate(cylinder(0.5, 0.42, s(16)), 0, -0.3, 0),
           v(-1.2, 0, 0), C.amber, { alpha: 0.45, glow: 0.8 }),
      part('shaft', cylinder(0.12, 1.9, s(10)), v(0, 0, 1.3), C.steel, { alpha: 0.4 }),
      part('stator vanes', blockRing(12, 0.66, 0.08, 0.24, 0.3), v(0, 0, -1.3),
           C.steel, { alpha: 0.3 }),
      part('exhaust cone', translate(cone(0.42, 0.7, s(16)), 0, -1.1, 0),
           v(0, -1.4, 0), C.red, { alpha: 0.38 }),
      part('nozzle ring', translate(torus(0.82, 0.07, s(20), s(8)), 0, -1.0, 0),
           v(0, -1.8, 0), C.amber, { alpha: 0.4, glow: 0.6 }),
    ],
  };
}

function satellite(q) {
  const s = (n) => seg(n, q);
  const panel = (sx) => merge([
    translate(boxMesh(1.7, 0.04, 0.9), sx * 1.5, 0, 0),
    ...[0, 1, 2, 3].map((i) =>
      translate(boxMesh(0.02, 0.06, 0.9), sx * (0.78 + i * 0.42), 0.02, 0)),
  ]);
  return {
    name: 'SATELLITE',
    blurb: 'bus, arrays, dish, thrusters',
    parts: [
      part('bus', boxMesh(0.8, 0.8, 1.0), v(0, 0, 0), C.steel, { alpha: 0.26 }),
      part('array (port)', panel(-1), v(-1.4, 0, 0), C.cyan, { alpha: 0.35 }),
      part('array (starboard)', panel(1), v(1.4, 0, 0), C.cyan, { alpha: 0.35 }),
      part('dish', rotateX(scale(cone(0.62, 0.34, s(18)), 1, 1, 1), Math.PI),
           v(0, 1.3, -0.4), C.ice, { alpha: 0.4 }),
      part('dish mast', translate(cylinder(0.05, 0.5, s(8)), 0, 0.62, 0),
           v(0, 1.1, 0), C.steel, { alpha: 0.4 }),
      part('antenna', translate(cylinder(0.03, 1.3, s(6)), 0, -0.9, 0),
           v(0, -1.4, 0), C.gold, { alpha: 0.45 }),
      part('thruster pod', blockRing(4, 0.46, 0.16, 0.16, 0.3), v(0, 0, 1.4),
           C.amber, { alpha: 0.4, glow: 0.5 }),
      part('sensor ring', torus(0.56, 0.05, s(18), s(6)), v(0, 0, -1.4),
           C.green, { alpha: 0.4 }),
    ],
  };
}

function nanoCore(q) {
  const s = (n) => seg(n, q);
  return {
    name: 'NANO CORE',
    blurb: 'lattice, cage, emitters',
    parts: [
      part('outer lattice', sphereMesh(1.15, s(8), s(12)), v(0, 0, 0), C.cyan, { alpha: 0.14 }),
      part('gyro ring X', rotateX(torus(1.0, 0.045, s(24), s(6)), Math.PI / 2),
           v(1, 0.3, 0), C.ice, { alpha: 0.4 }),
      part('gyro ring Y', torus(1.0, 0.045, s(24), s(6)), v(-1, 0.3, 0), C.ice, { alpha: 0.4 }),
      part('gyro ring Z', rotateZ(torus(1.0, 0.045, s(24), s(6)), Math.PI / 2),
           v(0, 0.3, 1), C.ice, { alpha: 0.4 }),
      part('containment cage', blockRing(6, 0.66, 0.07, 1.0, 0.07), v(0, 1.2, 0),
           C.gold, { alpha: 0.35 }),
      part('core', sphereMesh(0.34, s(8), s(12)), v(0, -1.2, 0), C.violet,
           { alpha: 0.6, glow: 1 }),
      part('emitter spikes', merge([
        translate(cone(0.1, 0.5, s(8)), 0, 1.25, 0),
        rotateZ(translate(cone(0.1, 0.5, s(8)), 0, 1.25, 0), Math.PI),
      ]), v(0, 0, -1.3), C.amber, { alpha: 0.45 }),
    ],
  };
}

function webShooter(q) {
  const s = (n) => seg(n, q);
  return {
    name: 'WEB-SHOOTER',
    blurb: 'cuff, cartridges, nozzle',
    parts: [
      part('wrist cuff', rotateX(pipe(0.7, 0.58, 0.7, s(18)), Math.PI / 2),
           v(0, 0, 0), C.red, { alpha: 0.24 }),
      part('cartridge drum', rotateX(cylinder(0.42, 0.36, s(16)), Math.PI / 2),
           v(0, -1.1, 0), C.steel, { alpha: 0.3 }),
      part('cartridges', rotateX(blockRing(6, 0.3, 0.12, 0.3, 0.12), Math.PI / 2),
           v(0, -1.5, 0.4), C.ice, { alpha: 0.4 }),
      part('nozzle', translate(rotateX(cone(0.14, 0.4, s(12)), -Math.PI / 2), 0, 0, -0.7),
           v(0, 0, -1.4), C.gold, { alpha: 0.5, glow: 0.6 }),
      part('trigger pad', translate(boxMesh(0.24, 0.12, 0.3), 0, -0.52, -0.2),
           v(0, -0.8, -1.0), C.white, { alpha: 0.5 }),
      part('pressure line', rotateY(torus(0.5, 0.04, s(16), s(6)), 0.6),
           v(1.2, 0.4, 0), C.cyan, { alpha: 0.35 }),
      part('strap', rotateX(pipe(0.78, 0.72, 0.16, s(18)), Math.PI / 2),
           v(0, 1.2, 0), C.steel, { alpha: 0.26 }),
    ],
  };
}

function exoSpine(q) {
  const s = (n) => seg(n, q);
  const verts = [];
  for (let i = 0; i < 7; i++) {
    const y = 1.2 - i * 0.4;
    verts.push(translate(scale(boxMesh(0.5, 0.18, 0.4), 1 - i * 0.05), 0, y, 0));
  }
  const discs = [];
  for (let i = 0; i < 6; i++) {
    discs.push(translate(cylinder(0.16, 0.14, s(12)), 0, 1.0 - i * 0.4, 0));
  }
  return {
    name: 'EXO-SPINE',
    blurb: 'vertebrae, actuators, bus',
    parts: [
      part('vertebrae', merge(verts), v(0, 0, 0), C.steel, { alpha: 0.28 }),
      part('discs', merge(discs), v(0, 0, -1.2), C.amber, { alpha: 0.4, glow: 0.5 }),
      part('actuator (left)', translate(cylinder(0.08, 2.4, s(10)), -0.42, 0, 0.1),
           v(-1.3, 0, 0), C.cyan, { alpha: 0.38 }),
      part('actuator (right)', translate(cylinder(0.08, 2.4, s(10)), 0.42, 0, 0.1),
           v(1.3, 0, 0), C.cyan, { alpha: 0.38 }),
      part('control bus', translate(boxMesh(0.34, 0.5, 0.26), 0, -1.35, 0),
           v(0, -1.4, 0), C.gold, { alpha: 0.45 }),
      part('shoulder yoke', translate(arcPlate(0.5, 0.95, Math.PI * 0.1, Math.PI * 0.9, 0.12, s(16)), 0, 1.3, 0),
           v(0, 1.4, 0), C.red, { alpha: 0.3 }),
      part('power spine', translate(cylinder(0.05, 2.6, s(8)), 0, 0, -0.28),
           v(0, 0, 1.3), C.violet, { alpha: 0.45, glow: 0.7 }),
    ],
  };
}

export const MODEL_BUILDERS = [
  arcReactor, helmet, gauntlet, turbine, nanoCore, satellite, webShooter, exoSpine,
];

export const MODEL_NAMES = [
  'ARC REACTOR', 'MK HELMET', 'REPULSOR GAUNTLET', 'TURBINE',
  'NANO CORE', 'SATELLITE', 'WEB-SHOOTER', 'EXO-SPINE',
];

/** Build a model and precompute everything the renderer needs per frame. */
export function buildModel(index, quality = 1) {
  const b = MODEL_BUILDERS[((index % MODEL_BUILDERS.length) + MODEL_BUILDERS.length)
                            % MODEL_BUILDERS.length];
  const model = b(quality);
  let faceCount = 0;
  for (const p of model.parts) {
    faceCount += p.m.faces.length;
    // edge list for the wireframe overlay, de-duplicated
    const seen = new Set(), edges = [];
    for (const f of p.m.faces) {
      for (let i = 0; i < f.length; i++) {
        const a = f[i], c = f[(i + 1) % f.length];
        const key = a < c ? `${a},${c}` : `${c},${a}`;
        if (!seen.has(key)) { seen.add(key); edges.push([a, c]); }
      }
    }
    p.edges = edges;
  }
  model.faceCount = faceCount;
  model.index = index;
  return model;
}
