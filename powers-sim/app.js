/* =========================================================================
   GESTURE POWER SIMULATOR
   webcam -> hand + face + pose landmarks -> gesture state machine -> VFX

   Everything runs locally in the browser. No video frame ever leaves the
   machine; the only network traffic is fetching the model files once.

   There are more powers than there are hand shapes a camera can tell apart
   reliably, so they are grouped into three loadouts (keys 1/2/3, or both
   hands in horns). Inside a loadout every gesture is unambiguous.
   ========================================================================= */

import {
  FX, faceFrame, drawRepulsor, drawMandala, drawPortal, drawHelmet,
  drawGamma, gammaGrade, drawSkeleton, drawFaceDots,
  lerp, clamp, rand, dist, TAU,
} from './fx.js';
import { HandState, LABEL, TUNING } from './hands.js';
import { Compositor, Spill, Ash, grade, desaturate } from './render.js';
import {
  drawBlue, drawRed, drawPurple, PurpleBeam, Slash,
  drawVoid, drawShrine, drawDomainBurst,
} from './jjk.js';
import {
  Bolt, drawMjolnir, drawGauntlet, drawChaos, drawShield, ShieldThrow,
  drawEye, TimeStream, drawTimeRings, drawMindStone, EnergyBeam,
} from './marvel.js';
import { drawArmor, Hologram } from './stark.js';
import { Workbench, driveWorkbench, MODEL_LIST } from './ar.js';
import { PingPong, Badminton } from './games.js';
import { RadialMenu } from './menu.js';
import { drawNano } from './nano.js';

/* ------------------------------ 1. tuning -------------------------------- */
/* Every feel-related number lives here. Editing this block is all the tuning
   the app needs; it is also exposed as window.POWER_CONFIG so values can be
   tried live from the browser console without a reload. See README.md.      */

const CONFIG = {
  repulsor: { chargeSeconds: 1.18, decayPerSec: 0.9, minFire: 0.22,
              beamLength: 1.3, glowScale: 0.55 },
  gamma:    { holdToTransform: 1.2, holdToRevert: 1.0,
              riseRate: 5.5, fallRate: 2.4, shake: 1.8 },
  helmet:   { cooldown: 0.9, faceRadius: 0.8, riseRate: 11, fallRate: 13 },
  suit:     { riseRate: 1.9, fallRate: 3.2 },     // body armour assembly speed
  mandala:  { scale: 2.0, riseRate: 9, fallRate: 7 },
  portal:   { scale: 2.6, riseRate: 6, fallRate: 8 },

  blue:     { chargeSeconds: 1.0, minFire: 0.25, scale: 0.8 },
  red:      { chargeSeconds: 0.9, minFire: 0.25, scale: 0.8 },
  purple:   { mergeDistance: 3.2,     // how close the hands must be, in hand-widths
              chargeSeconds: 1.5, beamWidth: 0.16 },
  dismantle:{ minSpeed: 900, lengthScale: 4.5, cooldown: 0.07 },
  domain:   { holdSeconds: 1.3, together: 2.6, riseRate: 2.6, fallRate: 1.8 },

  mjolnir:  { holdSeconds: 0.7, strikeEvery: 0.28, riseRate: 7 },
  gauntlet: { riseRate: 9, fallRate: 7 },
  snap:     { cooldown: 4.0, ashFlakes: 950 },
  chaos:    { chargeSeconds: 0.9, minFire: 0.25, scale: 0.9 },
  timeStone:{ riseRate: 4, rewindRate: 85 },
  shield:   { scale: 1.15 },
  holo:     { openHold: 0.5, riseRate: 5, rotateGain: 0.011 },
  nano:     { riseRate: 0.55, fallRate: 2.2 },   // how fast the suit crawls
  ar:       { rotateGain: 0.013, scaleGain: 0.0016, explodeGain: 0.0022,
              size: 0.20, riseRate: 4 },
  menu:     { holdToOpen: 0.8, radius: 0.30 },

  bloom:    { strength: 1.0, grain: 0.045 },
  gesture:  TUNING,
  audio:    { volume: 0.32 },
};
window.POWER_CONFIG = CONFIG;

/* ------------------------------ 2. loadouts ------------------------------ */

const LOADOUTS = [
  {
    id: 'STARK', tint: '#6fe8ff',
    rows: [
      ['open palm', 'charge repulsor — close hand to FIRE'],
      ['palm→fist on face', 'suit up: helmet + body armour'],
      ['fist above head', 'summon Mjolnir — open hand to discharge'],
      ['thumb+middle', 'Infinity Gauntlet — snap them apart'],
      ['both pinch', 'hologram — pinch-drag to turn, spread to scale'],
      ['three fingers', 'shield on your arm — swipe fast to throw'],
    ],
  },
  {
    id: 'MYSTIC', tint: '#ffb545',
    rows: [
      ['two fingers', 'mandala shield'],
      ['horns', 'sling-ring portal'],
      ['point', 'Eye of Agamotto — hold to rewind time'],
      ['pinch', 'chaos magic — close hand to blast'],
      ['three fingers', 'mind stone — close hand to fire the beam'],
    ],
  },
  {
    id: 'JUJUTSU', tint: '#c08bff',
    rows: [
      ['point', 'Lapse: Blue — close hand to implode'],
      ['pinch', 'Reversal: Red — close hand to detonate'],
      ['blue + red together', 'HOLLOW PURPLE — close a hand to fire'],
      ['three fingers + swipe', 'Dismantle'],
      ['both two-fingers', 'DOMAIN: Unlimited Void'],
      ['both three-fingers', 'DOMAIN: Malevolent Shrine'],
    ],
  },
];
const ALWAYS = [
  ['both fists', 'hold → HULK (both palms to revert)'],
  ['both horns', 'switch loadout'],
];

/* -------------------------------- 2b. modes ------------------------------ */
/* Loadouts are gesture maps inside the POWERS mode. Modes are bigger than
   that: they change what the whole app is doing. */

const MODES = [
  { id: 'POWERS',    label: 'POWERS',    sub: 'suit up',      tint: '111,232,255' },
  { id: 'AR',        label: 'AR LAB',    sub: 'build',        tint: '150,235,255' },
  { id: 'NANO',      label: 'NANO',      sub: 'assemble',     tint: '255,170,90' },
  { id: 'PONG',      label: 'PING PONG', sub: 'rally',        tint: '140,255,180' },
  { id: 'BADMINTON', label: 'BADMINTON', sub: 'rally',        tint: '255,225,140' },
];

/* --------------------------- 3. module loading --------------------------- */

const VER = '0.10.14';
const MODULE_URLS = [
  `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VER}/vision_bundle.mjs`,
  `https://unpkg.com/@mediapipe/tasks-vision@${VER}/vision_bundle.mjs`,
  `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VER}`,
];
const WASM_URLS = [
  `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VER}/wasm`,
  `https://unpkg.com/@mediapipe/tasks-vision@${VER}/wasm`,
];
const MODELS = 'https://storage.googleapis.com/mediapipe-models';
const HAND_MODEL = `${MODELS}/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`;
const FACE_MODEL = `${MODELS}/face_landmarker/face_landmarker/float16/1/face_landmarker.task`;
const POSE_MODEL = `${MODELS}/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`;

const $ = (id) => document.getElementById(id);
function say(t) { $('bootMsg').textContent = t; }
function fail(e) {
  const box = $('bootErr');
  box.style.display = 'block';
  box.textContent = (e && (e.stack || e.message)) || String(e);
  $('start').disabled = false;
  $('start').textContent = 'RETRY';
  say('Could not start - details below.');
  $('boot').style.display = 'grid';
}
/** Try every mirror in turn so one blocked CDN cannot kill the app. */
async function firstThatWorks(urls, fn) {
  let last;
  for (const u of urls) { try { return await fn(u); } catch (e) { last = e; } }
  throw last;
}

/* -------------------------------- 4. audio ------------------------------- */
/* All synthesised - no sample files to go missing. */

