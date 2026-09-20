/* =========================================================================
   games.js - ping pong and badminton, played with your hand as the racket.

   Both use the same pseudo-3D court: the table/court runs away from the
   camera along +z, your paddle lives at z = 0 and the opponent at z = 1.
   The ball is simulated in that space and projected, so depth reads properly
   instead of being a flat 2D pong.
   ========================================================================= */

import { clamp, lerp, rand, TAU } from './fx.js';

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

/* Court space: x in [-1,1], y in [0,1] (0 = table height, up is +), z in [0,1]. */
function projectCourt(x, y, z, W, H) {
  const horizon = H * 0.30;
  const near = H * 0.96;
  const t = clamp(z, 0, 1);
  const persp = 1 / (1 + t * 1.9);              // things shrink with depth
  const baseY = lerp(near, horizon, easeOutCubic(t));
  return {
    x: W / 2 + x * (W * 0.40) * persp,
    y: baseY - y * (H * 0.42) * persp,
    s: persp,
  };
}

class Rally {
  constructor() {
    this.you = 0; this.them = 0;
    this.streak = 0; this.best = 0;
    this.pop = 0; this.popText = ''; this.popCol = '#6fe8ff';
  }
  point(mine) {
    if (mine) this.you++; else this.them++;
    this.best = Math.max(this.best, this.streak);
    this.streak = 0;
    this.pop = 1;
    this.popText = mine ? 'POINT' : 'MISS';
    this.popCol = mine ? '#8dfd5c' : '#ff7a7a';
  }
  hit() {
    this.streak++;
    if (this.streak % 5 === 0) {
      this.pop = 1; this.popText = this.streak + ' RALLY'; this.popCol = '#ffd36f';
    }
  }
  update(dt) { this.pop = Math.max(0, this.pop - dt * 1.4); }
}

/* ============================================================== base ===== */

class CourtGame {
  constructor(W, H) {
    this.W = W; this.H = H;
    this.serveSpeed = 0.6;        // subclasses override, then re-serve
    this.score = new Rally();
    this.trail = [];
    this.serveIn = 1.2;
    this.shake = 0;
    this.lastHit = 0;
    this.reset(true);
  }

  resize(W, H) { this.W = W; this.H = H; }

  reset(serveToThem) {
    this.b = { x: 0, y: 0.35, z: serveToThem ? 0.15 : 0.85,
               vx: 0, vy: 0, vz: serveToThem ? this.serveSpeed : -this.serveSpeed };
    this.trail.length = 0;
    this.serveIn = 1.0;
    this.bounced = 0;
  }

  /** Paddle position follows the hand, in court coordinates. */
  paddleFromHand(h) {
    if (!h || !h.active) return null;
    return {
      x: clamp((h.palm.x / this.W - 0.5) * 2.4, -1.25, 1.25),
      y: clamp((1 - h.palm.y / this.H) * 1.5 - 0.1, 0, 1.2),
      vx: h.vel.x / this.W, vy: -h.vel.y / this.H,
      speed: h.speed,
    };
  }

  update(dt, hands, fx) {
    this.score.update(dt);
    this.shake *= Math.exp(-6 * dt);
    this.lastHit = Math.max(0, this.lastHit - dt);

    if (this.serveIn > 0) { this.serveIn -= dt; return; }

    // pick whichever hand is further forward as the racket hand
    let hand = null;
    for (const h of hands) {
      if (!h.active) continue;
      if (!hand || h.size > hand.size) hand = h;
    }
    this.paddle = this.paddleFromHand(hand);

    this.step(dt, fx);
  }

