import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createTheater } from "./theater.mjs";

const vault = fs.mkdtempSync(path.join(os.tmpdir(), "theater-"));
const T = createTheater({ vaultDir: () => vault });
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const video = Buffer.from(Array.from({ length: 2500 }, (_, i) => i % 251));
const pieces = [video.subarray(0, 1000), video.subarray(1000, 2000), video.subarray(2000)];
const job = { shelf: "Kai's films", name: "skate.mp4", size: video.length, modified: Date.UTC(2026, 5, 1) };

test("an upload comes in pieces, refuses a damaged one, and carries on after a break", () => {
  assert.deepEqual(T.uploadPiece({ ...job, offset: 0, sha256: sha(pieces[0]) }, pieces[0]), { have: 1000, done: false, path: null });
  assert.throws(() => T.uploadPiece({ ...job, offset: 1000, sha256: sha(pieces[0]) }, pieces[1]), /damaged/);
  // the connection dropped: the phone asks where it got to
  assert.deepEqual(T.uploadState(job), { have: 1000 });
  // a piece sent twice is ignored, not appended
  assert.equal(T.uploadPiece({ ...job, offset: 0, sha256: sha(pieces[0]) }, pieces[0]).have, 1000);
  T.uploadPiece({ ...job, offset: 1000, sha256: sha(pieces[1]) }, pieces[1]);
  const end = T.uploadPiece({ ...job, offset: 2000, sha256: sha(pieces[2]) }, pieces[2]);
  assert.equal(end.done, true);
  assert.equal(end.path, path.join(vault, "Videos", "Kai's films", "skate.mp4"));
  assert.deepEqual(fs.readFileSync(end.path), video);
  // it keeps the phone's own date
  assert.equal(new Date(fs.statSync(end.path).mtimeMs).getUTCMonth(), 5);
});

test("only videos are taken, and names can't climb out", () => {
  assert.throws(() => T.uploadPiece({ ...job, name: "notes.txt", offset: 0 }, pieces[0]), /isn't a video/);
  const r = T.uploadPiece({ ...job, shelf: "../../escape", name: "../x.mp4", size: 10, offset: 0 }, Buffer.alloc(10));
  assert.ok(r.path.startsWith(path.join(vault, "Videos") + path.sep), r.path);
});

test("the list has shelves, the phone's share-menu videos, and knows what's kept already", () => {
  fs.mkdirSync(path.join(vault, "From devices"), { recursive: true });
  fs.writeFileSync(path.join(vault, "From devices", "shared.MOV"), "1234567");
  fs.writeFileSync(path.join(vault, "From devices", "photo.jpg"), "not a video");
  const l = T.list();
  assert.deepEqual(l.shelves, ["escape", "Kai's films", "From devices"]);
  assert.deepEqual(l.videos.map((v) => v.name).sort(), ["shared", "skate", "x"]);
  const skate = l.videos.find((v) => v.name === "skate");
  assert.equal(skate.shelf, "Kai's films");
  assert.deepEqual(
    T.have([
      { name: "SKATE.mp4", size: video.length },
      { name: "skate.mp4", size: 99 },
      { name: "other.mp4", size: 7 },
    ]).map(Boolean),
    [true, false, false],
  );
});

test("favourites and thumbnails follow a video when it moves shelf", () => {
  const skate = T.list().videos.find((v) => v.name === "skate");
  T.setFav(skate.id, true);
  T.setThumb(skate.id, Buffer.from([0xff, 0xd8, 0xff, 0xd9]), 12.34);
  const moved = T.moveTo(skate.path, "Best");
  assert.equal(moved, path.join(vault, "Videos", "Best", "skate.mp4"));
  const again = T.list().videos.find((v) => v.name === "skate");
  assert.equal(again.shelf, "Best");
  assert.equal(again.fav, true);
  assert.equal(again.thumb, 1);
  assert.equal(again.seconds, 12.3);
  assert.throws(() => T.setThumb(skate.id, Buffer.from("png?"), 0), /JPEG/);
  assert.throws(() => T.moveTo(path.join(vault, "elsewhere.mp4"), "Best"), /isn't there/);
});

test("playlists: made, named, ordered, and shared through the library list", () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "theater-pl-"));
  const T = createTheater({ vaultDir: () => vault });
  fs.mkdirSync(path.join(vault, "Videos"), { recursive: true });
  for (const n of ["a", "b", "c"]) fs.writeFileSync(path.join(vault, "Videos", `${n}.mp4`), n.repeat(10 + n.charCodeAt(0)));
  const ids = T.list().videos.map((v) => v.id);
  assert.throws(() => T.savePlaylist({ name: "  ", items: [] }), /needs a name/);
  const p = T.savePlaylist({ name: "Saturday  cartoons", items: [ids[2], ids[0], ids[0], "../bad"] });
  assert.equal(p.name, "Saturday cartoons");
  assert.deepEqual(p.items, [ids[2], ids[0]]);
  T.savePlaylist({ id: p.id, items: [ids[0], ids[1], ids[2]] });
  T.savePlaylist({ id: p.id, name: "Cartoons" });
  const listed = T.list().playlists;
  assert.equal(listed.length, 1);
  assert.equal(listed[0].name, "Cartoons");
  assert.deepEqual(listed[0].items, [ids[0], ids[1], ids[2]]);
  T.dropPlaylist(p.id);
  assert.equal(T.list().playlists.length, 0);
});

