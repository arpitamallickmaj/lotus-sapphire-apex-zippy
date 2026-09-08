/** Procedural SFX — unlocked on the first user gesture. */
export class GameAudio {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  sfx: GainNode | null = null;
  engine: GainNode | null = null;
  engineOsc: OscillatorNode | null = null;
  engineFilter: BiquadFilterNode | null = null;
  noise: AudioBuffer | null = null;
  muted = false;
  private unlocked = false;

  unlock() {
    if (this.unlocked && this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC({ latencyHint: "interactive" });
    this.master = this.ctx.createGain();
    this.sfx = this.ctx.createGain();
    this.engine = this.ctx.createGain();
    this.master.gain.value = 0.72;
    this.sfx.gain.value = 0.9;
    this.engine.gain.value = 0;
    this.sfx.connect(this.master);
    this.engine.connect(this.master);
    this.master.connect(this.ctx.destination);
    this.noise = this.makeNoise(1.2);
    this.startEngine();
    this.unlocked = true;
    if (this.ctx.state === "suspended") void this.ctx.resume();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void this.ctx?.resume();
    });
  }

  setMuted(v: boolean) {
    this.muted = v;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(v ? 0 : 0.72, this.ctx.currentTime, 0.04);
    }
  }

  setEngine(speedAbs: number, inVehicle: boolean) {
    if (!this.ctx || !this.engineOsc || !this.engineFilter || !this.engine) return;
    const t = this.ctx.currentTime;
    const on = inVehicle && speedAbs > 0.4;
    const target = on ? Math.min(0.22, 0.04 + speedAbs * 0.006) : 0;
    this.engine.gain.setTargetAtTime(target, t, 0.08);
    this.engineOsc.frequency.setTargetAtTime(42 + speedAbs * 6.5, t, 0.08);
    this.engineFilter.frequency.setTargetAtTime(180 + speedAbs * 28, t, 0.08);
  }

  shot() {
    this.burst(0.07, 1800, 900, 0.55, 0.85);
    this.thump(90, 0.09, 0.45);
  }

  empty() {
    this.blip(420, 0.05, 0.12);
  }

  reload() {
    this.blip(180, 0.08, 0.16);
    this.later(0.2, () => this.blip(240, 0.06, 0.14));
    this.later(0.55, () => this.thump(70, 0.08, 0.2));
  }

  explode() {
    this.burst(0.45, 400, 80, 0.9, 0.4);
    this.thump(42, 0.42, 0.9);
  }

  hit() {
    this.burst(0.05, 900, 400, 0.35, 1.1);
  }

  hurt() {
    this.thump(55, 0.16, 0.5);
  }

  carDoor() {
    this.thump(110, 0.1, 0.28);
    this.blip(520, 0.04, 0.1);
  }

  pickup() {
    this.blip(660, 0.08, 0.18);
    this.later(0.08, () => this.blip(880, 0.08, 0.16));
  }

  ui() {
    this.blip(520, 0.05, 0.1);
  }

  foot() {
    this.burst(0.04, 500, 180, 0.16, 0.55);
  }

  private later(sec: number, fn: () => void) {
    window.setTimeout(fn, sec * 1000);
  }

  private makeNoise(dur: number) {
    if (!this.ctx) throw new Error("audio");
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  private startEngine() {
    if (!this.ctx || !this.engine) return;
    const osc = this.ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = 48;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 220;
    filter.Q.value = 3;
    osc.connect(filter);
    filter.connect(this.engine);
    osc.start();
    this.engineOsc = osc;
    this.engineFilter = filter;
  }

  private burst(dur: number, startHz: number, endHz: number, gain: number, rate = 1) {
    if (!this.ctx || !this.sfx || !this.noise) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = rate * (0.92 + Math.random() * 0.16);
    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(startHz, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(60, endHz), t + dur);
    filter.Q.value = 0.7;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.sfx);
    src.start(t);
    src.stop(t + dur + 0.02);
    src.onended = () => {
      src.disconnect();
      filter.disconnect();
      g.disconnect();
    };
  }

  private thump(freq: number, dur: number, gain: number) {
    if (!this.ctx || !this.sfx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq * 0.4), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g);
    g.connect(this.sfx);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private blip(freq: number, dur: number, gain: number) {
    if (!this.ctx || !this.sfx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = freq;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1800;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(filter);
    filter.connect(g);
    g.connect(this.sfx);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }
}
