// 3D crumpling paper, ported from the React Bits <PaperCrumple /> component (three.js).
// The fold solver and paper material come from that component. Instead of a pointer hold,
// the crumple amount is driven directly by the player's hand closure (0 flat, 1 balled up).
// The sheet is rendered to an offscreen WebGL canvas and stamped onto the game's 2D canvas,
// so it keeps the same interface as the other paper renderers:
//   draw(ctx, x, y, size, crumple, rotation)   size = flat sheet height in px
//   drawBall(ctx, x, y, diameter, rotation)
import * as THREE from 'three';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function randomSource(seed) {
  let value = seed | 0;
  return () => {
    value |= 0;
    value = (value + 0x6d2b79f5) | 0;
    let n = Math.imul(value ^ (value >>> 15), 1 | value);
    n = (n + Math.imul(n ^ (n >>> 7), 61 | n)) ^ n;
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

// Precomputes the crumple as a series of mesh poses (samples[0] flat ... samples[last] balled up).
function createPaperPath(rest, triangles, shortSide, density, sharpness, depth, seed) {
  const count = rest.length / 3;
  const points = Float64Array.from(rest);
  const previous = Float64Array.from(rest);
  const before = Float64Array.from(rest);
  const edges = [];
  const hinges = [];
  const adjacency = new Map();
  const random = randomSource(seed);
  const guides = Array.from({ length: density }, () => {
    const angle = random() * Math.PI * 2;
    return { x: Math.cos(angle), y: Math.sin(angle), phase: random() * Math.PI * 2, weight: random() * 0.6 + 0.4 };
  });
  for (let t = 0; t < triangles.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = triangles[t + k], b = triangles[t + ((k + 1) % 3)], opposite = triangles[t + ((k + 2) % 3)];
      const key = Math.min(a, b) * count + Math.max(a, b);
      const other = adjacency.get(key);
      if (!other) {
        adjacency.set(key, { a, b, opposite });
        const length = Math.hypot(rest[a * 3] - rest[b * 3], rest[a * 3 + 1] - rest[b * 3 + 1]);
        edges.push(a * 3, b * 3, length);
      } else {
        const c = other.opposite * 3, d = opposite * 3;
        const length = Math.hypot(rest[c] - rest[d], rest[c + 1] - rest[d + 1]);
        const mx = (rest[c] + rest[d]) * 0.5, my = (rest[c + 1] + rest[d + 1]) * 0.5;
        let weakness = 0;
        for (const guide of guides) {
          const distance = Math.abs(Math.sin(((mx * guide.x + my * guide.y) / shortSide) * 4 + guide.phase));
          weakness = Math.max(weakness, Math.exp(-distance * distance * 80) * guide.weight);
        }
        hinges.push(c, d, length, 0.12 + (1 - weakness) * 0.75);
      }
    }
  }
  const spacing = Math.sqrt((shortSide * shortSide) / count);
  const thickness = shortSide * 0.008;
  const samples = [rest.slice()];
  const frameCount = 64;
  const stepsPerFrame = 3;
  const totalSteps = frameCount * stepsPerFrame;
  let initialRadius = 0;
  for (let i = 0; i < rest.length; i += 3) initialRadius = Math.max(initialRadius, Math.hypot(rest[i] / 0.94, rest[i + 1] / 1.02));
  initialRadius *= 1.02;

  function constrain(list, stride, stiffness, reverse) {
    for (let n = 0; n < list.length; n += stride) {
      const edge = reverse ? list.length - stride - n : n;
      const a = list[edge], b = list[edge + 1];
      const dx = points[b] - points[a], dy = points[b + 1] - points[a + 1], dz = points[b + 2] - points[a + 2];
      const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (length < 0.000001) continue;
      const weight = stride === 4 ? list[edge + 3] : 1;
      const amount = (1 - list[edge + 2] / length) * 0.5 * stiffness * weight;
      points[a] += dx * amount; points[b] -= dx * amount;
      points[a + 1] += dy * amount; points[b + 1] -= dy * amount;
      points[a + 2] += dz * amount; points[b + 2] -= dz * amount;
    }
  }

  // Keeps layers of paper from passing through each other
  function separateLayers() {
    const margin = thickness * 2;
    for (let t = 0; t < triangles.length; t += 3) {
      const a = triangles[t] * 3, b = triangles[t + 1] * 3, c = triangles[t + 2] * 3;
      const ax = points[a], ay = points[a + 1], az = points[a + 2];
      const bx = points[b] - ax, by = points[b + 1] - ay, bz = points[b + 2] - az;
      const cx = points[c] - ax, cy = points[c + 1] - ay, cz = points[c + 2] - az;
      let nx = by * cz - bz * cy, ny = bz * cx - bx * cz, nz = bx * cy - by * cx;
      const length = Math.hypot(nx, ny, nz);
      if (length < 0.0000001) continue;
      nx /= length; ny /= length; nz /= length;
      const minX = Math.min(ax, points[b], points[c]) - margin, maxX = Math.max(ax, points[b], points[c]) + margin;
      const minY = Math.min(ay, points[b + 1], points[c + 1]) - margin, maxY = Math.max(ay, points[b + 1], points[c + 1]) + margin;
      const minZ = Math.min(az, points[b + 2], points[c + 2]) - margin, maxZ = Math.max(az, points[b + 2], points[c + 2]) + margin;
      const bb = bx * bx + by * by + bz * bz, cc = cx * cx + cy * cy + cz * cz, bc = bx * cx + by * cy + bz * cz;
      const determinant = bb * cc - bc * bc;
      if (determinant < 0.0000000001) continue;
      for (let p = 0; p < points.length; p += 3) {
        if (p === a || p === b || p === c) continue;
        if (points[p] < minX || points[p] > maxX || points[p + 1] < minY || points[p + 1] > maxY || points[p + 2] < minZ || points[p + 2] > maxZ) continue;
        const rx = rest[p] - (rest[a] + rest[b] + rest[c]) / 3;
        const ry = rest[p + 1] - (rest[a + 1] + rest[b + 1] + rest[c + 1]) / 3;
        if (rx * rx + ry * ry < spacing * spacing * 6) continue;
        const dx = points[p] - ax, dy = points[p + 1] - ay, dz = points[p + 2] - az;
        const distance = dx * nx + dy * ny + dz * nz;
        const previousDistance = (before[p] - before[a]) * nx + (before[p + 1] - before[a + 1]) * ny + (before[p + 2] - before[a + 2]) * nz;
        const side = previousDistance >= 0 ? 1 : -1;
        if (distance * side >= thickness || Math.abs(distance) > margin) continue;
        const pb = dx * bx + dy * by + dz * bz, pc = dx * cx + dy * cy + dz * cz;
        const u = (cc * pb - bc * pc) / determinant, v = (bb * pc - bc * pb) / determinant;
        if (u < 0 || v < 0 || u + v > 1) continue;
        const w = 1 - u - v;
        const correction = (thickness * side - distance) / (1 + w * w + u * u + v * v);
        for (let axis = 0; axis < 3; axis++) {
          const normal = axis === 0 ? nx : axis === 1 ? ny : nz;
          const movement = normal * correction;
          points[p + axis] += movement;
          points[a + axis] -= movement * w;
          points[b + axis] -= movement * u;
          points[c + axis] -= movement * v;
        }
      }
    }
  }

  for (let step = 1; step <= totalSteps; step++) {
    const progress = step / totalSteps;
    const compression = progress * progress * (3 - 2 * progress);
    const radius = initialRadius * (1 - compression) + shortSide * (0.19 - depth * 0.025) * compression;
    before.set(points);
    for (let i = 0; i < points.length; i += 3) {
      const x = rest[i] / shortSide, y = rest[i + 1] / shortSide;
      let buckle = 0;
      for (const guide of guides) buckle += Math.sin((x * guide.x + y * guide.y) * 5 + guide.phase) * guide.weight;
      for (let axis = 0; axis < 3; axis++) {
        const velocity = (points[i + axis] - previous[i + axis]) * 0.55;
        previous[i + axis] = points[i + axis];
        points[i + axis] += clamp(velocity, -spacing * 0.15, spacing * 0.15);
      }
      points[i + 2] += (buckle / density) * shortSide * 0.0007 * Math.sin(progress * Math.PI);
    }
    for (let pass = 0; pass < 18; pass++) {
      constrain(hinges, 4, 0.45 * (1 - sharpness * 0.4), pass % 2 === 0);
      for (let i = 0; i < points.length; i += 3) {
        const x = points[i] / 0.94, y = points[i + 1] / 1.02, z = points[i + 2] / 0.86;
        const distance = Math.hypot(x, y, z);
        if (distance > radius) {
          const push = (1 - radius / distance) * 0.55;
          points[i] -= points[i] * push; points[i + 1] -= points[i + 1] * push; points[i + 2] -= points[i + 2] * push;
        }
      }
      constrain(edges, 3, 1, pass % 2 !== 0);
      if (pass === 8 || pass === 17) separateLayers();
    }
    for (let h = 0; h < hinges.length; h += 4) {
      const a = hinges[h], b = hinges[h + 1];
      const length = Math.hypot(points[a] - points[b], points[a + 1] - points[b + 1], points[a + 2] - points[b + 2]);
      if (length < hinges[h + 2] * 0.86) hinges[h + 2] += (length - hinges[h + 2]) * 0.12;
    }
    if (step % stepsPerFrame === 0) samples.push(Float32Array.from(points));
  }
  return samples;
}

// Lined notepaper with paper fibres, slight warm ageing at the edges and ballpoint notes.
// Shared by the crumpling sheet and the top of the stack.
let notepaperCanvas = null;
function notepaperImage(aspect) {
  if (notepaperCanvas) return notepaperCanvas;
  const w = 1024, h = Math.round(1024 * aspect);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const c = cv.getContext('2d');
  const r = randomSource(23);
  c.fillStyle = '#f7f5ef';
  c.fillRect(0, 0, w, h);
  // fibres
  for (let i = 0; i < 2600; i++) {
    const x = r() * w, y = r() * h, a = r() * Math.PI, l = 3 + r() * 14;
    c.strokeStyle = r() < 0.5 ? `rgba(120,110,90,${0.03 + r() * 0.05})` : `rgba(255,255,255,${0.15 + r() * 0.2})`;
    c.lineWidth = 0.6 + r() * 0.8;
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke();
  }
  // per-pixel tooth
  const img = c.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (r() - 0.5) * 10; d[i] += n; d[i + 1] += n; d[i + 2] += n * 0.9; }
  c.putImageData(img, 0, 0);
  // faint warm edges
  const g = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
  g.addColorStop(0, 'rgba(240,226,196,0)'); g.addColorStop(1, 'rgba(232,214,178,0.22)');
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  // printed rules and margin
  c.strokeStyle = 'rgba(112,146,204,0.5)'; c.lineWidth = 1.8;
  for (let y = 170; y < h - 30; y += 46) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
  c.strokeStyle = 'rgba(214,92,96,0.55)'; c.lineWidth = 1.6;
  for (const x of [128, 134]) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke(); }
  // ballpoint handwriting: joined loops along each rule
  c.lineCap = c.lineJoin = 'round';
  const lines = [0.9, 0.75, 0.85, 0.55, 0.8, 0.4, 0.7, 0.3];
  lines.forEach((len, li) => {
    const base = 170 + 46 * li - 9;
    let x = 152;
    c.strokeStyle = `rgba(28,44,118,${0.7 + r() * 0.15})`;
    c.lineWidth = 2 + r() * 0.6;
    c.beginPath(); c.moveTo(x, base);
    while (x < 152 + (w - 200) * len) {
      const word = 3 + Math.floor(r() * 6);
      for (let k = 0; k < word; k++) {
        const hgt = 10 + r() * 14 * (r() < 0.25 ? 1.8 : 1), step = 7 + r() * 6;
        c.quadraticCurveTo(x + step * 0.2, base - hgt, x + step * 0.55, base - hgt * 0.4);
        c.quadraticCurveTo(x + step * 0.8, base + 2, x + step, base);
        x += step;
      }
      x += 12 + r() * 8;
      c.moveTo(x, base);
    }
    c.stroke();
  });
  notepaperCanvas = cv;
  return cv;
}
function notepaperTexture(aspect) {
  const tex = new THREE.CanvasTexture(notepaperImage(aspect));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

const RES = 512;      // offscreen render size in px
const VIEW = 0.74;    // half extent of the visible area, in sheet widths

export class CrumplePaper {
  constructor({ seed = 7, detail = 80, foldCount = 7, foldSharpness = 0.6, wrinkleDepth = 0.5, aspect = 1.3, paperColor = '#f4f0e8' } = {}) {
    this.aspect = aspect;
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(1);
    renderer.setSize(RES, RES, false);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = renderer;

    // mesh: slightly jittered grid, as in the original component
    const shortSide = Math.min(1, aspect);
    const resolution = Math.round(clamp(detail / 4, 8, 24));
    const columns = Math.max(8, Math.round(resolution / Math.max(1, aspect)));
    const rows = Math.max(8, Math.round(resolution * Math.min(1, aspect)));
    const rng = randomSource(seed);
    const count = (columns + 1) * (rows + 1);
    const original = new Float32Array(count * 3);
    const uvs = new Float32Array(count * 2);
    const indices = [];
    for (let row = 0; row <= rows; row++) {
      for (let col = 0; col <= columns; col++) {
        const index = row * (columns + 1) + col;
        const u = (col + (col > 0 && col < columns ? (rng() - 0.5) * 0.5 : 0)) / columns;
        const v = (row + (row > 0 && row < rows ? (rng() - 0.5) * 0.5 : 0)) / rows;
        original[index * 3] = u - 0.5;
        original[index * 3 + 1] = (v - 0.5) * aspect;
        uvs[index * 2] = u; uvs[index * 2 + 1] = v;
        if (col < columns && row < rows) {
          const a = index, b = index + 1, c = index + columns + 1, d = c + 1;
          if (rng() > 0.5) indices.push(a, b, d, a, d, c);
          else indices.push(a, b, c, b, d, c);
        }
      }
    }
    this.sharpness = clamp(foldSharpness, 0, 1);
    this.samples = createPaperPath(original, indices, shortSide, Math.round(clamp(foldCount, 3, 16)), this.sharpness, clamp(wrinkleDepth, 0, 2), seed);
    this.indices = indices;
    this.positions = new Float32Array(count * 3);

    const n = indices.length;
    this.renderPositions = new Float32Array(n * 3);
    this.renderNormals = new Float32Array(n * 3);
    const renderUvs = new Float32Array(n * 2);
    this.faceNormals = new Float32Array(n);
    this.incident = Array.from({ length: count }, () => []);
    for (let i = 0; i < n; i++) {
      renderUvs[i * 2] = uvs[indices[i] * 2];
      renderUvs[i * 2 + 1] = uvs[indices[i] * 2 + 1];
      this.incident[indices[i]].push(Math.floor(i / 3) * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.renderPositions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('normal', new THREE.BufferAttribute(this.renderNormals, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('uv', new THREE.BufferAttribute(renderUvs, 2));
    this.geometry = geometry;

    // fine paper grain
    const G = 256, raw = new Float32Array(G * G), grainData = new Uint8Array(G * G * 4);
    for (let i = 0; i < raw.length; i++) raw[i] = rng();
    for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
      // streak the noise along x so it reads as fibres rather than sand
      let v = 0;
      for (let k = -3; k <= 3; k++) v += raw[y * G + ((x + k + G) % G)];
      v = v / 7 * 0.7 + raw[y * G + x] * 0.3;
      const o = (y * G + x) * 4;
      grainData[o] = grainData[o + 1] = grainData[o + 2] = 90 + v * 165;
      grainData[o + 3] = 255;
    }
    const grain = new THREE.DataTexture(grainData, G, G);
    grain.wrapS = grain.wrapT = THREE.RepeatWrapping;
    grain.repeat.set(3, 3 * aspect);
    grain.magFilter = grain.minFilter = THREE.LinearFilter;
    grain.needsUpdate = true;

    const base = { roughness: 0.95, metalness: 0, bumpMap: grain, bumpScale: 0.05 };
    this.grain = grain;
    const front = new THREE.MeshStandardMaterial({ ...base, map: notepaperTexture(aspect), side: THREE.FrontSide });
    const back = new THREE.MeshStandardMaterial({ ...base, color: paperColor, side: THREE.BackSide });
    this.sheet = new THREE.Group();
    for (const m of [front, back]) {
      const mesh = new THREE.Mesh(geometry, m);
      mesh.castShadow = mesh.receiveShadow = true;
      this.sheet.add(mesh);
    }

    const scene = new THREE.Scene();
    scene.add(this.sheet);
    // warm sun from the windows, cool office bounce, matching the backdrop art
    scene.add(new THREE.HemisphereLight(0xf4f6ff, 0x7c84a8, 1.1));
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
    sun.position.set(-1.2, 1.6, 2.6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = sun.shadow.camera.bottom = -0.9;
    sun.shadow.camera.right = sun.shadow.camera.top = 0.9;
    sun.shadow.camera.near = 0.5; sun.shadow.camera.far = 6;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.006; sun.shadow.radius = 3;
    scene.add(sun);
    this.sun = sun;
    this.scene = scene;
    this.paperColor = paperColor;
    this.stackCache = new Map();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
    this.camera.position.z = VIEW / Math.tan(THREE.MathUtils.degToRad(15));

    // Size of the finished ball, so callers can scale it consistently
    const last = this.samples[this.samples.length - 1];
    let half = 0;
    for (let i = 0; i < last.length; i += 3) half = Math.max(half, Math.abs(last[i]), Math.abs(last[i + 1]));
    this.ballHalf = half;
    this.ballRatio = (2 * half) / aspect; // ball diameter / sheet height
    this.current = -1;
    this.cache = null;
  }

  deform(amount) {
    const { samples, positions, indices, faceNormals, renderPositions, renderNormals } = this;
    const frame = clamp(amount, 0, 1) * (samples.length - 1);
    const lower = Math.floor(frame), upper = Math.min(lower + 1, samples.length - 1), mix = frame - lower;
    const from = samples[lower], to = samples[upper];
    for (let i = 0; i < positions.length; i++) positions[i] = from[i] + (to[i] - from[i]) * mix;
    for (let f = 0; f < indices.length; f += 3) {
      const a = indices[f] * 3, b = indices[f + 1] * 3, c = indices[f + 2] * 3;
      const bx = positions[b] - positions[a], by = positions[b + 1] - positions[a + 1], bz = positions[b + 2] - positions[a + 2];
      const cx = positions[c] - positions[a], cy = positions[c + 1] - positions[a + 1], cz = positions[c + 2] - positions[a + 2];
      const nx = by * cz - bz * cy, ny = bz * cx - bx * cz, nz = bx * cy - by * cx;
      const length = Math.hypot(nx, ny, nz) || 1;
      faceNormals[f] = nx / length; faceNormals[f + 1] = ny / length; faceNormals[f + 2] = nz / length;
    }
    // smooth normals across soft wrinkles, keep them sharp across creases
    const lo = 0.88 - (1 - this.sharpness) * 0.18;
    for (let i = 0; i < indices.length; i++) {
      const src = indices[i] * 3, face = Math.floor(i / 3) * 3;
      let nx = 0, ny = 0, nz = 0;
      for (const nb of this.incident[indices[i]]) {
        const dot = faceNormals[face] * faceNormals[nb] + faceNormals[face + 1] * faceNormals[nb + 1] + faceNormals[face + 2] * faceNormals[nb + 2];
        const w = THREE.MathUtils.smoothstep(dot, lo, 0.98);
        nx += faceNormals[nb] * w; ny += faceNormals[nb + 1] * w; nz += faceNormals[nb + 2] * w;
      }
      const length = Math.hypot(nx, ny, nz) || 1;
      renderPositions[i * 3] = positions[src];
      renderPositions[i * 3 + 1] = positions[src + 1];
      renderPositions[i * 3 + 2] = positions[src + 2];
      renderNormals[i * 3] = nx / length; renderNormals[i * 3 + 1] = ny / length; renderNormals[i * 3 + 2] = nz / length;
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.normal.needsUpdate = true;
    this.geometry.computeBoundingSphere();
  }

  renderAt(amount) {
    if (amount === this.current) return;
    this.current = amount;
    this.deform(amount);
    // a held sheet leans back a little; the tilt fades as it balls up
    this.sheet.rotation.set(-0.35 * (1 - amount), 0.15 * (1 - amount), 0);
    this.renderer.render(this.scene, this.camera);
  }

  draw(ctx, x, y, size, c, rot = 0) {
    c = clamp(c, 0, 1);
    if (c > 0.995) return this.drawBall(ctx, x, y, size * this.ballRatio, rot);
    // ease in slightly so the sheet still reads as a sheet through the first part of the squeeze
    this.renderAt(Math.round(Math.pow(c, 1.25) * 400) / 400);
    const side = (2 * VIEW * size) / this.aspect;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.shadowColor = 'rgba(20,26,40,0.35)';
    ctx.shadowBlur = size * 0.06;
    ctx.shadowOffsetY = size * 0.03;
    ctx.drawImage(this.renderer.domElement, -side / 2, -side / 2, side, side);
    ctx.restore();
  }

  drawBall(ctx, x, y, diam, rot = 0) {
    if (!this.cache) {
      this.renderAt(1);
      const pxPerUnit = RES / (2 * VIEW);
      const half = Math.ceil(this.ballHalf * 1.35 * pxPerUnit);
      const cv = document.createElement('canvas');
      cv.width = cv.height = half * 2;
      cv.getContext('2d').drawImage(this.renderer.domElement, RES / 2 - half, RES / 2 - half, half * 2, half * 2, 0, 0, half * 2, half * 2);
      this.cache = { cv, scale: 1 / (2 * this.ballHalf * pxPerUnit) };
    }
    const { cv, scale } = this.cache;
    const s = cv.width * diam * scale;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.drawImage(cv, -s / 2, -s / 2, s, s);
    ctx.restore();
  }

  buildStack(count) {
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xf4f6ff, 0x7c84a8, 1.1));
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
    sun.position.set(-1.4, 2.6, 1.6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -1.2, right: 1.2, top: 1.2, bottom: -1.2, near: 0.5, far: 8 });
    sun.shadow.bias = -0.0004; sun.shadow.radius = 4;
    scene.add(sun);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.ShadowMaterial({ opacity: 0.5 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    const r = randomSource(99);
    const th = 0.007, sheets = 6 + count * 2, D = this.aspect;
    const geo = new THREE.BoxGeometry(1, th, D);
    const edge = new THREE.MeshStandardMaterial({ color: '#ebe7de', roughness: 0.95 });
    const plain = new THREE.MeshStandardMaterial({ color: this.paperColor, roughness: 0.95, bumpMap: this.grain, bumpScale: 0.03 });
    const printed = new THREE.MeshStandardMaterial({ map: notepaperTexture(this.aspect), roughness: 0.95, bumpMap: this.grain, bumpScale: 0.03 });
    for (let i = 0; i < sheets; i++) {
      const top = i === sheets - 1;
      const m = new THREE.Mesh(geo, [edge, edge, top ? printed : plain, plain, edge, edge]);
      m.position.set((r() - 0.5) * 0.03, th * (i + 0.5), (r() - 0.5) * 0.03);
      m.rotation.y = (r() - 0.5) * 0.04;
      m.castShadow = m.receiveShadow = true;
      scene.add(m);
    }
    const h = th * sheets;
    const cam = new THREE.PerspectiveCamera(28, 1, 0.1, 20);
    cam.position.set(0, 1.9, 2.4);
    cam.lookAt(0, h * 0.5, 0);
    cam.updateMatrixWorld();
    this.renderer.render(scene, cam);
    const cv = document.createElement('canvas');
    cv.width = cv.height = RES;
    cv.getContext('2d').drawImage(this.renderer.domElement, 0, 0);
    this.current = -1; // the sheet view needs a fresh render next time
    const P = (x, y, z) => { const v = new THREE.Vector3(x, y, z).project(cam); return [(v.x + 1) / 2 * RES, (1 - v.y) / 2 * RES]; };
    const res = {
      cv,
      front: P(0, 0, D / 2),
      width: P(0.5, 0, D / 2)[0] - P(-0.5, 0, D / 2)[0],
      top: [P(-0.5, h, -D / 2), P(0.5, h, -D / 2), P(0.5, h, D / 2), P(-0.5, h, D / 2)],
    };
    scene.traverse((o) => { if (o.isMesh && o.geometry !== geo) o.geometry.dispose(); });
    geo.dispose(); edge.dispose(); plain.dispose(); printed.map.dispose(); printed.dispose();
    return res;
  }

  // Same contract as paper.js drawStack: (x, y) = bottom front edge centre, w = sheet width in px.
  // Returns the centre of the top sheet for the pick test.
  drawStack(ctx, x, y, w, count, glow = 0, t = 0) {
    if (!this.stackCache.has(count)) this.stackCache.set(count, this.buildStack(count));
    const S = this.stackCache.get(count), k = w / S.width;
    const ox = x - S.front[0] * k, oy = y - S.front[1] * k;
    ctx.drawImage(S.cv, ox, oy, RES * k, RES * k);
    const top = S.top.map(([px, py]) => [ox + px * k, oy + py * k]);
    if (glow > 0) {
      // hover outline: brighter and thicker the longer the hand rests over the pile
      const a = Math.min(1, glow * (0.8 + 0.2 * Math.sin(t * 5)));
      ctx.save();
      ctx.shadowColor = `rgba(255,255,255,${a})`;
      ctx.shadowBlur = 10 + 16 * glow;
      ctx.strokeStyle = `rgba(10,132,255,${a})`;
      ctx.lineWidth = 2 + 4 * glow; ctx.lineJoin = 'round';
      ctx.beginPath(); top.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py))); ctx.closePath(); ctx.stroke();
      ctx.restore();
    }
    return { x: top.reduce((s, p) => s + p[0], 0) / 4, y: top.reduce((s, p) => s + p[1], 0) / 4 };
  }
}