const Sound = {
  ctx: null, master: null, muted: false, whine: null,
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = CONFIG.audio.volume;
    this.master.connect(this.ctx.destination);
  },
  noise(dur) {
    const n = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const s = this.ctx.createBufferSource(); s.buffer = buf; return s;
  },
  /** Continuous charge whine, pitched by how full the charge is. */
  setWhine(level, base) {
    if (!this.ctx) return;
    if (level <= 0.01 || this.muted) {
      if (this.whine) {
        const w = this.whine; this.whine = null;
        w.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
        setTimeout(() => { try { w.osc.stop(); } catch (e) {} }, 400);
      }
      return;
    }
    if (!this.whine) {
      const osc = this.ctx.createOscillator(); osc.type = 'triangle';
      const gain = this.ctx.createGain(); gain.gain.value = 0;
      osc.connect(gain); gain.connect(this.master); osc.start();
      this.whine = { osc, gain };
    }
    const t = this.ctx.currentTime;
    this.whine.osc.frequency.setTargetAtTime((base || 420) + level * 1500, t, 0.05);
    this.whine.gain.gain.setTargetAtTime(0.045 + level * 0.09, t, 0.05);
  },
  /** Shaped noise burst - the building block for most of the one-shots. */
  hit(o) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const dur = o.dur || 0.45;
    const src = this.noise(dur);
    const flt = this.ctx.createBiquadFilter();
    flt.type = o.type || 'bandpass'; flt.Q.value = o.q || 2;
    flt.frequency.setValueAtTime(o.f0 || 2200, t);
    flt.frequency.exponentialRampToValueAtTime(Math.max(40, o.f1 || 200), t + dur * 0.9);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(Math.max(0.001, o.gain || 0.8), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(flt); flt.connect(g); g.connect(this.master);
    src.start(); src.stop(t + dur + 0.05);
    if (o.sub) {
      const s = this.ctx.createOscillator(); s.type = 'sine';
      const sg = this.ctx.createGain();
      s.frequency.setValueAtTime(o.sub, t);
      s.frequency.exponentialRampToValueAtTime(o.sub * 0.25, t + dur * 0.8);
      sg.gain.setValueAtTime(o.subGain || 0.6, t);
      sg.gain.exponentialRampToValueAtTime(0.001, t + dur * 0.9);
      s.connect(sg); sg.connect(this.master); s.start(); s.stop(t + dur);
    }
  },
  blast(p) { this.hit({ f0: 2600, f1: 220, gain: 0.85 * (p || 1), sub: 180 }); },
  blueHit() { this.hit({ f0: 300, f1: 2600, gain: 0.5, dur: 0.6, q: 4, sub: 60, subGain: 0.5 }); },
  redHit() { this.hit({ f0: 1800, f1: 90, gain: 0.9, dur: 0.6, sub: 150, subGain: 0.8 }); },
  purple() { this.hit({ f0: 90, f1: 3400, gain: 0.95, dur: 1.4, q: 1.2, sub: 55, subGain: 0.95 }); },
  slash() { this.hit({ f0: 5200, f1: 900, gain: 0.5, dur: 0.16, q: 5 }); },
  thunder() { this.hit({ f0: 1200, f1: 45, gain: 1.0, dur: 1.5, q: 0.8, sub: 70, subGain: 0.9 }); },
  snapSfx() { this.hit({ f0: 7000, f1: 1200, gain: 0.7, dur: 0.09, q: 8 }); },
  clang() { this.hit({ f0: 3400, f1: 700, gain: 0.6, dur: 0.5, q: 6, sub: 220, subGain: 0.3 }); },
  chime() { this.hit({ f0: 2600, f1: 1800, gain: 0.35, dur: 0.8, q: 9 }); },
  portalSfx() { this.hit({ f0: 400, f1: 3800, gain: 0.5, dur: 0.8, q: 6 }); },
  domainSfx() { this.hit({ f0: 60, f1: 2200, gain: 1.0, dur: 2.4, q: 1, sub: 42, subGain: 1.0 }); },
  roar() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(92, t);
    o.frequency.exponentialRampToValueAtTime(54, t + 1.1);
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = 26;
    const lg = this.ctx.createGain(); lg.gain.value = 22;
    lfo.connect(lg); lg.connect(o.frequency); lfo.start(); lfo.stop(t + 1.3);
    const flt = this.ctx.createBiquadFilter();
    flt.type = 'lowpass'; flt.frequency.value = 900;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(0.8, t + 0.12);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.25);
    o.connect(flt); flt.connect(g); g.connect(this.master);
    o.start(); o.stop(t + 1.3);
    this.hit({ f0: 600, f1: 120, gain: 0.35, dur: 1.2, type: 'lowpass' });
  },
  servo(up) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 6; i++) {
      const o = this.ctx.createOscillator(); o.type = 'square';
      const g = this.ctx.createGain();
      const s = t + i * 0.055;
      o.frequency.setValueAtTime(up ? 300 + i * 130 : 900 - i * 120, s);
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.14, s + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.07);
      o.connect(g); g.connect(this.master);
      o.start(s); o.stop(s + 0.09);
    }
  },
};

/* ------------------------------- 5. globals ------------------------------ */

const video = $('cam');
const canvas = $('fx');
const ctx = canvas.getContext('2d');
const wrap = canvas.parentElement;

const mirror = document.createElement('canvas');   // flipped frame, screen sized
const mctx = mirror.getContext('2d');

const fx = new FX();
const comp = new Compositor();
const spill = new Spill();
const ash = new Ash();
const holo = new Hologram();
const bench = new Workbench();
const menu = new RadialMenu();
let game = null;
const timeStream = new TimeStream(80, 256);
const hands = [new HandState(), new HandState()];
const actors = [];                                 // beams, bolts, slashes...

let handLM = null, faceLM = null, poseLM = null;
let W = 0, H = 0, dpr = 1;
const view = { ox: 0, oy: 0, dw: 0, dh: 0, fill: true };
let running = false, debug = false, hudOn = true;
let lastVideoTs = -1, lastFace = null, lastPose = null;
let faceTick = 0, poseTick = 0;
let clock = 0, fpsSmooth = 60, quality = 1;
let lastNow = 0, lastDt = 0.016;

const power = {
  mode: 'POWERS', menuHold: 0, modeFade: 1,
  nano: 0, nanoOn: false,
  loadout: 0, switchHold: 0,
  helmet: 0, helmetOn: false, helmetCooldown: 0, eyeGlow: 0,
  suit: 0,
  gamma: 0, gammaOn: false, gammaCharge: 0, revert: 0,
  purple: 0, purpleReady: false, purpleMid: null,
  domain: 0, domainOn: null, domainCharge: 0, domainBurst: -1, domainHold: 0,
  snapFlash: 0, snapCooldown: 0, snapDrain: 0,
  timeOpen: 0, timeHand: null,
  mind: 0,
  shield: null, shieldArm: 0,
  holoHold: 0, holoGrabDist: 0,
  faceFrame: null,
};

const actorsAdd = (a) => { if (actors.length < 120) actors.push(a); };

/* ------------------------------- 6. startup ------------------------------ */

$('start').addEventListener('click', boot);

