// Paper art: a sheet that crumples live into a ball, and the stack it comes from.
// Every renderer has the same interface so a sprite sheet can replace the procedural one:
//   draw(ctx, x, y, size, crumple, rotation)   size = flat sheet height in px, crumple 0..1
//   drawBall(ctx, x, y, diameter, rotation)
import { CONFIG } from './config.js';

const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export function rng(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const N = 8;
const BALL_RATIO = 0.44; // ball diameter / sheet height
const L = (() => { const v = [-0.45, -0.7, 0.75], n = Math.hypot(...v); return v.map((x) => x / n); })();
// Palette pulled from the office art: warm paper whites, cool blue shade, navy ink lines
const LIGHT = [253, 250, 242], SHADE = [150, 160, 200], DEEP = [96, 104, 150];
const INK = 'rgba(34,40,72,';

function mix(a, b, k) { return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]; }

export class ProceduralPaper {
  constructor(seed = 7) {
    this.ballRatio = BALL_RATIO;
    const r = rng(seed);
    this.v = [];
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const u = -1 + (2 * i) / N, w = -1 + (2 * j) / N;
      // square -> disc, then wrap the disc around a lumpy sphere
      const dx = u * Math.sqrt(1 - (w * w) / 2), dy = w * Math.sqrt(1 - (u * u) / 2);
      const rho = Math.min(1, Math.hypot(dx, dy)), ang = Math.atan2(dy, dx);
      const th = rho * Math.PI * 0.6, R = 0.19 * (0.85 + 0.3 * r());
      this.v.push({
        fx: u * 0.36, fy: w * 0.5,
        bx: R * Math.sin(th) * Math.cos(ang) + (r() - 0.5) * 0.06,
        by: R * Math.sin(th) * Math.sin(ang) + (r() - 0.5) * 0.06,
        bz: R * Math.cos(th),
        delay: 0.32 * (1 - rho) + r() * 0.1, // edges fold first
        wx: (r() - 0.5) * 0.16, wy: (r() - 0.5) * 0.16, wz: (r() - 0.5) * 0.14,
        x: 0, y: 0, z: 0,
      });
    }
    this.tris = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
      const crease = () => [r() - 0.5, r() - 0.5, (r() - 0.5) * 0.5];
      this.tris.push({ i: [a, b, d], n: crease(), j: r() - 0.5, z: 0, col: '' });
      this.tris.push({ i: [a, d, c], n: crease(), j: r() - 0.5, z: 0, col: '' });
    }
    this.perim = [];
    for (let i = 0; i <= N; i++) this.perim.push(i);
    for (let j = 1; j <= N; j++) this.perim.push(j * (N + 1) + N);
    for (let i = N - 1; i >= 0; i--) this.perim.push(N * (N + 1) + i);
    for (let j = N - 1; j > 0; j--) this.perim.push(j * (N + 1));
    this.cache = null;
  }

  shape(c) {
    for (const v of this.v) {
      const p = clamp((c - v.delay) / (1 - v.delay));
      const e = p * p * (3 - 2 * p);
      const s = Math.sin(e * Math.PI);
      v.x = v.fx + (v.bx - v.fx) * e + v.wx * s;
      v.y = v.fy + (v.by - v.fy) * e + v.wy * s;
      v.z = v.bz * e + v.wz * s - 0.05 * v.fx * v.fx * (1 - e);
    }
  }

  draw(ctx, x, y, size, c, rot = 0) {
    c = clamp(c);
    if (c > 0.995) return this.drawBall(ctx, x, y, size * BALL_RATIO, rot);
    this.shape(c);
    const V = this.v;
    for (const t of this.tris) {
      const [a, b, d] = t.i.map((k) => V[k]);
      const e1 = [b.x - a.x, b.y - a.y, b.z - a.z], e2 = [d.x - a.x, d.y - a.y, d.z - a.z];
      let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      let m = Math.hypot(...n) || 1;
      n = n.map((q) => q / m);
      if (n[2] < 0) n = n.map((q) => -q);
      const k = 0.9 * c;
      n = [n[0] + t.n[0] * k, n[1] + t.n[1] * k, n[2] + t.n[2] * k];
      m = Math.hypot(...n) || 1;
      let tone = clamp((n[0] * L[0] + n[1] * L[1] + n[2] * L[2]) / m);
      tone = clamp(0.25 + 0.75 * tone + t.j * 0.08 * c);
      // light cel banding, in keeping with the illustrated style
      tone = (Math.round(tone * 5) / 5) * 0.55 + tone * 0.45;
      const col = tone > 0.5 ? mix(SHADE, LIGHT, (tone - 0.5) / 0.5) : mix(DEEP, SHADE, tone / 0.5);
      t.col = `rgb(${col[0] | 0},${col[1] | 0},${col[2] | 0})`;
      t.z = a.z + b.z + d.z;
    }
    const tris = this.tris.slice().sort((p, q) => p.z - q.z);

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.scale(size, size);
    ctx.lineJoin = 'round';
    ctx.lineWidth = 1 / size;
    for (const t of tris) {
      const [a, b, d] = t.i.map((k) => V[k]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(d.x, d.y); ctx.closePath();
      ctx.fillStyle = ctx.strokeStyle = t.col;
      ctx.fill(); ctx.stroke();
    }
    // ruled lines and margin, fading as the sheet crumples
    const la = 0.55 * (1 - c / 0.45);
    if (la > 0) {
      ctx.lineWidth = 1.2 / size;
      ctx.strokeStyle = `rgba(110,132,196,${la})`;
      for (let j = 2; j < N; j++) {
        ctx.beginPath();
        for (let i = 1; i < N; i++) { const p = V[j * (N + 1) + i]; i === 1 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y); }
        ctx.stroke();
      }
      ctx.strokeStyle = `rgba(226,112,112,${la})`;
      ctx.beginPath();
      for (let j = 1; j < N; j++) { const p = V[j * (N + 1) + 1]; j === 1 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y); }
      ctx.stroke();
    }
    // outline: sheet edge while flat, silhouette once balled up
    ctx.lineWidth = Math.max(1.4, size * 0.012) / size;
    const pa = 0.85 * clamp(1 - (c - 0.4) / 0.2);
    if (pa > 0) {
      ctx.strokeStyle = INK + pa + ')';
      ctx.beginPath();
      this.perim.forEach((k, idx) => (idx ? ctx.lineTo(V[k].x, V[k].y) : ctx.moveTo(V[k].x, V[k].y)));
      ctx.closePath(); ctx.stroke();
    }
    const ha = 0.85 * clamp((c - 0.4) / 0.2);
    if (ha > 0) {
      const h = hull(V);
      ctx.strokeStyle = INK + ha + ')';
      ctx.beginPath();
      h.forEach((p, idx) => (idx ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath(); ctx.stroke();
    }
    ctx.restore();
  }

  drawBall(ctx, x, y, diam, rot = 0) {
    if (!this.cache) {
      const S = 200, cv = document.createElement('canvas');
      cv.width = cv.height = S;
      this.draw(cv.getContext('2d'), S / 2, S / 2, S * 0.8 / BALL_RATIO, 0.994);
      this.cache = cv;
    }
    const S = this.cache.width, k = diam / (S * 0.8);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.drawImage(this.cache, -S * k / 2, -S * k / 2, S * k, S * k);
    ctx.restore();
  }
}

