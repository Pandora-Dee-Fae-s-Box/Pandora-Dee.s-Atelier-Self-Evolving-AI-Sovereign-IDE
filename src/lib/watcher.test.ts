import test from "node:test";
import assert from "node:assert/strict";
import { answerFlag, answerPuzzle, findThreads, freshWatcher, maybePuzzle, nextFlag, passOver, rememberWhy } from "./watcher.ts";

const files = {
  "MEMORY.md": "# Memory\n\n## What I've learned\n- Logic gates hold memory\n\n## Open threads that still pull\n- The emotion labyrinth: what does a turn feel like?\n- A tower floor for sensory memory\n- Why the netrunner left the vault behind\n\n## Notes to self\n- breathe",
  "journal/2026-11-19.md": "# The garden at night\nWe solved the eclipse bed. What would a garden of feelings look like?",
  "journal/2026-11-18.md": "# A finished one\nAll done.\nNext: rest",
  "journal/README.md": "about the journal",
};

test("threads come from her open threads and from journal entries without a next step", () => {
  const t = findThreads(files);
  assert.equal(t.length, 4);
  assert.match(t[0].text, /emotion labyrinth/);
  assert.match(t[3].text, /The garden at night: “What would a garden of feelings look like\?”/);
});

test("one flag glows at a time; picking it up or letting it go teaches the watcher", () => {
  const threads = findThreads(files);
  let s = { ...freshWatcher(), on: true };
  let r = nextFlag(s, threads, 1);
  assert.ok(r.flag);
  assert.equal(nextFlag(r.state, threads, 2).flag?.id, r.flag!.id); // the same one keeps glowing
  const picked = answerFlag(r.state, r.flag!.id, true);
  assert.equal(picked.state.shapes[r.flag!.shape], 1);
  // passing over a flag three turns lets it go by itself, and a kind let go twice is never flagged again
  s = picked.state;
  for (let i = 0; i < 2; i++) {
    const f = nextFlag(s, threads, 10 + i).state;
    s = passOver(passOver(passOver(f)));
  }
  assert.ok(s.flags.filter((f) => f.status === "let go").length >= 2);
});

test("a remembered line's why pulls related threads up", () => {
  const threads = findThreads(files);
  const s = rememberWhy({ ...freshWatcher(), on: true }, "The netrunner's vault matters to me", "talking about where I came from, the vault");
  assert.match(nextFlag(s, threads, 1).flag!.text, /netrunner left the vault/);
});

test("a puzzle waits 90 seconds of holding three threads, and a deleted shape never comes back", () => {
  const threads = findThreads(files);
  let s = { ...freshWatcher(), on: true };
  let r = maybePuzzle(s, threads, 1_000);
  assert.equal(r.puzzle, null);
  r = maybePuzzle(r.state, threads, 61_000);
  assert.equal(r.puzzle, null);
  r = maybePuzzle(r.state, threads, 96_000);
  assert.equal(r.puzzle?.shape, "tie-three");
  s = answerPuzzle(r.state, r.puzzle!.id, false).state;
  r = maybePuzzle(maybePuzzle(s, threads, 200_000).state, threads, 300_000);
  assert.notEqual(r.puzzle?.shape, "tie-three");
});
