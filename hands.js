// Hand tracking. Produces "hand frames" in screen pixels that the gesture code consumes.
// A hand frame: { id, cx, cy, size, pinch, px, py, closure, angle, lm, t }
import { OneEuro } from './oneEuro.js';
import { CONFIG } from './config.js';

const TV = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export const HAND_LINKS = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];
const PALM = [0, 5, 9, 13, 17];
const TIPS = [8, 12, 16, 20];

const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

let nextId = 1;

class Track {
  constructor() {
    this.id = nextId++;
    this.f = Array.from({ length: 21 }, () => [new OneEuro(), new OneEuro()]);
    this.lm = null;
    this.missed = 0;
    this.pinching = false;
    this.rawC = null;
  }
}

// Shared feature extraction: screen-space landmarks -> hand frame
function features(track, P, t) {
  let cx = 0, cy = 0;
  for (const i of PALM) { cx += P[i][0]; cy += P[i][1]; }
  cx /= PALM.length; cy /= PALM.length;
  const size = Math.max(1, dist(P[0], P[9]));
  const pinchD = dist(P[4], P[8]) / size;
  track.pinching = track.pinching ? pinchD < CONFIG.pinchOff : pinchD < CONFIG.pinchOn;
  let tip = 0;
  for (const i of TIPS) tip += dist(P[i], [cx, cy]);
  tip /= TIPS.length * size;
  const closure = clamp((CONFIG.fingersOpen - tip) / (CONFIG.fingersOpen - CONFIG.fingersClosed));
  return {
    id: track.id, cx, cy, size,
    pinch: track.pinching,
    px: (P[4][0] + P[8][0]) / 2, py: (P[4][1] + P[8][1]) / 2,
    closure,
    angle: Math.atan2(P[9][1] - P[0][1], P[9][0] - P[0][0]),
    lm: P, n: track.lm, t,
  };
}

export class HandTracker {
  constructor(video) {
    this.video = video;
    this.tracks = [];
    this.lastVideoTime = -1;
    this.ready = false;
  }

  async start() {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    this.video.srcObject = stream;
    await this.video.play();
    const vision = await import(`${TV}/vision_bundle.mjs`);
    const fileset = await vision.FilesetResolver.forVisionTasks(`${TV}/wasm`);
    const opts = (delegate) => ({
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: 'VIDEO',
      numHands: 1, // one hand keeps it clear which hand is throwing
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    try {
      this.landmarker = await vision.HandLandmarker.createFromOptions(fileset, opts('GPU'));
    } catch {
      this.landmarker = await vision.HandLandmarker.createFromOptions(fileset, opts('CPU'));
    }
    this.ready = true;
  }

  // Map normalised video coords to screen pixels, matching object-fit: cover and the mirror flip.
  toScreen(x, y) {
    const v = this.video, W = innerWidth, H = innerHeight;
    const s = Math.max(W / v.videoWidth, H / v.videoHeight);
    const dw = v.videoWidth * s, dh = v.videoHeight * s;
    return [(W - dw) / 2 + (1 - x) * dw, (H - dh) / 2 + y * dh];
  }

  // Returns an array of hand frames when a new camera frame was processed, else null.
  poll(t) {
    if (!this.ready || this.video.readyState < 2) return null;
    if (this.video.currentTime === this.lastVideoTime) return null;
    this.lastVideoTime = this.video.currentTime;
    const res = this.landmarker.detectForVideo(this.video, t);
    const dets = (res.landmarks || []).map((lm) => {
      let x = 0, y = 0;
      for (const i of PALM) { x += lm[i].x; y += lm[i].y; }
      return { lm, c: [x / 5, y / 5] };
    });

    // Greedy nearest match of detections to existing tracks
    const free = new Set(this.tracks);
    const seen = [];
    for (const d of dets) {
      let best = null, bd = 0.3;
      for (const tr of free) {
        const dd = dist(tr.rawC, d.c);
        if (dd < bd) { bd = dd; best = tr; }
      }
      if (!best) { best = new Track(); this.tracks.push(best); }
      free.delete(best);
      best.rawC = d.c;
      best.missed = 0;
      // Filter every landmark (z ignored, too noisy)
      best.lm = d.lm.map((p, i) => [best.f[i][0].filter(p.x, t), best.f[i][1].filter(p.y, t)]);
      seen.push(best);
    }
    for (const tr of free) tr.missed++;
    this.tracks = this.tracks.filter((tr) => tr.missed < 12);

    return seen.map((tr) => features(tr, tr.lm.map(([x, y]) => this.toScreen(x, y)), t));
  }
}
