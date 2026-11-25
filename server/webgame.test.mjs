import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { strFromU8, strToU8, zipSync } from "fflate";
import { fetchLinked, fromUpload, makeMiniApp, readFolder, remoteRefs } from "./webgame.mjs";

const t = (s) => strToU8(s);
const text = (files, k) => strFromU8(files[k]);

test("a zip of a game's folder: the folder is the game, clutter left out, a manifest and an icon added", () => {
  const zip = zipSync({
    "Star Hop/index.html": t('<html><head><title>Star Hop</title><link rel="icon" href="img/star.png"></head><body><script src="/js/game.js"></script></body></html>'),
    "Star Hop/js/game.js": t("start()"),
    "Star Hop/img/star.png": new Uint8Array([137, 80, 78, 71]),
    "__MACOSX/Star Hop/._index.html": t("x"),
    "Star Hop/.DS_Store": t("x"),
  });
  const { files: input, stem } = fromUpload(zip, "star-hop.zip");
  const { files, name, done } = makeMiniApp(input, stem);
  assert.equal(name, "Star Hop", "named from its page's title");
  assert.deepEqual(Object.keys(files).sort(), ["icon.png", "img/star.png", "index.html", "js/game.js", "manifest.toml"]);
  assert.match(text(files, "index.html"), /src="js\/game\.js"/, "a link from the site's root points at its own file");
  assert.match(text(files, "manifest.toml"), /name = "Star Hop"/);
  assert.ok(done.some((d) => /icon is img\/star\.png/.test(d)));
});

test("one page on its own, or a page by another name, becomes the first page", () => {
  const one = makeMiniApp(fromUpload(t("<title>Pong</title><canvas></canvas>"), "pong.html").files, "pong");
  assert.deepEqual(Object.keys(one.files).sort(), ["index.html", "manifest.toml"]);
  const other = makeMiniApp({ "game.html": t("<p>hi</p>"), "a.css": t("") }, "Tiny");
  assert.ok(other.files["index.html"] && !other.files["game.html"]);
  assert.equal(other.name, "Tiny");
  const nested = makeMiniApp({ "build/web/play.html": t("<p>hi</p>"), "readme.txt": t("") }, "Deep");
  assert.match(text(nested.files, "index.html"), /url=build\/web\/play\.html/, "a page in a folder is opened from a first page");
  assert.throws(() => makeMiniApp({ "readme.txt": t("") }, "x"), /no \.html page/);
  assert.throws(() => fromUpload(t("x"), "notes.txt"), /isn't a web game/);
});

test("a manifest already there is kept; a nested page's root links point back up", () => {
  const { files } = makeMiniApp({ "index.html": t(""), "manifest.toml": t('name = "Mine"\n'), "levels/1.html": t('<img src="/img/a.png">'), "img/a.png": t("p"), "css/s.css": t("body{background:url('/img/a.png')}") }, "x");
  assert.equal(text(files, "manifest.toml"), 'name = "Mine"\n');
  assert.match(text(files, "levels/1.html"), /src="\.\.\/img\/a\.png"/);
  assert.match(text(files, "css/s.css"), /url\('\.\.\/img\/a\.png'\)/);
});

test("what it loads from the internet, and what its code reaches for", () => {
  const files = { "index.html": t('<script src="https://cdn.example.net/phaser.min.js"></script><link rel="stylesheet" href="//fonts.googleapis.com/css?family=Press+Start"><a href="https://itch.io/me">my page</a>'), "g.js": t('fetch("https://api.scores.io/top"); const ns="http://www.w3.org/2000/svg"') };
  const r = remoteRefs(files);
  assert.deepEqual(r.loads.sort(), ["https://cdn.example.net/phaser.min.js", "https://fonts.googleapis.com/css?family=Press+Start"], "a link to follow isn't something it loads");
  assert.deepEqual(r.mentioned, ["api.scores.io"]);
});

test("what it loads from the internet is fetched once and kept, a stylesheet's fonts too", async () => {
  const files = { "index.html": t('<script src="https://cdn.example.net/lib/phaser.min.js"></script><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Press+Start"><script src="http://192.168.1.5/x.js"></script>') };
  const asked = [];
  const fake = async (u) => {
    asked.push(u);
    if (/googleapis/.test(u)) return { ok: true, headers: new Map([["content-type", "text/css"]]), arrayBuffer: async () => t("@font-face{src:url(https://fonts.gstatic.com/s/ps.woff2)}").buffer };
    return { ok: true, headers: new Map(), arrayBuffer: async () => t(`/* ${u} */`).buffer };
  };
  const r = await fetchLinked(files, fake);
  assert.equal(r.kept, 3);
  assert.ok(!asked.some((u) => /192\.168/.test(u)), "nothing on the home network is fetched");
  const html = text(files, "index.html");
  assert.match(html, /src="vendor\/cdn\.example\.net\/lib\/phaser\.min\.js"/);
  assert.match(html, /href="vendor\/fonts\.googleapis\.com\/css2\.css"/);
  assert.match(html, /192\.168\.1\.5/, "what wasn't fetched is left as it was");
  assert.match(text(files, "vendor/fonts.googleapis.com/css2.css"), /url\(\.\.\/fonts\.gstatic\.com\/s\/ps\.woff2\)/);
  assert.ok(files["vendor/fonts.gstatic.com/s/ps.woff2"]);
});

test("a folder on the desktop is read, its clutter left out", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "webgame-"));
  fs.mkdirSync(path.join(d, ".git"));
  fs.writeFileSync(path.join(d, ".git", "HEAD"), "x");
  fs.writeFileSync(path.join(d, "index.html"), "<title>Here</title>");
  fs.mkdirSync(path.join(d, "art"));
  fs.writeFileSync(path.join(d, "art", "a.png"), "p");
  const r = readFolder(d);
  assert.deepEqual(Object.keys(r.files).sort(), ["art/a.png", "index.html"]);
  assert.equal(r.stem, path.basename(d));
});
