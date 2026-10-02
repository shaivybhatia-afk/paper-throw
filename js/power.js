import { CONFIG } from './config.js';

export const BAND_NAMES = ['Soft', 'Medium', 'Hard'];

// raw: hand widths per second. max: the player's calibrated maximum.
// Returns 0 below the floor, otherwise 0.02..1 on a curve with a flat middle.
export function mapPower(raw, max) {
  const r = raw / Math.max(max, 1e-6);
  if (r < CONFIG.powerFloor) return 0;
  const u = Math.min(1, (r - CONFIG.powerFloor) / (CONFIG.powerCeil - CONFIG.powerFloor));
  const m = 2 * u - 1;
  const p = 0.5 + 0.5 * Math.sign(m) * Math.pow(Math.abs(m), CONFIG.powerCurve);
  return Math.max(0.02, p);
}

export function bandOf(p) {
  const [a, b] = CONFIG.bands;
  return p < a ? 0 : p < b ? 1 : 2;
}
