import { test } from "node:test";
import assert from "node:assert/strict";
import { previousRun } from "./musicRuns.ts";
import type { Item } from "./music.ts";

const s = (id: string, album: string, artist = "X"): Item => ({ kind: "track", id, title: id, artist, album, year: 0, track: 0, genre: "", duration: 1, cover: false, bitrate: 0, size: 0, folder: "" });
// three albums in a row (as an album shuffle lays them out): A A A, B B, C C
const q = [s("a1", "A"), s("a2", "A"), s("a3", "A"), s("b1", "B"), s("b2", "B"), s("c1", "C", "Y"), s("c2", "C", "Y")];

test("back to the first song of the album before this one, from anywhere in this one", () => {
  assert.equal(previousRun(q, 4, "album", false), 0);
  assert.equal(previousRun(q, 3, "album", false), 0);
  assert.equal(previousRun(q, 6, "album", false), 3);
});

test("on the first album: nothing, or round to the last with repeat on", () => {
  assert.equal(previousRun(q, 1, "album", false), -1);
  assert.equal(previousRun(q, 1, "album", true), 5);
});

test("two copies of one album in a row are two runs (one per folder)", () => {
  const c = (id: string, rel: string): Item => ({ ...s(id, "A"), folder: "/m", rel });
  const two = [c("x1", "128/A/1.mp3"), c("x2", "128/A/2.mp3"), c("y1", "320/A/1.mp3"), c("y2", "320/A/2.mp3")];
  assert.equal(previousRun(two, 3, "album", false), 0);
  assert.equal(previousRun(two, 1, "album", false), -1);
});

test("by artist, a run spans albums", () => {
  assert.equal(previousRun(q, 6, "artist", false), 0);
  assert.equal(previousRun(q, 2, "artist", true), 5);
  assert.equal(previousRun([s("x", "A")], 0, "album", true), -1, "one run only: nowhere to go");
});
