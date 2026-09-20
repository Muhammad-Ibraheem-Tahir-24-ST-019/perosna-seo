/* =========================================================================
   hands.js - turning 21 hand landmarks into a stable gesture.
   Kept free of DOM and camera code so it can be unit-tested directly.
   ========================================================================= */

import { lerp, dist, norm } from './fx.js';

export const WRIST = 0, MID_MCP = 9, PINKY_MCP = 17;
export const TIP = { thumb: 4, index: 8, middle: 12, ring: 16, pinky: 20 };
export const PIP = { thumb: 3, index: 6, middle: 10, ring: 14, pinky: 18 };
export const PALM_PTS = [0, 5, 9, 13, 17];
export const FINGERS = ['index', 'middle', 'ring', 'pinky'];

/**
 * Gesture thresholds. Raise `extendRatio` if fingers read as extended when
 * they are only half-curled; lower it if a deliberately open hand is missed.
 * `voteFrames`/`voteMajority` trade responsiveness against flicker.
 */
export const TUNING = {
  extendRatio: 1.12,   // tip-from-wrist vs joint-from-wrist, for the 4 fingers
  thumbRatio: 1.08,    // same idea, measured from the pinky knuckle
  pinchRatio: 0.42,    // thumb-to-index gap, in hand spans, to count as a pinch
  gripReach: 0.90,     // ...and how far out from the wrist the gripped tips must be
  voteFrames: 5,
  voteMajority: 3,
  smoothing: 24,       // higher = snappier tracking, lower = smoother
  swipeSpeed: 1400,    // px/sec that counts as a slash
  snapHold: 0.40,      // thumb-to-middle gap (in spans) that counts as gripped
  snapRelease: 0.85,   // ...and the gap it must fly past to count as a snap
  snapWindow: 0.22,    // seconds allowed between grip and release
};

export const LABEL = {
  OPEN: 'open palm', FIST: 'fist', PEACE: 'two fingers',
  HORNS: 'horns', POINT: 'point', PINCH: 'pinch', THREE: 'three fingers',
  SNAP: 'snap grip', NONE: '-',
};

/** Landmarks arrive normalized and un-mirrored; the view is mirrored. */
export function toCanvas(lms, W, H) {
  const out = new Array(lms.length);
  for (let i = 0; i < lms.length; i++) {
    out[i] = { x: (1 - lms[i].x) * W, y: lms[i].y * H, z: lms[i].z || 0 };
  }
  return out;
}

/**
 * A finger counts as extended when its tip sits further from the wrist than
 * its middle joint. The test is a ratio, so it holds at any hand size and
 * survives the hand moving toward or away from the lens.
 */
export function fingersOf(L) {
  const w = L[WRIST];
  const e = {};
  for (const f of FINGERS) {
    e[f] = dist(w, L[TIP[f]]) > dist(w, L[PIP[f]]) * TUNING.extendRatio;
  }
  // the thumb folds sideways rather than curling, so it is measured against
  // the pinky knuckle instead of the wrist
  const pk = L[PINKY_MCP];
  e.thumb = dist(L[TIP.thumb], pk) > dist(L[PIP.thumb], pk) * TUNING.thumbRatio;
  e.count = FINGERS.reduce((n, f) => n + (e[f] ? 1 : 0), 0);
  // thumb tip resting on the index tip, measured against the palm span so it
  // holds at any distance from the lens
  e.span = dist(w, L[MID_MCP]) || 1;

  /* A grip is two fingertips touching each other OUT IN FRONT of the hand.
     The second half matters: in a closed fist the thumb also rests against
     the index, and in horns it rests against the folded middle finger, so
     gap alone would read a fist as a pinch and horns as a snap. A gripped
     fingertip reaches past the knuckles; a tucked one sits inside the palm. */
  const reach = (tip) => dist(w, L[tip]) / e.span;
  e.reachIndex = reach(TIP.index);
  e.reachMiddle = reach(TIP.middle);
  e.pinchGap = dist(L[TIP.thumb], L[TIP.index]) / e.span;
  e.snapGap = dist(L[TIP.thumb], L[TIP.middle]) / e.span;

  /* Thumb on the INDEX is a pinch; thumb on the MIDDLE is the snap grip -
     deliberately different fingers so Red and the Gauntlet never collide.
     When snapping, the raised index can drift near the thumb as well, so
     whichever fingertip the thumb is actually closer to wins. */
  e.pinch = e.pinchGap < TUNING.pinchRatio &&
            e.reachIndex > TUNING.gripReach &&
            e.pinchGap <= e.snapGap;
  e.snapGrip = (e.snapGap < TUNING.snapHold &&
                e.reachMiddle > TUNING.gripReach &&
                e.snapGap < e.pinchGap) ? e.snapGap : 9;
  return e;
}