  drawCourt(ctx, t) {
    const W = this.W, H = this.H;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = Math.max(1, W * 0.0016);

    // the surface
    const corners = [
      projectCourt(-1, 0, 0, W, H), projectCourt(1, 0, 0, W, H),
      projectCourt(1, 0, 1, W, H), projectCourt(-1, 0, 1, W, H),
    ];
    const g = ctx.createLinearGradient(0, corners[3].y, 0, corners[0].y);
    g.addColorStop(0, 'rgba(40,120,190,0.12)');
    g.addColorStop(1, 'rgba(40,150,220,0.28)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
    ctx.closePath(); ctx.fill();

    ctx.strokeStyle = 'rgba(140,225,255,0.55)';
    ctx.stroke();

    // depth lines
    for (let i = 1; i < 8; i++) {
      const z = i / 8;
      const a = projectCourt(-1, 0, z, W, H), b = projectCourt(1, 0, z, W, H);
      ctx.strokeStyle = `rgba(140,225,255,${0.06 + (1 - z) * 0.12})`;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    // centre line
    const c0 = projectCourt(0, 0, 0, W, H), c1 = projectCourt(0, 0, 1, W, H);
    ctx.strokeStyle = 'rgba(140,225,255,0.25)';
    ctx.beginPath(); ctx.moveTo(c0.x, c0.y); ctx.lineTo(c1.x, c1.y); ctx.stroke();

    this.drawNet(ctx, t);
    ctx.restore();
  }

  drawBall(ctx, radius, col) {
    const W = this.W, H = this.H;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // trail
    for (let i = 1; i < this.trail.length; i++) {
      const p = this.trail[i], q = this.trail[i - 1];
      const a = i / this.trail.length;
      const P = projectCourt(p.x, p.y, p.z, W, H);
      const Q = projectCourt(q.x, q.y, q.z, W, H);
      ctx.strokeStyle = `rgba(${col},${0.25 * a})`;
      ctx.lineWidth = radius * W * 0.9 * P.s * a;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(Q.x, Q.y); ctx.lineTo(P.x, P.y); ctx.stroke();
    }

    const p = projectCourt(this.b.x, this.b.y, this.b.z, W, H);
    const r = Math.max(2, radius * W * p.s);

    // shadow on the table, which is what actually sells the height
    const sh = projectCourt(this.b.x, 0, this.b.z, W, H);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = `rgba(0,0,0,${0.35 * clamp(1 - this.b.y, 0.2, 1)})`;
    ctx.beginPath();
    ctx.ellipse(sh.x, sh.y, r * 1.1, r * 0.4, 0, 0, TAU);
    ctx.fill();

    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 3);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.28, `rgba(${col},0.8)`);
    g.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(p.x, p.y, r * 3, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill();
    ctx.restore();
  }

  drawPaddle(ctx, t) {
    if (!this.paddle) return;
    const W = this.W, H = this.H;
    const p = projectCourt(this.paddle.x, this.paddle.y, 0.02, W, H);
    const r = W * 0.055;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const swing = clamp(this.paddle.speed / 2200, 0, 1);
    ctx.strokeStyle = `rgba(120,235,255,${0.5 + swing * 0.5})`;
    ctx.lineWidth = Math.max(2, W * 0.004);
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, r, r * 1.12, this.paddle.vx * 1.2, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = `rgba(90,200,255,${0.12 + swing * 0.2})`;
    ctx.fill();
    ctx.restore();
  }

  drawHUD(ctx) {
    const W = this.W, H = this.H;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = `700 ${Math.round(H * 0.06)}px ui-monospace, monospace`;
    ctx.fillStyle = 'rgba(220,245,255,0.9)';
    ctx.fillText(`${this.score.you}  :  ${this.score.them}`, W / 2, H * 0.11);
    ctx.font = `${Math.round(H * 0.022)}px ui-monospace, monospace`;
    ctx.fillStyle = 'rgba(150,200,230,0.75)';
    ctx.fillText(`rally ${this.score.streak}   best ${this.score.best}`, W / 2, H * 0.15);

    if (this.serveIn > 0) {
      ctx.font = `700 ${Math.round(H * 0.035)}px ui-monospace, monospace`;
      ctx.fillStyle = 'rgba(220,245,255,0.8)';
      ctx.fillText('SERVING', W / 2, H * 0.24);
    }
    if (this.score.pop > 0.01) {
      const p = this.score.pop;
      ctx.globalAlpha = p;
      ctx.font = `700 ${Math.round(H * 0.07 * (1 + (1 - p) * 0.35))}px ui-monospace, monospace`;
      ctx.fillStyle = this.score.popCol;
      ctx.fillText(this.score.popText, W / 2, H * 0.45);
    }
    ctx.restore();
  }

  pushTrail() {
    this.trail.push({ x: this.b.x, y: this.b.y, z: this.b.z });
    if (this.trail.length > 14) this.trail.shift();
  }
}

/* ========================================================== ping pong ==== */

export class PingPong extends CourtGame {
  constructor(W, H) {
    super(W, H);
    this.serveSpeed = 0.62;
    this.name = 'PING PONG';
    this.reset(true);
  }

