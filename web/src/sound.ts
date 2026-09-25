// Every sound is synthesised with Web Audio: no files. Browsers only allow sound after a click, hence the toggle.
let ctx: AudioContext | null = null, master: GainNode | null = null, on = false;
const noise = (c: AudioContext) => {
  const b = c.createBuffer(1, c.sampleRate, c.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
};
let white: AudioBuffer | null = null, shot: AudioBuffer | null = null;

export function soundOn(): boolean {
  return on;
}

/** Turns sound on or off (the first call must come from a click). */
export function setSound(value: boolean): void {
  on = value;
  if (on && !ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.6;
    master.connect(ctx.destination);
    white = noise(ctx);
    const c = ctx; // a recorded shot (Pixabay); the synthesised one stands in until it loads
    fetch('/assets/sounds/gunshot.m4a').then((r) => r.arrayBuffer()).then((b) => c.decodeAudioData(b)).then((b) => { shot = b; }).catch(() => {});
  }
  if (ctx) void (on ? ctx.resume() : ctx.suspend());
}

/** A burst of filtered noise: the base of shots, clicks, cracks and rattles. */
function hiss(at: number, dur: number, gain: number, freq: number, type: BiquadFilterType = 'bandpass', q = 1): void {
  if (!ctx || !master || !white) return;
  const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  src.buffer = white;
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  g.gain.setValueAtTime(gain, at);
  g.gain.exponentialRampToValueAtTime(0.001, at + dur);
  src.connect(f).connect(g).connect(master);
  src.start(at, Math.random() * 0.5, dur + 0.05);
}

/** A pitched blip that drops in pitch: thumps, thuds and notes. */
function tone(at: number, dur: number, gain: number, from: number, to: number, type: OscillatorType = 'sine'): void {
  if (!ctx || !master) return;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(from, at);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, to), at + dur);
  g.gain.setValueAtTime(gain, at);
  g.gain.exponentialRampToValueAtTime(0.001, at + dur);
  o.connect(g).connect(master);
  o.start(at);
  o.stop(at + dur + 0.05);
}

const now = () => (ctx && on ? ctx.currentTime : -1);

export const sfx = {
  bang(): void {
    const t = now();
    if (t < 0) return;
    if (shot && ctx && master) {
      const src = ctx.createBufferSource(), g = ctx.createGain();
      src.buffer = shot;
      g.gain.value = 1.1;
      src.connect(g).connect(master);
      src.start(t);
      tone(t, 0.3, 0.5, 120, 40); // a little extra thump under the recording
      return;
    }
    hiss(t, 0.5, 1.2, 1200, 'lowpass', 0.7); // the blast
    hiss(t, 0.08, 0.9, 3000, 'highpass');
    tone(t, 0.35, 1.0, 140, 40); // the thump in the chest
    hiss(t + 0.05, 1.4, 0.12, 600, 'lowpass'); // the room ringing out
  },
  click(): void {
    const t = now();
    if (t < 0) return;
    hiss(t, 0.03, 0.7, 4000, 'highpass');
    tone(t, 0.04, 0.3, 1800, 900, 'square');
  },
  spin(): void {
    const t = now();
    if (t < 0) return;
    for (let i = 0; i < 14; i++) hiss(t + i * 0.06 * (1 + i / 14), 0.02, 0.35, 3500, 'highpass'); // the ratchet slows
  },
  twirl(seconds = 1.3, loud = 1): void {
    const t = now();
    if (t < 0) return;
    for (let at = 0, gap = 0.035; at < seconds; at += gap, gap *= 1.12) hiss(t + at, 0.05, (0.25 * (1 - at / seconds) + 0.05) * loud, 900, 'bandpass', 2); // metal scraping on wood, slowing down
  },
  thud(): void {
    const t = now();
    if (t < 0) return;
    tone(t, 0.3, 0.8, 110, 45);
    hiss(t, 0.15, 0.3, 300, 'lowpass');
  },
  dice(): void {
    const t = now();
    if (t < 0) return;
    for (let i = 0; i < 7; i++) hiss(t + i * 0.045 + Math.random() * 0.02, 0.025, 0.4, 2500 + Math.random() * 1500, 'bandpass', 3);
  },
  slam(): void {
    const t = now();
    if (t < 0) return;
    tone(t, 0.25, 0.9, 90, 50);
    hiss(t, 0.12, 0.6, 500, 'lowpass');
  },
  crack(): void {
    const t = now();
    if (t < 0) return;
    hiss(t, 0.18, 1.0, 1800, 'bandpass', 0.8); // the lance splinters
    tone(t, 0.12, 0.5, 300, 90, 'triangle');
  },
  hoof(gain = 0.25): void {
    const t = now();
    if (t < 0) return;
    tone(t, 0.07, gain, 180, 70);
    hiss(t, 0.04, gain * 0.5, 700, 'lowpass');
  },
  blip(): void {
    const t = now();
    if (t < 0) return;
    tone(t, 0.07, 0.12, 880, 1200, 'triangle');
  },
  fanfare(): void {
    const t = now();
    if (t < 0) return;
    [523, 659, 784, 1047].forEach((f, i) => tone(t + i * 0.13, i === 3 ? 0.6 : 0.16, 0.22, f, f * 0.99, 'square'));
  },
};
