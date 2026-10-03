// World, flight, scoring and drawing.
// The scene is a fake 3D floor: X sideways, Y up, Z away from the player (metres-ish).
import { CONFIG } from './config.js';
import { mapPower, bandOf, BAND_NAMES } from './power.js';
import { drawStack, rng } from './paper.js';

const Z0 = 0.6;       // camera to the throwing plane
const CAM_H = 1.2;    // eye height
const G = 4;          // gravity, floaty on purpose so the whole arc stays on screen
const RB = 0.45;      // bin mouth radius (a big office bin, easy to read at a distance)
const HB = RB * 2 * 0.98; // bin height, matches the sprite's proportions
const PR = 0.07;      // paper ball radius for physics
const PR_VIS = 0.1;   // drawn a little larger so it reads at a distance
const ARC_VY = 2.4;   // every throw leaves at the same upward speed, so only power decides distance

// Bin sprite anchors (fractions of the image), measured from assets/img/bin.png
const BIN_RIM_W = 0.9875, BIN_BASE_Y = 0.92;

// p is the power that lands dead centre in each bin. Level 1 sits in the middle of the
// range, so a normal, comfortable throw scores; the bin then moves back and asks for more.
export const LEVELS = [
  { z: 1.9, p: 0.45, wind: 0.22 },
  { z: 3.0, p: 0.6, wind: 0.4 },
  { z: 4.1, p: 0.75, wind: 0.55 },
];
const Z_PER_P = (LEVELS[2].z - LEVELS[0].z) / (LEVELS[2].p - LEVELS[0].p);
export const ZONE = 0.2;             // half width of the green zone on the power meter
const ASSIST = ZONE * Z_PER_P;       // throws landing this close to the bin get guided in
const powerToDistance = (p) => Math.max(0.3, LEVELS[0].z + (p - LEVELS[0].p) * Z_PER_P);
const HAND_FINGERS = [[0, 1, 2, 3, 4], [0, 5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [0, 17, 18, 19, 20], [5, 9, 13, 17]];
const HAND_PALM = [0, 1, 5, 9, 13, 17];
const TIPS = [4, 8, 12, 16, 20];

const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, k) => a + (b - a) * k;

