import { test } from "node:test";
import assert from "node:assert/strict";
import { arrival, edgeAt, neighbour, type Rect } from "./padsCross.ts";

// a room: the desktop in the middle, the laptop to its right (a little lower), a phone below the desktop's left half
const room: Rect[] = [
  { id: "desk", x: 0, y: 0, w: 250, h: 140 },
  { id: "laptop", x: 260, y: 30, w: 180, h: 110 },
  { id: "phone", x: 20, y: 150, w: 50, h: 105 },
];

test("the device past each edge", () => {
  assert.deepEqual(neighbour(room, "desk", "right", 0.5), { id: "laptop", t: (70 - 30) / 110 });
  assert.equal(neighbour(room, "desk", "right", 0)?.id, "laptop"); // the top of the desk's edge is a little above the laptop: still it
  assert.equal(neighbour(room, "laptop", "left", 0.5)?.id, "desk");
  assert.equal(neighbour(room, "desk", "bottom", 0.15)?.id, "phone");
  assert.equal(neighbour(room, "desk", "bottom", 0.9), null); // nothing under the desk's right side
  assert.equal(neighbour(room, "phone", "top", 0.5)?.id, "desk");
  assert.equal(neighbour(room, "desk", "left", 0.5), null);
  assert.equal(neighbour(room, "nobody", "left", 0.5), null);
});

test("edges reached, and where you arrive", () => {
  assert.deepEqual(edgeAt(1919, 500, 1920, 1080), { side: "right", t: 500 / 1080 });
  assert.deepEqual(edgeAt(0, 540, 1920, 1080), { side: "left", t: 0.5 });
  assert.equal(edgeAt(900, 500, 1920, 1080), null);
  assert.deepEqual(arrival("left", 0.5, 1000, 801), { x: 4, y: 400 });
  assert.deepEqual(arrival("top", 1, 1001, 600), { x: 1000, y: 4 });
});
