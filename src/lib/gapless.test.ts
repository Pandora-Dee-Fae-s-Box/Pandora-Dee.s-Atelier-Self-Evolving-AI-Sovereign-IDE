import { test } from "node:test";
import assert from "node:assert/strict";
import { peakOf, quietEnding, upcoming } from "./gapless.ts";

test("the next song is the one Next would play when a song ends", () => {
  assert.equal(upcoming(3, 0, "off"), 1);
  assert.equal(upcoming(3, 2, "off"), -1, "the end of the list, no repeat: nothing");
  assert.equal(upcoming(3, 2, "all"), 0);
  assert.equal(upcoming(3, 1, "one"), 1);
  assert.equal(upcoming(0, -1, "all"), -1);
});

test("a song ends early only on a long enough silence near its end", () => {
  assert.equal(quietEnding(10, 100, 101.5), true);
  assert.equal(quietEnding(10, 100, 100.5), false, "a short pause is part of the song");
  assert.equal(quietEnding(60, 100, 110), false, "a quiet passage mid-song isn't the end");
  assert.equal(quietEnding(10, null, 110), false);
});

test("peak level from the analyser's bytes", () => {
  assert.equal(peakOf(new Uint8Array([128, 128, 128])), 0);
  assert.equal(peakOf(new Uint8Array([128, 192, 64])), 0.5);
});
