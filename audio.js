// All sound goes through Howler, which unlocks audio on the first tap for mobile browsers.
const CRINKLE_LEN = 2.3; // seconds of crinkle that map onto closure 0..1

export class GameAudio {
  constructor() {
    const mk = (name, o = {}) => new window.Howl({ src: [`assets/audio/${name}.wav`], preload: true, ...o });
    this.s = {
      crinkle: mk('crinkle', { loop: true, volume: 0 }),
      whoosh: mk('whoosh', { volume: 0.6 }),
      clang: mk('clang', { volume: 0.7 }),
      thud: mk('thud', { volume: 0.8 }),
      pick: mk('pick', { volume: 0.5 }),
      chime: mk('chime', { volume: 0.45 }),
      fan: mk('fan', { loop: true, volume: 0 }),
      amb: mk('ambience', { loop: true, volume: 0.2 }),
    };
    this.crId = null;
    this.crVol = 0;
    this.lastC = 0;
  }

  startLoops() {
    if (this.ambId == null) this.ambId = this.s.amb.play();
    if (this.fanId == null) this.fanId = this.s.fan.play();
  }

  stopLoops() {
    this.s.amb.stop(); this.s.fan.stop();
    this.ambId = this.fanId = null;
  }

  play(name, volume, rate) {
    const snd = this.s[name], id = snd.play();
    if (volume != null) snd.volume(volume, id);
    if (rate != null) snd.rate(rate, id);
    return id;
  }

  // strength 0..1, pan -1..1
  fan(strength, pan) {
    if (this.fanId == null) return;
    this.s.fan.volume(strength > 0.02 ? 0.05 + 0.3 * strength : 0, this.fanId);
    if (this.s.fan.stereo) this.s.fan.stereo(pan * 0.6, this.fanId);
    this.s.fan.rate(0.85 + 0.3 * strength, this.fanId);
  }

  // Crinkle is scrubbed to the closure value and gets louder the faster the hand closes.
  crinkle(c, dt) {
    const rate = Math.abs(c - this.lastC) / Math.max(dt, 1e-3);
    this.lastC = c;
    const target = Math.min(1, rate * 0.9);
    this.crVol += (target - this.crVol) * Math.min(1, dt * 12);
    const s = this.s.crinkle, want = c * CRINKLE_LEN;
    if (this.crVol > 0.03) {
      if (this.crId == null) { this.crId = s.play(); s.seek(want, this.crId); }
      s.volume(this.crVol * 0.9, this.crId);
      const pos = s.seek(this.crId);
      if (typeof pos === 'number' && Math.abs(pos - want) > 0.3) s.seek(want, this.crId);
    } else if (this.crId != null) {
      s.stop(this.crId);
      this.crId = null;
    }
  }

  crinkleStop() {
    if (this.crId != null) { this.s.crinkle.stop(this.crId); this.crId = null; }
    this.crVol = 0;
  }
}
