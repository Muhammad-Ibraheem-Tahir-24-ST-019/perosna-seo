/* =========================================================================
   AR LAB - standalone.

   Deliberately separate from the powers app. That one runs three tracking
   models at once (hands, face, body), which costs frame time and makes the
   hand gestures less certain. This one loads ONLY the hand model, so the
   gestures are faster and steadier - which is the whole point when your
   hands are the only input.

   What loads is chosen on the setup screen before anything starts.
   ========================================================================= */

import { buildModel, MODEL_NAMES, MODEL_BUILDERS } from './models3d.js';
import { HandState, TUNING, LABEL } from './hands.js';
import { LandmarkFilter, SMOOTHING } from './filter.js';
import { buildGauntlet, drawWearable, gauntletFaceCount, SKINS } from './wearable.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------- settings -- */

export const SETTINGS = {
  mode: 'wear',             // wear | build
  skin: 'mk',               // which armour finish
  smoothing: 'balanced',    // responsive | balanced | smooth
  players: 1,
  quality: 'high',          // low | medium | high
  camera: 720,              // 480 | 720 | 1080
  model: [0, 2],            // starting model per player
  shading: true,            // solid faces, or wireframe only
  grid: true,
  mirror: true,
};

const QUALITY = {
  low:    { mesh: 0.6, dpr: 1,   bloom: 0,   maxFaces: 420 },
  medium: { mesh: 1.0,  dpr: 1.5, bloom: 0.6, maxFaces: 900 },
  high:   { mesh: 1.25, dpr: 2,  bloom: 1,   maxFaces: 1500 },
};

/* ------------------------------------------------------- gesture tuning -- */
/* The lab only needs five shapes, so they can be held to a tighter standard
   than the powers app: more voting frames means steadier grabs. */

function tuneForLab() {
  TUNING.voteFrames = 6;
  TUNING.voteMajority = 4;
  // the One Euro filter now does the smoothing, so HandState's own lerp can
  // run almost wide open - double-smoothing is what made it feel laggy
  TUNING.smoothing = 45;
  TUNING.pinchRatio = 0.46;   // a slightly more forgiving grab
  TUNING.gripReach = 0.88;
}

/* ------------------------------------------------------------ 3D camera -- */

class View3D {
  constructor() { this.dist = 5.0; }

  /** Rotate and project straight into an existing object - called for every
   *  vertex of every model every frame, so it must not allocate. */
  projectInto(out, px, py, pz, rx, ry, rz, cx, cy, unit) {
    let x = px, y = py, z = pz;
    if (rz) { const c = Math.cos(rz), s = Math.sin(rz);
              const nx = x * c - y * s; y = x * s + y * c; x = nx; }
    if (rx) { const c = Math.cos(rx), s = Math.sin(rx);
              const ny = y * c - z * s; z = y * s + z * c; y = ny; }
    if (ry) { const c = Math.cos(ry), s = Math.sin(ry);
              const nx = x * c + z * s; z = -x * s + z * c; x = nx; }
    const s = this.dist / (this.dist + z);
    out.x = cx + x * unit * s; out.y = cy + y * unit * s; out.z = z; out.s = s;
    return out;
  }

  /** Rotate a point by the model's orientation, then project it. */
  project(p, rx, ry, rz, cx, cy, unit) {
    let { x, y, z } = p;
    if (rz) { const c = Math.cos(rz), s = Math.sin(rz);
              const nx = x * c - y * s; y = x * s + y * c; x = nx; }
    if (rx) { const c = Math.cos(rx), s = Math.sin(rx);
              const ny = y * c - z * s; z = y * s + z * c; y = ny; }
    if (ry) { const c = Math.cos(ry), s = Math.sin(ry);
              const nx = x * c + z * s; z = -x * s + z * c; x = nx; }
    const s = this.dist / (this.dist + z);
    return { x: cx + x * unit * s, y: cy + y * unit * s, z, s };
  }
}

/* ------------------------------------------------------------- the bench -- */

