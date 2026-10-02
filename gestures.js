// Pick, crush and throw, driven by hand frames from hands.js.
// One hand only. States: idle -> holding (sheet, crumpling) -> ball (crushed, ready) -> done
import { CONFIG } from './config.js';

const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, k) => a + (b - a) * k;

export class Gestures {
  constructor(cb) {
    this.cb = cb;           // { pick, crush(crumple), crushed, release(throw), dropped }
    this.mode = 'game';     // 'game' | 'calibrate'
    this.enabled = false;
    this.pileTest = () => false;
    this.maxPower = CONFIG.defaultMaxPower;
    this.reset();
  }

  reset() {
    this.state = this.mode === 'calibrate' ? 'ball' : 'idle';
    this.holdId = null;
    this.crumple = this.target = this.mode === 'calibrate' ? 1 : 0;
    this.base = 0;
    this.crumpleMax = this.crumple;
    this.armed = false;
    this.squeezing = false;
    this.dwell = 0;
    this.dwellProgress = 0;
    this.buf = [];
    this.miss = 0;
    this.lastSpeed = 0;
    this.liveSpeed = 0;
    this.pos = null;
    this.hover = false;
  }

  // Put the ball back in the hand after a throw that was too gentle
  rearm() {
    this.state = 'ball';
    this.armed = false;
    this.buf = [];
  }

  update(hands, t) {
    const dt = this.lastT ? Math.min(0.2, (t - this.lastT) / 1000) : 0;
    this.lastT = t;
    if (!this.enabled) return;
    let hand = this.holdId != null ? hands.find((h) => h.id === this.holdId) : null;

    // If tracking lost our hand for a while and a new track appears, adopt the nearest one
    if (!hand && this.holdId != null && this.miss > 6 && hands.length && this.pos) {
      hand = nearest(hands, this.pos.x, this.pos.y);
      this.holdId = hand.id;
    }

    switch (this.state) {
      case 'idle': {
        // Pick: hold an open hand over the pile for a moment, or pinch for an instant pick
        const over = hands.find((h) => this.pileTest(h.cx, h.cy) || this.pileTest(h.px, h.py));
        this.hover = !!over;
        this.dwell = over ? this.dwell + dt : 0;
        this.dwellProgress = clamp(this.dwell / CONFIG.pickDwell);
        if (over && (over.pinch || this.dwell >= CONFIG.pickDwell)) {
          this.holdId = over.id;
          this.state = 'holding';
          this.crumple = this.target = 0;
          this.squeezing = false;
          this.dwell = 0;
          this.pos = { x: over.cx, y: over.cy - over.size * 0.4, angle: over.angle };
          this.cb.pick?.();
        }
        break;
      }

      case 'holding': {
        if (!hand) {
          if (++this.miss > 45) { this.state = 'idle'; this.holdId = null; this.cb.dropped?.(); }
          return;
        }
        this.miss = 0;
        // Crush: once the hand starts closing into a fist, the full crumple plays by itself.
        // No hard squeeze needed. Before that the sheet just bends a little with the fingers.
        if (hand.closure > CONFIG.crushTrigger) this.squeezing = true;
        this.target = this.squeezing ? 1 : clamp(hand.closure * 0.3);
        const k = clamp(this.crumple * 1.4);
        this.pos = { x: hand.cx, y: lerp(hand.cy - hand.size * 0.4, hand.cy - hand.size * 0.1, k), angle: hand.angle };
        this.cb.crush?.(this.crumple);
        if (this.crumple >= 0.99) {
          this.state = 'ball';
          this.crumple = 1;
          this.armed = hand.closure > CONFIG.gripClosure;
          this.buf = [];
          this.cb.crushed?.();
        }
        break;
      }

      case 'ball': {
        if (!hand) {
          // Calibration: adopt the first fist we see
          if (this.mode === 'calibrate' && this.holdId == null) {
            const fist = hands.find((h) => h.closure > CONFIG.gripClosure);
            if (fist) { this.holdId = fist.id; this.armed = true; this.buf = []; this.pushSample(fist, t); }
            return;
          }
          this.miss++;
          // Fast hands vanish from tracking. Treat a short dropout mid-throw as a release.
          const [a, b] = CONFIG.dropoutFrames;
          const fast = this.lastSpeed > Math.max(3, this.maxPower * 0.35);
          if (this.armed && fast && this.miss >= a && this.miss <= b) this.release(true);
          return;
        }
        this.miss = 0;
        this.pushSample(hand, t);
        this.pos = { x: hand.cx, y: hand.cy - hand.size * 0.15, angle: hand.angle };
        if (!this.armed) {
          if (hand.closure > CONFIG.gripClosure) { this.armed = true; this.buf = []; }
        } else if (hand.closure < CONFIG.releaseClosure) {
          this.release(false);
        }
        break;
      }
    }
  }

  // Called every animation frame. Once squeezing starts the crumple plays through
  // at a steady pace (about 0.8s), so it is always seen and heard in full.
  tick(dt) {
    if (this.state !== 'holding') return;
    if (this.squeezing) this.crumple = Math.min(1, this.crumple + dt / CONFIG.crumpleSeconds);
    else this.crumple += (this.target - this.crumple) * Math.min(1, dt * 8);
  }

  pushSample(h, t) {
    const b = this.buf;
    b.push({ x: h.cx, y: h.cy, s: h.size, t });
    if (b.length > CONFIG.bufferFrames) b.shift();
    this.lastSpeed = segSpeed(b, b.length - 1);
    // live reading: best of the last few segments, so the meter tracks the swing
    let live = 0;
    for (let i = Math.max(1, b.length - 3); i < b.length; i++) live = Math.max(live, segSpeed(b, i));
    this.liveSpeed = live;
  }

  // Peak speed in the 200ms before release, in hand widths per second
  measure() {
    const b = this.buf;
    if (b.length < 2) return { raw: 0, dx: 0, dy: -1 };
    const tEnd = b[b.length - 1].t;
    let best = 0, bi = b.length - 1;
    for (let i = 1; i < b.length; i++) {
      if (tEnd - b[i].t > CONFIG.peakWindowMs) continue;
      const sp = segSpeed(b, i);
      if (sp > best) { best = sp; bi = i; }
    }
    const a = b[Math.max(0, bi - 2)], c = b[Math.min(b.length - 1, bi + 1)];
    const dx = c.x - a.x, dy = c.y - a.y, n = Math.hypot(dx, dy) || 1;
    return { raw: best, dx: dx / n, dy: dy / n };
  }

  release(fromDropout) {
    const m = this.measure();
    m.dropout = fromDropout;
    this.state = 'done';
    this.armed = false;
    this.cb.release?.(m);
  }
}

function segSpeed(b, i) {
  if (i < 1) return 0;
  const p = b[i], q = b[i - 1];
  const dt = (p.t - q.t) / 1000;
  if (dt <= 0) return 0;
  return Math.hypot(p.x - q.x, p.y - q.y) / dt / ((p.s + q.s) / 2);
}

function nearest(hands, x, y) {
  let best = hands[0], bd = Infinity;
  for (const h of hands) {
    const d = Math.hypot(h.cx - x, h.cy - y);
    if (d < bd) { bd = d; best = h; }
  }
  return best;
}
