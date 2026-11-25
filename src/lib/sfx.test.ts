import { test } from "node:test";
import assert from "node:assert/strict";
import { KINDS, RATE, kindFor, length, render, sfxOf, wav } from "./sfx.ts";

test("every kind makes a short sound, the same again from the same seed and different from another", () => {
  for (const k of KINDS) {
    const s = sfxOf(k, 7);
    assert.ok(length(s) > 0.02 && length(s) < 2, `${k}: ${length(s)}s`);
    const a = render(s, 7);
    assert.equal(a.length, Math.round(length(s) * RATE));
    assert.ok(a.every((v) => v >= -1 && v <= 1), `${k} stays in range`);
    assert.ok(a.some((v) => Math.abs(v) > 0.05), `${k} isn't silent`);
    assert.deepEqual(render(sfxOf(k, 7), 7), a);
  }
  assert.notDeepEqual(sfxOf("coin", 1), sfxOf("coin", 2));
});

test("written as a WAV file a browser plays", () => {
  const w = wav(new Float32Array([0, 1, -1, 0.5]));
  const text = (a: number, b: number) => String.fromCharCode(...w.slice(a, b));
  assert.equal(text(0, 4), "RIFF");
  assert.equal(text(8, 12), "WAVE");
  assert.equal(text(36, 40), "data");
  assert.equal(w.length, 44 + 8);
  const d = new DataView(w.buffer);
  assert.equal(d.getUint32(24, true), RATE);
  assert.equal(d.getInt16(46, true), 32767);
  assert.equal(d.getInt16(48, true), -32767);
});

test("a game's wish for a sound finds its kind", () => {
  assert.equal(kindFor("picking up a gem"), "coin");
  assert.equal(kindFor("the cat jumps"), "jump");
  assert.equal(kindFor("game over"), "lose");
  assert.equal(kindFor("ship shoots"), "laser");
  assert.equal(kindFor("something odd"), "random");
});
