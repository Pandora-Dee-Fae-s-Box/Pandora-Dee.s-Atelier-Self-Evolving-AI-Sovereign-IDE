import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDeskState } from "./deskState.mjs";

// a stand-in for the vault's sealing: reversible, and visibly not plain JSON on disk
const seal = (o) => `SEALED:${Buffer.from(JSON.stringify(o)).toString("base64")}`;
const open = (t) => JSON.parse(Buffer.from(String(t).replace(/^SEALED:/, ""), "base64").toString("utf8"));
const setup = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "pdd-desk-"));
  let t = 1000;
  return { d, s: createDeskState({ dataDir: () => d, seal, open, now: () => ++t }) };
};

test("founded from the desktop's own computer, kept sealed, read back by revision", () => {
  const { d, s } = setup();
  assert.equal(s.get().empty, true);
  assert.throws(() => s.put({ device: "phone", changes: { model: { a: 1 } } }), /started from the desktop's own computer/);
  const r = s.put({ device: "pc", changes: { model: { a: 1 }, "files:dee": { "SOUL.md": "# Dee" } } }, { mayFound: true });
  assert.equal(r.rev, 2);
  assert.match(fs.readFileSync(path.join(d, "desk", "state.sealed"), "utf8"), /^SEALED:/);
  const all = s.get();
  assert.deepEqual(Object.keys(all.sections).sort(), ["files:dee", "model"]);
  // after founding, any device may save
  s.put({ device: "phone", base: { model: 1 }, changes: { privacy: { mode: "none" } } });
  assert.deepEqual(Object.keys(s.get(2).sections), ["privacy"], "only what changed after revision 2");
  // a fresh server instance reads the sealed file
  const again = createDeskState({ dataDir: () => d, seal, open });
  assert.equal(again.get().rev, 3);
});

test("the same section changed on two devices: the later stands, and it's reported", () => {
  const { s } = setup();
  s.put({ device: "pc", changes: { people: { names: ["A"] } } }, { mayFound: true });
  const seen = s.get().sections.people.rev;
  s.put({ device: "pc", base: { people: seen }, changes: { people: { names: ["A", "B"] } } });
  // the phone still thinks it's at the first revision
  const r = s.put({ device: "phone", base: { people: seen }, changes: { people: { names: ["A", "C"] } } });
  assert.deepEqual(r.clashes, [{ section: "people", with: "pc" }]);
  assert.deepEqual(s.get().sections.people.value, { names: ["A", "C"] });
  // no clash with oneself, and null removes a section
  assert.deepEqual(s.put({ device: "phone", base: { people: 0 }, changes: { people: null } }).clashes, []);
  assert.equal(s.get().sections.people, undefined);
});

test("a device's old desk is kept with its keys blanked", () => {
  const { d, s } = setup();
  const blob = JSON.stringify({ state: { env: { OPENAI_API_KEY: "sk-test-not-real" }, custom: [{ id: "x" }] } });
  const { kept } = s.keepLegacy("Android phone", blob);
  const text = fs.readFileSync(path.join(d, "desk", "devices", kept), "utf8");
  assert.ok(!text.includes("sk-test-not-real"));
  assert.deepEqual(JSON.parse(text).state.env, { OPENAI_API_KEY: "" });
  assert.equal(s.legacyList()[0].name, kept);
  assert.throws(() => s.legacyRead("../state.sealed"), /Which one/);
});

test("a room's stale copy isn't written over a newer one: the device is told, to merge and send again", () => {
  const { s } = setup();
  s.put({ device: "pc", changes: { "room:a": { messages: [1] }, model: {} } }, { mayFound: true });
  const seen = s.get().sections["room:a"].rev;
  s.put({ device: "phone", base: { "room:a": seen }, changes: { "room:a": { messages: [1, 2] } } });
  const r = s.put({ device: "pc", base: { "room:a": seen }, changes: { "room:a": { messages: [1, 3] }, model: { x: 1 } }, merge: ["room:a"] });
  assert.deepEqual(r.stale, ["room:a"]);
  assert.deepEqual(r.clashes, []);
  assert.deepEqual(s.get().sections["room:a"].value, { messages: [1, 2] }, "the phone's copy stays until the merged one comes");
  assert.deepEqual(s.get().sections.model.value, { x: 1 }, "the rest of the save goes in");
});
