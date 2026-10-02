// Small looping demos for the instructions screen: pick, crush, throw.
import { drawStack } from './paper.js';

const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const ease = (t) => t * t * (3 - 2 * t);
const INK = '#232a4d', GLOVE = '#f2f3fb', GLOVE_SHADE = '#cfd4ee';

// A friendly cartoon hand, palm toward us. curl 0..1 closes the fingers, pinch 0..1 brings thumb to index.
function drawHand(c, x, y, s, { curl = 0, pinch = 0 } = {}) {
  c.save();
  c.translate(x, y);
  c.lineCap = 'round'; c.lineJoin = 'round';
  const fingers = [[-0.3, 0.6], [-0.1, 0.7], [0.1, 0.66], [0.29, 0.5]];
  const base = -0.34 * s;
  const segs = fingers.map(([fx, len], i) => {
    const L = len * s, bx = fx * s;
    const cu = i === 0 ? Math.max(curl, pinch * 0.35) : curl;
    const jy = base - L * 0.5 * (1 - cu * 0.75);
    const ty = base - L * (1 - cu * 1.45);
    const tx = bx * (1 - cu * 0.2) + (i === 0 ? pinch * 0.12 * s : 0);
    return [[bx, base], [bx * 0.98, jy], [tx, ty]];
  });
  // thumb: from lower left of the palm toward the index tip when pinching, across the palm for a fist
  const idx = segs[0][2];
  const tOpen = [-0.62 * s, -0.22 * s], tFist = [-0.05 * s, -0.12 * s];
  let tip = [tOpen[0] + (tFist[0] - tOpen[0]) * curl, tOpen[1] + (tFist[1] - tOpen[1]) * curl];
  tip = [tip[0] + (idx[0] - 0.05 * s - tip[0]) * pinch, tip[1] + (idx[1] + 0.02 * s - tip[1]) * pinch];
  const thumb = [[-0.3 * s, 0.18 * s], [(-0.52 * s + tip[0]) / 2, (0.02 * s + tip[1]) / 2], tip];
  const line = (pts, w, col) => {
    c.strokeStyle = col; c.lineWidth = w;
    c.beginPath(); pts.forEach(([px, py], i) => (i ? c.lineTo(px, py) : c.moveTo(px, py))); c.stroke();
  };
  const fw = 0.18 * s;
  // palm
  c.fillStyle = GLOVE; c.strokeStyle = INK; c.lineWidth = 2.2;
  c.beginPath(); c.roundRect(-0.42 * s, -0.4 * s, 0.84 * s, 0.8 * s, 0.22 * s); c.fill(); c.stroke();
  c.fillStyle = GLOVE_SHADE;
  c.beginPath(); c.roundRect(-0.3 * s, 0.1 * s, 0.6 * s, 0.24 * s, 0.1 * s); c.fill();
  for (const p of [thumb, ...segs]) line(p, fw + 4.4, INK);
  for (const p of [thumb, ...segs]) line(p, fw, GLOVE);
  c.restore();
}

class Demo {
  constructor(canvas, kind, paper) {
    this.c = canvas.getContext('2d');
    this.cv = canvas;
    this.kind = kind;
    this.paper = paper;
    const dpr = Math.min(2, devicePixelRatio || 1);
    this.w = canvas.clientWidth || 260; this.h = canvas.clientHeight || 190;
    canvas.width = this.w * dpr; canvas.height = this.h * dpr;
    this.c.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  frame(t) {
    const { c, w, h } = this;
    c.clearRect(0, 0, w, h);
    this[this.kind](c, w, h, (t / 1000) % 3 / 3);
  }
  pick(c, w, h, p) {
    const sx = w * 0.7, sy = h * 0.86;
    // hand travels over the pile, pinches, lifts the sheet
    const reach = ease(clamp(p / 0.35)), lift = ease(clamp((p - 0.55) / 0.35));
    const pinch = ease(clamp((p - 0.36) / 0.16)) * (1 - clamp((p - 0.95) / 0.05));
    const hx = w * 0.3 + (sx - w * 0.3) * reach - lift * w * 0.25;
    const hy = h * 0.45 - lift * h * 0.15;
    const s = h * 0.36;
    drawStack(c, sx, sy, w * 0.26, 3, pinch > 0.5 && lift < 0.05 ? 1 : 0.3, p * 3);
    if (lift > 0) this.paper.draw(c, hx - s * 0.05, hy - s * 0.55 + s * 0.45, s * 1.2, 0.05, -0.2);
    drawHand(c, hx, hy + s * 0.2, s, { curl: pinch * 0.15 }); // open hand resting over the pile
  }
  crush(c, w, h, p) {
    const curl = ease(clamp((p - 0.1) / 0.55)) * (1 - ease(clamp((p - 0.9) / 0.1)));
    const s = h * 0.4, x = w * 0.5, y = h * 0.58;
    this.paper.draw(c, x, y - s * 0.3, s * 1.7, clamp(curl * 1.05), 0.1);
    drawHand(c, x, y + s * 0.15, s, { curl });
  }
  throw(c, w, h, p) {
    const s = h * 0.34;
    const bx = w * 0.78, by = h * 0.32;
    // little bin in the distance
    c.fillStyle = '#4b5684'; c.strokeStyle = INK; c.lineWidth = 2;
    c.beginPath(); c.moveTo(bx - 16, by); c.lineTo(bx + 16, by); c.lineTo(bx + 12, by + 30); c.lineTo(bx - 12, by + 30); c.closePath(); c.fill(); c.stroke();
    c.beginPath(); c.ellipse(bx, by, 16, 5, 0, 0, Math.PI * 2); c.fillStyle = '#2d3558'; c.fill(); c.stroke();
    const swing = ease(clamp(p / 0.35));
    const open = ease(clamp((p - 0.33) / 0.08));
    const hx = w * 0.22 + swing * w * 0.12, hy = h * 0.82 - swing * h * 0.38;
    if (swing > 0.25 && swing < 1) {
      c.strokeStyle = 'rgba(91,121,230,0.6)'; c.lineWidth = 3;
      for (let i = 0; i < 3; i++) { c.beginPath(); c.moveTo(hx - 20 + i * 12, hy + 40); c.lineTo(hx - 26 + i * 12, hy + 70); c.stroke(); }
    }
    drawHand(c, hx, hy, s, { curl: 1 - open });
    const f = clamp((p - 0.37) / 0.4);
    if (p < 0.37) this.paper.drawBall(c, hx, hy - s * 0.2, s * 0.5, 0);
    else if (f < 1) {
      const x = hx + (bx - hx) * f, y = hy - s * 0.2 + (by - 4 - (hy - s * 0.2)) * f - Math.sin(f * Math.PI) * h * 0.3;
      this.paper.drawBall(c, x, y, s * 0.5 * (1 - 0.6 * f), f * 8);
    }
    if (p > 0.8) {
      c.fillStyle = `rgba(255,170,80,${1 - (p - 0.8) / 0.2})`;
      c.font = '700 15px -apple-system, BlinkMacSystemFont, system-ui, sans-serif'; c.textAlign = 'center';
      c.fillText('In!', bx, by - 14);
    }
  }
}

export function startDemos(root, paper) {
  const demos = [...root.querySelectorAll('canvas[data-demo]')].map((cv) => new Demo(cv, cv.dataset.demo, paper));
  let raf = 0, running = true;
  const loop = (t) => { if (!running) return; demos.forEach((d) => d.frame(t)); raf = requestAnimationFrame(loop); };
  raf = requestAnimationFrame(loop);
  return () => { running = false; cancelAnimationFrame(raf); };
}