async function boot() {
  const btn = $('start');
  btn.disabled = true; btn.textContent = 'STARTING';
  $('bootErr').style.display = 'none';
  try {
    Sound.init();
    if (Sound.ctx && Sound.ctx.state === 'suspended') await Sound.ctx.resume();

    say('Opening camera...');
    await startCamera();

    say('Downloading models (first run only, ~16 MB)...');
    const vision = await firstThatWorks(MODULE_URLS, (u) => import(/* @vite-ignore */ u));
    const { FilesetResolver, HandLandmarker, FaceLandmarker, PoseLandmarker } = vision;
    const fileset = await firstThatWorks(WASM_URLS, (u) => FilesetResolver.forVisionTasks(u));

    say('Warming up the trackers...');
    handLM = await makeTask(HandLandmarker, fileset, HAND_MODEL,
      { numHands: 2, minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5 });
    faceLM = await makeTask(FaceLandmarker, fileset, FACE_MODEL,
      { numFaces: 1, outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false });
    // the body model only runs while the suit is up, but load it now so
    // suiting up never stalls
    try {
      poseLM = await makeTask(PoseLandmarker, fileset, POSE_MODEL,
        { numPoses: 1, minPoseDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
    } catch (e) {
      console.warn('pose model unavailable; body armour disabled', e);
      poseLM = null;
    }

    buildGuide();
    $('boot').style.display = 'none';
    running = true;
    toast('POWER ONLINE', '#6fe8ff');
    requestAnimationFrame(loop);
  } catch (e) {
    console.error(e);
    fail(e);
  }
}

/** GPU delegate where possible, CPU if the driver says no. */
async function makeTask(Klass, fileset, modelAssetPath, options) {
  for (const delegate of ['GPU', 'CPU']) {
    try {
      return await Klass.createFromOptions(fileset, {
        baseOptions: { modelAssetPath, delegate },
        runningMode: 'VIDEO', ...options,
      });
    } catch (e) { if (delegate === 'CPU') throw e; }
  }
}

async function startCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error(
      'getUserMedia is unavailable.\n' +
      'Browsers only expose the camera on a secure origin - serve this folder\n' +
      'over http://localhost (see README) instead of opening the file directly.');
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
  await new Promise((res) => {
    if (video.videoWidth) return res();
    video.onloadedmetadata = () => res();
  });
  layout();
}

/**
 * The canvas always fills the window. `view.fill` picks whether the camera
 * image covers it (cropping the edges) or fits inside it (letterboxed).
 * The flipped frame is rendered into a screen-sized buffer, so everything
 * downstream works in plain screen pixels.
 */
function layout() {
  if (!video.videoWidth) return;
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = Math.max(1, wrap.clientWidth);
  H = Math.max(1, wrap.clientHeight);
  canvas.style.left = '0px'; canvas.style.top = '0px';
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  mirror.width = canvas.width;
  mirror.height = canvas.height;

  const vw = video.videoWidth, vh = video.videoHeight;
  const s = view.fill ? Math.max(W / vw, H / vh) : Math.min(W / vw, H / vh);
  view.dw = vw * s; view.dh = vh * s;
  view.ox = (W - view.dw) / 2; view.oy = (H - view.dh) / 2;
  comp.resize(W, H);
  document.body.classList.toggle('small', W < 980 || H < 640);
}
window.addEventListener('resize', layout);

/** Landmarks arrive normalized and un-mirrored; map them into screen pixels. */
function toScreen(lms) {
  const out = new Array(lms.length);
  for (let i = 0; i < lms.length; i++) {
    out[i] = {
      x: view.ox + (1 - lms[i].x) * view.dw,
      y: view.oy + lms[i].y * view.dh,
      z: lms[i].z || 0,
      visibility: lms[i].visibility,
    };
  }
  return out;
}

/* --------------------------- 7. gesture -> power -------------------------- */

function assignHands(detections, dt) {
  const free = [0, 1];
  const taken = [null, null];
  for (const L of detections) {
    let bestI = -1, bestD = Infinity;
    for (const i of free) {
      if (!hands[i].active) continue;
      const d = dist(hands[i].palm, L[9]);
      if (d < bestD) { bestD = d; bestI = i; }
    }
    if (bestI < 0 || bestD > W * 0.45) bestI = free[0];
    free.splice(free.indexOf(bestI), 1);
    taken[bestI] = L;
  }
  for (let i = 0; i < 2; i++) {
    hands[i].landmarks = taken[i];
    if (taken[i]) hands[i].update(taken[i], dt); else hands[i].lost(dt);
  }
}

/** Ramp a 0..1 meter toward a target, faster up than down (or vice versa). */
const ramp = (v, want, rise, fall, dt) =>
  lerp(v, want, 1 - Math.exp(-(want > v ? rise : fall) * dt));

function setLoadout(i) {
  power.loadout = ((i % LOADOUTS.length) + LOADOUTS.length) % LOADOUTS.length;
  const L = LOADOUTS[power.loadout];
  buildGuide();
  Sound.chime();
  toast(L.id, L.tint);
}


function setMode(id) {
  if (power.mode === id) return;
  power.mode = id;
  power.modeFade = 0;
  const m = MODES.find((x) => x.id === id);

  // spin up / tear down whatever that mode owns
  if (id === 'PONG') game = new PingPong(W, H);
  else if (id === 'BADMINTON') game = new Badminton(W, H);
  else game = null;

  bench.open = id === 'AR' ? 0.01 : 0;
  if (id === 'AR') bench.setModel(bench.index);
  power.nanoOn = id === 'NANO';
  if (id !== 'POWERS') {
    holo.open = 0;
    for (const h of hands) { h.charge = h.blue = h.red = 0; h.chaos = 0; }
  }
  buildGuide();
  Sound.chime();
  toast(m ? m.label : id, m ? `rgb(${m.tint})` : '#6fe8ff');
}

/** One open hand and one fist, held together, opens the mode wheel. */
function updateMenu(dt) {
  const [h0, h1] = hands;
  const both = h0.active && h1.active;
  const openFist = both &&
    ((h0.gesture === 'OPEN' && h1.gesture === 'FIST') ||
     (h1.gesture === 'OPEN' && h0.gesture === 'FIST'));

  if (openFist && !menu.shown) {
    power.menuHold += dt;
    if (power.menuHold > CONFIG.menu.holdToOpen) {
      power.menuHold = 0;
      menu.show(MODES.map((m) => ({ label: m.label, sub: m.sub, tint: m.tint })),
                'MODE', W / 2, H / 2, Math.min(W, H) * CONFIG.menu.radius);
      Sound.chime();
    }
  } else if (!openFist) power.menuHold = 0;

  // aim with whichever hand is pointing; close it to commit
  let aim = null, fire = false;
  for (const h of hands) {
    if (!h.active) continue;
    if (h.gesture === 'POINT' || h.gesture === 'OPEN') { aim = h.palm; }
    if (h.gesture === 'FIST' && aim) fire = true;
  }
  const picked = menu.update(dt, menu.shown ? aim : null, fire);
  if (picked >= 0) setMode(MODES[picked].id);
  return menu.shown;
}

function updateAR(dt) {
  bench.open = ramp(bench.open, 1, CONFIG.ar.riseRate, 4, dt);
  bench._cx = W / 2; bench._cy = H * 0.5;
  driveWorkbench(bench, hands, dt, CONFIG.ar);
  bench.update(dt);

  // horns flips to the next model
  const horns = hands.find((h) => h.active && h.gesture === 'HORNS');
  if (horns) {
    power.modelHold = (power.modelHold || 0) + dt;
    if (power.modelHold > 0.7) {
      power.modelHold = -0.8;
      bench.setModel(bench.index + 1);
      Sound.servo(true);
      toast(bench.model.name, '#6fe8ff');
    }
  } else power.modelHold = Math.min(0, (power.modelHold || 0) + dt);

  bench.hint = bench.explode > 0.05
    ? 'open palm to close it up'
    : 'pinch to grab · two hands to pull apart · horns for next model';
}

function updateNano(dt, pose) {
  // both palms open = deploy, both fists = retract
  const [h0, h1] = hands;
  if (h0.active && h1.active) {
    if (h0.gesture === 'OPEN' && h1.gesture === 'OPEN') power.nanoOn = true;
    if (h0.gesture === 'FIST' && h1.gesture === 'FIST') power.nanoOn = false;
  }
  const was = power.nano;
  power.nano = ramp(power.nano, power.nanoOn ? 1 : 0,
                    CONFIG.nano.riseRate, CONFIG.nano.fallRate, dt);
  if (was < 0.02 && power.nano >= 0.02) Sound.servo(true);
  if (power.nano > 0.02 && power.nano < 0.99) fx.addShake(1.4);
}

function updatePowers(dt, face, pose) {
  const fr = face ? faceFrame(face) : null;
  power.faceFrame = fr;
  const headTop = fr ? fr.cy - fr.h * 0.85 : H * 0.28;
  const lo = LOADOUTS[power.loadout].id;

  power.helmetCooldown = Math.max(0, power.helmetCooldown - dt);
  power.snapCooldown = Math.max(0, power.snapCooldown - dt);

  let whine = 0, whineBase = 420;
  let bothFist = true, bothOpen = true, bothHorns = true, bothPinch = true;
  const [h0, h1] = hands;
  const bothLive = h0.active && h1.active;
  const apart = bothLive ? dist(h0.palm, h1.palm) : Infinity;
  const near = bothLive &&
    apart < ((h0.size + h1.size) / 2) * CONFIG.domain.together;

  for (const h of hands) {
    if (!h.active) {
      h.mandala = ramp(h.mandala, 0, 9, 9, dt);
      h.portal = ramp(h.portal, 0, 6, 6, dt);
      h.blue = ramp(h.blue, 0, 6, 6, dt);
      h.red = ramp(h.red, 0, 6, 6, dt);
      h.chaos = ramp(h.chaos || 0, 0, 6, 6, dt);
      h.gauntlet = ramp(h.gauntlet, 0, 7, 7, dt);
      h.hammer = ramp(h.hammer, 0, 7, 7, dt);
      bothFist = bothOpen = bothHorns = bothPinch = false;
      continue;
    }
    h.onFace = !!fr &&
      dist(h.palm, { x: fr.cx, y: fr.cy }) < fr.w * CONFIG.helmet.faceRadius;
    h.raised = h.palm.y < headTop;
    const g = h.gesture;
    if (g !== 'FIST') bothFist = false;
    if (g !== 'OPEN') bothOpen = false;
    if (g !== 'HORNS') bothHorns = false;
    if (g !== 'PINCH') bothPinch = false;

    // a closing hand either suits you up or releases whatever it was holding
    if (h.takeClose()) {
      if (h.onFace && power.helmetCooldown <= 0) {
        power.helmetOn = !power.helmetOn;
        power.helmetCooldown = CONFIG.helmet.cooldown;
        Sound.servo(power.helmetOn);
        fx.burst(h.palm.x, h.palm.y, 30, 'rgba(255,205,120,1)',
                 { speed: 420, life: 0.6, drag: 2.4 });
        fx.addShake(7);
        toast(power.helmetOn ? 'SUIT UP' : 'STAND DOWN', '#ffc542');
      } else {
        fireFromHand(h, lo);
      }
      h.charge = 0; h.blue = 0; h.red = 0; h.chaos = 0;
    }

    if (lo === 'STARK') updateStark(h, dt);
    else if (lo === 'MYSTIC') updateMystic(h, dt);
    else updateJujutsu(h, dt);

    whine = Math.max(whine, h.charge, h.blue, h.red, h.chaos || 0);
    if (h.blue > 0.05) whineBase = 220;
    if (h.red > 0.05) whineBase = 700;
  }

  /* ------------------------------------------------ two-hand combos ----- */

  // loadout switch: both hands in horns. The negative hold is a lockout so
  // one long gesture cannot cycle through every loadout.
  if (bothHorns && bothLive) {
    if (power.switchHold >= 0) {
      power.switchHold += dt;
      if (power.switchHold > 0.8) {
        power.switchHold = -1.2;
        setLoadout(power.loadout + 1);
      }
    }
  } else if (power.switchHold > 0) power.switchHold = 0;
  if (power.switchHold < 0) power.switchHold = Math.min(0, power.switchHold + dt);

  // Hollow Purple: a charged Blue and a charged Red brought together
  if (lo === 'JUJUTSU') {
    const blueH = hands.find((h) => h.blue > 0.5);
    const redH = hands.find((h) => h.red > 0.5);
    const merging = blueH && redH && blueH !== redH &&
      dist(blueH.palm, redH.palm) <
        ((blueH.size + redH.size) / 2) * CONFIG.purple.mergeDistance;
    if (merging) {
      power.purple = clamp(power.purple + dt / CONFIG.purple.chargeSeconds, 0, 1);
      power.purpleMid = {
        x: (blueH.palm.x + redH.palm.x) / 2,
        y: (blueH.palm.y + redH.palm.y) / 2,
        r: (blueH.size + redH.size) / 2,
      };
      fx.addShake(power.purple * 4);
      if (Math.random() < power.purple) {
        fx.inhale(power.purpleMid.x, power.purpleMid.y,
                  power.purpleMid.r * 0.6, 'rgba(210,160,255,1)');
      }
      whine = Math.max(whine, power.purple); whineBase = 130;
      power.purpleReady = power.purple > 0.6;
    } else {
      power.purple = Math.max(0, power.purple - dt * 1.6);
      if (power.purple <= 0.01) power.purpleReady = false;
    }
  } else {
    power.purple = Math.max(0, power.purple - dt * 2);
    power.purpleReady = false;
  }

  // Domain Expansion: both hands in the same sign, held together
  let wantDomain = null;
  if (lo === 'JUJUTSU' && near) {
    if (h0.gesture === 'PEACE' && h1.gesture === 'PEACE') wantDomain = 'VOID';
    else if (h0.gesture === 'THREE' && h1.gesture === 'THREE') wantDomain = 'SHRINE';
  }
  if (wantDomain && power.domainOn !== wantDomain) {
    power.domainCharge += dt;
    fx.addShake(power.domainCharge * 5);
    if (power.domainCharge >= CONFIG.domain.holdSeconds) {
      power.domainOn = wantDomain;
      power.domainCharge = 0;
      power.domainBurst = 0;
      Sound.domainSfx();
      fx.addShake(40);
      fx.addFlash(0.6, wantDomain === 'VOID' ? [180, 215, 255] : [255, 90, 60]);
      toast(wantDomain === 'VOID' ? 'UNLIMITED VOID' : 'MALEVOLENT SHRINE',
            wantDomain === 'VOID' ? '#bcd8ff' : '#ff6a4a');
    }
  } else if (!wantDomain) {
    power.domainCharge = Math.max(0, power.domainCharge - dt * 1.5);
    // a domain drops once you break the sign and lower your hands
    if (power.domainOn && !bothLive) {
      power.domainHold += dt;
      if (power.domainHold > 1.6) { power.domainOn = null; power.domainHold = 0; }
    } else power.domainHold = 0;
  }
  if (power.domainBurst >= 0) {
    power.domainBurst += dt / 0.9;
    if (power.domainBurst > 1) power.domainBurst = -1;
  }
  power.domain = ramp(power.domain, power.domainOn ? 1 : 0,
                      CONFIG.domain.riseRate, CONFIG.domain.fallRate, dt);

  // hologram
  if (lo === 'STARK') updateHologram(dt, bothPinch, bothLive);
  else holo.open = ramp(holo.open, 0, 4, 4, dt);

  // gamma - available in every loadout
  const charging = bothFist && bothLive && !h0.onFace && !h1.onFace &&
                   !h0.raised && !h1.raised;
  if (charging && !power.gammaOn) {
    power.gammaCharge = clamp(power.gammaCharge + dt / CONFIG.gamma.holdToTransform, 0, 1);
    fx.addShake(power.gammaCharge * 3.2);
    for (const h of hands) {
      if (Math.random() < power.gammaCharge) {
        fx.inhale(h.palm.x, h.palm.y, h.size * 0.5, 'rgba(140,255,90,1)');
      }
    }
    if (power.gammaCharge >= 1) {
      power.gammaOn = true;
      Sound.roar();
      fx.addShake(38);
      fx.addFlash(0.55, [130, 255, 110]);
      if (fr) {
        fx.shock(fr.cx, fr.cy, fr.w * 6, 'rgba(150,255,120,0.9)', 0.9, 14);
        fx.burst(fr.cx, fr.cy, 90, 'rgba(180,255,140,1)',
                 { speed: 1100, life: 1.1, drag: 1.6, grav: 500, size: 4 });
      }
      toast('GAMMA OVERLOAD', '#8dfd5c');
    }
  } else if (!power.gammaOn) {
    power.gammaCharge = Math.max(0, power.gammaCharge - dt * 0.8);
  }
  if (power.gammaOn) {
    power.revert = bothOpen ? power.revert + dt : 0;
    if (power.revert > CONFIG.gamma.holdToRevert) {
      power.gammaOn = false; power.gammaCharge = 0; power.revert = 0;
      toast('STABILISED', '#8dfd5c');
    }
  }
  power.gamma = ramp(power.gamma, power.gammaOn ? 1 : 0,
                     CONFIG.gamma.riseRate, CONFIG.gamma.fallRate, dt);
  if (power.gamma > 0.25) {
    fx.addShake(power.gamma * CONFIG.gamma.shake * (0.6 + Math.random() * 0.8));
  }

  Sound.setWhine(whine, whineBase);

  power.helmet = ramp(power.helmet, power.helmetOn ? 1 : 0,
                      CONFIG.helmet.riseRate, CONFIG.helmet.fallRate, dt);
  power.suit = ramp(power.suit, power.helmetOn ? 1 : 0,
                    CONFIG.suit.riseRate, CONFIG.suit.fallRate, dt);
  power.eyeGlow = Math.max(0.55 + Math.sin(clock * 2.2) * 0.12, power.eyeGlow - dt * 2.2);
  power.snapFlash = Math.max(0, power.snapFlash - dt * 1.6);
  power.snapDrain = Math.max(0, power.snapDrain - dt * 0.22);
}

/* ------------------------------------------------------- per-loadout ---- */

function updateStark(h, dt) {
  const g = h.gesture;

  // repulsor
  if (g === 'OPEN' && !h.onFace) {
    h.charge = clamp(h.charge + dt / CONFIG.repulsor.chargeSeconds, 0, 1);
    if (h.charge > 0.05 && Math.random() < 0.75) {
      fx.inhale(h.palm.x, h.palm.y, h.size * 0.4, 'rgba(150,235,255,1)');
    }
  } else if (g !== 'FIST') {
    h.charge = Math.max(0, h.charge - dt * CONFIG.repulsor.decayPerSec);
  }

  // Mjolnir: a fist held above your own head
  if (g === 'FIST' && h.raised) {
    h.hammerHold = (h.hammerHold || 0) + dt;
    if (h.hammerHold > CONFIG.mjolnir.holdSeconds) {
      if (h.hammer < 0.02) { Sound.thunder(); toast('MJOLNIR', '#bfe6ff'); }
      h.hammer = ramp(h.hammer, 1, CONFIG.mjolnir.riseRate, 6, dt);
      h.strikeIn = (h.strikeIn || 0) - dt;
      if (h.strikeIn <= 0) {
        h.strikeIn = CONFIG.mjolnir.strikeEvery * rand(0.6, 1.6);
        actorsAdd(new Bolt(h.palm.x + rand(-W * 0.3, W * 0.3), -40,
                           h.palm.x, h.palm.y - h.size * 0.8, '150,215,255', 3.2));
        fx.addFlash(0.10, [170, 220, 255]);
        fx.burst(h.palm.x, h.palm.y, 10, 'rgba(200,235,255,1)',
                 { speed: 320, life: 0.35 });
      }
    }
  } else {
    if (h.hammer > 0.4 && g === 'OPEN') {          // let the charge go
      Sound.thunder();
      fx.addFlash(0.45, [190, 230, 255]);
      fx.addShake(26);
      for (let i = 0; i < 5; i++) {
        actorsAdd(new Bolt(h.palm.x, h.palm.y,
          h.palm.x + rand(-W, W), h.palm.y + rand(-H * 0.4, H * 0.7),
          '170,225,255', 3.6));
      }
      fx.shock(h.palm.x, h.palm.y, 420, 'rgba(190,235,255,0.9)', 0.6, 10);
    }
    h.hammerHold = 0;
    h.hammer = ramp(h.hammer, 0, 6, 7, dt);
  }

  // gauntlet + snap
  const wantG = g === 'SNAP';
  if (wantG && h.gauntlet < 0.02) Sound.servo(true);
  h.gauntlet = ramp(h.gauntlet, wantG ? 1 : 0,
                    CONFIG.gauntlet.riseRate, CONFIG.gauntlet.fallRate, dt);
  if (h.takeSnap() && h.gauntlet > 0.45 && power.snapCooldown <= 0) doSnap(h);

  // shield
  const wantS = g === 'THREE';
  power.shieldArm = ramp(power.shieldArm, wantS ? 1 : 0, 8, 8, dt);
  if (wantS && h.speed > CONFIG.dismantle.minSpeed * 1.2 && !power.shield) {
    const d = { x: h.vel.x / h.speed, y: h.vel.y / h.speed };
    power.shield = new ShieldThrow(h.palm.x, h.palm.y, d.x, d.y,
                                   h.size * CONFIG.shield.scale, W, H);
    Sound.clang();
    fx.addShake(8);
  }
}

function updateMystic(h, dt) {
  const g = h.gesture;

  const wantM = g === 'PEACE' ? 1 : 0;
  h.mandala = ramp(h.mandala, wantM, CONFIG.mandala.riseRate, CONFIG.mandala.fallRate, dt);
  if (wantM && h.mandala > 0.3 && Math.random() < 0.5) {
    const a = rand(0, TAU), r = h.size * CONFIG.mandala.scale * h.mandala;
    fx.spark({ x: h.palm.x + Math.cos(a) * r, y: h.palm.y + Math.sin(a) * r * 0.62,
      vx: rand(-25, 25), vy: rand(-60, -15), life: rand(0.3, 0.8),
      size: rand(0.8, 2.2), col: 'rgba(255,180,70,1)', drag: 1.1 });
  }

  const wantP = g === 'HORNS' ? 1 : 0;
  if (wantP && h.portal < 0.02) Sound.portalSfx();
  h.portal = ramp(h.portal, wantP, CONFIG.portal.riseRate, CONFIG.portal.fallRate, dt);
  h.portalR = h.size * CONFIG.portal.scale;
  if (wantP && h.portal > 0.25) {
    const a = rand(0, TAU), r = h.portalR * h.portal;
    fx.spark({ x: h.palm.x + Math.cos(a) * r, y: h.palm.y + Math.sin(a) * r,
      vx: Math.cos(a) * 30 + rand(-20, 20), vy: Math.sin(a) * 30 - 40,
      life: rand(0.35, 0.9), size: rand(1, 2.8),
      col: 'rgba(255,160,50,1)', drag: 1.3 });
  }

  // Eye of Agamotto -> time rewind
  const wantT = g === 'POINT';
  if (wantT) {
    if (power.timeOpen < 0.02) { Sound.chime(); toast('TIME', '#7bffa8'); }
    power.timeHand = h;
  }
  power.timeOpen = ramp(power.timeOpen, wantT ? 1 : 0, CONFIG.timeStone.riseRate, 4, dt);

  // chaos magic
  const wantC = g === 'PINCH';
  h.chaos = wantC ? clamp((h.chaos || 0) + dt / CONFIG.chaos.chargeSeconds, 0, 1)
                  : Math.max(0, (h.chaos || 0) - dt * 1.2);
  if (wantC && Math.random() < 0.6) {
    fx.spark({ x: h.palm.x + rand(-h.size, h.size), y: h.palm.y + rand(-h.size, h.size),
      vx: rand(-40, 40), vy: rand(-70, 10), life: rand(0.3, 0.9),
      size: rand(1, 2.6), col: 'rgba(255,70,50,1)', drag: 1.4 });
  }

  // mind stone
  power.mind = ramp(power.mind, g === 'THREE' ? 1 : 0, 6, 5, dt);
}

function updateJujutsu(h, dt) {
  const g = h.gesture;

  h.blue = g === 'POINT' ? clamp(h.blue + dt / CONFIG.blue.chargeSeconds, 0, 1)
                         : Math.max(0, h.blue - dt * 1.3);
  if (g === 'POINT' && h.blue > 0.08 && Math.random() < 0.85) {
    fx.inhale(h.palm.x, h.palm.y, h.size * 0.55, 'rgba(120,200,255,1)');
  }

  h.red = g === 'PINCH' ? clamp(h.red + dt / CONFIG.red.chargeSeconds, 0, 1)
                        : Math.max(0, h.red - dt * 1.3);
  if (g === 'PINCH' && h.red > 0.08 && Math.random() < 0.7) {
    const a = rand(0, TAU), r = h.size * 0.7;
    fx.spark({ x: h.palm.x + Math.cos(a) * r, y: h.palm.y + Math.sin(a) * r,
      vx: Math.cos(a) * 260, vy: Math.sin(a) * 260, life: rand(0.2, 0.5),
      size: rand(1, 2.8), col: 'rgba(255,150,70,1)', drag: 2.6 });
  }

  // Dismantle: a fast sweep with three fingers cuts across the sweep
  if (g === 'THREE') {
    h.slashCd = (h.slashCd || 0) - dt;
    if (h.speed > CONFIG.dismantle.minSpeed && h.slashCd <= 0) {
      h.slashCd = CONFIG.dismantle.cooldown;
      const d = { x: h.vel.x / h.speed, y: h.vel.y / h.speed };
      actorsAdd(new Slash(h.palm.x, h.palm.y, -d.y, d.x,
                          h.size * CONFIG.dismantle.lengthScale, h.size * 0.14));
      Sound.slash();
      fx.addShake(4);
      fx.burst(h.palm.x, h.palm.y, 8, 'rgba(255,190,170,1)',
               { speed: 420, life: 0.3, drag: 3 });
    }
  }
}

/** What a closing hand does depends on what it was holding. */
function fireFromHand(h, lo) {
  const len = Math.max(W, H) * CONFIG.repulsor.beamLength;

  if (lo === 'JUJUTSU' && power.purpleReady) {
    const m = power.purpleMid || h.palm;
    actorsAdd(new PurpleBeam(m.x, m.y, h.dir.x, h.dir.y,
      Math.max(W, H) * 2, Math.min(W, H) * CONFIG.purple.beamWidth));
    Sound.purple();
    fx.addShake(44);
    fx.addFlash(0.7, [210, 160, 255]);
    fx.shock(m.x, m.y, Math.max(W, H), 'rgba(220,170,255,0.9)', 1.0, 16);
    fx.burst(m.x, m.y, 120, 'rgba(225,180,255,1)',
             { speed: 1500, life: 1.2, drag: 1.5, size: 4 });
    power.purple = 0; power.purpleReady = false;
    for (const hh of hands) { hh.blue = 0; hh.red = 0; }
    toast('HOLLOW PURPLE', '#c08bff');
    return;
  }

  if (lo === 'JUJUTSU') {
    if (h.blue > CONFIG.blue.minFire) {
      const p = h.blue;
      Sound.blueHit();
      fx.addShake(16 * p);
      fx.addFlash(0.2 * p, [90, 170, 255]);
      fx.shock(h.palm.x, h.palm.y, 240 * p, 'rgba(120,200,255,0.9)', 0.5, 8);
      // everything is dragged in first, then cracks outward
      for (let i = 0; i < 70; i++) {
        const a = rand(0, TAU), d = rand(h.size * 2, h.size * 9);
        fx.spark({ x: h.palm.x + Math.cos(a) * d, y: h.palm.y + Math.sin(a) * d,
          vx: 0, vy: 0, life: rand(0.25, 0.6), size: rand(1, 3),
          col: 'rgba(150,215,255,1)', drag: 0.1,
          toward: { x: h.palm.x, y: h.palm.y }, pull: 5200 });
      }
      actorsAdd(new EnergyBeam(h.palm.x, h.palm.y, h.dir.x, h.dir.y,
        len * 0.8, h.size * 0.5 * p, '80,170,255', 0.4));
      return;
    }
    if (h.red > CONFIG.red.minFire) {
      const p = h.red;
      Sound.redHit();
      fx.addShake(26 * p);
      fx.addFlash(0.32 * p, [255, 140, 70]);
      fx.shock(h.palm.x, h.palm.y, 520 * p, 'rgba(255,150,80,0.95)', 0.6, 12);
      fx.burst(h.palm.x, h.palm.y, 90, 'rgba(255,170,90,1)',
               { speed: 1500 * p, life: 0.9, drag: 1.8, size: 3.4 });
      actorsAdd(new EnergyBeam(h.palm.x, h.palm.y, h.dir.x, h.dir.y,
        len, h.size * 0.7 * p, '255,90,40', 0.45));
      return;
    }
    return;
  }

  if (lo === 'MYSTIC') {
    if ((h.chaos || 0) > CONFIG.chaos.minFire) {
      const p = h.chaos;
      Sound.redHit();
      fx.addShake(18 * p);
      fx.addFlash(0.22 * p, [255, 60, 60]);
      actorsAdd(new EnergyBeam(h.palm.x, h.palm.y, h.dir.x, h.dir.y,
        len, h.size * 0.55 * p, '230,30,40', 0.5));
      fx.burst(h.palm.x, h.palm.y, 50, 'rgba(255,80,60,1)',
               { speed: 900, life: 0.8, drag: 2 });
      return;
    }
    if (power.mind > 0.5 && power.faceFrame) {
      const fr = power.faceFrame;
      const p = fr.to(0, 0.72);
      const aim = { x: 0, y: 1 };           // the beam goes where you look: forward
      actorsAdd(new EnergyBeam(p.x, p.y, aim.x, aim.y, len, fr.w * 0.12,
                               '255,210,60', 0.55));
      Sound.blast(1);
      fx.addShake(14);
      fx.addFlash(0.25, [255, 220, 90]);
      return;
    }
    return;
  }

  // STARK
  if (h.charge > CONFIG.repulsor.minFire) {
    const p = h.charge;
    fx.fire(h.palm.x, h.palm.y, h.dir.x, h.dir.y, p, len);
    Sound.blast(p);
    power.eyeGlow = Math.max(power.eyeGlow, 0.9 * p);
  }
}

/* ------------------------------------------------------------- the snap -- */

function doSnap(h) {
  const fr = power.faceFrame;
  power.snapCooldown = CONFIG.snap.cooldown;
  power.snapFlash = 1;
  power.snapDrain = 1;
  Sound.snapSfx();
  setTimeout(() => Sound.hit({ f0: 40, f1: 20, gain: 1, dur: 2.6,
                               type: 'lowpass', sub: 38, subGain: 1 }), 120);
  fx.addFlash(0.8, [255, 200, 120]);
  fx.addShake(30);
  fx.shock(h.palm.x, h.palm.y, Math.max(W, H) * 1.2, 'rgba(255,210,140,0.9)', 1.1, 18);

  // tear the person apart, starting at the head and sweeping down
  const x0 = clamp(fr ? fr.cx - fr.w * 1.6 : W * 0.3, 0, W - 10);
  const y0 = clamp(fr ? fr.cy - fr.h * 1.0 : H * 0.2, 0, H - 10);
  const w = Math.min(fr ? fr.w * 3.2 : W * 0.4, W - x0);
  const hh = Math.min(fr ? fr.h * 4.5 : H * 0.7, H - y0);
  ash.seed(x0, y0, w, hh, CONFIG.snap.ashFlakes, { sweep: 1.4, up: -90 });
  toast('THE SNAP', '#ffc98a');
}

/* ------------------------------------------------------------ hologram -- */

function updateHologram(dt, bothPinch, bothLive) {
  const [h0, h1] = hands;
  if (bothPinch && bothLive && holo.open < 0.5) {
    power.holoHold += dt;
    if (power.holoHold > CONFIG.holo.openHold) {
      holo.open = 0.01; power.holoHold = 0;
      Sound.chime(); toast('HOLOGRAM', '#6fe8ff');
    }
  } else if (!bothPinch) power.holoHold = 0;

  if (holo.open <= 0.005) return;
  holo.open = ramp(holo.open, 1, CONFIG.holo.riseRate, 4, dt);

  if (bothPinch && bothLive) {
    // two pinched hands: their separation sets the scale
    const d = dist(h0.palm, h1.palm);
    if (!power.holoGrabDist) power.holoGrabDist = d;
    holo.scale = clamp(holo.scale * (1 + (d - power.holoGrabDist) * 0.0016), 0.4, 2.6);
    power.holoGrabDist = d;
    holo.grabbed = true;
  } else {
    power.holoGrabDist = 0;
    const g = hands.find((h) => h.active && h.gesture === 'PINCH');
    if (g) {
      holo.grabbed = true;
      holo.ry += g.vel.x * CONFIG.holo.rotateGain * dt;
      holo.rx = clamp(holo.rx - g.vel.y * CONFIG.holo.rotateGain * dt, -1.3, 1.3);
    } else {
      holo.grabbed = false;
      holo.ry += dt * 0.28;                     // idle turntable
    }
  }

  // a fist at chest height dismisses it
  if (hands.some((h) => h.active && h.gesture === 'FIST' && !h.raised)) {
    holo.open = ramp(holo.open, 0, 5, 5, dt);
    if (holo.open < 0.03) holo.open = 0;
  }
}

/* -------------------------------- 8. render ------------------------------ */

function render(face, pose) {
  const c = ctx;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, W, H);

  const sh = fx.shake;
  if (sh > 0.2) {
    c.translate(rand(-sh, sh), rand(-sh, sh));
    c.rotate(rand(-sh, sh) * 0.0009);
  }

  /* 1. the mirrored camera frame, rendered into a screen-sized buffer so
        everything downstream works in plain screen pixels */
  mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  mctx.fillStyle = '#05070c';
  mctx.fillRect(0, 0, W, H);
  mctx.save();
  mctx.translate(W, 0); mctx.scale(-1, 1);
  mctx.drawImage(video, W - view.ox - view.dw, view.oy, view.dw, view.dh);
  mctx.restore();

  timeStream.push(mirror, mirror.width, mirror.height);
  c.drawImage(mirror, 0, 0, W, H);

  // the rewind plays the recent past back over the live picture
  if (power.timeOpen > 0.02) {
    timeStream.draw(c, W, H, power.timeOpen, lastDt, CONFIG.timeStone.rewindRate);
  }

  /* 2. full-frame grades */
  gammaGrade(c, power.gamma, W, H, clock);
  if (power.domain > 0.01 && power.domainOn === 'SHRINE') {
    drawShrine(c, W, H, power.domain, clock);
  }
  if (power.snapDrain > 0.01) {
    desaturate(c, mirror, W, H, power.snapDrain * 0.75);
    grade(c, W, H, '#c8a06a', power.snapDrain * 0.25, 'multiply');
  }

  /* 3. light thrown onto the room by whatever is in your hands */
  for (const h of hands) {
    if (!h.active) continue;
    if (h.charge > 0.02) spill.add(h.palm.x, h.palm.y, h.size * 7, '120,215,255', h.charge);
    if (h.blue > 0.02) spill.add(h.palm.x, h.palm.y, h.size * 8, '60,150,255', h.blue);
    if (h.red > 0.02) spill.add(h.palm.x, h.palm.y, h.size * 8, '255,90,40', h.red);
    if ((h.chaos || 0) > 0.02) spill.add(h.palm.x, h.palm.y, h.size * 8, '230,40,45', h.chaos);
    if (h.hammer > 0.02) spill.add(h.palm.x, h.palm.y, h.size * 9, '150,210,255', h.hammer);
    if (h.gauntlet > 0.02) spill.add(h.palm.x, h.palm.y, h.size * 6, '255,190,60', h.gauntlet);
  }
  if (power.purple > 0.02 && power.purpleMid) {
    spill.add(power.purpleMid.x, power.purpleMid.y, power.purpleMid.r * 12,
              '170,90,255', power.purple);
  }
  spill.draw(c, W, H);

  /* 4. the face and the body */
  const fr = power.faceFrame;
  if (fr) {
    drawGamma(c, mirror, face, fr, power.gamma, clock, W, H);
    if (power.suit > 0.01 && pose) drawArmor(c, pose, power.suit, clock);
    drawHelmet(c, fr, power.helmet, power.eyeGlow, clock);
    if (debug) drawFaceDots(c, face);
  } else if (power.suit > 0.01 && pose) {
    drawArmor(c, pose, power.suit, clock);
  }

  /* 4b. the nano suit crawls over your real body */
  if (power.nano > 0.005 && pose) drawNano(c, pose, power.nano, clock, fx);

  /* 5. disintegration rides over the body, under the effects */
  ash.draw(c, mirror, W, H, mirror.width, mirror.height);

  /* ---- everything below goes on the effect layer, so it blooms -------- */
  const e = comp.begin(W, H);
  e.setTransform(dpr, 0, 0, dpr, 0, 0);

  if (power.domain > 0.01 && power.domainOn === 'VOID') {
    drawVoid(e, W, H, power.domain, clock, fr ? { x: fr.cx, y: fr.cy } : null);
  }
  if (power.domainBurst >= 0) {
    drawDomainBurst(e, fr ? fr.cx : W / 2, fr ? fr.cy : H / 2,
      Math.max(W, H) * 1.1, power.domainBurst,
      power.domainOn === 'VOID' ? 'rgba(190,225,255,0.9)' : 'rgba(255,110,70,0.9)');
  }

  if (power.timeOpen > 0.02) {
    const th = power.timeHand && power.timeHand.active ? power.timeHand : null;
    drawEye(e, th ? th.palm.x : (fr ? fr.cx : W / 2),
            th ? th.palm.y : (fr ? fr.cy + fr.h : H / 2),
            (th ? th.size : 80) * 0.45, power.timeOpen, clock);
    drawTimeRings(e, W / 2, H / 2, Math.min(W, H) * 0.45, power.timeOpen, clock);
  }

  if (fr && power.mind > 0.02) drawMindStone(e, fr, power.mind, clock);

  const lo = LOADOUTS[power.loadout].id;
  for (const h of hands) {
    if (!h.active) continue;
    if (h.portal > 0.01) {
      drawPortal(e, h.palm.x, h.palm.y, h.portalR * h.portal, clock, h.portal);
    }
    if (h.mandala > 0.01) {
      const tilt = Math.atan2(h.dir.y, h.dir.x) + Math.PI / 2;
      drawMandala(e, h.palm.x, h.palm.y, h.size * CONFIG.mandala.scale * h.mandala,
                  clock, h.mandala, tilt * 0.35);
    }
    if (h.charge > 0.005) {
      drawRepulsor(e, h.palm.x, h.palm.y,
                   h.size * CONFIG.repulsor.glowScale, h.charge, clock);
    }
    if (h.blue > 0.005) drawBlue(e, h.palm.x, h.palm.y, h.size * CONFIG.blue.scale, h.blue, clock);
    if (h.red > 0.005) drawRed(e, h.palm.x, h.palm.y, h.size * CONFIG.red.scale, h.red, clock);
    if ((h.chaos || 0) > 0.005) {
      drawChaos(e, h.palm.x, h.palm.y, h.size * CONFIG.chaos.scale, h.chaos, clock, h.trail);
    }
    if (h.hammer > 0.02) {
      drawMjolnir(e, h.palm.x, h.palm.y, Math.atan2(h.dir.x, -h.dir.y),
                  h.size * 0.85 * h.hammer, h.hammer, clock);
    }
    if (h.gauntlet > 0.02 && h.landmarks) {
      drawGauntlet(e, h.landmarks, h.gauntlet, clock, 1 + power.snapFlash * 2);
    }
    if (power.shieldArm > 0.02 && !power.shield && lo === 'STARK' && h.gesture === 'THREE') {
      drawShield(e, h.palm.x, h.palm.y,
                 h.size * CONFIG.shield.scale * power.shieldArm, clock * 0.6, 0.55, clock);
    }
  }

  if (power.purple > 0.02 && power.purpleMid) {
    drawPurple(e, power.purpleMid.x, power.purpleMid.y,
               power.purpleMid.r * 1.1, power.purple, clock);
  }

  if (power.shield) power.shield.draw(e);
  for (const a of actors) a.draw(e);

  if (holo.open > 0.01) {
    holo.draw(e, W * 0.5, H * 0.48, Math.min(W, H) * 0.17, clock);
  }

  /* the AR workbench and the games live on the effect layer too, so they
     pick up the same bloom as everything else */
  if (bench.open > 0.01) {
    bench.draw(e, W * 0.5, H * 0.5, Math.min(W, H) * CONFIG.ar.size, clock);
  }
  if (game) {
    game.draw(e, clock);
    if (game.shake > 0.2) fx.addShake(game.shake * 0.35);
  }
  menu.draw(e, clock);

  // charge rings between the hands
  if (hands[0].active && hands[1].active) {
    const mx = (hands[0].palm.x + hands[1].palm.x) / 2;
    const my = (hands[0].palm.y + hands[1].palm.y) / 2;
    if (power.gammaCharge > 0.02 && !power.gammaOn) {
      ringMeter(e, mx, my, dist(hands[0].palm, hands[1].palm) / 2 + 24,
                power.gammaCharge, '140,255,110');
    }
    if (power.domainCharge > 0.05) {
      const p = clamp(power.domainCharge / CONFIG.domain.holdSeconds, 0, 1);
      ringMeter(e, mx, my, Math.min(W, H) * 0.16 * (0.5 + p * 0.5), p, '200,180,255');
    }
  }

  fx.draw(e);

  /* 6. bleed the effect layer onto the frame */
  c.setTransform(1, 0, 0, 1, 0, 0);
  comp.composite(c, CONFIG.bloom.strength * quality);
  c.setTransform(dpr, 0, 0, dpr, 0, 0);

  fx.drawFlash(c, W, H);
  if (power.snapFlash > 0.01) grade(c, W, H, '#ffd9a0', power.snapFlash * 0.5, 'lighter');

  /* 7. debug + finishing */
  if (debug) {
    for (const h of hands) if (h.active && h.landmarks) drawSkeleton(c, h.landmarks);
    if (pose) drawPoseSticks(c, pose);
  }

  c.setTransform(1, 0, 0, 1, 0, 0);
  comp.drawGrain(c, canvas.width, canvas.height, CONFIG.bloom.grain * quality);
  c.setTransform(dpr, 0, 0, dpr, 0, 0);

  const vg = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35,
                                    W / 2, H / 2, Math.max(W, H) * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.45)');
  c.fillStyle = vg; c.fillRect(0, 0, W, H);
}

