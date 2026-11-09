import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createLibrary } from "./library.mjs";

const setup = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "library-"));
  const data = path.join(root, "data");
  const texts = path.join(root, "share", "readings");
  fs.mkdirSync(data, { recursive: true });
  fs.mkdirSync(path.join(texts, "class-a"), { recursive: true });
  fs.writeFileSync(path.join(texts, "class-a", "liber-one.json"), JSON.stringify({ title: "Liber One", text: "Every star is a star.\nThe second line." }, null, 1));
  fs.writeFileSync(path.join(texts, "notes.md"), "# Notes\nnothing about stars");
  fs.writeFileSync(path.join(root, "share", "outside.txt"), "a star outside the link");
  return { L: createLibrary({ dataDir: () => data }), texts, root };
};

test("a linked folder reads like the character's own files, and nothing outside it", () => {
  const { L, texts } = setup();
  const l = L.link({ path: texts, name: "A∴A∴ readings" });
  assert.equal(l.name, "A∴A∴ readings");
  assert.deepEqual(L.list("dee", "").map((e) => e.name), ["A∴A∴ readings/"]);
  assert.deepEqual(L.list("dee", "A∴A∴ readings").map((e) => e.name), ["class-a/", "notes.md"]);
  assert.match(L.readFile("dee", "a∴a∴ readings/class-a/liber-one.json"), /Every star/);
  assert.throws(() => L.readFile("dee", "A∴A∴ readings/../outside.txt"), /no file|isn't there|ENOENT/i, "climbing out lands back inside the link");
  assert.throws(() => L.readFile("dee", "elsewhere/x.txt"), /no linked folder called "elsewhere"/);
  const hits = L.search("dee", "star");
  assert.ok(hits.some((h) => h.startsWith("A∴A∴ readings/class-a/liber-one.json:")), hits.join("\n"));
  assert.ok(!hits.some((h) => h.includes("outside")));
});

test("a link for one character is only theirs; linking the same folder again updates it", () => {
  const { L, texts } = setup();
  L.link({ path: texts, name: "texts", for: ["fae"] });
  assert.deepEqual(L.list("dee", ""), []);
  assert.equal(L.list("fae", "").length, 1);
  L.link({ path: texts, name: "texts" });
  assert.equal(L.links().length, 1, "one link per folder");
  assert.equal(L.list("dee", "").length, 1, "now everyone's");
  L.unlink(texts);
  assert.deepEqual(L.links(), []);
});

test("each character keeps her own library: only folders she may serve, numbered, found, checked by SHA-256", async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "pdd-fserve-"));
  const shelf = path.join(d, "models");
  fs.mkdirSync(path.join(shelf, "small"), { recursive: true });
  fs.writeFileSync(path.join(shelf, "small", "tiny-model.gguf"), "weights");
  fs.writeFileSync(path.join(shelf, "README.md"), "# models");
  const secret = path.join(d, "diary");
  fs.mkdirSync(secret);
  fs.writeFileSync(path.join(secret, "private.md"), "no");
  const L = createLibrary({ dataDir: () => d });
  L.link({ path: shelf, name: "Models", for: ["dee"] });
  L.link({ path: secret, name: "Diary", for: ["dee"] });
  assert.deepEqual(L.catalog("dee"), [], "nothing is handed out until a folder is switched on");
  L.setServe(shelf, true);
  assert.deepEqual(L.catalog("dee").map((f) => [f.n, f.rel]), [[1, "README.md"], [2, "small/tiny-model.gguf"]], "the diary stays unshared");
  assert.deepEqual(L.catalog("jade"), [], "her library is hers");
  assert.deepEqual(L.shelves("dee"), [{ name: "Models", count: 2 }]);
  assert.deepEqual(L.find("dee", "TINY gguf").map((f) => f.n), [2]);
  assert.equal(L.catalog("dee")[0].full, undefined, "where it is on disk isn't given out");
  const f = L.pick("dee", "#2");
  assert.equal(await L.sha256(f), crypto.createHash("sha256").update("weights").digest("hex"));
  assert.throws(() => L.pick("dee", 9), /no file with that number/);
  const t = L.ticket(f);
  assert.equal(L.redeem(t).name, "tiny-model.gguf");
  assert.equal(L.redeem("made-up"), null);
});
