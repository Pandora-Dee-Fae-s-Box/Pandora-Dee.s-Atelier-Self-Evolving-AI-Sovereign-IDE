import test from "node:test";
import assert from "node:assert/strict";
import { allowed, askingPkg, fetchFor } from "./appNet.mjs";

const COURSE = "https://raw.githubusercontent.com/lucky-edgelord/Lilith-Learning-Lab/main/courses/catalog.json";

test("only the Learning Lab, and only course files from a repository's courses/ folder", () => {
  assert.equal(allowed("lilith-learning-lab", COURSE), true);
  assert.equal(allowed("lilith-learning-lab", "https://raw.githubusercontent.com/someone/their-courses/main/courses/music.json"), true);
  assert.equal(allowed("vexel", COURSE), false);
  assert.equal(allowed("lilith-learning-lab", "https://raw.githubusercontent.com/a/b/main/secrets/keys.json"), false);
  assert.equal(allowed("lilith-learning-lab", "https://raw.githubusercontent.com/a/b/main/courses/../x.json"), false);
  assert.equal(allowed("lilith-learning-lab", `${COURSE}?leak=1`), false);
  assert.equal(allowed("lilith-learning-lab", "https://example.com/main/courses/x.json"), false);
  assert.equal(allowed("lilith-learning-lab", "http://raw.githubusercontent.com/a/b/main/courses/x.json"), false);
  assert.equal(allowed("lilith-learning-lab", "not a url"), false);
});

test("the asking app comes from its page's address", () => {
  assert.equal(askingPkg("http://127.0.0.1:15695/run/abc123/index.html?scope=x"), "abc123");
  assert.equal(askingPkg("http://127.0.0.1:15695/games/x/index.html"), null);
  assert.equal(askingPkg(""), null);
});

test("refused addresses aren't fetched at all", async () => {
  let called = false;
  const r = await fetchFor("vexel", COURSE, async () => {
    called = true;
    return new Response("{}");
  });
  assert.equal(r.status, 403);
  assert.equal(called, false);
  const ok = await fetchFor("lilith-learning-lab", COURSE, async () => new Response('{"format":"lilith-catalog"}'));
  assert.equal(ok.status, 200);
  assert.match(ok.text, /lilith-catalog/);
});