export function classify(e) {
  // pinch first: a closed thumb-index ring reads as a folded index, so it
  // would otherwise be swallowed by FIST
  if (e.snapGrip < TUNING.snapHold && !e.pinch) return 'SNAP';
  if (e.pinch) return 'PINCH';
  if (e.count >= 4) return 'OPEN';
  if (e.count === 0) return 'FIST';
  if (e.index && e.middle && e.ring && !e.pinky) return 'THREE';
  if (e.index && e.middle && !e.ring && !e.pinky) return 'PEACE';
  if (e.index && e.pinky && !e.middle && !e.ring) return 'HORNS';
  if (e.index && !e.middle && !e.ring && !e.pinky) return 'POINT';
  return 'NONE';
}

/** Read a pose straight from landmarks, with no smoothing. */
export function poseOf(L) { return classify(fingersOf(L)); }

/**
 * One tracked hand: smoothed position/aim plus a de-flickered gesture and
 * the per-hand power meters.
 */
export class HandState {
  constructor() {
    this.seen = 0; this.gesture = 'NONE'; this.prev = 'NONE';
    this.hold = 0; this.votes = []; this.active = false; this.justClosed = false;
    this.palm = { x: 0, y: 0 }; this.dir = { x: 0, y: -1 };
    this.size = 60; this.onFace = false;
    this.charge = 0; this.mandala = 0; this.portal = 0; this.portalR = 0;
    this.eject = 0;
    // cursed-technique meters, filled by the power state machine
    this.blue = 0; this.red = 0; this.slash = 0; this.hammer = 0;
    this.vel = { x: 0, y: 0 }; this.speed = 0; this.raised = false;
    this.trail = [];
    this.gauntlet = 0; this.grip = 9; this.gripHeldFor = -1; this.didSnap = false;
  }

  update(L, dt) {
    this.active = true;
    this.seen = Math.min(this.seen + 1, 30);

    let cx = 0, cy = 0;
    for (const i of PALM_PTS) { cx += L[i].x; cy += L[i].y; }
    cx /= PALM_PTS.length; cy /= PALM_PTS.length;

    const k = this.seen < 3 ? 1 : 1 - Math.exp(-TUNING.smoothing * dt);  // snap in, then smooth
    const px = this.palm.x, py = this.palm.y;
    this.palm.x = lerp(this.palm.x, cx, k);
    this.palm.y = lerp(this.palm.y, cy, k);

    // velocity, smoothed: a fast sweep is a slash, a slow one is not
    if (this.seen > 2 && dt > 0) {
      const vx = (this.palm.x - px) / dt, vy = (this.palm.y - py) / dt;
      this.vel.x = lerp(this.vel.x, vx, 0.35);
      this.vel.y = lerp(this.vel.y, vy, 0.35);
      this.speed = Math.hypot(this.vel.x, this.vel.y);
    }
    this.trail.push({ x: this.palm.x, y: this.palm.y });
    if (this.trail.length > 14) this.trail.shift();
    this.size = lerp(this.size, dist(L[WRIST], L[MID_MCP]) * 2.1, k);

    const d = norm(cx - L[WRIST].x, cy - L[WRIST].y);   // wrist -> palm is the aim
    this.dir.x = lerp(this.dir.x, d.x, k);
    this.dir.y = lerp(this.dir.y, d.y, k);

    // snap: fingers gripped, then flung apart inside a short window
    const e = fingersOf(L);
    const wasGripped = this.grip < TUNING.snapHold;
    this.grip = e.snapGrip;
    if (this.grip < TUNING.snapHold) {
      this.gripHeldFor = this.gripHeldFor < 0 ? 0 : this.gripHeldFor + dt;
    } else {
      if (wasGripped && this.gripHeldFor >= 0 &&
          this.gripHeldFor < TUNING.snapWindow + 2 &&
          this.grip > TUNING.snapRelease) {
        this.didSnap = true;
      }
      this.gripHeldFor = -1;
    }

    this.votes.push(classify(e));
    if (this.votes.length > TUNING.voteFrames) this.votes.shift();

    // a majority over ~5 frames; one bad frame can never flip a power on
    const tally = {};
    let best = this.gesture, bestN = 0;
    for (const g of this.votes) {
      tally[g] = (tally[g] || 0) + 1;
      if (tally[g] > bestN) { bestN = tally[g]; best = g; }
    }
    const settled = bestN >= TUNING.voteMajority ? best : this.gesture;

    this.prev = this.gesture;
    this.justClosed = settled === 'FIST' && this.prev === 'OPEN';
    this.hold = settled === this.gesture ? this.hold + dt : 0;
    this.gesture = settled;
  }

