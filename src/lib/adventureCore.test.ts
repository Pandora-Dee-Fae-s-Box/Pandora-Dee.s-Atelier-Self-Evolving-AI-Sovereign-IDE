import { test } from "node:test";
import assert from "node:assert/strict";
import { hostOf, noteSeen, noteStep, logLine, logPath, macroPath, type Trail } from "./adventureCore.ts";

test("hostOf drops www and survives junk", () => {
  assert.equal(hostOf("https://www.example.com/a"), "example.com");
  assert.equal(hostOf("not a url"), "");
  assert.equal(hostOf("chrome-error://chromewebdata/"), "");
});

test("visits, a check met, steps taken, and the check gone", () => {
  let t: Trail = {};
  let r = noteSeen(t, { host: "example.com", humanCheck: false }, 1);
  assert.deepEqual(r.lines, ["Went to example.com."]);
  r = noteSeen(r.trail, { host: "example.com", humanCheck: true }, 2);
  assert.deepEqual(r.lines, ["Met a human check (CAPTCHA or similar) on example.com."]);
  t = noteStep(noteStep(r.trail, "looked"), "clicked at 120,340");
  r = noteSeen(t, { host: "example.com", humanCheck: false }, 3);
  assert.deepEqual(r.lines, ["The check on example.com was gone after 2 steps: looked, clicked at 120,340."]);
  assert.equal(r.trail.check, undefined);
});

test("moving on from a check is noted, and steps aren't kept without one", () => {
  let r = noteSeen({}, { host: "a.org", humanCheck: true }, 1);
  r = noteSeen(r.trail, { host: "b.org", humanCheck: false }, 2);
  assert.deepEqual(r.lines, ["Moved on from the check on a.org to b.org after 0 steps.", "Went to b.org."]);
  assert.deepEqual(noteStep({ host: "b.org" }, "clicked"), { host: "b.org" });
});

test("a check that stays showing isn't logged twice", () => {
  let r = noteSeen({}, { host: "a.org", humanCheck: true }, 1);
  r = noteSeen(noteStep(r.trail, "looked"), { host: "a.org", humanCheck: true }, 2);
  assert.deepEqual(r.lines, []);
  assert.deepEqual(r.trail.check?.steps, ["looked"]);
});

test("log lines, log files and macro names", () => {
  const at = Date.UTC(2026, 10, 8, 5, 7);
  assert.equal(logLine(at, "Mac · qwen", "Went to a.org."), "- 2026-11-08 05:07Z · Mac · qwen · Went to a.org.");
  assert.equal(logPath(at), "adventures/2026-11.md");
  assert.equal(macroPath("Sign in to Forum!"), "macros/sign-in-to-forum.json");
  assert.equal(macroPath("???"), "macros/macro.json");
});