function ringMeter(e, x, y, r, p, col) {
  e.save();
  e.strokeStyle = `rgba(${col},${0.65 * p})`;
  e.lineWidth = 2 + 7 * p;
  e.beginPath();
  e.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(p, 0, 1));
  e.stroke();
  e.restore();
}

const POSE_STICKS = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
                     [11, 23], [12, 24], [23, 24]];
function drawPoseSticks(c, P) {
  c.save();
  c.strokeStyle = 'rgba(255,120,220,0.8)';
  c.lineWidth = 3;
  for (const [a, b] of POSE_STICKS) {
    if (!P[a] || !P[b]) continue;
    c.beginPath(); c.moveTo(P[a].x, P[a].y); c.lineTo(P[b].x, P[b].y); c.stroke();
  }
  c.restore();
}

/* --------------------------------- 9. loop ------------------------------- */

function loop(now) {
  if (!running) return;
  requestAnimationFrame(loop);
  try { frame(now); } catch (err) { console.error(err); }
}

function frame(now) {
  const dt = lastNow ? Math.min((now - lastNow) / 1000, 0.05) : 0.016;
  lastNow = now; lastDt = dt; clock += dt;
  fpsSmooth = lerp(fpsSmooth, 1 / Math.max(dt, 1e-4), 0.05);

  // shed bloom before shedding tracking
  quality = fpsSmooth < 20 ? 0 : fpsSmooth < 26 ? 0.45 : 1;

  if (video.readyState < 2) return;
  if (W === 0) layout();

  if (video.currentTime !== lastVideoTs) {
    lastVideoTs = video.currentTime;
    const ts = performance.now();

    const hr = handLM.detectForVideo(video, ts);
    const dets = [];
    if (hr && hr.landmarks) {
      for (let i = 0; i < hr.landmarks.length && i < 2; i++) {
        dets.push(toScreen(hr.landmarks[i]));
      }
    }
    assignHands(dets, dt);

    const faceEvery = fpsSmooth < 24 ? 2 : 1;
    if (faceTick++ % faceEvery === 0) {
      const f = faceLM.detectForVideo(video, ts + 0.1);
      lastFace = (f && f.faceLandmarks && f.faceLandmarks[0])
        ? toScreen(f.faceLandmarks[0]) : null;
    }

    // the body model only runs while the suit is actually up
    const needPose = poseLM && (power.helmetOn || power.suit > 0.02 ||
                    power.mode === 'NANO' || power.nano > 0.02 || debug);
    if (needPose) {
      const poseEvery = fpsSmooth < 26 ? 3 : 2;
      if (poseTick++ % poseEvery === 0) {
        const p = poseLM.detectForVideo(video, ts + 0.2);
        lastPose = (p && p.landmarks && p.landmarks[0]) ? toScreen(p.landmarks[0]) : null;
      }
    } else if (lastPose) lastPose = null;
  }

  power.modeFade = Math.min(1, power.modeFade + dt * 2.2);

  // the mode wheel swallows input while it is up
  const menuUp = updateMenu(dt);
  if (!menuUp) {
    switch (power.mode) {
      case 'AR':   updateAR(dt); break;
      case 'NANO': updateNano(dt, lastPose); break;
      case 'PONG':
      case 'BADMINTON':
        if (game) { game.resize(W, H); game.update(dt, hands, fx); }
        break;
      default:     updatePowers(dt, lastFace, lastPose);
    }
  }
  // meters still need to settle in every mode
  if (menuUp || power.mode !== 'POWERS') {
    power.helmet = ramp(power.helmet, power.helmetOn ? 1 : 0, 11, 13, dt);
    power.suit = ramp(power.suit, power.helmetOn ? 1 : 0, 1.9, 3.2, dt);
    power.faceFrame = lastFace ? faceFrame(lastFace) : null;
    // drain the one-shot edges so switching back does not fire a stale blast
    for (const h of hands) { h.takeClose(); h.takeSnap(); }
  }
  if (power.mode !== 'AR') bench.open = ramp(bench.open, 0, 4, 5, dt);
  if (power.mode !== 'NANO') power.nano = ramp(power.nano, 0, 1, 2.6, dt);

  for (let i = actors.length - 1; i >= 0; i--) {
    if (!actors[i].update(dt)) actors.splice(i, 1);
  }
  if (power.shield && !power.shield.update(dt)) { power.shield = null; Sound.clang(); }
  ash.update(dt);
  fx.update(dt);

  render(lastFace, lastPose);
  hud(lastFace);
}