export class Bench {
  constructor(playerIndex, modelIndex, quality) {
    this.p = playerIndex;
    this.quality = quality;
    this.setModel(modelIndex);
    this.rx = -0.3; this.ry = 0.5; this.rz = 0;
    this.scale = 1;
    this.explode = 0;
    this.px = 0; this.py = 0;         // offset from this pane's centre
    this.spin = 0.22;
    this.grab = null;                  // 'one' | 'two' | null
    this.swap = 0;
    this.view = new View3D();
    this.hint = '';
    this.pulse = 0;
  }

  setModel(i) {
    this.modelIndex = ((i % MODEL_BUILDERS.length) + MODEL_BUILDERS.length)
                      % MODEL_BUILDERS.length;
    const q = QUALITY[this.quality];
    /* Every face is sorted and filled on the CPU each frame, so a mesh that
       is too dense costs frame rate directly. Build it, and if it blew the
       budget, rebuild it coarser until it fits. */
    let mesh = q.mesh;
    this.model = buildModel(this.modelIndex, mesh);
    let guard = 0;
    while (this.model.faceCount > q.maxFaces && mesh > 0.45 && guard++ < 6) {
      mesh *= 0.8;
      this.model = buildModel(this.modelIndex, mesh);
    }
    this.meshQ = mesh;
    this.swap = 1;
    this.pulse = 1;
  }

  reset() {
    this.rx = -0.3; this.ry = 0.5; this.rz = 0;
    this.scale = 1; this.explode = 0; this.px = 0; this.py = 0;
  }

  update(dt) {
    this.swap = Math.max(0, this.swap - dt * 1.7);
    this.pulse = Math.max(0, this.pulse - dt * 1.2);
    if (!this.grab) {
      // let go and it keeps spinning, then settles back to a slow idle turn
      const decay = Math.exp(-2.6 * dt);
      this.vry = (this.vry || 0) * decay;
      this.vrx = (this.vrx || 0) * decay;
      this.ry += this.vry * 60 * dt;
      this.rx = clamp(this.rx + this.vrx * 60 * dt, -1.45, 1.45);
      this.ry += dt * this.spin * (1 - Math.min(1, Math.abs(this.vry) * 90));
      this.px = lerp(this.px, 0, 1 - Math.exp(-2.4 * dt));
      this.py = lerp(this.py, 0, 1 - Math.exp(-2.4 * dt));
    }
  }

  /**
   * Drive from this player's hands.
   *   pinch one hand  -> move + turn
   *   pinch both      -> spread to scale, twist to roll, pull apart to open
   *   open palm       -> close it back up
   *   horns           -> next model
   *   fist            -> recentre
   */
  drive(hands, dt) {
    const pinched = hands.filter((h) => h.active && h.gesture === 'PINCH');

    if (pinched.length >= 2) {
      const [a, b] = pinched;
      const dx = b.palm.x - a.palm.x, dy = b.palm.y - a.palm.y;
      const d = Math.hypot(dx, dy);
      const ang = Math.atan2(dy, dx);
      if (this.lastD) {
        const spread = d - this.lastD;
        this.scale = clamp(this.scale * (1 + spread * 0.0019), 0.35, 3.4);
        this.explode = clamp(this.explode + spread * 0.0026, 0, 1);
        let dA = ang - this.lastA;
        while (dA > Math.PI) dA -= TAU;
        while (dA < -Math.PI) dA += TAU;
        this.rz += dA;
      }
      this.lastD = d; this.lastA = ang;
      this.px = lerp(this.px, (a.palm.x + b.palm.x) / 2 - this.cx, 0.28);
      this.py = lerp(this.py, (a.palm.y + b.palm.y) / 2 - this.cy, 0.28);
      this.grab = 'two';
      this.wasGrab = true;
      return;
    }
    this.lastD = 0; this.lastA = 0;

    if (pinched.length === 1) {
      const h = pinched[0];
      /* Trackball, not velocity. The old version integrated a smoothed
         velocity, which drifts, overshoots and never lands where you expect.
         This maps the frame-to-frame movement of your hand straight to an
         angle: about 180 degrees across 420 pixels, 1:1 and predictable. */
      if (!this.wasGrab) { this.lx = h.palm.x; this.ly = h.palm.y; }
      const dx = h.palm.x - this.lx, dy = h.palm.y - this.ly;
      this.lx = h.palm.x; this.ly = h.palm.y;
      const gain = Math.PI / 420;
      this.ry += dx * gain;
      this.rx = clamp(this.rx + dy * gain, -1.45, 1.45);
      // keep the throw so it carries on turning when you let go
      this.vry = dx * gain; this.vrx = dy * gain;
      this.grab = 'one';
      this.wasGrab = true;
      return;
    }

    this.wasGrab = false;
    this.grab = null;

    for (const h of hands) {
      if (!h.active) continue;
      if (h.gesture === 'OPEN' && this.explode > 0) {
        this.explode = Math.max(0, this.explode - dt * 0.9);
      }
      if (h.gesture === 'FIST' && h.hold > 0.6) this.reset();
      if (h.gesture === 'HORNS') {
        this.hornsHold = (this.hornsHold || 0) + dt;
        if (this.hornsHold > 0.65) {
          this.hornsHold = -0.9;
          this.setModel(this.modelIndex + 1);
        }
      }
    }
    if (!hands.some((h) => h.active && h.gesture === 'HORNS')) {
      this.hornsHold = Math.min(0, (this.hornsHold || 0) + dt);
    }
  }

