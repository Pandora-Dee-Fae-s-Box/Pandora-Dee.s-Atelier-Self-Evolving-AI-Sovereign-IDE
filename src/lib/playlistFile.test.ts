import { test } from "node:test";
import assert from "node:assert/strict";
import { matchEntries, nameFromFile, parsePlaylist, writeM3u } from "./playlistFile.ts";

test("M3U with titles, written and read back", () => {
  const text = writeM3u([
    { path: "\\\\MEDIA-PC\\movies\\Bluey\\S01E01 Magic Xylophone.mp4", title: "Magic Xylophone", seconds: 420 },
    { path: "C:/Videos/loose.mkv" },
  ]);
  assert.match(text, /^#EXTM3U\n#EXTINF:420,Magic Xylophone\n/);
  assert.deepEqual(parsePlaylist(text), [
    { path: "\\\\MEDIA-PC\\movies\\Bluey\\S01E01 Magic Xylophone.mp4", title: "Magic Xylophone", seconds: 420 },
    { path: "C:/Videos/loose.mkv", title: undefined, seconds: undefined },
  ]);
});

test("PLS, file: addresses, a byte-order mark and plain lists", () => {
  assert.deepEqual(parsePlaylist("[playlist]\nFile2=b.mp3\nFile1=file:///C:/Music/a%20song.mp3\nTitle1=A song\nNumberOfEntries=2").map((e) => e.path), ["C:/Music/a song.mp3", "b.mp3"]);
  assert.deepEqual(parsePlaylist("\uFEFFone.mp4\r\n\r\n# a note\r\ntwo.mp4").map((e) => e.path), ["one.mp4", "two.mp4"]);
});

test("entries found by path, or by the folders above the name; what isn't here is counted", () => {
  const here = ["\\\\MEDIA-PC\\movies\\SpongeBob\\Season 1\\ep1.mp4", "\\\\MEDIA-PC\\movies\\SpongeBob\\Season 2\\ep1.mp4", "F:\\vault\\Videos\\Kids\\Frozen.mp4"];
  const r = matchEntries(
    [{ path: "Season 2/ep1.mp4" }, { path: "D:\\old pc\\Kids\\frozen.MP4" }, { path: "gone.mp4" }, { path: "http://radio.example/stream" }],
    here,
    (p) => p,
  );
  assert.deepEqual(r.found, [here[1], here[2]]);
  assert.equal(r.missing.length, 2);
  assert.equal(nameFromFile("C:\\x\\Saturday cartoons.m3u8"), "Saturday cartoons");
});