export class Game {
  constructor({ canvas, office, bin, paper, audio, gestures, ui }) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    Object.assign(this, { office, bin, paper, audio, gestures, ui });
    this.overlay = 1;           // office scene opacity over the camera feed
    this.hands = [];
    this.mode = 'menu';         // menu | calibrate | play
    this.calMax = CONFIG.defaultMaxPower;
    this.total = 0;
    this.streak = 0;
    this.meter = 0;
    this.r = rng(Date.now() & 0xffff);
    this.particles = Array.from({ length: 34 }, () => this.newParticle(true));
    this.fanSide = -1;
    this.fanAngle = 0;
    this.wind = 0;
    this.papers = [];
    this.flying = null;
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = Math.min(2, devicePixelRatio || 1);
    this.W = innerWidth; this.H = innerHeight;
    this.cv.width = this.W * dpr; this.cv.height = this.H * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // 16:9 stage that covers the window, same crop as the office image
    const s = Math.max(this.W / 16, this.H / 9);
    this.sw = 16 * s; this.sh = 9 * s;
    this.sx = (this.W - this.sw) / 2; this.sy = (this.H - this.sh) / 2;
    this.F = 0.6 * this.sh;
    this.cx = this.sx + this.sw / 2;
    this.hz = this.sy + 0.42 * this.sh;
    // Paper stack sits on the right hand desk, kept on screen for narrow windows
    this.stackW = Math.max(100, 0.12 * this.sw);
    this.stackX = Math.min(this.sx + 0.84 * this.sw, this.W - this.stackW * 0.75);
    this.stackY = Math.min(this.sy + 0.8 * this.sh, this.H - 60);
    if (this.level != null) this.lockBin();
  }

  proj(X, Y, Z) {
    const k = this.F / (Z + Z0);
    return { x: this.cx + X * k, y: this.hz + (CAM_H - Y) * k, k };
  }

  // Bin is placed once per level and then stays fixed in screen space
  lockBin() {
    const z = LEVELS[this.level].z, p = this.proj(0, 0, z);
    const rimW = 2 * RB * p.k, w = rimW / BIN_RIM_W, h = w * (this.bin.height / this.bin.width);
    this.binScreen = { x: p.x - w / 2, y: p.y - h * BIN_BASE_Y, w, h, baseX: p.x, baseY: p.y, rimW };
  }

  // ---------- flow ----------

  startGame(calMax) {
    this.calMax = calMax;
    this.total = 0;
    this.streak = 0;
    this.startLevel(0);
  }

  startLevel(i) {
    this.mode = 'play';
    this.level = i;
    this.throwIdx = 0;
    this.levelScore = 0;
    this.results = [];
    this.papers = [];
    this.binBalls = 0;
    this.flying = null;
    this.lockBin();
    this.ui.zone(LEVELS[i].p - ZONE, LEVELS[i].p + ZONE);
    this.audio.startLoops();
    this.newThrow();
  }

  newThrow() {
    const max = LEVELS[this.level].wind, r = this.r();
    this.wind = !CONFIG.wind || r < 0.15 ? 0 : (this.r() < 0.5 ? -1 : 1) * max * (0.3 + 0.7 * this.r());
    if (this.wind) this.fanSide = this.wind > 0 ? -1 : 1;
    this.phase = 'ready';
    this.gestures.mode = 'game';
    this.gestures.reset();
    this.gestures.enabled = true;
    this.gestures.maxPower = this.calMax;
    this.ui.wind(this.wind, 0.55);
    this.audio.fan(Math.abs(this.wind) / 0.55, this.fanSide);
    this.hud();
  }

  hud() {
    this.ui.hud({
      level: this.level + 1, levels: LEVELS.length,
      throwNo: Math.min(this.throwIdx + 1, CONFIG.throwsPerLevel), throws: CONFIG.throwsPerLevel,
      score: this.total, streak: this.streak, levelScore: this.levelScore, goal: CONFIG.goalPerLevel,
      results: this.results, current: this.throwIdx,
    });
  }

  // ---------- gesture callbacks ----------

  onPick() {
    this.phase = 'inhand';
    this.pickFlash = 1;
    this.audio.play('pick');
  }

  onCrushed() {
    this.audio.crinkleStop();
    this.audio.play('pick', 0.5, 0.6);
  }

  onDropped() {
    this.phase = 'ready';
    this.audio.crinkleStop();
    this.ui.toast('You dropped it. Pick up another sheet.');
  }

  onRelease(th) {
    const p = mapPower(th.raw, this.calMax);
    if (p <= 0) {
      this.gestures.rearm();
      this.ui.toast('Too gentle. Swing a bit faster, then open your hand.');
      return;
    }
    const band = bandOf(p);
    const lvl = LEVELS[this.level];
    const pos = this.gestures.pos;
    const X0 = (pos.x - this.cx) * Z0 / this.F;
    const Y0 = clamp(CAM_H - (pos.y - this.hz) * Z0 / this.F, 0.85, 1.6);
    // Where this throw wants to land. Power sets the distance; a clearly sideways flick
    // pulls it left or right. Small wobbles in direction are ignored.
    let Zt = powerToDistance(p);
    const side = Math.abs(th.dx) < 0.25 ? 0 : th.dx - Math.sign(th.dx) * 0.25;
    let Xt = side * 1.4;
    const off = Math.hypot(Xt, Zt - lvl.z);
    if (off < ASSIST) { Xt *= 0.1; Zt = lvl.z + (Zt - lvl.z) * 0.1; } // close enough: guide it in
    const tF = (ARC_VY + Math.sqrt(ARC_VY * ARC_VY + 2 * G * Math.max(0, Y0 - HB))) / G;
    const s0 = this.proj(X0, Y0, 0);
    const heldDiam = (this.heldSize || 150) * this.paper.ballRatio;
    this.flying = {
      X: X0, Y: Y0, Z: 0, vX: (Xt - X0) / tF, vY: ARC_VY, vZ: Zt / tF,
      rot: pos.angle || 0, vr: (this.r() - 0.5) * 12, age: 0, state: 'fly',
      ox: pos.x - s0.x, oy: pos.y - s0.y, s0: heldDiam / (2 * PR_VIS * s0.k), done: false,
      p, short: p < lvl.p - ZONE, long: p > lvl.p + ZONE,
    };
    this.phase = 'flying';
    this.meter = p;
    this.ui.meter(p, false);
    this.ui.toast(`${BAND_NAMES[band]} throw`, 'band');
    this.audio.play('whoosh', 0.35 + 0.25 * band, 0.9 + 0.15 * band);
  }

  resolve(hit) {
    const f = this.flying;
    if (!f || f.done) return;
    f.done = true;
    if (hit) {
      this.streak++;
      const pts = this.streak;
      this.levelScore += pts;
      this.total += pts;
      this.ui.toast(this.streak > 1 ? `In! +${pts}  ·  streak of ${this.streak}` : `In! +${pts}`, 'hit');
      if (this.streak > 1) this.audio.play('chime', 0.35);
      this.binBalls++;
    } else {
      // tell the player which way to adjust, so the next one feels within reach
      const tip = f.short ? 'A little more power' : f.long ? 'A little softer' : 'Just wide. Throw straighter';
      this.ui.toast(this.streak > 0 ? `${tip}. Streak ended.` : `${tip}.`, 'miss');
      this.streak = 0;
      this.papers.push({ X: f.X, Z: f.Z, rot: f.rot });
    }
    this.results.push(hit);
    this.throwIdx++;
    this.hud();
    this.phase = 'between';
    setTimeout(() => {
      if (this.mode !== 'play') return;
      this.flying = null;
      if (this.throwIdx >= CONFIG.throwsPerLevel) {
        this.phase = 'over';
        this.gestures.enabled = false;
        this.audio.fan(0, 0);
        this.ui.levelEnd({
          level: this.level, last: this.level === LEVELS.length - 1,
          cleared: this.levelScore >= CONFIG.goalPerLevel,
          levelScore: this.levelScore, total: this.total,
        });
      } else this.newThrow();
    }, hit ? 900 : 1100);
  }

  // ---------- per frame ----------

  update(dt, t) {
    this.t = t / 1000;
    const g = this.gestures;
    g.tick(dt);
    this.pickFlash = Math.max(0, (this.pickFlash || 0) - dt * 1.6);
    if (this.mode === 'play' || this.mode === 'calibrate') {
      if (g.state === 'holding') this.audio.crinkle(g.crumple, dt);
      else if (this.audio.crId != null && g.state !== 'holding') this.audio.crinkle(1, dt);
      // live power meter while the ball is in hand
      if (g.state === 'ball' && g.armed) {
        const p = mapPower(g.liveSpeed, this.calMax);
        this.meter = Math.max(p, this.meter - dt * 0.9);
        this.ui.meter(this.meter, true);
      } else if (this.phase !== 'flying' && this.phase !== 'between') {
        this.meter = Math.max(0, this.meter - dt * 1.5);
        this.ui.meter(this.meter, false);
      }
    }
    if (this.mode === 'play') {
      this.updateFlight(dt);
      this.ui.prompt(this.promptText());
    }
    // wind particles and fan
    const wv = this.mode === 'play' ? this.wind : 0;
    this.fanAngle += dt * (4 + 40 * Math.abs(wv));
    for (const p of this.particles) {
      p.X += wv * 2.2 * dt; p.life -= dt;
      if (p.life <= 0 || Math.abs(p.X) > 2.6) Object.assign(p, this.newParticle(false));
    }
  }

  newParticle(initial) {
    const r = this.r;
    const side = this.wind > 0 ? -1 : 1;
    return {
      X: initial ? (r() - 0.5) * 5 : side * (1.6 + r() * 0.8), Y: 0.3 + r() * 1.3,
      Z: 0.6 + r() * 3.8, life: 1.5 + r() * 2.5, len: 0.12 + r() * 0.2,
    };
  }

  updateFlight(dt) {
    const f = this.flying;
    if (!f) return;
    f.age += dt;
    const bz = LEVELS[this.level].z;
    if (f.state === 'fly') {
      const pY = f.Y;
      f.vX += this.wind * dt;       // the fan pushes sideways every frame
      f.X += f.vX * dt; f.Y += f.vY * dt; f.Z += f.vZ * dt;
      f.vY -= G * dt;
      f.rot += f.vr * dt;
      const dx = f.X, dz = f.Z - bz, d = Math.hypot(dx, dz) || 1e-6;
      if (!f.done && pY > HB && f.Y <= HB) {
        // crossing the height of the bin mouth: distance check against the mouth
        if (d < RB - 0.03) {
          f.state = 'in'; f.inT = 0; f.from = { X: f.X, Y: f.Y, Z: f.Z }; f.to = this.binSlot(this.binBalls);
          this.audio.play('clang', 0.75);
        } else if (d < RB + PR) {
          f.vX = (dx / d) * 1.1 + f.vX * 0.3; f.vZ = (dz / d) * 1.1 + f.vZ * 0.2;
          f.vY = Math.abs(f.vY) * 0.35; f.Y = HB + 0.01;
          this.audio.play('clang', 0.3, 1.2);
          this.ui.toast('Off the rim!');
        }
      } else if (f.Y < HB && d < RB + PR) {
        const nx = dx / d, nz = dz / d, vn = f.vX * nx + f.vZ * nz;
        if (vn < 0) { f.vX -= 1.6 * vn * nx; f.vZ -= 1.6 * vn * nz; this.audio.play('clang', 0.2, 1.4); }
      }
      if (f.Z > 11) f.vZ = -Math.abs(f.vZ) * 0.3;
      if (f.Y <= PR) {
        f.Y = PR;
        if (!f.landed) { f.landed = true; this.audio.play('thud', 0.8); }
        if (Math.abs(f.vY) > 0.8) { f.vY = -f.vY * 0.3; f.vX *= 0.6; f.vZ *= 0.6; }
        else {
          f.vY = 0;
          const fr = Math.pow(0.02, dt);
          f.vX *= fr; f.vZ *= fr; f.vr *= fr;
          if (Math.hypot(f.vX, f.vZ) < 0.06) { f.state = 'rest'; this.resolve(false); }
        }
      }
      if (f.age > 5) this.resolve(false);
    } else if (f.state === 'in') {
      f.inT += dt;
      const k = Math.min(1, f.inT / 0.35), e = k * k; // drops in, speeding up
      f.X = lerp(f.from.X, f.to.X, k); f.Z = lerp(f.from.Z, f.to.Z, k); f.Y = lerp(f.from.Y, f.to.Y, e);
      f.rot += f.vr * dt;
      if (k >= 1) this.resolve(true);
    }
  }

  promptText() {
    const g = this.gestures;
    if (this.phase === 'flying' || this.phase === 'between' || this.phase === 'over') return '';
    if (!this.hands.length && g.state !== 'ball') return 'Show your hand to the camera.';
    switch (g.state) {
      case 'idle': return g.hover ? 'Hold still to pick it up...' : 'Move your open hand over the paper on the right.';
      case 'holding': return g.squeezing ? 'Crumpling...' : 'Got it. Make a fist to crush it.';
      case 'ball': return g.armed ? 'Swing toward the bin and open your hand. Fill the meter to the green band.' : 'Make a fist to hold the ball.';
      default: return '';
    }
  }

  // ---------- drawing ----------

  render() {
    const c = this.ctx;
    c.clearRect(0, 0, this.W, this.H);
    if (this.office.complete) {
      c.globalAlpha = this.overlay;
      c.drawImage(this.office, this.sx, this.sy, this.sw, this.sh);
      c.globalAlpha = 1;
    }
    if (this.mode === 'play') this.drawWorld(c);
    else this.ui.pickHint(0, 0, false);
    if (this.mode === 'play') this.drawHands(c);
  }

  drawWorld(c) {
    const bz = LEVELS[this.level].z;
    const wa = Math.abs(this.wind) / 0.55;
    // air streaks
    if (wa > 0.02) {
      c.lineCap = 'round';
      for (const p of this.particles) {
        const a = this.proj(p.X, p.Y, p.Z), b = this.proj(p.X - Math.sign(this.wind) * p.len, p.Y, p.Z);
        c.strokeStyle = `rgba(255,255,255,${0.35 * wa * clamp(p.life)})`;
        c.lineWidth = Math.max(1, a.k * 0.012);
        c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
      }
    }
    // things on the floor, far to near
    const items = [{ z: bz, d: () => this.drawBin(c) }];
    if (CONFIG.wind) this.drawFanAndArrow(c, bz, items);
    for (const p of this.papers) items.push({ z: p.Z, d: () => this.drawFloorPaper(c, p) });
    const f = this.flying;
    if (f) items.push({ z: f.state === 'in' ? bz - 0.01 : f.Z, d: () => this.drawFlying(c, f) });
    items.sort((a, b) => b.z - a.z).forEach((it) => it.d());

    const g = this.gestures;
    const left = CONFIG.throwsPerLevel - this.throwIdx - (this.phase === 'inhand' ? 1 : 0) - (this.phase === 'flying' ? 1 : 0);
    const glow = g.state === 'idle' && this.phase === 'ready' ? (g.hover ? 0.6 + 0.4 * g.dwellProgress : 0.3) : 0;
    // soft contact shadow so the stack sits on the desk
    const sg = c.createRadialGradient(this.stackX, this.stackY - this.stackW * 0.2, 0, this.stackX, this.stackY - this.stackW * 0.2, this.stackW * 0.95);
    sg.addColorStop(0, 'rgba(10,14,40,0.34)'); sg.addColorStop(0.55, 'rgba(10,14,40,0.16)'); sg.addColorStop(1, 'rgba(10,14,40,0)');
    c.fillStyle = sg;
    c.beginPath(); c.ellipse(this.stackX + this.stackW * 0.06, this.stackY - this.stackW * 0.18, this.stackW * 0.95, this.stackW * 0.48, 0, 0, Math.PI * 2); c.fill();
    const stack = this.paper.drawStack ? this.paper.drawStack.bind(this.paper) : drawStack;
    this.pile = stack(c, this.stackX, this.stackY, this.stackW, Math.max(0, left), glow, this.t);
    if (this.pile) {
      const r = this.stackW * 0.85, P = this.pile;
      g.pileTest = (x, y) => this.phase === 'ready' && Math.hypot(x - P.x, y - P.y) < r;
      const n = Math.max(0, left);
      c.font = `600 ${Math.round(Math.max(13, this.stackW * 0.11))}px -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif`;
      c.textAlign = 'center';
      c.fillStyle = 'rgba(255,255,255,0.96)';
      c.shadowColor = 'rgba(10,14,40,0.65)'; c.shadowBlur = 8;
      c.fillText(n === 0 ? 'Last throw' : `${n} ${n === 1 ? 'throw' : 'throws'} left`, this.stackX, this.stackY + Math.max(20, this.stackW * 0.2));
      c.shadowBlur = 0;
      this.ui.pickHint(P.x, P.y - this.stackW * 0.45, this.phase === 'ready' && g.state === 'idle');
    }
  }

  drawBin(c) {
    const b = this.binScreen;
    const g = c.createRadialGradient(b.baseX, b.baseY, 0, b.baseX, b.baseY, b.rimW * 0.7);
    g.addColorStop(0, 'rgba(20,26,64,0.45)');
    g.addColorStop(1, 'rgba(20,26,64,0)');
    c.fillStyle = g;
    c.beginPath(); c.ellipse(b.baseX, b.baseY, b.rimW * 0.7, b.rimW * 0.2, 0, 0, Math.PI * 2); c.fill();
    // Paper inside the bin: drawn behind the bin, then again faintly through the mesh,
    // so it reads as sitting inside. Balls pile up from the bottom like a real bin.
    const inside = [];
    for (let i = 0; i < this.binBalls; i++) inside.push({ ...this.binSlot(i), rot: i * 1.7 });
    const f = this.flying;
    if (f && f.state === 'in') inside.push({ X: f.X, Y: f.Y, Z: f.Z, rot: f.rot });
    const drawInside = () => inside.forEach((q) => {
      const p = this.proj(q.X, q.Y, q.Z);
      this.paper.drawBall(c, p.x, p.y, 2 * PR_VIS * p.k, q.rot);
    });
    drawInside();
    c.drawImage(this.bin, b.x, b.y, b.w, b.h);
    if (inside.length) {
      const top = b.y + b.h * 0.105, half = b.rimW / 2;
      c.save();
      c.beginPath();
      c.moveTo(b.baseX - half, top); c.lineTo(b.baseX + half, top);
      c.lineTo(b.baseX + half * 0.6, b.baseY); c.lineTo(b.baseX - half * 0.6, b.baseY);
      c.closePath(); c.clip();
      c.globalAlpha = 0.42;
      drawInside();
      c.restore();
    }
  }

  // Where the n-th ball rests inside the bin: three to a layer, layers stacking upward
  binSlot(n) {
    const spots = [[-0.32, -0.15], [0.3, -0.05], [0, 0.22]];
    const [sx, sz] = spots[n % 3], layer = Math.floor(n / 3);
    return { X: sx * RB, Y: PR_VIS * 0.9 + layer * PR_VIS * 1.45, Z: LEVELS[this.level].z + sz * RB };
  }

  drawFloorPaper(c, p) {
    const s = this.proj(p.X, PR * 0.8, p.Z);
    this.shadow(c, p.X, p.Z, 2 * PR_VIS * s.k, 0.35);
    this.paper.drawBall(c, s.x, s.y, 2 * PR_VIS * s.k, p.rot);
  }

  drawFlying(c, f) {
    const s = this.proj(f.X, f.Y, f.Z);
    const k = clamp(f.age / 0.22);
    const scale = lerp(f.s0, 1, k);
    const diam = 2 * PR_VIS * s.k * scale;
    if (f.state !== 'in') this.shadow(c, f.X, f.Z, diam, 0.3 * clamp(1 - (f.Y - PR) / 1.5));
    if (f.state === 'in') return; // drawn with the bin's contents
    this.paper.drawBall(c, s.x + f.ox * (1 - k), s.y + f.oy * (1 - k), diam, f.rot);
  }

  shadow(c, X, Z, diam, a) {
    if (a <= 0.01) return;
    const s = this.proj(X, 0, Z);
    c.fillStyle = `rgba(20,26,64,${a})`;
    c.beginPath(); c.ellipse(s.x, s.y, diam * 0.55, diam * 0.16, 0, 0, Math.PI * 2); c.fill();
  }

  drawFanAndArrow(c, bz, items) {
    const side = this.fanSide, fz = bz + 0.5, fx = side * (1.2 + 0.1 * bz);
    const wa = Math.abs(this.wind) / 0.55;
    items.push({ z: fz, d: () => drawFan(c, this.proj(fx, 0, fz), this.proj(fx, 1, fz).k, -side, this.fanAngle, wa) });
    // arrow from the fan toward the flight path, length shows strength
    items.push({ z: fz - 0.05, d: () => {
      if (wa < 0.02) return;
      const y = 0.95, a = this.proj(fx - side * 0.35, y, fz), b = this.proj(fx - side * (0.45 + 1.5 * wa), y, fz);
      drawArrow(c, a.x, a.y, b.x, b.y, Math.max(8, a.k * 0.09), this.t);
    } });
  }

  drawHands(c) {
    const g = this.gestures;
    for (const h of this.hands) {
      if (!h.lm) continue;
      const holding = h.id === g.holdId && (g.state === 'holding' || g.state === 'ball');
      const accent = holding || h.pinch ? '10,132,255' : null;
      const P = h.lm, s = h.size;
      c.save();
      c.lineCap = c.lineJoin = 'round';
      c.fillStyle = 'rgba(255,255,255,0.12)';
      c.beginPath(); HAND_PALM.forEach((i, n) => (n ? c.lineTo(P[i][0], P[i][1]) : c.moveTo(P[i][0], P[i][1]))); c.closePath(); c.fill();
      const bones = () => {
        c.beginPath();
        for (const f of HAND_FINGERS) f.forEach((i, n) => (n ? c.lineTo(P[i][0], P[i][1]) : c.moveTo(P[i][0], P[i][1])));
        c.stroke();
      };
      c.strokeStyle = 'rgba(255,255,255,0.13)'; c.lineWidth = s * 0.22; bones();
      c.strokeStyle = 'rgba(255,255,255,0.75)'; c.lineWidth = Math.max(1.5, s * 0.028); bones();
      for (const i of TIPS) {
        c.beginPath(); c.arc(P[i][0], P[i][1], Math.max(3, s * 0.055), 0, Math.PI * 2);
        c.fillStyle = accent && (holding || i === 4 || i === 8) ? `rgb(${accent})` : 'rgba(255,255,255,0.95)';
        c.fill();
        c.lineWidth = 1; c.strokeStyle = 'rgba(20,30,70,0.35)'; c.stroke();
      }
      c.restore();
    }
    // paper in hand
    const hand = this.hands.find((h) => h.id === g.holdId) || this.hands[0];
    if (hand) this.heldSize = hand.size * 3; // a sheet is about three hand lengths tall
    if (g.pos && (g.state === 'holding' || (g.state === 'ball' && (g.holdId != null || this.mode === 'play')))) {
      const size = this.heldSize || 150;
      const rot = (g.pos.angle || -Math.PI / 2) + Math.PI / 2;
      if (g.state === 'holding') {
        // a bright outline glow the moment a sheet is picked, so the pick is unmistakable
        if (this.pickFlash > 0) {
          c.save();
          c.globalAlpha = this.pickFlash;
          c.shadowColor = 'rgba(10,132,255,0.9)'; c.shadowBlur = 28;
          c.strokeStyle = '#fff'; c.lineWidth = 4;
          c.translate(g.pos.x, g.pos.y); c.rotate(rot * 0.6);
          c.beginPath(); c.roundRect(-size * 0.4, -size * 0.52, size * 0.8, size * 1.04, 6); c.stroke();
          c.restore();
        }
        this.paper.draw(c, g.pos.x, g.pos.y, size, g.crumple, rot * 0.6);
      }
      else this.paper.drawBall(c, g.pos.x, g.pos.y, size * this.paper.ballRatio, rot);
      // fingertips over the ball so it reads as gripped
      if (hand && hand.lm && g.state !== 'holding') {
        c.fillStyle = 'rgb(10,132,255)';
        for (const i of TIPS) { c.beginPath(); c.arc(hand.lm[i][0], hand.lm[i][1], Math.max(3, hand.size * 0.055), 0, Math.PI * 2); c.fill(); }
      }
    }
  }
}

