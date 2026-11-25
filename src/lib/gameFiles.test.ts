import { test } from "node:test";
import assert from "node:assert/strict";
import { filesForChange, gameSystem, manifestFor, nextVersion, parseGame } from "./gameFiles.ts";

const answer = `Sure! Here it is.
TITLE: **Cat Hop**
NOTE: A cat hops over puddles; tap to jump.
SOUND: sfx/jump.wav | a jump
SOUND: sfx/splash.wav | a splash, game over
PICTURE: art/cat.png | a pixel-art cat
MUSIC: ../music/x.mp3 | sneaky
=== FILE: index.html ===
<!doctype html><script src="game.js"></script>
=== END FILE ===
=== FILE: game.js ===
\`\`\`js
let score = 0;
\`\`\`
=== END FILE ===
=== FILE: ../evil.js ===
x
=== END FILE ===`;

test("her answer becomes the game's files and what it asks to have made", () => {
  const g = parseGame(answer);
  assert.equal(g.title, "Cat Hop");
  assert.match(g.note, /hops over puddles/);
  assert.deepEqual(Object.keys(g.files), ["index.html", "game.js"], "a path climbing out is left out");
  assert.equal(g.files["game.js"], "let score = 0;", "a code fence around a file is taken off");
  assert.deepEqual(g.assets.map((a) => `${a.kind} ${a.path}`), ["sound sfx/jump.wav", "sound sfx/splash.wav", "picture art/cat.png"], "a bad asset path is left out");
});

test("an answer with only a fenced page still gives a game", () => {
  const g = parseGame("TITLE: Tiny\n```html\n<p>hi</p>\n```");
  assert.deepEqual(Object.keys(g.files), ["index.html"]);
});

test("the game as it is, for a change; versions count up", () => {
  const s = filesForChange({ "game.js": "a", "index.html": "b", "manifest.toml": "x", "sfx/jump.wav": "?" });
  assert.match(s, /^=== FILE: index\.html ===\nb\n=== END FILE ===\n=== FILE: game\.js ===/);
  assert.doesNotMatch(s, /manifest|jump/);
  assert.match(filesForChange({ "index.html": "x".repeat(50) }, 10), /cut short/);
  assert.equal(nextVersion(["1", "2", "0.1.0-draft"]), "3");
  assert.equal(nextVersion([]), "1");
  assert.match(manifestFor('A "q"', "2", "d"), /name = "A \\"q\\""/);
});

test("what she's told follows what can be made", () => {
  assert.match(gameSystem("Dee", { pictures: true, music: false }), /PICTURE: art\/cat\.png/);
  assert.match(gameSystem("Dee", { pictures: false, music: false }), /Don't ask for pictures/);
  assert.match(gameSystem("Dee", { pictures: false, music: false }), /^You are Dee/);
});
