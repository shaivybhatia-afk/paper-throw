// Screen flow: landing -> instructions -> calibration -> game -> level end / final
import { CONFIG } from './config.js';
import { HandTracker } from './hands.js';
import { Gestures } from './gestures.js';
import { Game, LEVELS } from './game.js';
import { GameAudio } from './audio.js';
import { createPaperRenderer } from './paper.js';
import { mapPower } from './power.js';
import { startDemos } from './demos.js';

const $ = (s) => document.querySelector(s);
const store = {
  get(k, d) { try { const v = localStorage.getItem('paperThrow.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('paperThrow.' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};

const video = $('#cam');
const canvas = $('#stage');
function loadImage(src) {
  const img = new Image();
  const done = new Promise((res) => { img.onload = img.onerror = res; setTimeout(res, 5000); });
  img.src = src;
  return done.then(() => img);
}
const [office, bin] = await Promise.all([loadImage('assets/img/office.webp'), loadImage('assets/img/bin.png')]);

const audio = new GameAudio();
const paper = await createPaperRenderer(5);

// ---------- DOM helpers ----------
let screen = 'landing';
function show(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
  screen = id;
}

let toastTimer;
const ui = {
  hud(s) {
    $('#hLevel').textContent = s.level;
    $('#hLevel').nextElementSibling.textContent = `of ${s.levels}`;
    bump('#hScore', s.score);
    bump('#hStreak', s.streak);
    $('#hLevelScore').textContent = s.levelScore;
    $('#hGoal').textContent = s.goal;
    $('#hThrows').innerHTML = `<em>Throw ${Math.min(s.current + 1, s.throws)} of ${s.throws}</em><span class="dots">` +
      Array.from({ length: s.throws }, (_, i) =>
        `<i class="${i < s.results.length ? (s.results[i] ? 'hit' : 'miss') : i === s.current ? 'now' : ''}"></i>`).join('') + '</span>';
  },
  pickHint(x, y, show) {
    const el = $('#hPick');
    el.hidden = !show;
    if (show) { el.style.left = `${x}px`; el.style.top = `${y}px`; }
  },
  prompt(t) { const el = $('#hPrompt'); if (el.textContent !== t) el.textContent = t; },
  toast(t, kind = '') {
    const el = $('#hToast');
    el.className = 'toast';
    void el.offsetWidth;
    el.textContent = t;
    el.className = `toast show ${kind}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.className = 'toast'), 1700);
  },
  zone(lo, hi) {
    const el = $('#hZone');
    el.style.bottom = `${(lo * 100).toFixed(1)}%`;
    el.style.height = `${((hi - lo) * 100).toFixed(1)}%`;
    $('#hZoneLabel').style.bottom = `${(((lo + hi) / 2) * 100).toFixed(1)}%`;
  },
  meter(p, live) {
    const el = $('#hMeter');
    el.style.transform = `scaleY(${p.toFixed(3)})`;
    el.classList.toggle('live', live);
  },
  wind(w, max) {
    $('#hWind').hidden = !CONFIG.wind;
    const a = Math.abs(w) / max;
    const word = a < 0.02 ? 'Calm, no wind' : a < 0.5 ? 'Light breeze' : 'Strong breeze';
    const dir = a < 0.02 ? '' : w > 0 ? ', blowing right' : ', blowing left';
    $('#hWindText').textContent = word + dir;
    const svg = $('#hWind svg');
    svg.style.visibility = a < 0.02 ? 'hidden' : 'visible';
    svg.style.transform = `scaleX(${w < 0 ? -1 : 1}) scale(${0.7 + 0.5 * a})`;
  },
  levelEnd(r) { levelEnd(r); },
};
function bump(sel, v) {
  const el = $(sel);
  if (el.textContent !== String(v)) {
    el.textContent = v;
    const box = el.closest('.stat');
    box.classList.remove('pop'); void box.offsetWidth; box.classList.add('pop');
  }
}

// ---------- game objects ----------
let calMax = store.get('calMax', null);
const gestures = new Gestures({
  pick: () => screen === 'hud' && game.onPick(),
  crushed: () => screen === 'hud' && game.onCrushed(),
  dropped: () => screen === 'hud' && game.onDropped(),
  release: (m) => (screen === 'calib' ? calibResult(m) : screen === 'hud' && game.onRelease(m)),
});
const game = new Game({ canvas, office, bin, paper, audio, gestures, ui });

// ---------- input ----------
let input = null;
let inputPromise = null;
function initInput() {
  const tracker = new HandTracker(video);
  return tracker.start().then(() => { input = tracker; $('#pip').hidden = false; });
}

function inputReady() {
  const b = $('#btnContinue');
  b.disabled = false;
  b.textContent = 'Continue';
}

function inputFailed(e) {
  console.error(e);
  const name = e && e.name;
  $('#errorText').textContent =
    name === 'NotAllowedError' ? 'Camera access was blocked. Allow the camera for this page (the camera icon in the address bar), then try again. If you opened the game inside another app, open it in Chrome or Safari instead.'
    : name === 'NotFoundError' ? 'We could not find a camera on this device. Plug one in and try again.'
    : name === 'NotReadableError' ? 'Another app seems to be using the camera. Close it and try again.'
    : 'Hand tracking could not load. Check your internet connection and try again.';
  show('error');
}

function beginInput() {
  $('#btnContinue').disabled = true;
  $('#btnContinue').textContent = 'Getting the camera ready...';
  inputPromise = initInput().then(inputReady, inputFailed);
}

// ---------- screens ----------
let stopDemos = null;
$('#btnStart').onclick = () => {
  if (window.Howler && Howler.ctx && Howler.ctx.state === 'suspended') Howler.ctx.resume();
  show('instructions');
  stopDemos = startDemos($('#instructions'), paper);
  beginInput(false);
};
$('#btnRetryCam').onclick = () => { show('instructions'); beginInput(false); };
$('#btnContinue').onclick = () => { stopDemos?.(); startCalib(); };

function startCalib() {
  show('calib');
  game.mode = 'calibrate';
  game.overlay = 1;
  gestures.mode = 'calibrate';
  gestures.maxPower = calMax || CONFIG.defaultMaxPower;
  gestures.reset();
  gestures.enabled = true;
  $('#calibButtons').hidden = true;
  $('#calibText').textContent = 'Make a fist, swing as hard as feels comfortable, then open your hand.';
  $('#calibValue').textContent = '0.0';
  $('#calibFill').style.width = '0';
  calibPeak = 0;
}

let calibPeak = 0;
function calibResult(m) {
  if (m.raw < 3) {
    $('#calibText').textContent = 'That one was very gentle. Make a fist and give it a proper flick.';
    gestures.reset();
    return;
  }
  calMax = Math.max(CONFIG.minMaxPower, m.raw);
  store.set('calMax', calMax);
  $('#calibValue').textContent = m.raw.toFixed(1);
  $('#calibFill').style.width = Math.min(100, (m.raw / 30) * 100) + '%';
  $('#calibText').textContent = m.dropout
    ? 'Nice and fast. Your hand moved so quickly the camera lost it for a moment, which we count as a release.'
    : 'Got it. This is now your hardest throw. Soft, medium and hard throws are measured against it.';
  $('#calibButtons').hidden = false;
}
$('#btnCalibRetry').onclick = startCalib;
$('#btnSkipCalib').onclick = () => { calMax = calMax || CONFIG.defaultMaxPower; startGame(); };
$('#btnPlay').onclick = startGame;

// Camera preview: the mirrored feed with a light trace of the tracked hand on top
const pipCv = $('#pipHands'), pipCtx = pipCv.getContext('2d');
const PIP_BONES = [[0, 1, 2, 3, 4], [0, 5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [0, 17, 18, 19, 20], [5, 9, 13, 17]];
function drawPip(hands) {
  const W = pipCv.clientWidth, H = pipCv.clientHeight, dpr = Math.min(2, devicePixelRatio || 1);
  if (pipCv.width !== Math.round(W * dpr)) { pipCv.width = W * dpr; pipCv.height = H * dpr; }
  pipCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  pipCtx.clearRect(0, 0, W, H);
  if (!video.videoWidth) return;
  const s = Math.max(W / video.videoWidth, H / video.videoHeight);
  const dw = video.videoWidth * s, dh = video.videoHeight * s, ox = (W - dw) / 2, oy = (H - dh) / 2;
  pipCtx.lineCap = pipCtx.lineJoin = 'round';
  for (const h of hands) {
    if (!h.n) continue;
    const P = h.n.map(([x, y]) => [ox + (1 - x) * dw, oy + y * dh]);
    pipCtx.strokeStyle = 'rgba(255,255,255,0.85)'; pipCtx.lineWidth = 1.5;
    pipCtx.beginPath();
    for (const f of PIP_BONES) f.forEach((i, k) => (k ? pipCtx.lineTo(P[i][0], P[i][1]) : pipCtx.moveTo(P[i][0], P[i][1])));
    pipCtx.stroke();
    pipCtx.fillStyle = h.pinch ? 'rgb(255,186,110)' : h.closure > 0.55 ? 'rgb(125,180,255)' : '#fff';
    for (const i of [4, 8, 12, 16, 20]) { pipCtx.beginPath(); pipCtx.arc(P[i][0], P[i][1], 2.6, 0, Math.PI * 2); pipCtx.fill(); }
  }
}

function startGame() {
  show('hud');
  game.overlay = 1;
  game.startGame(calMax || CONFIG.defaultMaxPower);
}

let leAction = null;
function levelEnd(r) {
  const nextLevel = r.level + 1;
  if (r.cleared && r.last) return finish(r.total, true);
  show('levelEnd');
  if (r.cleared) {
    audio.play('chime', 0.5);
    $('#leTitle').textContent = `Level ${nextLevel} cleared`;
    $('#leText').textContent = `You scored ${r.levelScore} points this level. The bin is moving further back.`;
    $('#lePrimary').textContent = `Start level ${nextLevel + 1}`;
    leAction = () => { show('hud'); game.startLevel(nextLevel); };
  } else {
    $('#leTitle').textContent = 'Not quite';
    $('#leText').textContent = `You scored ${r.levelScore} of ${CONFIG.goalPerLevel} points. Hits in a row are worth more, so keep a streak going.`;
    $('#lePrimary').textContent = 'Try this level again';
    leAction = () => { game.total -= r.levelScore; show('hud'); game.startLevel(r.level); };
  }
  $('#leSecondary').onclick = () => finish(r.total, false);
}
$('#lePrimary').onclick = () => leAction && leAction();

function finish(total, allClear) {
  game.mode = 'menu';
  gestures.enabled = false;
  audio.fan(0, 0);
  const best = Math.max(total, store.get('best', 0));
  store.set('best', best);
  $('#fScore').textContent = total;
  $('#fText').textContent = (allClear ? 'You cleared all three bins. ' : '') +
    (total >= best && total > 0 ? 'That is your best so far.' : `Your best is ${best}.`);
  show('final');
  lastScore = total;
}
let lastScore = 0;
$('#btnAgain').onclick = startGame;
$('#btnRecal').onclick = startCalib;
$('#btnShare').onclick = async () => {
  const text = `I scored ${lastScore} in Paper Throw, a game where you crush and toss paper with your bare hand. Can you beat it?`;
  const url = location.href.split('?')[0];
  try {
    if (navigator.share) await navigator.share({ title: 'Paper Throw', text, url });
    else { await navigator.clipboard.writeText(`${text} ${url}`); $('#btnShare').textContent = 'Copied'; }
  } catch { /* share sheet closed */ }
};

// Hold up an open, still hand to press the highlighted button on the level end and final screens
let palmHold = 0;
function palmContinue(dt) {
  const btn = screen === 'levelEnd' ? $('#lePrimary') : screen === 'final' ? $('#btnAgain') : null;
  if (!btn) { palmHold = 0; return; }
  const open = input instanceof HandTracker && game.hands.some((h) => h.closure < 0.12);
  palmHold = open ? palmHold + dt : Math.max(0, palmHold - dt * 2);
  btn.style.setProperty('--hold', Math.min(1, palmHold / 1.8));
  if (palmHold > 1.8) { palmHold = 0; btn.click(); }
}

// ---------- main loop ----------
let reported = false;
function reportOnce(e) { if (!reported) { reported = true; console.error('Paper Throw frame error', e); } }
let last = performance.now();
function loop(t) {
  requestAnimationFrame(loop);
  if (window.paperThrow?.paused) return;
  const dt = Math.min(0.05, (t - last) / 1000);
  last = t;
  // Each stage is guarded so one bad frame never blanks the scene
  try {
    if (input) {
      const hands = input.poll(t);
      if (hands) { game.hands = hands; gestures.update(hands, t); }
    }
    game.update(dt, t);
  } catch (e) { reportOnce(e); }
  try { game.render(); } catch (e) { reportOnce(e); }
  if (screen === 'calib' && gestures.state === 'ball' && gestures.armed) {
    calibPeak = Math.max(gestures.liveSpeed, calibPeak * 0.97);
    if ($('#calibButtons').hidden) {
      $('#calibValue').textContent = calibPeak.toFixed(1);
      $('#calibFill').style.width = Math.min(100, (calibPeak / 30) * 100) + '%';
    }
  }
  palmContinue(dt);
  if (input instanceof HandTracker) drawPip(game.hands);
}
requestAnimationFrame(loop);

// handy for testing
window.paperThrow = { game, gestures, LEVELS, mapPower, startGame, startCalib, paused: false };
