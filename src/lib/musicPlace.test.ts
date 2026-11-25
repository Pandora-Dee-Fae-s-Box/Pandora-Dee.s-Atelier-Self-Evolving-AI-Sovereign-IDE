import { test } from "node:test";
import assert from "node:assert/strict";
import { pack, unpack } from "./musicPlace.ts";
import type { Item, Track } from "./music.ts";

const tr = (id: string, album = "A"): Track => ({ id, title: id, artist: "X", album, year: 0, track: 0, genre: "", duration: 200, cover: false, bitrate: 320, size: 1, folder: "/m" });
const lib = ["a1", "a2", "b1", "b2", "c1"].map((id) => tr(id, id[0]));
const item = (t: Track): Item => ({ kind: "track", ...t });

test("a shuffled queue comes back in the same order, at the same song and second", () => {
  const q = [lib[2], lib[3], lib[0], lib[1]].map(item);
  const saved = JSON.parse(JSON.stringify(pack(q, 2, 73.6)));
  assert.deepEqual(saved.q.slice(0, 2), [{ t: "b1" }, { t: "b2" }], "library songs are kept by id");
  const back = unpack(saved, lib)!;
  assert.deepEqual(back.queue.map((x) => (x.kind === "track" ? x.id : "")), ["b1", "b2", "a1", "a2"]);
  assert.equal(back.index, 2);
  assert.equal(back.position, 73);
});

test("stations and songs from another device are kept whole", () => {
  const radio: Item = { kind: "radio", name: "Tide FM", url: "https://radio.example/tide" } as Item;
  const shared: Item = { ...item(tr("zz")), src: "/api/share/zz", device: "phone" };
  const back = unpack(JSON.parse(JSON.stringify(pack([radio, shared], 1, 5))), lib)!;
  assert.deepEqual(back.queue, [radio, shared]);
  assert.equal(back.index, 1);
});

test("songs gone from the library are left out, and the place moves with them", () => {
  const q = ["a1", "a2", "b1", "c1"].map((id) => item(lib.find((t) => t.id === id)!));
  const fewer = lib.filter((t) => t.id !== "a1" && t.id !== "b1");
  // playing b1, which is gone: carry on at the next one that's left (c1), from its start
  const back = unpack(pack(q, 2, 40), fewer)!;
  assert.deepEqual(back.queue.map((x) => (x.kind === "track" ? x.id : "")), ["a2", "c1"]);
  assert.equal(back.index, 1);
  assert.equal(back.position, 0);
  // playing c1, which is there: same song, same second, one earlier in the list
  const kept = unpack(pack(q, 3, 12), fewer)!;
  assert.equal(kept.index, 1);
  assert.equal(kept.position, 12);
});

test("nothing saved, or nothing left, gives nothing", () => {
  assert.equal(unpack(null, lib), null);
  assert.equal(unpack({ v: 1, q: [{ t: "gone" }], i: 0, at: 0 }, lib), null);
  assert.equal(unpack("junk", lib), null);
});