  drawNet(ctx) {
    const W = this.W, H = this.H;
    const l = projectCourt(-1, 0, 0.5, W, H), r = projectCourt(1, 0, 0.5, W, H);
    const lt = projectCourt(-1, 0.12, 0.5, W, H), rt = projectCourt(1, 0.12, 0.5, W, H);
    ctx.fillStyle = 'rgba(180,235,255,0.12)';
    ctx.beginPath();
    ctx.moveTo(l.x, l.y); ctx.lineTo(r.x, r.y);
    ctx.lineTo(rt.x, rt.y); ctx.lineTo(lt.x, lt.y);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(200,245,255,0.5)';
    ctx.beginPath(); ctx.moveTo(lt.x, lt.y); ctx.lineTo(rt.x, rt.y); ctx.stroke();
    for (let i = 0; i <= 18; i++) {
      const x = -1 + (i / 18) * 2;
      const a = projectCourt(x, 0, 0.5, W, H), b = projectCourt(x, 0.12, 0.5, W, H);
      ctx.strokeStyle = 'rgba(180,235,255,0.16)';
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
  }

  step(dt, fx) {
    const b = this.b;
    b.vy -= 1.5 * dt;                           // gravity
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
    this.pushTrail();

    // bounce on the table
    if (b.y < 0.02) {
      b.y = 0.02; b.vy = Math.abs(b.vy) * 0.72;
      this.bounced++;
      if (fx) {
        const p = projectCourt(b.x, 0, b.z, this.W, this.H);
        fx.burst(p.x, p.y, 6, 'rgba(180,235,255,1)', { speed: 120, life: 0.25 });
      }
    }
    // side walls keep the rally alive
    if (Math.abs(b.x) > 1.2) { b.x = Math.sign(b.x) * 1.2; b.vx *= -0.85; }

    // your paddle
    if (this.paddle && b.z < 0.08 && b.vz < 0 && this.lastHit <= 0) {
      const dx = Math.abs(b.x - this.paddle.x), dy = Math.abs(b.y - this.paddle.y);
      if (dx < 0.32 && dy < 0.34) {
        this.hitBack(fx);
      }
    }
    // opponent: tracks the ball with a deliberate lag so it is beatable
    if (b.z > 0.92 && b.vz > 0) {
      const err = this.aiError();
      this.ai = lerp(this.ai === undefined ? b.x : this.ai, b.x + err, 0.5);
      if (Math.abs(b.x - this.ai) < 0.42) {
        b.vz = -Math.abs(b.vz) * 1.02;
        b.vx += (b.x - this.ai) * 0.5 + rand(-0.1, 0.1);
        b.vy = 0.55 + rand(0, 0.25);
        b.z = 0.92;
        this.lastHit = 0.12;
      }
    }

    if (b.z < -0.12) { this.score.point(false); this.reset(true); }
    if (b.z > 1.12) { this.score.point(true); this.reset(false); }
  }

  aiError() {
    // the better your rally, the sharper the opponent gets
    const skill = clamp(0.5 - this.score.streak * 0.03, 0.12, 0.5);
    return rand(-skill, skill);
  }

  hitBack(fx) {
    const b = this.b, p = this.paddle;
    const power = clamp(p.speed / 1400, 0, 1.6);
    b.vz = 0.62 + power * 0.45;
    b.vx = (b.x - p.x) * 1.8 + p.vx * 9;       // aim and side-spin
    b.vy = 0.5 + power * 0.5;
    b.z = 0.08;
    this.lastHit = 0.14;
    this.score.hit();
    this.shake = 5 + power * 6;
    if (fx) {
      const s = projectCourt(b.x, b.y, b.z, this.W, this.H);
      fx.burst(s.x, s.y, 14 + power * 14, 'rgba(190,240,255,1)',
               { speed: 320 + power * 300, life: 0.4 });
      fx.shock(s.x, s.y, 60 + power * 90, 'rgba(180,235,255,0.8)', 0.3, 4);
    }
  }

  draw(ctx, t) {
    this.drawCourt(ctx, t);
    this.drawBall(ctx, 0.012, '160,230,255');
    this.drawPaddle(ctx, t);
    this.drawHUD(ctx);
  }
}

/* ========================================================== badminton ==== */

export class Badminton extends CourtGame {
  constructor(W, H) {
    super(W, H);
    this.serveSpeed = 0.75;
    this.name = 'BADMINTON';
    this.reset(true);
  }