  /* ----------------------------------------------------------- drawing -- */

  draw(ctx, cx, cy, unit, t, shading) {
    this.cx = cx; this.cy = cy;
    const ox = cx + this.px, oy = cy + this.py;
    const u = unit * this.scale;
    const ex = this.explode * 1.6 + this.swap * this.swap * 2.4;

    /* Batched on purpose. One beginPath/fillStyle per face and per edge means
       thousands of draw calls and thousands of throwaway colour strings every
       frame, which is slower than the geometry by an order of magnitude.
       Instead: quantise alpha into buckets and collect everything into one
       Path2D per (part, bucket), then issue a few dozen fills.

       No depth sort either - the whole thing composites with 'lighter', and
       additive blending gives the same result in any order. */
    const FB = 10;                       // face alpha buckets
    const WB = 6;                        // wire alpha buckets
    const faceBatch = this.fb || (this.fb = new Map());
    const wireBatch = this.wb || (this.wb = new Map());
    faceBatch.clear(); wireBatch.clear();

    for (let pi = 0; pi < this.model.parts.length; pi++) {
      const p = this.model.parts[pi];
      const dx = p.dir.x * ex, dy = p.dir.y * ex, dz = p.dir.z * ex;

      // reuse the projected-vertex objects instead of reallocating each frame
      let pv = p.screen;
      if (!pv || pv.length !== p.m.verts.length) {
        pv = p.screen = new Array(p.m.verts.length);
        for (let i = 0; i < pv.length; i++) pv[i] = { x: 0, y: 0, z: 0, s: 1 };
      }
      for (let i = 0; i < pv.length; i++) {
        const q = p.m.verts[i];
        this.view.projectInto(pv[i], q.x + dx, q.y + dy, q.z + dz,
                              this.rx, this.ry, this.rz, ox, oy, u);
      }

      if (shading) {
        const faces = p.m.faces;
        const areaRef = u * u * 0.12;
        for (let fi = 0; fi < faces.length; fi++) {
          const f = faces[fi];
          const A = pv[f[0]], B = pv[f[1]], C = pv[f[2]];
          const cross = (B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x);
          const area = cross < 0 ? -cross : cross;
          // a hologram is translucent, so back faces still show, just dimmer
          const lit = area / areaRef;
          const shade = 0.45 + (lit > 1 ? 1 : lit < 0.08 ? 0.08 : lit) * 0.55;
          const a = p.alpha * (cross < 0 ? 1 : 0.34) * shade;
          let b = (a * FB) | 0;
          if (b >= FB) b = FB - 1;
          if (b < 0) continue;
          const key = pi * FB + b;
          let path = faceBatch.get(key);
          if (!path) {
            path = new Path2D();
            path._style = `rgba(${p.c[0]},${p.c[1]},${p.c[2]},${((b + 0.5) / FB).toFixed(3)})`;
            faceBatch.set(key, path);
          }
          path.moveTo(A.x, A.y);
          for (let i = 1; i < f.length; i++) { const q = pv[f[i]]; path.lineTo(q.x, q.y); }
          path.closePath();
        }
      }

      const edges = p.edges;
      for (let ei = 0; ei < edges.length; ei++) {
        const e = edges[ei];
        const a1 = pv[e[0]], b1 = pv[e[1]];
        const z = (a1.z + b1.z) * 0.5;
        let depth = 1 - (z + 1.8) / 4.0;
        if (depth > 1) depth = 1; else if (depth < 0.12) depth = 0.12;
        const a = (0.10 + depth * 0.5) * p.wire;
        let b = (a * WB * 1.6) | 0;
        if (b >= WB) b = WB - 1;
        const key = pi * WB + b;
        let path = wireBatch.get(key);
        if (!path) {
          path = new Path2D();
          path._style = `rgba(${p.c[0]},${p.c[1]},${p.c[2]},${(((b + 0.5) / (WB * 1.6))).toFixed(3)})`;
          path._w = Math.max(0.5, u * 0.0055 * (0.5 + b / WB));
          wireBatch.set(key, path);
        }
        path.moveTo(a1.x, a1.y);
        path.lineTo(b1.x, b1.y);
      }
    }

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    if (SETTINGS.grid) this.drawStage(ctx, ox, oy, u, t);

    for (const path of faceBatch.values()) {
      ctx.fillStyle = path._style;
      ctx.fill(path);
    }
    ctx.lineCap = 'round';
    for (const path of wireBatch.values()) {
      ctx.strokeStyle = path._style;
      ctx.lineWidth = path._w;
      ctx.stroke(path);
    }

    // emissive parts get a bloom blob, drawn last and cheaply
    for (const p of this.model.parts) {
      if (p.glow <= 0 || !p.screen || !p.screen.length) continue;
      let sx = 0, sy = 0;
      for (let i = 0; i < p.screen.length; i++) { sx += p.screen[i].x; sy += p.screen[i].y; }
      sx /= p.screen.length; sy /= p.screen.length;
      const r = u * 0.5;
      const rg = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
      rg.addColorStop(0, `rgba(255,255,255,${0.5 * p.glow})`);
      rg.addColorStop(0.3, `rgba(${p.c[0]},${p.c[1]},${p.c[2]},${0.4 * p.glow})`);
      rg.addColorStop(1, `rgba(${p.c[0]},${p.c[1]},${p.c[2]},0)`);
      ctx.fillStyle = rg;
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.fill();
    }

    if (this.explode > 0.1) this.drawLabels(ctx, u);
    ctx.restore();
  }

