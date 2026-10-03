// Looping demos for the "How to play" screen: pick, crush, throw.
import { drawStack as drawFlatStack } from './paper.js';
// Uses the hand and fist icons, the same realistic paper as the game, and the real bin.
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const ease = (t) => t * t * (3 - 2 * t);

function loadIcon(src) {
  const img = new Image();
  img.src = src;
  return img;
}
const ICONS = { hand: loadIcon('assets/img/hand-open.svg'), fist: loadIcon('assets/img/fist.svg') };

// Draw an icon centred at (x, y), s px tall
function icon(c, img, x, y, s, alpha = 1) {
  if (!img.complete || alpha <= 0) return;
  c.save();
  c.globalAlpha = alpha;
  c.drawImage(img, x - s / 2, y - s / 2, s, s);
  c.restore();
}

class Demo {
  constructor(canvas, kind, paper, bin) {
    this.c = canvas.getContext('2d');
    this.kind = kind;
    this.paper = paper;
    this.bin = bin;
    const dpr = Math.min(2, devicePixelRatio || 1);
    this.w = canvas.clientWidth || 260; this.h = canvas.clientHeight || 190;
    canvas.width = this.w * dpr; canvas.height = this.h * dpr;
    this.c.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  frame(t) {
    const { c, w, h } = this;
    c.clearRect(0, 0, w, h);
    this[this.kind](c, w, h, ((t / 1000) % 3.2) / 3.2);
  }

  // open hand comes over the pile, rests, the sheet lifts with it
  pick(c, w, h, p) {
    const sx = w * 0.5, sy = h * 0.9, sw = w * 0.42;
    const reach = ease(clamp(p / 0.3)), lift = ease(clamp((p - 0.55) / 0.3));
    const rest = clamp((p - 0.3) / 0.25);
    const s = h * 0.42;
    const hx = w * 0.18 + (sx - w * 0.18) * reach, hy = h * 0.22 + (h * 0.4 - h * 0.22) * reach - lift * h * 0.22;
    const glow = lift > 0 ? 0 : rest > 0 ? 0.4 + 0.6 * rest : 0.25;
    const top = this.paper.drawStack ? this.paper.drawStack(c, sx, sy, sw, 2, glow, p * 3.2) : drawFlatStack(c, sx, sy, sw, 2, glow, p * 3.2);
    if (lift > 0 && top) this.paper.draw(c, hx, hy + s * 0.55, h * 0.5, 0, 0); // sheet hangs just under the hand
    icon(c, ICONS.hand, hx, hy, s);
  }

  // the hand closes into a fist and the sheet crumples into a ball
  crush(c, w, h, p) {
    const x = w * 0.5, y = h * 0.5, s = h * 0.48;
    const close = ease(clamp((p - 0.18) / 0.14));
    const crumple = ease(clamp((p - 0.28) / 0.42));
    const reset = 1 - ease(clamp((p - 0.92) / 0.08));
    const cr = crumple * reset;
    if (cr < 0.995) this.paper.draw(c, x, y - s * 0.05, h * 0.78, cr, 0.08);
    else this.paper.drawBall(c, x, y - s * 0.05, h * 0.78 * this.paper.ballRatio, 0.3);
    icon(c, ICONS.hand, x + w * 0.14, y + s * 0.42, s * 0.62, (1 - close) * reset + (1 - reset));
    icon(c, ICONS.fist, x + w * 0.14, y + s * 0.42, s * 0.62, close * reset);
  }

  // fist swings up, opens, the ball arcs into the bin
  throw(c, w, h, p) {
    const s = h * 0.36;
    const bw = w * 0.2, bh = bw * (this.bin.height / this.bin.width || 1.2);
    const bx = w * 0.8, by = h * 0.86 - bh;           // bin top-left anchor via centre x
    const mouthY = by + bh * 0.105;
    const swing = ease(clamp(p / 0.3));
    const open = clamp((p - 0.3) / 0.04);
    const hx = w * 0.2 + swing * w * 0.1, hy = h * 0.78 - swing * h * 0.4;
    const f = clamp((p - 0.32) / 0.42);
    const sx = hx + s * 0.05, sy = hy - s * 0.35, d = s * 0.42;
    // ball first (behind the bin once it is inside), then the bin
    if (p < 0.32) this.paper.drawBall(c, sx, sy, d, 0);
    else if (f < 1) {
      const x = sx + (bx - sx) * f;
      const y = sy + (mouthY + bh * 0.25 - sy) * f - Math.sin(f * Math.PI) * h * 0.32;
      this.paper.drawBall(c, x, y, d * (1 - 0.45 * f), f * 7);
    } else if (p < 0.97) this.paper.drawBall(c, bx, mouthY + bh * 0.25, d * 0.55, 7);
    if (this.bin.complete) c.drawImage(this.bin, bx - bw / 2, by, bw, bh);
    icon(c, ICONS.fist, hx, hy, s, 1 - open);
    icon(c, ICONS.hand, hx, hy, s, open);
    if (p > 0.76 && p < 0.97) {
      c.fillStyle = `rgba(18,22,43,${1 - (p - 0.76) / 0.21})`;
      c.font = '600 15px -apple-system, BlinkMacSystemFont, system-ui, sans-serif';
      c.textAlign = 'center';
      c.fillText('In!', bx, by - 8);
    }
  }
}

export function startDemos(root, paper, bin) {
  const demos = [...root.querySelectorAll('canvas[data-demo]')].map((cv) => new Demo(cv, cv.dataset.demo, paper, bin));
  let raf = 0, running = true;
  const loop = (t) => { if (!running) return; demos.forEach((d) => d.frame(t)); raf = requestAnimationFrame(loop); };
  raf = requestAnimationFrame(loop);
  return () => { running = false; cancelAnimationFrame(raf); };
}
