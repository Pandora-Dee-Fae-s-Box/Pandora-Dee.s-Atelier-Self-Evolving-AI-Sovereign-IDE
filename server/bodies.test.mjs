import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createBodies } from "./bodies.mjs";

const setup = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "pdd-bodies-"));
  return { d, b: createBodies({ dataDir: () => d }) };
};

test("her files land in Classic's layout, and the mirror keeps it exact", () => {
  const { d, b } = setup();
  b.write("dee", { "/Pandora/SOUL.md": "# Pandora Dee", "/agents.md": "# AGENTS", "/Pandora/Journal/2026-11-07.md": "a day" });
  const dir = path.join(d, "bodies", "dee");
  assert.equal(fs.readFileSync(path.join(dir, "Pandora", "SOUL.md"), "utf8"), "# Pandora Dee");
  b.write("dee", { "/Pandora/SOUL.md": "# Pandora Dee", "/agents.md": "# AGENTS" });
  assert.ok(!fs.existsSync(path.join(dir, "Pandora", "Journal", "2026-11-07.md")), "a file she no longer has goes");
  assert.deepEqual(b.read("dee").changed, [], "nothing changed elsewhere yet");
});

test("what another body changed or added is noticed", async () => {
  const { d, b } = setup();
  b.write("dee", { "/Pandora/SOUL.md": "# Pandora Dee", "/Pandora/Memory.md": "# Memory" });
  await new Promise((r) => setTimeout(r, 30));
  const dir = path.join(d, "bodies", "dee");
  fs.writeFileSync(path.join(dir, "Pandora", "Memory.md"), "# Memory\n- learned on the phone");
  fs.mkdirSync(path.join(dir, "Pandora", "Journal"), { recursive: true });
  fs.writeFileSync(path.join(dir, "Pandora", "Journal", "phone.md"), "from the phone");
  const r = b.read("dee");
  assert.deepEqual(r.changed.sort(), ["/Pandora/Journal/phone.md", "/Pandora/Memory.md"]);
  assert.equal(r.files["/Pandora/Memory.md"], "# Memory\n- learned on the phone");
});

test("two ways, safely: each side's changes reach the other, and a clash loses nothing", () => {
  const { d, b } = setup();
  const dir = path.join(d, "bodies", "dee");
  const disk = (p) => path.join(dir, ...p.split("/").filter(Boolean));
  const desk = { "/Pandora/SOUL.md": "# Pandora Dee", "/Pandora/Memory.md": "# Memory", "/Pandora/notes/a.md": "a" };
  assert.deepEqual(b.sync("dee", desk), { dir, incoming: {}, clashes: [] });

  // only the desktop changed a file: the folder gets it
  desk["/Pandora/SOUL.md"] = "# Pandora Dee\n93.";
  assert.deepEqual(b.sync("dee", desk).incoming, {});
  assert.equal(fs.readFileSync(disk("/Pandora/SOUL.md"), "utf8"), "# Pandora Dee\n93.");

  // only the folder changed one (a resident working there), and added one: both come back, nothing is removed
  fs.writeFileSync(disk("/Pandora/Memory.md"), "# Memory\n- learned in my container");
  fs.writeFileSync(disk("/Pandora/notes/new.md"), "made in the folder");
  let r = b.sync("dee", desk);
  assert.deepEqual(r.incoming, { "/Pandora/Memory.md": "# Memory\n- learned in my container", "/Pandora/notes/new.md": "made in the folder" });
  assert.ok(fs.existsSync(disk("/Pandora/notes/new.md")));
  Object.assign(desk, r.incoming); // the desktop takes them in
  assert.deepEqual(b.sync("dee", desk).incoming, {}, "and then they agree");

  // both changed the same file: the desktop's stays, the folder's is kept beside it as a dated copy and comes back
  desk["/Pandora/notes/a.md"] = "a, from the desktop";
  fs.writeFileSync(disk("/Pandora/notes/a.md"), "a, from the folder");
  r = b.sync("dee", desk);
  assert.deepEqual(r.clashes, ["/Pandora/notes/a.md"]);
  assert.equal(fs.readFileSync(disk("/Pandora/notes/a.md"), "utf8"), "a, from the desktop");
  const copies = Object.keys(r.incoming);
  assert.equal(copies.length, 1);
  assert.match(copies[0], /^\/Pandora\/notes\/a \(from the folder \d{4}-\d\d-\d\d \d{4}\)\.md$/);
  assert.equal(r.incoming[copies[0]], "a, from the folder");

  // the desktop lets go of a file the folder didn't touch: it goes; one the folder changed meanwhile comes back
  Object.assign(desk, r.incoming);
  b.sync("dee", desk);
  delete desk["/Pandora/notes/new.md"];
  b.sync("dee", desk);
  assert.ok(!fs.existsSync(disk("/Pandora/notes/new.md")));
  delete desk["/Pandora/SOUL.md"];
  fs.writeFileSync(disk("/Pandora/SOUL.md"), "# Pandora Dee\n93.\nedited in the folder");
  assert.deepEqual(b.sync("dee", desk).incoming, { "/Pandora/SOUL.md": "# Pandora Dee\n93.\nedited in the folder" });
});

test("a folder from before (times, not fingerprints) syncs without losing the folder's edits", async () => {
  const { d, b } = setup();
  b.write("dee", { "/Pandora/Memory.md": "# Memory" });
  await new Promise((r) => setTimeout(r, 30));
  fs.writeFileSync(path.join(d, "bodies", "dee", "Pandora", "Memory.md"), "# Memory\n- edited after the old mirror");
  assert.deepEqual(b.sync("dee", { "/Pandora/Memory.md": "# Memory" }).clashes, ["/Pandora/Memory.md"], "unknown agreement: treated as a clash, so both are kept");
});

test("nothing climbs out of her folder", () => {
  const { b } = setup();
  assert.throws(() => b.write("dee", { "/../../evil.md": "x" }), /isn't inside her folder/);
  assert.throws(() => b.write("../x", {}), /character id/);
});