// Pedestal fan in the office art style: navy outline, soft blue plastic, white cage.
function drawFan(c, base, k, facing, ang, strength) {
  const h = k * 1.0, x = base.x, y = base.y;
  c.save();
  c.lineJoin = 'round'; c.lineCap = 'round';
  const ink = '#232a4d';
  // shadow
  c.fillStyle = 'rgba(20,26,64,0.3)';
  c.beginPath(); c.ellipse(x, y, h * 0.2, h * 0.05, 0, 0, Math.PI * 2); c.fill();
  // base
  c.fillStyle = '#4b5684'; c.strokeStyle = ink; c.lineWidth = Math.max(1.2, h * 0.012);
  c.beginPath(); c.ellipse(x, y - h * 0.02, h * 0.16, h * 0.04, 0, 0, Math.PI * 2); c.fill(); c.stroke();
  // pole
  c.fillStyle = '#c9cfe6';
  c.fillRect(x - h * 0.018, y - h * 0.7, h * 0.036, h * 0.68);
  c.strokeRect(x - h * 0.018, y - h * 0.7, h * 0.036, h * 0.68);
  const hx = x, hy = y - h * 0.86, R = h * 0.2, sq = 0.62;
  // motor housing behind the cage
  c.fillStyle = '#5b6799';
  c.beginPath(); c.ellipse(hx - facing * R * 0.45, hy, R * 0.28, R * 0.36, 0, 0, Math.PI * 2); c.fill(); c.stroke();
  // blades, squashed because the fan is turned toward the bin
  c.save();
  c.translate(hx, hy); c.scale(sq, 1);
  c.fillStyle = 'rgba(210,222,255,0.35)';
  c.beginPath(); c.arc(0, 0, R * 0.92, 0, Math.PI * 2); c.fill();
  c.fillStyle = strength > 0.02 ? 'rgba(120,140,210,0.55)' : 'rgba(120,140,210,0.9)';
  for (let i = 0; i < 3; i++) {
    const a = ang + (i * Math.PI * 2) / 3;
    c.save(); c.rotate(a);
    c.beginPath(); c.ellipse(R * 0.45, 0, R * 0.42, R * 0.2, 0, 0, Math.PI * 2); c.fill();
    c.restore();
  }
  c.fillStyle = '#e9ecf8';
  c.beginPath(); c.arc(0, 0, R * 0.14, 0, Math.PI * 2); c.fill();
  // cage
  c.strokeStyle = 'rgba(255,255,255,0.85)'; c.lineWidth = Math.max(0.8, h * 0.006) / sq;
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI) / 5;
    c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(a) * R, Math.sin(a) * R); c.stroke();
  }
  c.strokeStyle = ink; c.lineWidth = Math.max(1.4, h * 0.014) / sq;
  c.beginPath(); c.arc(0, 0, R, 0, Math.PI * 2); c.stroke();
  c.restore();
  c.restore();
}

function drawArrow(c, x1, y1, x2, y2, w, t) {
  const ang = Math.atan2(y2 - y1, x2 - x1), len = Math.hypot(x2 - x1, y2 - y1);
  c.save();
  c.translate(x1, y1); c.rotate(ang);
  c.beginPath();
  c.moveTo(0, -w * 0.35); c.lineTo(len - w, -w * 0.35); c.lineTo(len - w, -w * 0.8);
  c.lineTo(len, 0);
  c.lineTo(len - w, w * 0.8); c.lineTo(len - w, w * 0.35); c.lineTo(0, w * 0.35); c.closePath();
  c.fillStyle = 'rgba(255,255,255,0.88)';
  c.strokeStyle = '#232a4d'; c.lineWidth = Math.max(1.5, w * 0.12); c.lineJoin = 'round';
  c.fill(); c.stroke();
  // flowing dashes inside
  c.setLineDash([w * 0.5, w * 0.5]);
  c.lineDashOffset = -t * w * 3;
  c.strokeStyle = 'rgba(91,121,230,0.8)'; c.lineWidth = Math.max(1, w * 0.18);
  c.beginPath(); c.moveTo(w * 0.3, 0); c.lineTo(len - w * 1.1, 0); c.stroke();
  c.restore();
}
