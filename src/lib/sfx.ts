// Sound effects for games, made right here: a little synthesizer (a wave, a pitch that slides, a quick rise and fall,
// a wobble, a jump in pitch) with kinds to start from (a coin, a jump, a laser…), each one a bit different every
// time. The sound is written as a WAV file for the game to play. No engine or download needed. No DOM here
// (sfx.test.ts).

export type Wave = "square" | "saw" | "sine" | "triangle" | "noise";
export type Sfx = {
  wave: Wave;
  /** Starting pitch and where it slides to, in Hz. */
  from: number;
  to: number;
  /** Seconds: rising in, holding, fading out. */
  attack: number;
  hold: number;
  fade: number;
  /** A wobble in pitch: how fast (Hz) and how deep (0..1). */
  wobble: number;
  wobbleDepth: number;
  /** A jump in pitch partway (a coin's "bling"): by how much (×), and when (0..1 of the sound). */
  jump: number;
  jumpAt: number;
  /** Square waves: how thin the pulse is (0.05..0.5). */
  duty: number;
  volume: number;
};

export const KINDS = ["coin", "jump", "laser", "explosion", "hit", "powerup", "blip", "select", "lose", "random"] as const;
export type SfxKind = (typeof KINDS)[number];
export const KIND_NAMES: Record<SfxKind, string> = { coin: "Coin", jump: "Jump", laser: "Laser", explosion: "Explosion", hit: "Hit", powerup: "Power-up", blip: "Blip", select: "Select", lose: "Lose", random: "Surprise" };

/** A small seeded random, so a sound can be made again from its seed. */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/** A sound of this kind, a little different for each seed. */
export function sfxOf(kind: SfxKind, seed: number): Sfx {
  const r = rng(seed);
  const between = (a: number, b: number) => a + (b - a) * r();
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  const base: Sfx = { wave: "square", from: 440, to: 440, attack: 0.005, hold: 0.05, fade: 0.15, wobble: 0, wobbleDepth: 0, jump: 1, jumpAt: 0.5, duty: 0.5, volume: 0.5 };
  switch (kind) {
    case "coin": {
      const f = between(700, 1300);
      return { ...base, wave: pick(["square", "triangle"] as const), from: f, to: f, hold: between(0.03, 0.08), fade: between(0.15, 0.35), jump: between(1.3, 1.6), jumpAt: between(0.15, 0.35), duty: between(0.2, 0.5) };
    }
    case "jump": {
      const f = between(200, 420);
      return { ...base, wave: "square", from: f, to: f * between(1.8, 2.8), hold: between(0.05, 0.12), fade: between(0.08, 0.2), duty: between(0.2, 0.5) };
    }
    case "laser": {
      const f = between(900, 2200);
      return { ...base, wave: pick(["saw", "square", "sine"] as const), from: f, to: f * between(0.1, 0.35), hold: between(0.05, 0.15), fade: between(0.05, 0.2), duty: between(0.05, 0.3) };
    }
    case "explosion":
      return { ...base, wave: "noise", from: between(60, 180), to: between(20, 50), attack: 0.002, hold: between(0.05, 0.2), fade: between(0.4, 0.9), wobble: between(0, 12), wobbleDepth: between(0, 0.3), volume: 0.6 };
    case "hit":
      return { ...base, wave: pick(["noise", "square", "saw"] as const), from: between(150, 500), to: between(40, 120), attack: 0.001, hold: between(0.01, 0.04), fade: between(0.06, 0.18) };
    case "powerup": {
      const f = between(220, 500);
      return { ...base, wave: pick(["square", "triangle", "sine"] as const), from: f, to: f * between(2, 4), hold: between(0.15, 0.3), fade: between(0.1, 0.3), wobble: between(8, 18), wobbleDepth: between(0.05, 0.15), duty: between(0.3, 0.5) };
    }
    case "blip": {
      const f = between(500, 1500);
      return { ...base, wave: pick(["square", "sine", "triangle"] as const), from: f, to: f, hold: between(0.02, 0.05), fade: between(0.02, 0.06), volume: 0.4 };
    }
    case "select": {
      const f = between(400, 900);
      return { ...base, wave: pick(["square", "triangle"] as const), from: f, to: f, hold: between(0.04, 0.08), fade: between(0.04, 0.1), jump: between(1.2, 2), jumpAt: 0.5, volume: 0.4 };
    }
    case "lose": {
      const f = between(300, 600);
      return { ...base, wave: pick(["square", "saw", "triangle"] as const), from: f, to: f * between(0.25, 0.5), hold: between(0.3, 0.6), fade: between(0.2, 0.5), wobble: between(4, 9), wobbleDepth: between(0.05, 0.2) };
    }
    default: {
      const f = between(80, 2000);
      return { ...base, wave: pick(["square", "saw", "sine", "triangle", "noise"] as const), from: f, to: f * between(0.2, 3), attack: between(0, 0.05), hold: between(0.02, 0.3), fade: between(0.05, 0.5), wobble: between(0, 20), wobbleDepth: between(0, 0.4), jump: r() < 0.4 ? between(0.5, 2) : 1, jumpAt: between(0.1, 0.8), duty: between(0.1, 0.5) };
    }
  }
}

