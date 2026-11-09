import { test } from "node:test";
import assert from "node:assert/strict";
import { episodeOf, episodeOrder, inFolder, underFolder } from "./episodes.ts";

test("seasons go 1, 2 … 10, 11, not 1, 10, 11, 2", () => {
  const v = ["Season 10", "Season 2", "Season 1", "Season 11"].map((s) => ({ folder: `SpongeBob/${s}`, name: "ep" }));
  assert.deepEqual(v.sort(episodeOrder).map((x) => x.folder), ["SpongeBob/Season 1", "SpongeBob/Season 2", "SpongeBob/Season 10", "SpongeBob/Season 11"]);
});

test("episodes by the number in their name, whatever the name looks like", () => {
  assert.deepEqual(episodeOf("SpongeBob.S01E09.Jellyfishing"), { season: 1, episode: 9 });
  assert.deepEqual(episodeOf("spongebob 2x03"), { season: 2, episode: 3 });
  assert.deepEqual(episodeOf("Bluey - Episode 12 - Takeaway"), { episode: 12 });
  const names = ["S01E10 Pizza", "S01E09 Jelly", "S01E01 Help Wanted", "S01E02 Reef Blower"];
  assert.deepEqual(names.map((name) => ({ folder: "S1", name })).sort(episodeOrder).map((x) => x.name), ["S01E01 Help Wanted", "S01E02 Reef Blower", "S01E09 Jelly", "S01E10 Pizza"]);
});

test("a shelf browsed show by show, and what plays on from an episode", () => {
  const v = [
    { folder: "SpongeBob/Season 2", name: "S02E01" },
    { folder: "SpongeBob/Season 1", name: "S01E02" },
    { folder: "SpongeBob/Season 1", name: "S01E01" },
    { folder: "SpongeBob/Season 10", name: "S10E01" },
    { folder: "Bluey", name: "Bluey 1" },
    { folder: "", name: "loose video" },
  ];
  const top = inFolder(v, "");
  assert.deepEqual(top.folders.map((f) => [f.name, f.videos.length]), [["Bluey", 1], ["SpongeBob", 4]]);
  assert.deepEqual(top.here.map((x) => x.name), ["loose video"]);
  assert.deepEqual(inFolder(v, "SpongeBob").folders.map((f) => f.name), ["Season 1", "Season 2", "Season 10"]);
  assert.deepEqual(underFolder(v, "SpongeBob").map((x) => x.name), ["S01E01", "S01E02", "S02E01", "S10E01"]);
});
