/* =========================================================================
   render.js - the compositor.

   Effects are not drawn straight onto the camera frame. They go onto their
   own layer, which is then blurred and added back. That one change is what
   separates "a bright shape pasted on video" from "a light source in the
   room": real glow bleeds past its edges, spills colour onto the scene, and
   blows out its own core.
   ========================================================================= */

import { clamp, TAU, rand } from './fx.js';

const canBlur = (() => {
  try {
    const c = document.createElement('canvas').getContext('2d');
    c.filter = 'blur(2px)';
    return c.filter === 'blur(2px)';
  } catch (e) { return false; }
})();

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0);
  return c;
}

/**
 * Effect layer + two-pass bloom.
 *
 * Usage per frame:
 *   const ec = comp.begin(W, H);   // draw all effects into ec
 *   ...
 *   comp.composite(ctx, strength); // bleed them onto the camera frame
 */
export class Compositor {
  constructor() {
    this.W = 0; this.H = 0;
    this.layer = null; this.lctx = null;
    this.small = null; this.sctx = null;
    this.small2 = null; this.s2ctx = null;
    this.grain = null;
    this.quality = 1;          // 1 = full bloom, 0.5 = cheap, 0 = none
    this.div = 4;              // bloom runs at 1/div resolution
  }

  resize(W, H) {
    if (this.W === W && this.H === H && this.layer) return;
    this.W = W; this.H = H;
    this.layer = makeCanvas(W, H);
    this.lctx = this.layer.getContext('2d');
    const sw = Math.max(1, Math.round(W / this.div));
    const sh = Math.max(1, Math.round(H / this.div));
    this.small = makeCanvas(sw, sh);
    this.sctx = this.small.getContext('2d');
    this.small2 = makeCanvas(sw, sh);
    this.s2ctx = this.small2.getContext('2d');
  }

  /** Clear and hand back the effect layer's context. */
  begin(W, H) {
    this.resize(W, H);
    const c = this.lctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    c.clearRect(0, 0, W, H);
    return c;
  }

  /**
   * Add the effect layer to the frame, plus its blurred halo.
   * `strength` scales the halo only - the effects themselves always land.
   */
  composite(ctx, strength = 1) {
    if (!this.layer) return;
    const W = this.W, H = this.H;
    const s = clamp(strength, 0, 2) * this.quality;

    if (s > 0.02) {
      const sw = this.small.width, sh = this.small.height;
      // downsample: the shrink is itself a blur, and a cheap one
      this.sctx.setTransform(1, 0, 0, 1, 0, 0);
      this.sctx.globalCompositeOperation = 'source-over';
      this.sctx.clearRect(0, 0, sw, sh);
      this.sctx.drawImage(this.layer, 0, 0, sw, sh);

      // two blur passes at low res: wide, soft, and still cheap
      if (canBlur) {
        this.s2ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.s2ctx.clearRect(0, 0, sw, sh);
        this.s2ctx.filter = 'blur(3px)';
        this.s2ctx.drawImage(this.small, 0, 0);
        this.s2ctx.filter = 'none';

        this.sctx.clearRect(0, 0, sw, sh);
        this.sctx.filter = 'blur(7px)';
        this.sctx.drawImage(this.small2, 0, 0);
        this.sctx.filter = 'none';
      }

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.85 * s;          // wide, soft halo
      ctx.drawImage(this.small, 0, 0, W, H);
      ctx.globalAlpha = 0.45 * s;          // second, tighter pass
      ctx.drawImage(this.small2 || this.small, 0, 0, W, H);
      ctx.restore();
    }

    // the effects themselves, at full resolution and full strength
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 1;
    ctx.drawImage(this.layer, 0, 0, W, H);
    ctx.restore();
  }

  /**
   * Sensor noise. Real camera footage is never clean, so perfectly smooth
   * CG sitting on top of it is the single biggest giveaway. Matching the
   * grain is most of what "looks composited" means.
   */
  drawGrain(ctx, W, H, amount = 0.05) {
    if (amount <= 0.002) return;
    if (!this.grain) {
      const N = 160;
      this.grain = makeCanvas(N, N);
      const g = this.grain.getContext('2d');
      const img = g.createImageData(N, N);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = 110 + (Math.random() * 90) | 0;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
      g.putImageData(img, 0, 0);
    }
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = amount;
    const p = ctx.createPattern(this.grain, 'repeat');
    // shift every frame or the grain freezes into a static texture
    ctx.translate(-rand(0, 160) | 0, -rand(0, 160) | 0);
    ctx.fillStyle = p;
    ctx.fillRect(0, 0, W + 160, H + 160);
    ctx.restore();
  }
}

/* --------------------------------------------------------- light spill --- */

/**
 * Coloured light thrown onto the room by whatever you are holding. Drawn
 * under the effects but over the camera frame, so your face actually picks
 * up the colour of the thing in your hand.
 */
