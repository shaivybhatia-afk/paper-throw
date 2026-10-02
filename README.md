# Paper Throw

An AR paper toss that runs in the browser. Pick a sheet off the pile, crush it in your fist, and flick it into the bin. Hand tracking runs on device with MediaPipe; nothing is recorded or uploaded.

## Run locally
Use the included no-cache server so the browser always loads your latest edits (the camera needs `localhost` or `https`):

    python3 serve.py 8000

Then open http://localhost:8000 in Chrome, Safari or Firefox and allow the camera. Built-in browsers inside other apps often block cameras.

The fan and wind are switched off. Set `wind: true` in `js/config.js` to bring them back.

## Deploy to GitHub Pages
Push this folder to a repo and enable Pages on the branch root. `.nojekyll` is included.

## Layout
- `js/hands.js` MediaPipe Hands, per-landmark One Euro filtering, hand features (centroid, hand size, pinch, closure)
- `js/gestures.js` pick, crush (one or two hands), throw capture with a 10 frame buffer, 200ms peak speed, dropout release
- `js/power.js` power curve: floor, ceiling, flattened middle, soft/medium/hard bands
- `js/game.js` fake 3D floor, parabola with wind, bin mouth hit test, streak scoring, drawing
- `js/crumple3d.js` 3D crumpling sheet (three.js), ported from the React Bits PaperCrumple component and driven by hand closure instead of a mouse hold
- `js/paper.js` paper stack, plus a flat canvas crumple used if WebGL is unavailable. Set `paperSprite` in `js/config.js` to use a sprite sheet instead
- `js/audio.js` Howler sounds; crinkle is scrubbed by hand closure
- `js/demos.js` looping gesture demos for the instructions screen
- `assets/audio/*.wav` synthesized sound effects (replace freely, same names)

When you change any file, bump every `?v=` number in `index.html` (stylesheet, import map and main script) so browsers fetch fresh copies.

Tuning lives in `js/config.js` and the constants at the top of `js/game.js`.
