/* =========================================================================
   filter.js - the One Euro filter.

   Raw landmarks jitter. The naive fix is heavy smoothing, but that adds lag,
   and lag is worse than jitter when you are trying to grab something.

   One Euro solves it by adapting: when the hand is still it smooths hard
   (jitter disappears), and when the hand moves fast it barely smooths at all
   (no rubber-banding). The cutoff frequency is driven by the measured speed
   of the signal itself.

   Casiez, Roussel & Vogel, CHI 2012.
   ========================================================================= */

const TWO_PI = Math.PI * 2;

/** alpha for a first-order low pass at a given cutoff and timestep */
function alphaFor(cutoff, dt) {
  const tau = 1 / (TWO_PI * cutoff);
  return 1 / (1 + tau / dt);
}

class LowPass {
  constructor() { this.y = 0; this.init = false; }
  filter(x, a) {
    if (!this.init) { this.y = x; this.init = true; return x; }
    this.y = a * x + (1 - a) * this.y;
    return this.y;
  }
  reset() { this.init = false; }
}

export class OneEuro {
  /**
   * @param minCutoff lower = smoother when still (but laggier)
   * @param beta      higher = more responsive when moving fast
   * @param dCutoff   cutoff for the speed estimate itself
   */
  constructor(minCutoff = 1.7, beta = 0.018, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.x = new LowPass();
    this.dx = new LowPass();
    this.prev = 0;
    this.init = false;
  }
  filter(value, dt) {
    if (dt <= 0) dt = 1 / 60;
    let dValue = 0;
    if (this.init) dValue = (value - this.prev) / dt;
    this.prev = value;
    this.init = true;
    const edValue = this.dx.filter(dValue, alphaFor(this.dCutoff, dt));
    // the faster it is moving, the less we smooth it
    const cutoff = this.minCutoff + this.beta * Math.abs(edValue);
    return this.x.filter(value, alphaFor(cutoff, dt));
  }
  reset() { this.x.reset(); this.dx.reset(); this.init = false; }
}

/**
 * One filter per coordinate of every landmark in a hand. Reused frame to
 * frame; call reset() when the hand is lost so a reappearing hand does not
 * lerp in from wherever the old one was.
 */
export class LandmarkFilter {
  constructor(count = 21, opts = {}) {
    this.minCutoff = opts.minCutoff ?? 1.7;
    this.beta = opts.beta ?? 0.018;
    this.f = [];
    for (let i = 0; i < count; i++) {
      this.f.push({
        x: new OneEuro(this.minCutoff, this.beta),
        y: new OneEuro(this.minCutoff, this.beta),
        z: new OneEuro(this.minCutoff, this.beta),
      });
    }
    this.out = [];
    for (let i = 0; i < count; i++) this.out.push({ x: 0, y: 0, z: 0 });
  }

  /** Smooth in place and return a stable array (no per-frame allocation). */
  apply(lms, dt) {
    const n = Math.min(lms.length, this.f.length);
    for (let i = 0; i < n; i++) {
      const s = lms[i], o = this.out[i], f = this.f[i];
      o.x = f.x.filter(s.x, dt);
      o.y = f.y.filter(s.y, dt);
      o.z = f.z.filter(s.z || 0, dt);
    }
    return this.out;
  }

  /** Re-tune live, from the settings panel. */
  retune(minCutoff, beta) {
    this.minCutoff = minCutoff; this.beta = beta;
    for (const f of this.f) {
      f.x.minCutoff = f.y.minCutoff = f.z.minCutoff = minCutoff;
      f.x.beta = f.y.beta = f.z.beta = beta;
    }
  }

  reset() {
    for (const f of this.f) { f.x.reset(); f.y.reset(); f.z.reset(); }
  }
}

/** Smoothing presets, exposed in the UI. */
export const SMOOTHING = {
  responsive: { minCutoff: 3.0, beta: 0.03, label: 'Responsive',
                note: 'least lag, a little jitter' },
  balanced:   { minCutoff: 1.7, beta: 0.018, label: 'Balanced',
                note: 'recommended' },
  smooth:     { minCutoff: 0.9, beta: 0.008, label: 'Very smooth',
                note: 'rock steady, slightly laggy' },
};
