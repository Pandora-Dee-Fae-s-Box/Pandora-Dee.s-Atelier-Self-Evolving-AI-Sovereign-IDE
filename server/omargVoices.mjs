// SEASIDE's own voices, the OMARG way: the same offline neural voice engine OMARG Narrator carries on Android
// (sherpa-onnx: Kokoro, Kitten, Piper...), here on the desktop, with the same voice packs. A pack is a sherpa-onnx TTS
// folder in the data folder's voices/ (unpacked from its .tar.bz2). It answers OpenAI's speech API shape, so it's a
// voice engine like any other in Settings, with nothing else to run. Synthesis runs off the server's main thread.
// Pure apart from the engine itself (omargVoices.test.mjs).

import fs from "node:fs";
import path from "node:path";

/** Kokoro v1.0's 54 voices, in speaker order (the first letter is the language, the second f/m). */
export const KOKORO_V1 = [
  "af_alloy", "af_aoede", "af_bella", "af_heart", "af_jessica", "af_kore", "af_nicole", "af_nova", "af_river", "af_sarah", "af_sky",
  "am_adam", "am_echo", "am_eric", "am_fenrir", "am_liam", "am_michael", "am_onyx", "am_puck", "am_santa",
  "bf_alice", "bf_emma", "bf_isabella", "bf_lily", "bm_daniel", "bm_fable", "bm_george", "bm_lewis",
  "ef_dora", "em_alex", "em_santa", "ff_siwis", "hf_alpha", "hf_beta", "hm_omega", "hm_psi", "if_sara", "im_nicola",
  "jf_alpha", "jf_gongitsune", "jf_nezumi", "jf_tebukuro", "jm_kumo", "pf_dora", "pm_alex", "pm_santa",
  "zf_xiaobei", "zf_xiaoni", "zf_xiaoxiao", "zf_xiaoyi", "zm_yunjian", "zm_yunxi", "zm_yunxia", "zm_yunyang",
];
const LANG = { a: "en-us", b: "en-gb", e: "es", f: "fr", h: "hi", i: "it", j: "ja", p: "pt-br", z: "zh" };
const KOKORO_VOICE_BYTES = 510 * 256 * 4;

/** What kind of pack a folder holds, or null. */
export function packKind(files) {
  const has = (f) => files.includes(f);
  if (!has("tokens.txt")) return null;
  if (has("voices.bin") && has("model.onnx")) return "kokoro";
  if (has("voices.bin")) return "kitten";
  if (files.some((f) => f.endsWith(".onnx"))) return "vits";
  return null;
}

/** The voices a pack offers: names for Kokoro v1.0, numbers otherwise. */
export function voicesOf(pack, count) {
  if (pack.kind === "kokoro" && count === KOKORO_V1.length) return KOKORO_V1.map((name, sid) => ({ name, sid, lang: LANG[name[0]] || "" }));
  return Array.from({ length: count }, (_, sid) => ({ name: count === 1 ? pack.id : `${pack.id}-${sid}`, sid, lang: "" }));
}

/** A WAV file from mono float samples (16-bit). */
export function wav(samples, rate) {
  const n = samples.length, buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  return buf;
}

/** Apps that speak with SEASIDE's voices, and their voice unless voices/app-voices.json says otherwise. */
export const APP_VOICES = { "lilith-learning-lab": "bf_emma" };
export function appVoice(voicesDir, appKey) {
  const key = String(appKey || "");
  if (!(key in APP_VOICES)) return null;
  try {
    const set = JSON.parse(fs.readFileSync(path.join(voicesDir, "app-voices.json"), "utf8"));
    if (typeof set[key] === "string" && set[key]) return set[key];
  } catch {
    /* none set */
  }
  return APP_VOICES[key];
}

export function createVoices(voicesDir) {
  const engines = new Map(); // pack id -> Promise<OfflineTts>

  /** The packs in voices/, with their voices. */
  function packs() {
    if (!fs.existsSync(voicesDir)) return [];
    const out = [];
    for (const d of fs.readdirSync(voicesDir, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const dir = path.join(voicesDir, d.name);
      const files = fs.readdirSync(dir);
      const kind = packKind(files);
      if (!kind) continue;
      const pack = { id: d.name, dir, kind, files };
      const count = kind === "kokoro" || kind === "kitten" ? Math.round(fs.statSync(path.join(dir, "voices.bin")).size / KOKORO_VOICE_BYTES) || 1 : 1;
      out.push({ ...pack, voices: voicesOf(pack, kind === "kitten" ? 8 : count) });
    }
    // Kokoro v1.0 (English and eight more languages) first
    return out.sort((a, b) => Number(b.voices[0]?.name === "af_alloy") - Number(a.voices[0]?.name === "af_alloy") || a.id.localeCompare(b.id));
  }

  function configFor(p) {
    const f = (n) => path.join(p.dir, n);
    const lex = p.files.filter((x) => /^lexicon-.*\.txt$/.test(x)).map(f).join(",");
    const espeak = p.files.includes("espeak-ng-data") ? f("espeak-ng-data") : "";
    if (p.kind === "kokoro") return { model: { kokoro: { model: f("model.onnx"), voices: f("voices.bin"), tokens: f("tokens.txt"), lexicon: lex }, numThreads: 4, provider: "cpu" }, maxNumSentences: 1 };
    if (p.kind === "kitten") {
      const model = p.files.find((x) => x.endsWith(".onnx"));
      return { model: { kitten: { model: f(model), voices: f("voices.bin"), tokens: f("tokens.txt"), dataDir: espeak }, numThreads: 4, provider: "cpu" }, maxNumSentences: 1 };
    }
    const model = p.files.find((x) => x.endsWith(".onnx"));
    return { model: { vits: { model: f(model), tokens: f("tokens.txt"), dataDir: espeak, lexicon: lex }, numThreads: 4, provider: "cpu" }, maxNumSentences: 1 };
  }

  async function engine(p) {
    if (!engines.has(p.id)) {
      engines.set(
        p.id,
        import("sherpa-onnx-node").then((m) => (m.default || m).OfflineTts.createAsync(configFor(p))),
      );
    }
    return engines.get(p.id);
  }

  /** The voice asked for: a name ("af_heart", "kitten-2"), or the first pack's first voice. */
  function find(voice) {
    const all = packs();
    const want = String(voice || "").trim().toLowerCase();
    for (const p of all) {
      const v = p.voices.find((x) => x.name.toLowerCase() === want);
      if (v) return { p, v };
    }
    return all[0] ? { p: all[0], v: all[0].voices[0] } : null;
  }

  /** Speak: WAV bytes. */
  async function speak({ input, voice, speed }) {
    const hit = find(voice);
    if (!hit) throw Object.assign(new Error("No voice packs yet: put a sherpa-onnx voice pack in the data folder's voices/."), { status: 404 });
    const tts = await engine(hit.p);
    const text = String(input || "").slice(0, 8000);
    if (!text.trim()) throw Object.assign(new Error("Nothing to say."), { status: 400 });
    const audio = await tts.generateAsync({ text, sid: hit.v.sid, speed: Math.max(0.5, Math.min(2, Number(speed) || 1)) });
    return wav(audio.samples, audio.sampleRate);
  }

  return { packs, find, speak };
}