  /**
   * Consume the open -> closed edge. Returns true exactly once per real
   * gesture: the render loop usually runs faster than the camera, so the
   * flag must be cleared on read or one closed hand fires twice.
   */
  takeClose() {
    const v = this.justClosed;
    this.justClosed = false;
    return v;
  }

  /** Consume the snap, same one-shot rule as takeClose. */
  takeSnap() {
    const v = this.didSnap;
    this.didSnap = false;
    return v;
  }

  lost(dt) {
    this.seen = Math.max(0, this.seen - 2);
    this.justClosed = false;
    if (this.seen === 0) {
      this.active = false; this.gesture = 'NONE'; this.prev = 'NONE';
      this.votes.length = 0; this.hold = 0;
      this.speed = 0; this.vel.x = 0; this.vel.y = 0; this.trail.length = 0;
      this.grip = 9; this.gripHeldFor = -1; this.didSnap = false;
    }
    this.charge = Math.max(0, this.charge - dt * 1.4);
  }
}

/* ------------------------------------------------------------ test rigs --- */

/** Build a synthetic right hand pointing up, for tests and calibration. */
export function makeHand(pose, scale = 100, ox = 0, oy = 0) {
  const P = (x, y) => ({ x: ox + x * scale, y: oy + y * scale, z: 0 });
  const MCP = { index: [-0.18, -0.55], middle: [-0.02, -0.60],
                ring: [0.13, -0.57], pinky: [0.27, -0.50] };
  const L = new Array(21);
  L[0] = P(0, 0);

  // thumb: 1 CMC, 2 MCP, 3 IP, 4 TIP
  L[1] = P(-0.18, -0.12);
  L[2] = P(-0.32, -0.28);
  if (pose.snap) {                     // thumb tip parked on the middle tip
    L[3] = P(-0.14, -0.74);
    L[4] = P(0.00, -0.94);
  } else if (pose.pinch) {             // thumb tip brought onto the index tip
    L[3] = P(-0.30, -0.74);
    L[4] = P(-0.16, -0.92);
  } else {
    L[3] = pose.thumb ? P(-0.45, -0.42) : P(-0.25, -0.40);
    L[4] = pose.thumb ? P(-0.60, -0.50) : P(-0.10, -0.45);
  }

  const base = { index: 5, middle: 9, ring: 13, pinky: 17 };
  for (const f of FINGERS) {
    const b = base[f], [mx, my] = MCP[f];
    L[b] = P(mx, my);
    const gripped = (pose.pinch && f === 'index') || (pose.snap && f === 'middle');
    if (gripped) {                       // curled forward to meet the thumb
      L[b + 1] = P(mx, my - 0.20);
      L[b + 2] = P(mx + 0.02, my - 0.32);
      L[b + 3] = P(mx + 0.04, my - 0.36);
    } else if (pose[f]) {                // straight out past the knuckle
      L[b + 1] = P(mx, my - 0.22);
      L[b + 2] = P(mx, my - 0.38);
      L[b + 3] = P(mx, my - 0.52);
    } else {                             // curled down into the palm
      L[b + 1] = P(mx, my - 0.20);
      L[b + 2] = P(mx * 0.85, my * 0.85);
      L[b + 3] = P(mx * 0.60, my * 0.62);
    }
  }
  return L;
}

export const POSES = {
  OPEN:  { thumb: 1, index: 1, middle: 1, ring: 1, pinky: 1 },
  FIST:  { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 },
  PEACE: { thumb: 0, index: 1, middle: 1, ring: 0, pinky: 0 },
  HORNS: { thumb: 0, index: 1, middle: 0, ring: 0, pinky: 1 },
  POINT: { thumb: 0, index: 1, middle: 0, ring: 0, pinky: 0 },
  THREE: { thumb: 0, index: 1, middle: 1, ring: 1, pinky: 0 },
  PINCH: { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0, pinch: 1 },
  SNAP:  { thumb: 0, index: 1, middle: 0, ring: 1, pinky: 1, snap: 1 },
};