test("a watched folder is a shelf of its own, read in the background, and left as it is", async () => {
  const away = fs.mkdtempSync(path.join(os.tmpdir(), "watched-"));
  fs.mkdirSync(path.join(away, "Films", "1999"), { recursive: true });
  fs.writeFileSync(path.join(away, "Films", "1999", "matrix.mkv"), "x".repeat(10));
  fs.writeFileSync(path.join(away, "readme.txt"), "not a video");
  const wv = fs.mkdtempSync(path.join(os.tmpdir(), "theater-w-"));
  const W = createTheater({ vaultDir: () => wv });
  const f = W.addFolder(away, "Movies");
  assert.equal(f.name, "Movies");
  assert.equal(W.addFolder(away, "Movies").name, "Movies", "the same folder again: still one shelf");
  await new Promise((r) => setTimeout(r, 200));
  const l = W.list();
  assert.ok(l.shelves.includes("Movies"));
  assert.deepEqual(l.scanning, []);
  const v = l.videos.find((x) => x.name === "matrix");
  assert.ok(v && v.watched && v.shelf === "Movies", JSON.stringify(l.videos));
  assert.equal(W.owns(v.path), null, "a watched folder's video isn't the Theater's to move or delete");
  W.dropFolder(away);
  assert.ok(!W.list().shelves.includes("Movies"));
  assert.ok(fs.existsSync(path.join(away, "Films", "1999", "matrix.mkv")), "the folder stays where it was");
});

test("videos know their show and season folder; collections keep shows in an order of their own", () => {
  const v = fs.mkdtempSync(path.join(os.tmpdir(), "theater-c-"));
  const C = createTheater({ vaultDir: () => v });
  for (const s of ["Season 1", "Season 2", "Season 10"]) {
    fs.mkdirSync(path.join(v, "Videos", "Kids", "SpongeBob", s), { recursive: true });
    fs.writeFileSync(path.join(v, "Videos", "Kids", "SpongeBob", s, `ep ${s}.mp4`), s);
  }
  const l = C.list();
  assert.deepEqual(l.videos.filter((x) => x.shelf === "Kids").map((x) => x.folder).sort(), ["SpongeBob/Season 1", "SpongeBob/Season 10", "SpongeBob/Season 2"]);
  const kids = C.saveCollection({ name: "Kids", items: ["Kids/SpongeBob"] });
  const films = C.saveCollection({ name: "Films", items: [] });
  C.saveCollection({ id: films.id, at: 0 });
  assert.deepEqual(C.list().collections.map((c) => c.name), ["Films", "Kids"], "moved to the front");
  C.saveCollection({ id: kids.id, items: ["Kids/Bluey", "Kids/SpongeBob"] });
  assert.deepEqual(C.list().collections[1].items, ["Kids/Bluey", "Kids/SpongeBob"]);
  C.dropCollection(films.id);
  assert.deepEqual(C.list().collections.map((c) => c.name), ["Kids"]);
});

