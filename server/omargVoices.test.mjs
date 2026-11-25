import test from "node:test";
import assert from "node:assert/strict";
import { KOKORO_V1, packKind, voicesOf, wav } from "./omargVoices.mjs";

test("a pack's kind from its files", () => {
  assert.equal(packKind(["model.onnx", "voices.bin", "tokens.txt", "lexicon-us-en.txt"]), "kokoro");
  assert.equal(packKind(["kitten-nano.onnx", "voices.bin", "tokens.txt"]).length > 0, true);
  assert.equal(packKind(["en_GB-jenny.onnx", "tokens.txt", "espeak-ng-data"]), "vits");
  assert.equal(packKind(["README.md"]), null);
});

test("Kokoro v1.0's 54 voices by name, in speaker order", () => {
  assert.equal(KOKORO_V1.length, 54);
  const v = voicesOf({ id: "kokoro-multi-lang-v1_0", kind: "kokoro" }, 54);
  assert.deepEqual(v.find((x) => x.name === "af_heart"), { name: "af_heart", sid: 3, lang: "en-us" });
  assert.deepEqual(v.find((x) => x.name === "bf_emma"), { name: "bf_emma", sid: 21, lang: "en-gb" });
  // another count: numbered
  assert.equal(voicesOf({ id: "kokoro-multi-lang-v1_1", kind: "kokoro" }, 103)[5].name, "kokoro-multi-lang-v1_1-5");
});

test("a WAV file from samples", () => {
  const b = wav(new Float32Array([0, 0.5, -1, 1]), 24000);
  assert.equal(b.toString("ascii", 0, 4), "RIFF");
  assert.equal(b.readUInt32LE(24), 24000);
  assert.equal(b.length, 44 + 8);
  assert.equal(b.readInt16LE(44 + 2), Math.round(0.5 * 32767));
});

test("only apps given a voice speak, with their own setting or the default", async () => {
  const { appVoice } = await import("./omargVoices.mjs");
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voices-"));
  assert.equal(appVoice(dir, "vexel"), null);
  assert.equal(appVoice(dir, "lilith-learning-lab"), "bf_emma");
  fs.writeFileSync(path.join(dir, "app-voices.json"), JSON.stringify({ "lilith-learning-lab": "af_nicole", vexel: "am_adam" }));
  assert.equal(appVoice(dir, "lilith-learning-lab"), "af_nicole");
  assert.equal(appVoice(dir, "vexel"), null);
  fs.rmSync(dir, { recursive: true, force: true });
});