/* ---------------------------------- 10. HUD ------------------------------- */

const MODE_GUIDES = {
  AR: {
    name: 'AR LAB', tint: '#6fe8ff',
    rows: [
      ['pinch', 'grab the model — drag to move and turn it'],
      ['both pinch', 'spread to scale, twist to roll'],
      ['pull hands apart', 'OPEN THE MODEL UP — parts fly out and label themselves'],
      ['open palm', 'close it back up'],
      ['horns', 'next model'],
    ],
  },
  NANO: {
    name: 'NANO', tint: '#ffaa5a',
    rows: [
      ['both palms open', 'deploy — the suit crawls out from the reactor'],
      ['both fists', 'retract it'],
      ['stand back', 'your shoulders must be in frame'],
    ],
  },
  PONG: {
    name: 'PING PONG', tint: '#8dfd5c',
    rows: [
      ['move your hand', 'that is your paddle'],
      ['swing fast', 'harder shots, and the swing adds side-spin'],
      ['rally', 'the opponent sharpens as your streak grows'],
    ],
  },
  BADMINTON: {
    name: 'BADMINTON', tint: '#ffe18c',
    rows: [
      ['move your hand', 'that is your racket'],
      ['swing up', 'the shuttle always climbs first, then drops'],
      ['clear the net', 'too low in the middle and you lose the point'],
    ],
  },
};
const MODE_ALWAYS = [
  ['open + fist', 'hold → mode wheel'],
  ['point then fist', 'pick from the wheel'],
];

