// Tunables in one place.
export const CONFIG = {
  // Drop a crumple sprite sheet here to replace the procedural paper.
  // Frame 0 is a flat sheet, the last frame is a fully crushed ball.
  // Example: { src: 'assets/img/crumple.png', frames: 16, cols: 4 }
  paperSprite: null,

  // Hand shape thresholds, all in hand sizes (wrist to middle knuckle).
  pinchOn: 0.36,
  pinchOff: 0.55,
  fingersOpen: 0.95,   // average fingertip to palm distance with an open hand
  fingersClosed: 0.45, // same distance for a fist
  gripClosure: 0.5,    // closure needed to hold the ball
  crushTrigger: 0.4,   // a fist this closed starts the crumple animation
  crumpleSeconds: 0.8, // length of the crumple animation
  pickDwell: 0.45,     // seconds an open hand rests over the pile to pick a sheet
  releaseClosure: 0.35,// closure below this lets go

  // Throw capture
  bufferFrames: 10,
  peakWindowMs: 200,
  dropoutFrames: [2, 4], // tracking lost for this many frames while throwing counts as a release

  // Power curve on (measured / calibrated max)
  powerFloor: 0.18,
  powerCeil: 1.05,
  powerCurve: 1.4,        // above 1 flattens the middle so medium covers a wide range
  bands: [0.36, 0.66],    // soft | medium | hard

  defaultMaxPower: 14,    // hand widths per second, used if calibration is skipped
  minMaxPower: 6,

  // Fan and sideways wind. Off by default; set to true to bring the fan back.
  wind: false,

  throwsPerLevel: 5,
  goalPerLevel: 5,
};