test("a shelf, or a show on one, added to another shelf; shelves renamed; where a shelf came from", () => {
  const v = fs.mkdtempSync(path.join(os.tmpdir(), "theater-s-"));
  const S = createTheater({ vaultDir: () => v });
  S.mkShelf("Elsa stuff", "Mia's Android phone");
  fs.mkdirSync(path.join(v, "Videos", "Elsa stuff", "Songs"), { recursive: true });
  fs.writeFileSync(path.join(v, "Videos", "Elsa stuff", "Songs", "let it go.mp4"), "a");
  S.mkShelf("Kids");
  const c = S.saveCollection({ name: "Kids", items: ["Elsa stuff/Songs"] });
  assert.equal(S.list().from["Elsa stuff"], "Mia's Android phone");
  assert.deepEqual(S.addToShelf("Elsa stuff", "", "Kids"), { shelf: "Kids", folder: "Elsa stuff" });
  const l = S.list();
  assert.deepEqual(l.videos.map((x) => [x.shelf, x.folder]), [["Kids", "Elsa stuff/Songs"]]);
  assert.deepEqual(l.collections.find((x) => x.id === c.id).items, ["Kids/Elsa stuff/Songs"], "collections follow");
  assert.deepEqual(l.from, { "Kids/Elsa stuff": "Mia's Android phone" }, "where it came from follows");
  assert.throws(() => S.addToShelf("Kids", "Elsa stuff", "Kids"), /already/);
  assert.deepEqual(S.addToShelf("Kids", "Elsa stuff", ""), { shelf: "Elsa stuff", folder: "" }, "back to a shelf of its own");
  assert.deepEqual(S.renameShelf("Elsa stuff", "Frozen"), { shelf: "Frozen" });
  assert.deepEqual(S.list().from, { Frozen: "Mia's Android phone" });
  assert.deepEqual(S.list().videos.map((x) => [x.shelf, x.folder]), [["Frozen", "Songs"]]);
  assert.throws(() => S.renameShelf("Frozen", "Kids"), /already/);
  assert.throws(() => S.addToShelf("Frozen", "../..", "Kids"), /Which folder/);
});

test("a show folder renamed where it is; collections follow", () => {
  const v = fs.mkdtempSync(path.join(os.tmpdir(), "theater-r-"));
  const R = createTheater({ vaultDir: () => v });
  fs.mkdirSync(path.join(v, "Videos", "Kids", "spongebob stuff", "Season 1"), { recursive: true });
  fs.writeFileSync(path.join(v, "Videos", "Kids", "spongebob stuff", "Season 1", "ep.mp4"), "a");
  const c = R.saveCollection({ name: "Kids", items: ["Kids/spongebob stuff"] });
  assert.deepEqual(R.renameFolder("Kids", "spongebob stuff", "SpongeBob"), { folder: "SpongeBob" });
  assert.deepEqual(R.list().videos.map((x) => x.folder), ["SpongeBob/Season 1"]);
  assert.deepEqual(R.list().collections.find((x) => x.id === c.id).items, ["Kids/SpongeBob"]);
  assert.deepEqual(R.renameFolder("Kids", "SpongeBob/Season 1", "Season 01"), { folder: "SpongeBob/Season 01" });
  assert.throws(() => R.renameFolder("Kids", "../x", "y"), /Which folder/);
});
