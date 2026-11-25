import { test } from "node:test";
import assert from "node:assert/strict";
import { insertionPoint, placeInQueue, whereOf } from "./queueOps.ts";

// albums in a row: A A A B B C, by first letter
const q = ["a1", "a2", "a3", "b1", "b2", "c1"];
const album = (s: string) => s[0];

test("next goes right after what's playing", () => {
  assert.deepEqual(placeInQueue(q, 1, ["x"], "next", album).queue, ["a1", "a2", "x", "a3", "b1", "b2", "c1"]);
});

test("last goes at the end", () => {
  assert.deepEqual(placeInQueue(q, 1, ["x", "y"], "last", album).queue, [...q, "x", "y"]);
});

test("after the current album goes after the rest of this album's run", () => {
  assert.equal(insertionPoint(q, 0, "after-album", album), 3);
  assert.equal(insertionPoint(q, 2, "after-album", album), 3);
  assert.equal(insertionPoint(q, 3, "after-album", album), 5);
  assert.equal(insertionPoint(q, 5, "after-album", album), 6);
});

test("with nothing playing, everything goes at the end", () => {
  assert.equal(insertionPoint(q, -1, "next", album), 6);
  assert.equal(insertionPoint([], -1, "after-album", album), 0);
});

test("loose words name the place", () => {
  assert.equal(whereOf("play_next"), "next");
  assert.equal(whereOf("queue last"), "last");
  assert.equal(whereOf("after_album"), "after-album");
  assert.equal(whereOf("Play after current album"), "after-album");
  assert.equal(whereOf("soon"), null);
});
