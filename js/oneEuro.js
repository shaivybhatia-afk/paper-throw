// One Euro Filter (Casiez et al. 2012). Low lag when moving fast, low jitter when still.
class LowPass {
  constructor() { this.y = null; }
  filter(x, a) {
    this.y = this.y === null ? x : a * x + (1 - a) * this.y;
    return this.y;
  }
}

export class OneEuro {
  constructor(minCutoff = 1.5, beta = 6, dCutoff = 1) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.reset();
  }
  reset() {
    this.x = new LowPass();
    this.dx = new LowPass();
    this.t = null;
  }
  static alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }
  // tMs: real timestamp in milliseconds
  filter(value, tMs) {
    if (this.t === null) {
      this.t = tMs;
      this.dx.y = 0;
      return this.x.filter(value, 1);
    }
    const dt = Math.max(1e-3, (tMs - this.t) / 1000);
    this.t = tMs;
    const d = (value - this.x.y) / dt;
    const ed = this.dx.filter(d, OneEuro.alpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(ed);
    return this.x.filter(value, OneEuro.alpha(cutoff, dt));
  }
}