// Sprite sheet version. Frame index is scrubbed off the crumple value.
export class SpritePaper {
  constructor(img, { frames, cols }) {
    this.img = img; this.frames = frames; this.cols = cols;
    this.fw = img.width / cols;
    this.fh = img.height / Math.ceil(frames / cols);
  }
  draw(ctx, x, y, size, c, rot = 0) {
    const f = Math.round(clamp(c) * (this.frames - 1));
    const sx = (f % this.cols) * this.fw, sy = Math.floor(f / this.cols) * this.fh;
    const h = size, w = size * (this.fw / this.fh);
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    ctx.drawImage(this.img, sx, sy, this.fw, this.fh, -w / 2, -h / 2, w, h);
    ctx.restore();
  }
  get ballRatio() { return BALL_RATIO; }
  drawBall(ctx, x, y, diam, rot = 0) { this.draw(ctx, x, y, diam / BALL_RATIO, 1, rot); }
}

export async function createPaperRenderer(seed) {
  const s = CONFIG.paperSprite;
  if (s) {
    const img = new Image();
    const ok = await new Promise((res) => { img.onload = () => res(true); img.onerror = () => res(false); img.src = s.src; });
    if (ok) return new SpritePaper(img, s);
  }
  // 3D crumple (three.js) first, flat-shaded canvas version if WebGL is unavailable
  try {
    const { CrumplePaper } = await import('./crumple3d.js');
    return new CrumplePaper({ seed });
  } catch (e) {
    console.warn('3D paper unavailable, using the canvas version', e);
    return new ProceduralPaper(seed);
  }
}