export class Spill {
  constructor() { this.items = []; }
  add(x, y, r, col, a) {
    if (a > 0.004) this.items.push({ x, y, r, col, a });
  }
  draw(ctx, W, H) {
    if (!this.items.length) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const s of this.items) {
      const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r);
      g.addColorStop(0, `rgba(${s.col},${0.5 * s.a})`);
      g.addColorStop(0.45, `rgba(${s.col},${0.18 * s.a})`);
      g.addColorStop(1, `rgba(${s.col},0)`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, TAU); ctx.fill();
    }
    ctx.restore();
    this.items.length = 0;
  }
}

/* ------------------------------------------------------ colour grading --- */

/** Push the whole frame toward a colour - used by domains and the Snap. */
export function grade(ctx, W, H, col, amount, mode = 'multiply') {
  const a = clamp(amount, 0, 1);
  if (a <= 0.004) return;
  ctx.save();
  ctx.globalCompositeOperation = mode;
  ctx.globalAlpha = a;
  ctx.fillStyle = col;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

/** Drain the colour out of the frame. */
export function desaturate(ctx, src, W, H, amount) {
  const a = clamp(amount, 0, 1);
  if (a <= 0.004 || !canBlur) return;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.filter = 'grayscale(1)';
  ctx.drawImage(src, 0, 0, W, H);
  ctx.filter = 'none';
  ctx.restore();
}

/**
 * Split the red and blue channels apart. Cameras do this under a hard
 * light source, so a flash that does it reads as physically present.
 */
export function chromatic(ctx, src, W, H, amount) {
  const a = clamp(amount, 0, 1);
  if (a <= 0.01) return;
  const o = a * 9;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.30 * a;
  if (canBlur) {
    ctx.filter = 'url(#none) sepia(1) saturate(6) hue-rotate(-40deg)';
    ctx.drawImage(src, -o, 0, W, H);
    ctx.filter = 'sepia(1) saturate(6) hue-rotate(160deg)';
    ctx.drawImage(src, o, 0, W, H);
    ctx.filter = 'none';
  }
  ctx.restore();
}

/* ------------------------------------------------------------ dissolve --- */

/**
 * Disintegration. Each flake carries a real patch of the camera frame and
 * drifts off with it, so you come apart into pieces of yourself rather than
 * into generic dust.
 */
export class Ash {
  constructor() { this.flakes = []; }
  get active() { return this.flakes.length > 0; }
  clear() { this.flakes.length = 0; }

  /** Tear a rectangle of the frame into drifting flakes. */
  seed(x0, y0, w, h, count, opts = {}) {
    const step = Math.max(4, Math.sqrt((w * h) / Math.max(1, count)));
    const up = opts.up ?? -70;
    for (let y = y0; y < y0 + h; y += step) {
      for (let x = x0; x < x0 + w; x += step) {
        if (this.flakes.length > 1600) return;
        const d = Math.hypot(x - (x0 + w / 2), y - (y0 + h / 2));
        this.flakes.push({
          sx: x, sy: y, s: step,
          x, y, vx: rand(-14, 14), vy: rand(up * 1.4, up * 0.3),
          delay: (d / Math.max(w, h)) * (opts.sweep ?? 0.9) + rand(0, 0.25),
          life: rand(1.1, 2.4), age: 0,
        });
      }
    }
  }

  update(dt) {
    for (let i = this.flakes.length - 1; i >= 0; i--) {
      const f = this.flakes[i];
      if (f.delay > 0) { f.delay -= dt; continue; }
      f.age += dt;
      f.vx += Math.sin(f.age * 3 + f.sy * 0.05) * 26 * dt;   // turbulence
      f.vy -= 24 * dt;                                        // heat rises
      f.x += f.vx * dt; f.y += f.vy * dt;
      if (f.age > f.life) this.flakes.splice(i, 1);
    }
  }

  /** `src` is the mirrored camera frame, drawn to fill W x H. */
  draw(ctx, src, W, H, sw, sh) {
    if (!this.flakes.length) return;
    const kx = sw / W, ky = sh / H;
    ctx.save();
    /* No per-flake save/translate/rotate: at a thousand-plus flakes the
       transform churn costs more than the blits do, and a few degrees of
       spin on a 10px chip is invisible anyway. Size jitter sells it instead. */
    for (const f of this.flakes) {
      if (f.delay > 0) continue;
      const t = 1 - f.age / f.life;
      if (t <= 0) continue;
      ctx.globalAlpha = t * t;
      const s = f.s * (0.6 + t * 0.7);
      try {
        ctx.drawImage(src, f.sx * kx, f.sy * ky, f.s * kx, f.s * ky,
                      f.x - s / 2, f.y - s / 2, s, s);
      } catch (e) { /* source rect off-frame; skip this flake */ }
    }
    // embers riding along with the dust
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < this.flakes.length; i += 14) {
      const f = this.flakes[i];
      if (f.delay > 0) continue;
      const t = 1 - f.age / f.life;
      ctx.globalAlpha = t * 0.5;
      ctx.fillStyle = 'rgba(255,190,120,1)';
      ctx.beginPath(); ctx.arc(f.x, f.y, f.s * 0.14 * t, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }
}

export const supportsFilter = canBlur;
