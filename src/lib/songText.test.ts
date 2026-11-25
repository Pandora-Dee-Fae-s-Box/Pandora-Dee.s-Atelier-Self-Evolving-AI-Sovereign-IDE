import { test } from "node:test";
import assert from "node:assert/strict";
import { fitLength } from "./songText.ts";

const song = (verses: number, linesEach: number) =>
  Array.from({ length: verses }, (_, i) => [`[${i % 2 ? "Chorus" : "Verse"}]`, ...Array.from({ length: linesEach }, (_, k) => `line ${k}`)].join("\n")).join("\n\n");

test("a short song still gets four minutes", () => {
  assert.equal(fitLength(song(4, 4)), 240);
  assert.equal(fitLength(""), 240);
});

test("a long one gets the time its words need, up to the most", () => {
  assert.equal(fitLength(song(8, 8)), 360);
  const mid = fitLength(song(6, 9)); // 54 sung lines, 6 sections: 243 + 48 + 10 → 300
  assert.equal(mid, 300);
});

test("the floor and ceiling can be set (a shorter engine)", () => {
  assert.equal(fitLength(song(8, 8), 30, 240), 240);
  assert.equal(fitLength("[Verse]\nla", 30, 240), 30);
});

import { engineLyrics, styleWithArrangement } from "./songText.ts";

test("instructions in a section tag leave the sung words and go to the style", () => {
  const { lyrics, notes } = engineLyrics("[Intro - soft piano, rain sounds]\n\n[Verse 1: whispered, close mic]\nThe tide comes in\n[Chorus (full band, big harmonies)]\nSing it out\n[Bridge]\nquiet now");
  assert.equal(lyrics, "[Intro]\n\n[Verse]\nThe tide comes in\n[Chorus]\nSing it out\n[Bridge]\nquiet now");
  assert.deepEqual(notes, ["Intro: soft piano, rain sounds", "Verse 1: whispered, close mic", "Chorus: full band, big harmonies"]);
});

test("a direction on its own line, or inside a sung line, is never sung", () => {
  const { lyrics, notes } = engineLyrics("[Verse 2]\nWe walk [guitar swells] the shore\n[drums drop out]\n(oh, oh)\nand home");
  assert.equal(lyrics, "[Verse]\nWe walk the shore\n(oh, oh)\nand home");
  assert.deepEqual(notes, ["Verse 2: guitar swells", "Verse 2: drums drop out"]);
});

test("names are made plain: Pre Chorus, Refrain, Guitar Solo, Ending", () => {
  assert.equal(engineLyrics("[Pre Chorus]\na\n[Refrain]\nb\n[Guitar Solo]\n[Ending - fade out]").lyrics, "[Pre-Chorus]\na\n[Chorus]\nb\n[Solo]\n[Outro]");
});

test("an instrumental stays an instrumental; plain lyrics are untouched", () => {
  assert.deepEqual(engineLyrics("[Instrumental]"), { lyrics: "[Instrumental]", notes: [] });
  assert.deepEqual(engineLyrics("[Verse]\nla la\n\n[Chorus]\nla"), { lyrics: "[Verse]\nla la\n\n[Chorus]\nla", notes: [] });
});

test("the style carries the arrangement, kept short", () => {
  assert.equal(styleWithArrangement("dream pop, female vocals,", ["Intro: soft piano"]), "dream pop, female vocals. Arrangement: Intro: soft piano");
  assert.equal(styleWithArrangement("x", []), "x");
  assert.ok(styleWithArrangement("x", Array(50).fill("Verse 1: a long direction here"), 100).length < 120);
});
