/* =========================================================================
   menu.js - the radial mode selector.

   Opened with a gesture, aimed with your hand, committed by closing it.
   Nothing here touches app state directly: it reports the chosen index and
   lets the caller decide what that means.
   ========================================================================= */

import { clamp, lerp, TAU } from './fx.js';

const easeOutBack = (t) => 1 + 2.1 * Math.pow(t - 1, 3) + 1.1 * Math.pow(t - 1, 2);
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

export class RadialMenu {
  constructor() {
    this.open = 0;          // 0..1 animation
    this.shown = false;
    this.items = [];
    this.hover = -1;
    this.commit = 0;        // how long the hovered wedge has been held
    this.cx = 0; this.cy = 0; this.r = 220;
    this.title = '';
    this.chosen = -1;       // set for one frame when a selection lands
  }

  show(items, title, cx, cy, r) {
    this.items = items;
    this.title = title || '';
    this.cx = cx; this.cy = cy; this.r = r;
    this.shown = true;
    this.hover = -1;
    this.commit = 0;
  }

  hide() { this.shown = false; this.hover = -1; this.commit = 0; }

  /**
   * @param aim   {x,y} the pointing hand, or null
   * @param fire  true while the hand is closed/pinched (commits instantly)
   * @returns the chosen index, or -1
   */
  update(dt, aim, fire) {
    this.chosen = -1;
    this.open = lerp(this.open, this.shown ? 1 : 0,
                     1 - Math.exp(-(this.shown ? 11 : 9) * dt));
    if (!this.shown || this.open < 0.35 || !this.items.length) {
      this.hover = -1; this.commit = 0;
      return -1;
    }

    if (aim) {
      const dx = aim.x - this.cx, dy = aim.y - this.cy;
      const d = Math.hypot(dx, dy);
      if (d > this.r * 0.32) {
        // wedge 0 starts at the top and they run clockwise
        let a = Math.atan2(dy, dx) + Math.PI / 2;
        while (a < 0) a += TAU;
        while (a >= TAU) a -= TAU;
        const idx = Math.floor((a / TAU) * this.items.length);
        if (idx !== this.hover) { this.hover = idx; this.commit = 0; }
        else this.commit += dt;
      } else {
        this.hover = -1; this.commit = 0;     // hand in the middle = no choice
      }
    } else { this.hover = -1; this.commit = 0; }

    // commit either by closing your hand, or by dwelling on the wedge
    if (this.hover >= 0 && (fire || this.commit > 1.1)) {
      this.chosen = this.hover;
      this.hide();
      return this.chosen;
    }
    return -1;
  }

  draw(ctx, t) {
    const a = clamp(this.open, 0, 1);
    if (a <= 0.01) return;
    const n = this.items.length;
    if (!n) return;
    const grow = easeOutBack(a);
    const R = this.r * grow;
    const inner = R * 0.34;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // backing disc
    const bg = ctx.createRadialGradient(this.cx, this.cy, inner, this.cx, this.cy, R * 1.05);
    bg.addColorStop(0, `rgba(20,60,95,${0.30 * a})`);
    bg.addColorStop(0.75, `rgba(20,70,110,${0.22 * a})`);
    bg.addColorStop(1, 'rgba(20,70,110,0)');
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.arc(this.cx, this.cy, R * 1.05, 0, TAU); ctx.fill();

    const step = TAU / n;
    for (let i = 0; i < n; i++) {
      // each wedge springs out on its own slight delay
      const d = clamp((a - i * 0.035) / (1 - i * 0.02), 0, 1);
      if (d <= 0) continue;
      const wedgeR = inner + (R - inner) * easeOutCubic(d);
      const a0 = -Math.PI / 2 + i * step + step * 0.06;
      const a1 = -Math.PI / 2 + (i + 1) * step - step * 0.06;
      const on = i === this.hover;
      const item = this.items[i];
      const col = item.tint || '140,225,255';

      ctx.beginPath();
      ctx.arc(this.cx, this.cy, wedgeR, a0, a1);
      ctx.arc(this.cx, this.cy, inner, a1, a0, true);
      ctx.closePath();
      ctx.fillStyle = `rgba(${col},${(on ? 0.34 : 0.12) * a})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(${col},${(on ? 0.95 : 0.4) * a})`;
      ctx.lineWidth = on ? 3 : 1.5;
      ctx.stroke();

      // dwell meter creeping around the hovered wedge
      if (on && this.commit > 0.02) {
        const p = clamp(this.commit / 1.1, 0, 1);
        ctx.strokeStyle = `rgba(255,255,255,${0.85 * a})`;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(this.cx, this.cy, wedgeR - 4, a0, a0 + (a1 - a0) * p);
        ctx.stroke();
      }

      const mid = (a0 + a1) / 2;
      const lr = (inner + wedgeR) / 2;
      const lx = this.cx + Math.cos(mid) * lr;
      const ly = this.cy + Math.sin(mid) * lr;

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `700 ${Math.round(R * 0.085)}px ui-monospace, monospace`;
      ctx.fillStyle = `rgba(235,250,255,${(on ? 1 : 0.7) * a})`;
      ctx.fillText(item.label, lx, ly - R * 0.045);
      if (item.sub) {
        ctx.font = `${Math.round(R * 0.055)}px ui-monospace, monospace`;
        ctx.fillStyle = `rgba(190,225,245,${(on ? 0.9 : 0.5) * a})`;
        ctx.fillText(item.sub, lx, ly + R * 0.055);
      }
    }

    // hub
    ctx.beginPath(); ctx.arc(this.cx, this.cy, inner * 0.92, 0, TAU);
    ctx.fillStyle = `rgba(10,30,50,${0.5 * a})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(140,225,255,${0.6 * a})`;
    ctx.lineWidth = 2; ctx.stroke();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `700 ${Math.round(R * 0.07)}px ui-monospace, monospace`;
    ctx.fillStyle = `rgba(200,240,255,${0.9 * a})`;
    ctx.fillText(this.title, this.cx, this.cy - R * 0.03);
    ctx.font = `${Math.round(R * 0.048)}px ui-monospace, monospace`;
    ctx.fillStyle = `rgba(150,200,230,${0.7 * a})`;
    ctx.fillText('point → close', this.cx, this.cy + R * 0.06);

    // a spoke from the hub to wherever you are aiming
    if (this.hover >= 0) {
      const mid = -Math.PI / 2 + (this.hover + 0.5) * step;
      ctx.strokeStyle = `rgba(255,255,255,${0.5 * a})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(this.cx + Math.cos(mid) * inner, this.cy + Math.sin(mid) * inner);
      ctx.lineTo(this.cx + Math.cos(mid) * R * 0.98, this.cy + Math.sin(mid) * R * 0.98);
      ctx.stroke();
    }

    ctx.textBaseline = 'alphabetic';
    ctx.restore();
  }
}