function buildGuide() {
  const list = $('guideList');
  if (!list) return;
  const mg = MODE_GUIDES[power.mode];
  const L = mg || LOADOUTS[power.loadout];
  const name = mg ? mg.name : L.id;
  const tint = mg ? mg.tint : L.tint;
  $('loName').textContent = name;
  $('loName').style.color = tint;
  const tail = mg ? MODE_ALWAYS : ALWAYS.concat(MODE_ALWAYS);
  const rows = L.rows.concat(tail);
  list.innerHTML = rows.map(([k, v], i) =>
    `<li${i >= L.rows.length ? ' class="always"' : ''}>` +
    `<kbd>${k}</kbd><span>${v}</span></li>`).join('');
  $('loDots').innerHTML = MODES.map((m, i) =>
    `<i class="${m.id === power.mode ? 'on' : ''}"></i>`).join('');
}

let hudTick = 0;
function hud(face) {
  if (hudTick++ % 3) return;
  const left = hands.find((h) => h.active && h.palm.x < W / 2);
  const right = hands.find((h) => h.active && h.palm.x >= W / 2);
  $('gL').textContent = left ? LABEL[left.gesture] : '-';
  $('gR').textContent = right ? LABEL[right.gesture] : '-';
  $('gF').textContent =
      menu.shown ? 'mode wheel'
    : power.mode === 'AR' ? bench.model.name.toLowerCase()
    : power.mode === 'NANO' ? (power.nanoOn ? 'deploying' : 'retracted')
    : game ? `${game.score.you}-${game.score.them}`
    : power.domainOn ? (power.domainOn === 'VOID' ? 'void' : 'shrine')
    : power.helmetOn ? 'suited' : face ? 'tracking' : 'none';

  const meters = [
    ['bC', 'pC', Math.max(hands[0].charge, hands[1].charge, hands[0].blue,
                          hands[1].blue, hands[0].red, hands[1].red, power.purple)],
    ['bH', 'pH', power.gammaOn ? 1 : power.gammaCharge],
    ['bM', 'pM', Math.max(hands[0].mandala, hands[1].mandala, hands[0].portal,
                          hands[1].portal, power.domain, power.timeOpen, holo.open,
                          bench.open * (0.25 + bench.explode * 0.75), power.nano,
                          menu.open)],
  ];
  for (const [bar, label, v] of meters) {
    const n = Math.round(clamp(v, 0, 1) * 100);
    $(label).textContent = n + '%';
    $(bar).style.width = n + '%';
  }
  $('fps').textContent = Math.round(fpsSmooth);
}

