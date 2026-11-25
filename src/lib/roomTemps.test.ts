import test from "node:test";
import assert from "node:assert/strict";
import { temperature, wanderers } from "./roomTemps.ts";

test("a room's temperature: what was said in the last ten minutes, and the last thing said", () => {
  const now = 60 * 60_000;
  const said = (at: number, name = "Dee") => ({ kind: "character", name, text: "hello", at });
  assert.equal(temperature([], now).heat, "quiet");
  assert.equal(temperature([said(now - 20 * 60_000)], now).heat, "quiet");
  const warm = temperature([said(now - 60_000, "Jade"), { kind: "notice", text: "desk", at: now }], now);
  assert.equal(warm.heat, "warm");
  assert.equal(warm.last?.name, "Jade"); // a desk notice isn't something said
  assert.equal(temperature(Array.from({ length: 9 }, () => said(now - 1000)), now).heat, "lively");
});

test("characters in more than one room are the ones whose conversations can cross", () => {
  const w = wanderers([{ name: "Home", members: ["dee", "jade"] }, { name: "Phone room", members: ["dee"] }]);
  assert.deepEqual([...w], [["dee", ["Home", "Phone room"]]]);
});
