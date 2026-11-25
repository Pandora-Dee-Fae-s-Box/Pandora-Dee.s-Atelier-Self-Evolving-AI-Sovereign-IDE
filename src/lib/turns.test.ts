import test from "node:test";
import assert from "node:assert/strict";
import { turnNow, wakes } from "./turns.ts";

const row = (serial: number, from: string, notify?: Record<string, string>) => ({ serial, at: 0, from, name: from, update: { payload: {}, ...(notify ? { notify } : {}) } }) as never;

test("a game that never says whose turn it is leaves everyone playing", () => {
  assert.deepEqual(turnNow([row(1, "you:t"), row(2, "ai:dee")], ["dee", "jade"]), { kind: "open" });
});

test("the game naming a character opens only her eyes, with its line for her", () => {
  const t = turnNow([row(1, "you:t", { "ai:dee": "Choose a secret word" })], ["dee", "jade"]);
  assert.equal(t.kind, "theirs");
  assert.deepEqual(t.kind === "theirs" ? [...t.mine] : [], [["dee", "Choose a secret word"]]);
});

test("while a person is choosing, the characters wait; once they've answered, play opens again", () => {
  const rows = [row(1, "ai:dee", { "you:t": "Your turn to choose" })];
  assert.deepEqual(turnNow(rows, ["dee", "jade"]), { kind: "waiting", for: ["you:t"] });
  assert.deepEqual(turnNow([...rows, row(2, "you:t")], ["dee"]), { kind: "open" });
});

test("everyone (*) is named: every playing character takes a turn", () => {
  const t = turnNow([row(1, "you:t", { "*": "Guess a letter" })], ["dee", "jade"]);
  assert.equal(t.kind === "theirs" ? t.mine.size : 0, 2);
});

test("a move naming a character wakes her, from another character or from her own move (her turn again)", () => {
  assert.equal(wakes(row(1, "ai:jade", { "ai:dee": "Your guess" }), ["dee", "jade"]), true);
  // First Frost, 2026-11-19: Dee's plan was the last of the huddle, and her own copy said "everyone act now"
  assert.equal(wakes(row(1, "ai:dee", { "ai:dee": "Round 4: act now", "you:you": "Round 4: act now" }), ["dee"]), true);
  assert.equal(wakes(row(1, "you:t"), ["dee"]), false);
});