  drawStage(ctx, cx, cy, u, t) {
    const base = cy + u * 1.85;
    const cone = ctx.createLinearGradient(cx, base, cx, cy - u * 0.5);
    cone.addColorStop(0, 'rgba(80,200,255,0.13)');
    cone.addColorStop(1, 'rgba(80,200,255,0)');
    ctx.fillStyle = cone;
    ctx.beginPath();
    ctx.moveTo(cx - u * 0.13, base); ctx.lineTo(cx + u * 0.13, base);
    ctx.lineTo(cx + u * 1.6, cy - u * 0.4); ctx.lineTo(cx - u * 1.6, cy - u * 0.4);
    ctx.closePath(); ctx.fill();

    ctx.strokeStyle = 'rgba(110,220,255,0.30)';
    ctx.lineWidth = Math.max(1, u * 0.01);
    for (let k = 0; k < 3; k++) {
      const p = ((t * 0.45 + k / 3) % 1);
      ctx.globalAlpha = 1 - p;
      ctx.beginPath();
      ctx.ellipse(cx, base, u * (0.3 + p * 1.3), u * (0.08 + p * 0.36), 0, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  drawLabels(ctx, u) {
    const a = clamp(this.explode * 2, 0, 1);
    ctx.font = `${Math.max(8, Math.round(u * 0.068))}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    for (const p of this.model.parts) {
      if (!p.screen || !p.screen.length) continue;
      let sx = 0, sy = 0;
      for (const q of p.screen) { sx += q.x; sy += q.y; }
      sx /= p.screen.length; sy /= p.screen.length;
      ctx.fillStyle = `rgba(200,240,255,${0.7 * a})`;
      ctx.fillText(p.n, sx, sy);
    }
  }
}

/* --------------------------------------------------------------- the app -- */

const VER = '0.10.14';
const MODULE_URLS = [
  `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VER}/vision_bundle.mjs`,
  `https://unpkg.com/@mediapipe/tasks-vision@${VER}/vision_bundle.mjs`,
];
const WASM_URLS = [
  `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VER}/wasm`,
  `https://unpkg.com/@mediapipe/tasks-vision@${VER}/wasm`,
];
const HAND_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/' +
                   'hand_landmarker/float16/1/hand_landmarker.task';

async function firstThatWorks(urls, fn) {
  let last;
  for (const u of urls) { try { return await fn(u); } catch (e) { last = e; } }
  throw last;
}

export class ARLab {
  constructor(video, canvas) {
    this.video = video;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.mirror = document.createElement('canvas');
    this.mctx = this.mirror.getContext('2d');
    this.hands = [];
    this.benches = [];
    this.W = 0; this.H = 0; this.dpr = 1;
    this.view = { ox: 0, oy: 0, dw: 0, dh: 0 };
    this.clock = 0; this.fps = 60;
    this.running = false;
    this.lastVideoTs = -1;
    this.lastNow = 0;
    this.debug = false;
    this.hud = true;
    this.err = null;
    this.sparks = [];
  }

  async start(onStatus) {
    tuneForLab();

    onStatus('Opening camera...');
    const heights = { 480: 480, 720: 720, 1080: 1080 };
    const h = heights[SETTINGS.camera] || 720;
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: Math.round(h * 16 / 9) }, height: { ideal: h },
               facingMode: 'user' },
      audio: false,
    });
    this.video.srcObject = stream;
    await this.video.play();
    await new Promise((res) => {
      if (this.video.videoWidth) return res();
      this.video.onloadedmetadata = () => res();
    });

