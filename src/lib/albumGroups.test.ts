import { test } from "node:test";
import assert from "node:assert/strict";
import { albumHome, groupAlbums } from "./albumGroups.ts";
import type { Track } from "./music.ts";

const t = (id: string, album: string, rel: string, o: Partial<Track> = {}): Track =>
  ({ id, title: id, artist: "X", album, year: 0, track: Number(id.replace(/\D/g, "")) || 0, genre: "", duration: 1, cover: false, bitrate: 320, size: 1, folder: "M:\\Music", rel, file: rel.split(/[\\/]/).pop(), ...o });

test("an album's folder: its own, or the one above a disc folder", () => {
  assert.equal(albumHome(t("1", "A", "X\\A\\01.mp3")), "m:/music/x/a");
  assert.equal(albumHome(t("1", "A", "X\\A\\CD2\\01.mp3")), "m:/music/x/a");
  assert.equal(albumHome(t("1", "A", "X\\A\\Disc 1\\01.mp3")), "m:/music/x/a");
  assert.equal(albumHome({ folder: "/m", rel: undefined }), "/m");
  assert.equal(albumHome({ folder: "/m", rel: "a/1.mp3", device: "phone" }), "phone:/m/a");
});

test("the same album in three places is three albums, each saying what it is", () => {
  const songs = [
    t("1", "Tide", "128\\Tide\\01.mp3", { bitrate: 128 }), t("2", "Tide", "128\\Tide\\02.mp3", { bitrate: 128 }),
    t("1b", "Tide", "320\\Tide\\01.mp3", { bitrate: 320 }), t("2b", "Tide", "320\\Tide\\02.mp3", { bitrate: 320 }),
    t("1c", "Tide", "Lossless\\Tide\\01.flac", { bitrate: 900 }),
  ];
  const a = groupAlbums(songs);
  assert.equal(a.length, 3);
  assert.deepEqual(a.map((x) => x.tracks.length), [2, 2, 1]);
  assert.deepEqual(a.map((x) => x.label), ["MP3 128k", "MP3 320k", "FLAC"]);
});

test("two copies of the same kind are told apart by folder; a lone album gets no label", () => {
  const a = groupAlbums([t("1", "Tide", "Old\\Tide\\01.mp3"), t("1", "Tide", "New\\Tide\\01.mp3"), t("1", "Reef", "Reef\\01.mp3")]);
  assert.deepEqual(a.map((x) => x.label), ["MP3 320k · Old", "MP3 320k · New", undefined], "the part of the path that differs, as it's written");
  const b = groupAlbums([t("1", "Tide", "Old\\01.mp3"), t("1", "Tide", "New\\01.mp3")]);
  assert.deepEqual(b.map((x) => x.label), ["MP3 320k · Old", "MP3 320k · New"]);
  const vbr = groupAlbums([t("1", "Tide", "A\\1.mp3", { bitrate: 288 }), t("1", "Tide", "B\\1.mp3", { bitrate: 318 })]);
  assert.deepEqual(vbr.map((x) => x.label), ["MP3 ~290k", "MP3 320k"]);
});

test("a two-disc set stays one album; a compilation in one folder is one album by various artists", () => {
  const a = groupAlbums([t("1", "Set", "Set\\CD1\\01.mp3"), t("2", "Set", "Set\\CD2\\01.mp3", { artist: "Y" })]);
  assert.equal(a.length, 1);
  assert.equal(a[0].artist, "Various artists");
  const s = groupAlbums([t("1", "", "a\\1.mp3"), t("2", "", "b\\2.mp3")]);
  assert.equal(s.length, 1, "songs with no album are all Singles, as before");
  assert.equal(s[0].name, "Singles");
});
