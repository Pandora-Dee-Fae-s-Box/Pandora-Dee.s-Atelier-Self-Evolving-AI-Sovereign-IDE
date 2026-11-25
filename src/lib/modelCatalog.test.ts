import { test } from "node:test";
import assert from "node:assert/strict";
import { CATALOG, catalogFor, tierOf } from "./modelCatalog.ts";

test("every model sits in one memory group, and groups come lightest first", () => {
  for (const m of CATALOG) assert.ok(tierOf(m), m.id);
  const music = catalogFor("music");
  assert.deepEqual(music.map((g) => g.label), ["Up to 16 GB", "Up to 32 GB", "48 GB and more"]);
  assert.equal(music[0].models[0].id, "mlx-community/MiniMax-Music3-mxfp4");
});

test("with the engine's memory known, each says whether it fits", () => {
  const groups = catalogFor("music", 24);
  const all = groups.flatMap((g) => g.models);
  assert.equal(all.find((m) => m.id.endsWith("6bit"))?.fits, true);
  assert.equal(all.find((m) => m.id.endsWith("bf16"))?.fits, false);
  assert.equal(catalogFor("music")[0].models[0].fits, null, "unknown memory: no claim either way");
});

test("ids are unique", () => {
  assert.equal(new Set(CATALOG.map((m) => m.id)).size, CATALOG.length);
});