let toastTimer = 0;
function toast(text, col) {
  const el = $('toast');
  el.textContent = text;
  el.style.color = col || '#fff';
  el.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.opacity = '0'; }, 1200);
}

/* -------------------------------- 11. keys -------------------------------- */

let recorder = null, chunks = [];

window.addEventListener('keydown', (ev) => {
  const k = ev.key.toLowerCase();
  if (k >= '1' && k <= '3') {
    if (power.mode !== 'POWERS') setMode('POWERS');
    setLoadout(parseInt(k, 10) - 1);
    return;
  }
  if (k >= '4' && k <= '8') { setMode(MODES[parseInt(k, 10) - 4].id); return; }
  if (ev.key === 'Tab') {
    ev.preventDefault();
    const i = MODES.findIndex((m) => m.id === power.mode);
    setMode(MODES[(i + 1) % MODES.length].id);
    return;
  }
  if (k === 'n' && power.mode === 'AR') { bench.setModel(bench.index + 1); return; }
  switch (k) {
    case 'd': debug = !debug; toast(debug ? 'DEBUG ON' : 'DEBUG OFF', '#6fe8ff'); break;
    case 'h': hudOn = !hudOn; document.body.classList.toggle('nohud', !hudOn); break;
    case 'f':
      view.fill = !view.fill; layout();
      toast(view.fill ? 'FILL SCREEN' : 'FIT SCREEN', '#6fe8ff');
      break;
    case 'b':
      if (!document.fullscreenElement) {
        if (document.documentElement.requestFullscreen) {
          document.documentElement.requestFullscreen();
        }
      } else if (document.exitFullscreen) document.exitFullscreen();
      break;
    case 'm':
      Sound.muted = !Sound.muted;
      if (Sound.muted) Sound.setWhine(0);
      toast(Sound.muted ? 'MUTED' : 'SOUND ON', '#6fe8ff');
      break;
    case 's': snapshot(); break;
    case 'v': toggleRecord(); break;
    case 'g': holo.open = holo.open > 0.01 ? 0 : 0.01; break;
    case 'q':
      if (menu.shown) menu.hide();
      else menu.show(MODES.map((m) => ({ label: m.label, sub: m.sub, tint: m.tint })),
                     'MODE', W / 2, H / 2, Math.min(W, H) * CONFIG.menu.radius);
      break;
    default:
      if (ev.key === 'Escape') resetAll();
  }
});