export const RATE = 22050;
export const length = (s: Sfx) => s.attack + s.hold + s.fade;

/** The sound itself: samples between -1 and 1. */
export function render(s: Sfx, seed = 1, rate = RATE): Float32Array {
  const n = Math.max(1, Math.round(length(s) * rate));
  const out = new Float32Array(n);
  const noise = rng(seed ^ 0x5f3759df);
  let phase = 0;
  let held = 0; // noise holds each value for a step, so its pitch can still slide
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const k = i / n;
    let f = s.from * Math.pow(s.to / s.from, k);
    if (s.jump !== 1 && k >= s.jumpAt) f *= s.jump;
    if (s.wobble && s.wobbleDepth) f *= 1 + s.wobbleDepth * Math.sin(2 * Math.PI * s.wobble * t);
    const before = phase;
    phase = (phase + f / rate) % 1;
    let v: number;
    if (s.wave === "square") v = phase < s.duty ? 1 : -1;
    else if (s.wave === "saw") v = 2 * phase - 1;
    else if (s.wave === "sine") v = Math.sin(2 * Math.PI * phase);
    else if (s.wave === "triangle") v = 1 - 4 * Math.abs(phase - 0.5);
    else {
      if (phase < before) held = noise() * 2 - 1;
      v = held;
    }
    const env = t < s.attack ? t / Math.max(s.attack, 1e-6) : t < s.attack + s.hold ? 1 : Math.max(0, 1 - (t - s.attack - s.hold) / Math.max(s.fade, 1e-6));
    out[i] = v * env * s.volume;
  }
  return out;
}

/** Samples as a 16-bit mono WAV file. */
export function wav(samples: Float32Array, rate = RATE): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const d = new DataView(bytes.buffer);
  const str = (at: number, s: string) => [...s].forEach((c, i) => d.setUint8(at + i, c.charCodeAt(0)));
  str(0, "RIFF");
  d.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  d.setUint32(16, 16, true);
  d.setUint16(20, 1, true); // PCM
  d.setUint16(22, 1, true); // mono
  d.setUint32(24, rate, true);
  d.setUint32(28, rate * 2, true);
  d.setUint16(32, 2, true);
  d.setUint16(34, 16, true);
  str(36, "data");
  d.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) d.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), true);
  return bytes;
}

/** The kind a game's wish for a sound sounds most like ("a jump", "picking up a gem"…). */
export function kindFor(words: string): SfxKind {
  const w = words.toLowerCase();
  const by: [RegExp, SfxKind][] = [
    [/coin|gem|pick ?up|collect|score|point|ding|bling/, "coin"],
    [/jump|hop|bounce|spring/, "jump"],
    [/laser|shoot|shot|zap|fire|pew/, "laser"],
    [/explo|boom|blast|bomb|crash/, "explosion"],
    [/hit|hurt|punch|damage|thud|bump/, "hit"],
    [/power|level ?up|win|bonus|grow|magic/, "powerup"],
    [/lose|game ?over|fail|die|death|sad/, "lose"],
    [/select|menu|click|button|confirm/, "select"],
    [/blip|beep|tick|step/, "blip"],
  ];
  return by.find(([re]) => re.test(w))?.[1] ?? "random";
}