  drawNet(ctx) {
    const W = this.W, H = this.H;
    const lt = projectCourt(-1, 0.42, 0.5, W, H), rt = projectCourt(1, 0.42, 0.5, W, H);
    const lb = projectCourt(-1, 0, 0.5, W, H), rb = projectCourt(1, 0, 0.5, W, H);
    ctx.strokeStyle = 'rgba(200,245,255,0.55)';
    ctx.lineWidth = Math.max(1, W * 0.0022);
    ctx.beginPath(); ctx.moveTo(lt.x, lt.y); ctx.lineTo(rt.x, rt.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(lt.x, lt.y); ctx.lineTo(lb.x, lb.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(rt.x, rt.y); ctx.lineTo(rb.x, rb.y); ctx.stroke();
    // mesh
    for (let i = 0; i <= 20; i++) {
      const x = -1 + (i / 20) * 2;
      const a = projectCourt(x, 0.42, 0.5, W, H), b = projectCourt(x, 0.05, 0.5, W, H);
      ctx.strokeStyle = 'rgba(180,235,255,0.14)';
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    for (let j = 1; j < 5; j++) {
      const y = 0.05 + (j / 5) * 0.37;
      const a = projectCourt(-1, y, 0.5, W, H), b = projectCourt(1, y, 0.5, W, H);
      ctx.strokeStyle = 'rgba(180,235,255,0.1)';
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
  }

  step(dt, fx) {
    const b = this.b;
    /* A shuttlecock is the opposite of a ball: almost no mass, enormous
       drag. It leaves fast, stalls in the air, then drops nearly straight
       down. Modelling the drag is what makes it feel like badminton. */
    const sp = Math.hypot(b.vx, b.vy, b.vz);
    const drag = 1.9 * sp;
    b.vx -= b.vx * drag * dt;
    b.vz -= b.vz * drag * dt;
    b.vy -= (2.4 + Math.max(0, b.vy) * drag) * dt;

    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
    this.pushTrail();

    if (Math.abs(b.x) > 1.25) { b.x = Math.sign(b.x) * 1.25; b.vx *= -0.6; }

    // net: too low at the middle and the rally is over
    if (Math.abs(b.z - 0.5) < 0.03 && b.y < 0.42) {
      this.score.point(b.vz < 0);
      this.reset(b.vz < 0);
      return;
    }

    if (this.paddle && b.z < 0.12 && b.vz < 0 && this.lastHit <= 0) {
      const dx = Math.abs(b.x - this.paddle.x), dy = Math.abs(b.y - this.paddle.y);
      if (dx < 0.4 && dy < 0.45) this.hitBack(fx);
    }

    if (b.z > 0.88 && b.vz > 0) {
      const skill = clamp(0.55 - this.score.streak * 0.03, 0.15, 0.55);
      this.ai = lerp(this.ai === undefined ? b.x : this.ai, b.x + rand(-skill, skill), 0.4);
      if (Math.abs(b.x - this.ai) < 0.5 && b.y < 0.95) {
        b.vz = -0.72 - rand(0, 0.2);
        b.vx += (b.x - this.ai) * 0.4;
        b.vy = 0.95 + rand(0, 0.35);
        b.z = 0.88;
        this.lastHit = 0.15;
      }
    }

    if (b.y < 0.01) {                   // it hit the floor
      const mine = b.z > 0.5;
      this.score.point(mine);
      this.reset(!mine);
      return;
    }
    if (b.z < -0.15) { this.score.point(false); this.reset(true); }
    if (b.z > 1.15) { this.score.point(true); this.reset(false); }
  }

  hitBack(fx) {
    const b = this.b, p = this.paddle;
    const power = clamp(p.speed / 1300, 0, 1.8);
    b.vz = 0.7 + power * 0.7;
    b.vx = (b.x - p.x) * 1.4 + p.vx * 7;
    b.vy = 0.85 + power * 0.8;          // shuttles go UP first, always
    b.z = 0.12;
    this.lastHit = 0.16;
    this.score.hit();
    this.shake = 4 + power * 7;
    if (fx) {
      const s = projectCourt(b.x, b.y, b.z, this.W, this.H);
      fx.burst(s.x, s.y, 12 + power * 12, 'rgba(255,240,200,1)',
               { speed: 280 + power * 260, life: 0.35 });
    }
  }

  /** The shuttle: a cork nose and a feather skirt that streams behind it. */
  drawShuttle(ctx) {
    const W = this.W, H = this.H;
    const p = projectCourt(this.b.x, this.b.y, this.b.z, W, H);
    const r = Math.max(3, 0.016 * W * p.s);

    // the skirt always trails the direction of travel
    const back = projectCourt(this.b.x - this.b.vx * 0.06,
                              this.b.y - this.b.vy * 0.06,
                              this.b.z - this.b.vz * 0.06, W, H);
    const ang = Math.atan2(p.y - back.y, p.x - back.x);

    const sh = projectCourt(this.b.x, 0, this.b.z, W, H);
    ctx.save();
    ctx.fillStyle = `rgba(0,0,0,${0.3 * clamp(1 - this.b.y, 0.15, 1)})`;
    ctx.beginPath(); ctx.ellipse(sh.x, sh.y, r * 1.2, r * 0.4, 0, 0, TAU); ctx.fill();

    ctx.translate(p.x, p.y);
    ctx.rotate(ang);
    ctx.globalCompositeOperation = 'lighter';
    // skirt
    ctx.fillStyle = 'rgba(235,245,255,0.35)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-r * 3.2, -r * 1.5);
    ctx.lineTo(-r * 3.2, r * 1.5);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = Math.max(0.6, r * 0.18);
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-r * 3.2, i * r * 0.75); ctx.stroke();
    }
    // cork
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 2.4);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.35, 'rgba(255,225,170,0.8)');
    g.addColorStop(1, 'rgba(255,200,120,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, r * 2.4, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
    ctx.restore();
  }

  drawPaddle(ctx) {
    if (!this.paddle) return;
    const W = this.W, H = this.H;
    const p = projectCourt(this.paddle.x, this.paddle.y, 0.04, W, H);
    const r = W * 0.055;
    const swing = clamp(this.paddle.speed / 2000, 0, 1);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(p.x, p.y);
    ctx.rotate(this.paddle.vx * 1.4);
    // head
    ctx.strokeStyle = `rgba(255,225,150,${0.5 + swing * 0.5})`;
    ctx.lineWidth = Math.max(2, W * 0.0035);
    ctx.beginPath(); ctx.ellipse(0, -r * 0.3, r * 0.78, r * 1.0, 0, 0, TAU); ctx.stroke();
    // strings
    ctx.strokeStyle = `rgba(255,240,200,${0.14 + swing * 0.14})`;
    ctx.lineWidth = Math.max(0.6, W * 0.0011);
    for (let i = -3; i <= 3; i++) {
      ctx.beginPath();
      ctx.moveTo(i * r * 0.2, -r * 1.25); ctx.lineTo(i * r * 0.2, r * 0.62);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-r * 0.74, -r * 0.3 + i * r * 0.26);
      ctx.lineTo(r * 0.74, -r * 0.3 + i * r * 0.26);
      ctx.stroke();
    }
    // shaft
    ctx.strokeStyle = `rgba(255,220,150,${0.55 + swing * 0.4})`;
    ctx.lineWidth = Math.max(2, W * 0.004);
    ctx.beginPath(); ctx.moveTo(0, r * 0.68); ctx.lineTo(0, r * 1.7); ctx.stroke();
    ctx.restore();
  }

  draw(ctx, t) {
    this.drawCourt(ctx, t);
    this.drawShuttle(ctx);
    this.drawPaddle(ctx);
    this.drawHUD(ctx);
  }
}

export const GAMES = { PONG: PingPong, BADMINTON: Badminton };
