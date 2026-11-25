import test from "node:test";
import assert from "node:assert/strict";
import { WRAP_AT, playNote, timeToWrap, wrapNote } from "./playRoom.ts";

test("wraps up at four-fifths of her room, not before", () => {
  const w = 262144;
  assert.equal(timeToWrap(undefined, w), false);
  assert.equal(timeToWrap(Math.floor(w * WRAP_AT) - 1, w), false);
  assert.equal(timeToWrap(Math.ceil(w * WRAP_AT), w), true);
});

test("the notes say how long she has, and what to say at the end", () => {
  assert.match(playNote(262144), /about 210k tokens.*of 262k/);
  const n = wrapNote(215000, 262144);
  assert.match(n, /215k of 262k/);
  assert.match(n, /safe/);
  assert.match(n, /x, y, z/);
  assert.match(n, /next turn/);
});

test("a reply that narrates play instead of playing is caught as it streams", async () => {
  const { runaway } = await import("./playRoom.ts");
  assert.equal(runaway("I'll read my screen first, then pick a course."), false);
  assert.equal(runaway("Thinking it over.</think>\n\nI'll click Browse online."), false);
  // Dee in the Learning Lab: pretend turns, one after another
  assert.equal(runaway("I clicked Start.</think>Slide 1 is about AIXI.</think>I read the screen. Slide 2.</think>I'll continue."), true);
  assert.equal(runaway("a".repeat(6001)), true);
});
