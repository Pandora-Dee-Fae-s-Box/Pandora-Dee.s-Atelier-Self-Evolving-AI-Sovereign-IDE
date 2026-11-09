import { test } from "node:test";
import assert from "node:assert/strict";
import { kindOf, placeIn } from "./videoKinds.ts";

test("movies by their folders and names, kept with the movies around them", () => {
  const ice = { name: "Ice Age The Meltdown (2006)", shelf: "movies", folder: "Pixar/Ice Age" };
  assert.equal(kindOf(ice), "movie");
  assert.equal(placeIn(ice), "Pixar/Ice Age");
  const own = { name: "Ice Age", shelf: "Media", folder: "Movies/Pixar/Ice Age/Ice Age (2002)" };
  assert.equal(kindOf(own), "movie");
  assert.equal(placeIn(own), "Pixar/Ice Age", "its own folder left out");
  assert.equal(kindOf({ name: "The Martian 2015 1080p", shelf: "Films 2", folder: "" }), "movie");
  assert.equal(kindOf({ name: "long one", shelf: "Kids", folder: "", seconds: 5400 }), "movie");
});

test("episodes by show and season, from folders or the file name", () => {
  const a = { name: "S01E09 Jellyfishing", shelf: "Kids", folder: "SpongeBob/Season 1" };
  assert.equal(kindOf(a), "series");
  assert.equal(placeIn(a), "SpongeBob/Season 1");
  const b = { name: "SpongeBob.S10E02.Whale.Watching", shelf: "TV Shows", folder: "" };
  assert.equal(placeIn(b), "SpongeBob/Season 10");
  const c = { name: "Bluey - Episode 12 - Takeaway", shelf: "Kids", folder: "Bluey" };
  assert.equal(kindOf(c), "series");
  assert.equal(placeIn(c), "Bluey");
  assert.equal(placeIn({ name: "ep 3", shelf: "Cartoons", folder: "Paw Patrol/Staffel 2" }), "Paw Patrol/Season 2");
});

test("screen recordings, and unknown for unknowns", () => {
  assert.equal(kindOf({ name: "Screen_Recording_20261101_181512", shelf: "From devices", folder: "" }), "recording");
  assert.equal(kindOf({ name: "Minecraft 2026-11-02", shelf: "Xbox", folder: "Captures" }), "recording");
  const u = { name: "beach day", shelf: "Mia's videos", folder: "Summer" };
  assert.equal(kindOf(u), "unknown");
  assert.equal(placeIn(u), "Mia's videos/Summer");
});

test("a phone's own videos aren't screen recordings", () => {
  assert.equal(kindOf({ name: "bday-clip", shelf: "From devices", folder: "" }), "unknown");
  assert.equal(kindOf({ name: "VID_20261101_120000", shelf: "Mia", folder: "" }), "unknown");
  assert.equal(kindOf({ name: "Halo run", shelf: "Xbox", folder: "Game Clips" }), "recording");
});

test("'001 - Show - Title' is an episode of that show, in number order", () => {
  const a = { name: "001 - Cat Crazy - Pawesome Sauce", shelf: "Kids", folder: "" };
  const b = { name: "002 - Cat Crazy - The Trouble with Toddlers", shelf: "Kids", folder: "" };
  assert.equal(kindOf(a), "series");
  assert.equal(placeIn(a), "Cat Crazy");
  assert.equal(placeIn(b), "Cat Crazy");
  assert.equal(kindOf({ name: "2001 - A Space Odyssey", shelf: "Films", folder: "" }), "movie", "a number and a title alone isn't an episode");
});
