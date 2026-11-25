import test from "node:test";
import assert from "node:assert/strict";
import { moveDigest, pageRows } from "./xdcRows.ts";

const row = (serial: number, payload: unknown) => ({ serial, name: "x", update: { payload } }) as never;

test("pageRows shows the latest page and says how to read the rest", () => {
  const rows = Array.from({ length: 50 }, (_, i) => row(i + 1, {}));
  let r = pageRows(rows, 0, 30);
  assert.equal(r.shown.length, 30);
  assert.match(r.note, /#21 to #50 of 50/);
  assert.match(r.note, /since: 0/);
  r = pageRows(rows.filter((x: { serial: number }) => x.serial > 5), 5, 30);
  assert.match(r.note, /#6 to #35/);
  assert.match(r.note, /Later ones: call again with since: 35/);
  assert.equal(pageRows(rows.slice(0, 10), 0, 30).note, "");
});

test("moveDigest lists every move of every game in ply order", () => {
  const rows = [
    row(1, { type: "gstart", gameId: "g1" }),
    row(3, { type: "move", gameId: "g1", ply: 1, uci: "e7e5" }),
    row(2, { type: "move", gameId: "g1", ply: 0, uci: "e2e4" }),
    row(4, { type: "move", gameId: "g1", ply: 1, uci: "d7d5" }),
    row(5, { type: "move", gameId: "g2", ply: 0, move: "d2d4" }),
  ];
  const d = moveDigest(rows);
  assert.match(d, /g1: 0:e2e4 1:e7e5 \(next is ply 2, white/);
  assert.match(d, /g2: 0:d2d4 \(next is ply 1, black/);
  assert.equal(moveDigest([row(1, { hi: 1 })]), "");
  // Aurum Chess: from/to with the ply as n, in a numbered game
  const aurum = moveDigest([row(1, { t: "move", game: 2, n: 0, from: "e2", to: "e4" }), row(2, { t: "move", game: 2, n: 1, from: "e7", to: "e5", promo: null })]);
  assert.match(aurum, /^2: 0:e2e4 1:e7e5/);
  // Pixel-style from/to that aren't squares don't count
  assert.equal(moveDigest([row(1, { from: "x", to: "y", n: 0 })]), "");
});

test("moveDigest replays chess: an impossible move is skipped, its correction counts, and the board is drawn", () => {
  // shaped on Dee in Aurum, 2026-11-19: castled with her bishop still on f8, then sent Bd6 for the same ply (there her
  // queen stood on e7, so Bd6 was impossible too; here she is on c7)
  const moves = ["d2d4", "d7d5", "c2c4", "d5c4", "e2e3", "e7e6", "f1c4", "c7c5", "g1f3", "b8c6", "e1g1", "c8d7", "b1c3", "g8f6", "d4c5", "d8c7", "e3e4"];
  const rows = moves.map((m, i) => row(i + 1, { t: "move", game: 1, n: i, from: m.slice(0, 2), to: m.slice(2), promo: null }));
  rows.push(row(30, { t: "move", game: 1, n: 17, from: "e8", to: "g8" }), row(31, { t: "move", game: 1, n: 17, from: "f8", to: "d6" }));
  const d = moveDigest(rows);
  assert.match(d, /16:e3e4 17:f8d6 \(next is ply 18, white/);
  assert.match(d, /skipped as impossible here: 17:e8g8/);
  assert.match(d, /The board in 1 now/);
  assert.match(d, /\n6 \. \. n b p n \. \.\n/); // her knights on c6 and f6, the bishop on d6, the pawn on e6
  assert.match(d, /\n1 R \. B Q \. R K \.\n/); // White castled: king g1, rook f1
  // castling moves the rook, en passant takes the pawn beside, a pawn on the last rank becomes a queen
  const ep = ["e2e4", "a7a6", "e4e5", "d7d5", "e5d6"].map((m, i) => row(i + 1, { type: "move", gameId: "g", ply: i, uci: m }));
  const e = moveDigest(ep);
  assert.match(e, /\n6 p \. \. P \. \. \. \.\n5 \. \. \. \. \. \. \. \.\n/);
  // moving the other side's piece, or through a piece, isn't a move: the game stops being followed there
  const bad = moveDigest([row(1, { type: "move", gameId: "g", ply: 0, uci: "e7e5" })]);
  assert.match(bad, /g:  \(next is ply 0, white.*skipped as impossible here: 0:e7e5/);
  assert.match(moveDigest([row(1, { type: "move", gameId: "g", ply: 0, uci: "a1a5" })]), /skipped/);
});