function resetAll() {
  power.helmetOn = false; power.gammaOn = false; power.gammaCharge = 0;
  power.domainOn = null; power.domainCharge = 0;
  power.purple = 0; power.purpleReady = false;
  power.shield = null; power.snapDrain = 0; power.snapFlash = 0;
  power.timeOpen = 0; power.mind = 0;
  holo.open = 0;
  for (const h of hands) {
    h.charge = h.mandala = h.portal = h.blue = h.red = 0;
    h.chaos = 0; h.hammer = 0; h.gauntlet = 0;
  }
  actors.length = 0;
  ash.clear(); fx.reset();
  menu.hide();
  power.nanoOn = false;
  bench.explode = 0; bench.scale = 1; bench.pos.x = 0; bench.pos.y = 0;
  if (game) game.reset(true);
  toast('RESET', '#8aa0b8');
}

window.addEventListener('fullscreenchange', () => setTimeout(layout, 60));

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function snapshot() {
  canvas.toBlob((b) => {
    if (b) { download(b, `power-${Date.now()}.png`); toast('SNAPSHOT SAVED', '#6fe8ff'); }
  }, 'image/png');
}

function toggleRecord() {
  if (recorder && recorder.state === 'recording') { recorder.stop(); return; }
  if (!window.MediaRecorder || !canvas.captureStream) {
    toast('RECORDING UNSUPPORTED', '#ff8080'); return;
  }
  const stream = canvas.captureStream(30);
  const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  const mime = types.find((t) => MediaRecorder.isTypeSupported(t)) || '';
  try {
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  } catch (e) { toast('RECORDING UNSUPPORTED', '#ff8080'); return; }
  chunks = [];
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  recorder.onstop = () => {
    $('rec').style.display = 'none';
    download(new Blob(chunks, { type: 'video/webm' }), `power-${Date.now()}.webm`);
    toast('CLIP SAVED', '#6fe8ff');
  };
  recorder.start();
  $('rec').style.display = 'flex';
  toast('RECORDING', '#ff6b6b');
}

// Debug handle for tuning: inspect live state, or force a power on, e.g.
//   __sim.power.helmetOn = true       __sim.power.domainOn = 'VOID'
//   POWER_CONFIG.repulsor.chargeSeconds = 0.5
window.__sim = {
  hands, power, fx, CONFIG, holo, ash, comp, setLoadout, LOADOUTS, actors,
  bench, menu, setMode, MODES, get game() { return game; },
  // drive one frame by hand - lets the render path be exercised in a
  // headless tab, where requestAnimationFrame never fires
  step(ms) { frame(ms === undefined ? performance.now() : ms); },
  get face() { return lastFace; },
  get pose() { return lastPose; },
};

window.addEventListener('error', (e) => { if (!running) fail(e.error || e.message); });