    onStatus('Loading the hand tracker (this is the only model we need)...');
    const vision = await firstThatWorks(MODULE_URLS, (u) => import(/* @vite-ignore */ u));
    const { FilesetResolver, HandLandmarker } = vision;
    const fileset = await firstThatWorks(WASM_URLS, (u) => FilesetResolver.forVisionTasks(u));

    // two hands per player, so a second person gets their own pair
    const numHands = SETTINGS.players * 2;
    for (const delegate of ['GPU', 'CPU']) {
      try {
        this.handLM = await HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: HAND_MODEL, delegate },
          runningMode: 'VIDEO',
          numHands,
          minHandDetectionConfidence: 0.55,
          minHandPresenceConfidence: 0.55,
          minTrackingConfidence: 0.55,
        });
        this.delegate = delegate;
        break;
      } catch (e) { if (delegate === 'CPU') throw e; }
    }

    const sm = SMOOTHING[SETTINGS.smoothing] || SMOOTHING.balanced;
    this.hands = [];
    this.filters = [];
    for (let i = 0; i < numHands; i++) {
      this.hands.push(new HandState());
      this.filters.push(new LandmarkFilter(21, sm));
    }
    this.skin = SKINS[SETTINGS.skin] || SKINS.mk;
    this.wornFaces = 0;

    this.benches = [];
    for (let p = 0; p < SETTINGS.players; p++) {
      this.benches.push(new Bench(p, SETTINGS.model[p] ?? p * 2, SETTINGS.quality));
    }

    this.layout();
    this.running = true;
    requestAnimationFrame((t) => this.loop(t));
  }

  layout() {
    const q = QUALITY[SETTINGS.quality];
    this.dpr = Math.min(window.devicePixelRatio || 1, q.dpr);
    this.W = Math.max(1, window.innerWidth);
    this.H = Math.max(1, window.innerHeight);
    this.canvas.style.width = this.W + 'px';
    this.canvas.style.height = this.H + 'px';
    this.canvas.width = Math.round(this.W * this.dpr);
    this.canvas.height = Math.round(this.H * this.dpr);
    this.mirror.width = this.canvas.width;
    this.mirror.height = this.canvas.height;

    const vw = this.video.videoWidth || 1280, vh = this.video.videoHeight || 720;
    const s = Math.max(this.W / vw, this.H / vh);
    this.view.dw = vw * s; this.view.dh = vh * s;
    this.view.ox = (this.W - this.view.dw) / 2;
    this.view.oy = (this.H - this.view.dh) / 2;
  }

  toScreen(lms) {
    const out = new Array(lms.length);
    const { ox, oy, dw, dh } = this.view;
    for (let i = 0; i < lms.length; i++) {
      out[i] = {
        x: SETTINGS.mirror ? ox + (1 - lms[i].x) * dw : ox + lms[i].x * dw,
        y: oy + lms[i].y * dh,
        // MediaPipe's z is wrist-relative at roughly the same scale as x, so
        // it only becomes a usable depth once it is scaled like x. Mirroring
        // flips handedness, which would invert every surface normal.
        z: (lms[i].z || 0) * dw * (SETTINGS.mirror ? -1 : 1),
      };
    }
    return out;
  }

  /** Split the frame between players and give each their own hands. */
  paneFor(p) {
    if (SETTINGS.players === 1) return { x: 0, w: this.W, cx: this.W / 2 };
    const w = this.W / 2;
    return { x: p * w, w, cx: p * w + w / 2 };
  }

  assign(dets, dt) {
    const used = new Array(this.hands.length).fill(false);
    const taken = new Array(this.hands.length).fill(null);

    for (const L of dets) {
      // a hand belongs to whichever half of the screen it is in
      const mid = L[9].x;
      const player = SETTINGS.players === 1 ? 0 : (mid < this.W / 2 ? 0 : 1);
      const lo = player * 2, hi = lo + 2;

      let best = -1, bestD = Infinity;
      for (let i = lo; i < hi && i < this.hands.length; i++) {
        if (used[i]) continue;
        const h = this.hands[i];
        const d = h.active ? Math.hypot(h.palm.x - mid, h.palm.y - L[9].y) : 1e6;
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best < 0) {
        for (let i = lo; i < hi && i < this.hands.length; i++) if (!used[i]) { best = i; break; }
      }
      if (best >= 0) { used[best] = true; taken[best] = L; }
    }

    for (let i = 0; i < this.hands.length; i++) {
      if (taken[i]) {
        // smooth BEFORE anything reads the landmarks, so the gesture machine,
        // the grab and the worn armour all agree on where the hand is
        const sm = this.filters[i].apply(taken[i], dt);
        const out = new Array(sm.length);
        for (let k = 0; k < sm.length; k++) out[k] = { x: sm[k].x, y: sm[k].y, z: sm[k].z };
        this.hands[i].landmarks = out;
        this.hands[i].update(out, dt);
      } else {
        // a hand that comes back should appear where it is, not lerp in
        if (this.hands[i].active) this.filters[i].reset();
        this.hands[i].landmarks = null;
        this.hands[i].lost(dt);
      }
    }
  }

  handsOf(p) {
    if (SETTINGS.players === 1) return this.hands;
    return this.hands.slice(p * 2, p * 2 + 2);
  }

  loop(now) {
    if (!this.running) return;
    requestAnimationFrame((t) => this.loop(t));
    try { this.frame(now); } catch (e) {
      this.err = e; console.error(e);
    }
  }

  frame(now) {
    const dt = this.lastNow ? Math.min((now - this.lastNow) / 1000, 0.05) : 0.016;
    this.lastNow = now;
    this.clock += dt;
    this.fps = lerp(this.fps, 1 / Math.max(dt, 1e-4), 0.06);

    if (this.video.readyState < 2) return;
    if (!this.W) this.layout();

    if (this.video.currentTime !== this.lastVideoTs) {
      this.lastVideoTs = this.video.currentTime;
      const r = this.handLM.detectForVideo(this.video, performance.now());
      const dets = [];
      if (r && r.landmarks) {
        for (const lm of r.landmarks) dets.push(this.toScreen(lm));
      }
      this.assign(dets, dt);
    }

    if (SETTINGS.mode === 'wear') {
      this.worn = [];
      this.wornFaces = 0;
      for (const h of this.hands) {
        if (!h.active || !h.landmarks || h.seen < 3) continue;
        const g = buildGauntlet(h.landmarks, this.skin,
                                { thickness: 0.085, fit: 1.0 });
        this.worn.push(g);
        this.wornFaces += gauntletFaceCount(g);
      }
      return;
    }
    this.worn = null;

    for (let p = 0; p < this.benches.length; p++) {
      const b = this.benches[p];
      const pane = this.paneFor(p);
      b.cx = pane.cx; b.cy = this.H * 0.5;
      b.drive(this.handsOf(p), dt);
      b.update(dt);
      b.hint = b.explode > 0.05
        ? 'open palm to close it'
        : 'pinch to grab · two hands: spread to open · horns: next';
      if (b.pulse > 0.4 && Math.random() < 0.5) this.spark(pane.cx, this.H * 0.5, b);
    }

    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life -= dt; s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 40 * dt;
      if (s.life <= 0) this.sparks.splice(i, 1);
    }

    this.render();
  }

  spark(cx, cy, b) {
    if (this.sparks.length > 220) return;
    const a = rand(0, TAU), d = rand(0.3, 1.5) * Math.min(this.W, this.H) * 0.16;
    this.sparks.push({
      x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d,
      vx: -Math.cos(a) * d * 1.6, vy: -Math.sin(a) * d * 1.6,
      life: rand(0.2, 0.5), max: 0.5,
    });
  }

  render() {
    const c = this.ctx, W = this.W, H = this.H, dpr = this.dpr;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);

    // camera frame
    this.mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.mctx.fillStyle = '#04070c';
    this.mctx.fillRect(0, 0, W, H);
    this.mctx.save();
    if (SETTINGS.mirror) { this.mctx.translate(W, 0); this.mctx.scale(-1, 1); }
    const dx = SETTINGS.mirror ? W - this.view.ox - this.view.dw : this.view.ox;
    this.mctx.drawImage(this.video, dx, this.view.oy, this.view.dw, this.view.dh);
    this.mctx.restore();
    c.drawImage(this.mirror, 0, 0, W, H);

    // holograms need a dark backing to read; worn armour does not, and
    // dimming your own hand just makes it look pasted on
    c.fillStyle = SETTINGS.mode === 'wear' ? 'rgba(3,7,14,0.12)' : 'rgba(3,7,14,0.42)';
    c.fillRect(0, 0, W, H);

    if (SETTINGS.mode === 'wear') {
      if (this.worn) for (const g of this.worn) drawWearable(c, g, { alpha: 1 });
      if (this.debug) this.drawDebug(c);
      if (this.hud) this.drawHUD(c);
      return;
    }

    const unit = Math.min(SETTINGS.players === 1 ? W : W / 2, H) * 0.19;

    for (let p = 0; p < this.benches.length; p++) {
      const pane = this.paneFor(p);
      // each player owns their half: clip so a model blown up to 3x or pulled
      // wide open cannot spill into the other player's side
      if (SETTINGS.players === 2) {
        c.save();
        c.beginPath();
        c.rect(pane.x, 0, pane.w, H);
        c.clip();
      }
      this.benches[p].draw(c, pane.cx, H * 0.5, unit, this.clock, SETTINGS.shading);
      if (SETTINGS.players === 2) c.restore();
    }

    // convergence sparks when a model swaps in
    c.save();
    c.globalCompositeOperation = 'lighter';
    for (const s of this.sparks) {
      const a = clamp(s.life / s.max, 0, 1);
      c.fillStyle = `rgba(190,240,255,${a})`;
      c.beginPath(); c.arc(s.x, s.y, 1.6 * a + 0.6, 0, TAU); c.fill();
    }
    c.restore();

    if (SETTINGS.players === 2) {
      c.strokeStyle = 'rgba(120,200,255,0.25)';
      c.lineWidth = 1;
      c.beginPath(); c.moveTo(W / 2, 0); c.lineTo(W / 2, H); c.stroke();
    }

    if (this.debug) this.drawDebug(c);
    if (this.hud) this.drawHUD(c);
  }

  drawDebug(c) {
    const BONES = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],
      [10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],
      [19,20],[0,17]];
    c.save();
    for (const h of this.hands) {
      if (!h.active || !h.landmarks) continue;
      c.strokeStyle = 'rgba(90,220,255,0.8)';
      c.lineWidth = 2;
      for (const [a, b] of BONES) {
        c.beginPath();
        c.moveTo(h.landmarks[a].x, h.landmarks[a].y);
        c.lineTo(h.landmarks[b].x, h.landmarks[b].y);
        c.stroke();
      }
      c.fillStyle = '#fff';
      for (const p of h.landmarks) {
        c.beginPath(); c.arc(p.x, p.y, 2.5, 0, TAU); c.fill();
      }
    }
    c.restore();
  }

  drawHUD(c) {
    const W = this.W, H = this.H;
    c.save();
    c.font = '11px ui-monospace, monospace';

    for (let p = 0; p < this.benches.length; p++) {
      const b = this.benches[p];
      const pane = this.paneFor(p);
      const x = pane.x + 14;
      let y = 22;
      const hs = this.handsOf(p);

      c.fillStyle = 'rgba(6,12,20,0.6)';
      c.fillRect(x - 8, y - 16, 210, SETTINGS.players === 2 ? 108 : 96);
      c.strokeStyle = 'rgba(120,200,255,0.2)';
      c.strokeRect(x - 8, y - 16, 210, SETTINGS.players === 2 ? 108 : 96);

      c.fillStyle = '#6fe8ff';
      c.fillText(SETTINGS.players === 2 ? `PLAYER ${p + 1}` : 'AR LAB', x, y); y += 16;
      c.fillStyle = '#dfe9f5';
      c.fillText(b.model.name, x, y); y += 14;
      c.fillStyle = '#8399b0';
      c.fillText(b.model.blurb, x, y); y += 14;
      c.fillText(`parts ${b.model.parts.length}   faces ${b.model.faceCount}`, x, y); y += 14;
      c.fillText(`open ${Math.round(b.explode * 100)}%   scale ${b.scale.toFixed(2)}x`, x, y);
      y += 14;
      const g = hs.filter((h) => h.active).map((h) => LABEL[h.gesture]).join(' / ') || '-';
      c.fillStyle = b.grab ? '#8dfd5c' : '#8399b0';
      c.fillText(`hands ${g}`, x, y);
    }

    // shared footer
    c.fillStyle = 'rgba(6,12,20,0.6)';
    c.fillRect(W - 250, H - 66, 236, 52);
    c.strokeStyle = 'rgba(120,200,255,0.2)';
    c.strokeRect(W - 250, H - 66, 236, 52);
    c.fillStyle = '#8399b0';
    c.fillText(`fps ${Math.round(this.fps)}   ${this.delegate || ''}   ` +
               `${SETTINGS.quality}`, W - 240, H - 48);
    c.fillText('N next model   R reset   D debug', W - 240, H - 33);
    c.fillText('H hide UI   F fullscreen   Esc setup', W - 240, H - 18);

    // one hint per pane, under that player's own model
    c.textAlign = 'center';
    c.fillStyle = 'rgba(150,200,230,0.55)';
    for (let p = 0; p < this.benches.length; p++) {
      const b = this.benches[p];
      if (!b.hint) continue;
      const pane = this.paneFor(p);
      c.fillText(b.hint, pane.cx, H - (SETTINGS.players === 2 ? 20 : 34));
    }
    c.textAlign = 'left';
    c.restore();
  }

  stop() {
    this.running = false;
    const s = this.video.srcObject;
    if (s) for (const t of s.getTracks()) t.stop();
    this.video.srcObject = null;
  }
}