function hull(V) {
  const p = V.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const cr = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lo = [], up = [];
  for (const q of p) { while (lo.length > 1 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length > 1 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

// A neat stack of paper on a desk, seen from slightly above.
// (x, y) = centre of the bottom front edge, w = sheet width in px.
const STACK_JITTER = (() => { const r = rng(42); return Array.from({ length: 40 }, () => [(r() - 0.5), (r() - 0.5)]); })();
export function drawStack(ctx, x, y, w, count, glow = 0, t = 0) {
  const d = w * 0.42, th = Math.max(1.5, w * 0.026);
  const sheets = 3 + count * 2;
  // soft contact shadow
  const g = ctx.createRadialGradient(x, y - d * 0.4, w * 0.1, x, y - d * 0.4, w * 0.75);
  g.addColorStop(0, 'rgba(30,36,80,0.32)');
  g.addColorStop(1, 'rgba(30,36,80,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(x, y - d * 0.35, w * 0.72, d * 0.8, 0, 0, Math.PI * 2); ctx.fill();

  ctx.lineJoin = 'round';
  let top = null;
  for (let s = 0; s < sheets; s++) {
    const [jx, jy] = STACK_JITTER[s % 40];
    const ox = x + jx * w * 0.06, oy = y - s * th + jy * 2;
    const quad = [
      [ox - w * 0.5, oy], [ox + w * 0.5, oy],
      [ox + w * 0.42, oy - d], [ox - w * 0.42, oy - d],
    ];
    const last = s === sheets - 1;
    // front edge
    ctx.fillStyle = s % 2 ? '#dfe1ee' : '#eceef6';
    ctx.strokeStyle = 'rgba(40,46,84,0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(quad[0][0], quad[0][1]); ctx.lineTo(quad[1][0], quad[1][1]);
    ctx.lineTo(quad[1][0], quad[1][1] + th); ctx.lineTo(quad[0][0], quad[0][1] + th);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // top face
    const tg = ctx.createLinearGradient(ox, oy - d, ox, oy);
    tg.addColorStop(0, '#fffdf6'); tg.addColorStop(1, '#eeeaf0');
    ctx.fillStyle = tg;
    ctx.strokeStyle = last ? 'rgba(34,40,72,0.9)' : 'rgba(40,46,84,0.45)';
    ctx.lineWidth = last ? 1.6 : 1;
    ctx.beginPath();
    quad.forEach(([qx, qy], i) => (i ? ctx.lineTo(qx, qy) : ctx.moveTo(qx, qy)));
    ctx.closePath(); ctx.fill(); ctx.stroke();
    if (last) top = { quad, ox, oy };
  }
  if (!top) return null;
  const { quad, ox, oy } = top;
  // writing lines on the top sheet
  ctx.strokeStyle = 'rgba(110,132,196,0.55)';
  ctx.lineWidth = 1;
  for (let i = 1; i <= 5; i++) {
    const k = i / 6.5, yy = oy - d + d * k;
    const inset = w * (0.42 + 0.08 * k) - w * 0.08;
    ctx.beginPath(); ctx.moveTo(ox - inset, yy); ctx.lineTo(ox + inset * (i === 5 ? 0.3 : 1), yy); ctx.stroke();
  }
  // warm sunlight sheen
  ctx.fillStyle = 'rgba(255,196,130,0.12)';
  ctx.beginPath(); quad.forEach(([qx, qy], i) => (i ? ctx.lineTo(qx, qy) : ctx.moveTo(qx, qy))); ctx.fill();
  if (glow > 0) {
    const a = glow * (0.55 + 0.35 * Math.sin(t * 6));
    ctx.save();
    ctx.shadowColor = `rgba(255,170,80,${a})`;
    ctx.shadowBlur = 18;
    ctx.strokeStyle = `rgba(255,178,92,${a})`;
    ctx.lineWidth = 3;
    ctx.beginPath(); quad.forEach(([qx, qy], i) => (i ? ctx.lineTo(qx, qy) : ctx.moveTo(qx, qy))); ctx.closePath(); ctx.stroke();
    ctx.restore();
  }
  return { x: ox, y: oy - d / 2 };
}
