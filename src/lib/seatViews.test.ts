import test from "node:test";
import assert from "node:assert/strict";
import { OLDER, shrinkOlderViews } from "./seatViews.ts";

const big = "Vexel: you stand at 1, 2, 3. " + "TTvv~~ ".repeat(200);

test("earlier seat views this turn shrink; everything else stays", () => {
  const turns = [
    { role: "tool", name: "game_screen", content: big },
    { role: "tool", name: "game_screen", content: big },
    { role: "tool", name: "web_search", content: big },
    { role: "tool", name: "game_seat_act", content: "Walked 3 blocks." },
  ];
  shrinkOlderViews(turns, 1);
  assert.equal(turns[0].content, big); // (before this turn: not ours to touch)
  assert.ok(String(turns[1].content).endsWith(OLDER));
  assert.ok(String(turns[1].content).length < 400);
  assert.ok(String(turns[1].content).startsWith("Vexel: you stand at 1, 2, 3."));
  assert.equal(turns[2].content, big);
  assert.equal(turns[3].content, "Walked 3 blocks.");
});

test("a view shrinks only once", () => {
  const turns = [{ role: "tool", name: "game_screen", content: big }];
  shrinkOlderViews(turns, 0);
  const once = turns[0].content;
  shrinkOlderViews(turns, 0);
  assert.equal(turns[0].content, once);
});
