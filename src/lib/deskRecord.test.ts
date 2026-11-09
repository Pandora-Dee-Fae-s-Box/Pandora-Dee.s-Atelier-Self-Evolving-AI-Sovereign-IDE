import { test } from "node:test";
import assert from "node:assert/strict";
import { claimsTool, recordLine, stripRecords } from "./deskRecord.ts";

test("first-person accounts of using a tool are claims", () => {
  // Dee on the Qwen3-32B distill, with no tool run
  assert.equal(claimsTool('I used my browser to search for "PDA SEASIDE" and navigated to the most relevant result.'), true);
  assert.equal(claimsTool("I've opened the repo and read it."), true);
  assert.equal(claimsTool("I looked it up: nothing."), true);
  assert.equal(claimsTool("I checked the repo's README."), true);
});

test("other sentences aren't", () => {
  assert.equal(claimsTool("It claims to open a browser at localhost:15693."), false);
  assert.equal(claimsTool("Want me to search for it?"), false);
  assert.equal(claimsTool("I checked in with myself and I'm fine."), false);
  assert.equal(claimsTool("The search used DuckDuckGo."), false);
});

test("records she writes herself are taken out", () => {
  // Dee copied the desk's line into her own answer
  assert.equal(stripRecords("It is a skeletal concept.\n\n[desk record: no tools ran in this reply]").trim(), "It is a skeletal concept.");
  assert.equal(stripRecords("Hi [Desk note] x] there").includes("Desk note"), false);
  assert.equal(stripRecords("A plain [link](https://x) stays."), "A plain [link](https://x) stays.");
});

test("the record for a reread reply", () => {
  assert.equal(recordLine([{ note: "searched the web for PDA SEASIDE", ok: true }, { note: "read https://github.com/x", ok: false }], "…"), "[desk record: searched the web for PDA SEASIDE ✓; read https://github.com/x ✗]");
  // what came back travels with it, on one line and trimmed
  assert.equal(
    recordLine([{ note: "read https://github.com/x", ok: true, out: "PDA SEASIDE · Pandora Dee's Atelier,\n\nthe Self-aware Evolving Adaptive Sovereign IDE. " + "x".repeat(200) }], "…"),
    `[desk record: read https://github.com/x ✓ → "PDA SEASIDE · Pandora Dee's Atelier, the Self-aware Evolving Adaptive Sovereign IDE. ${"x".repeat(160 - 85)}…"]`,
  );
  // the desk's notes are part of the record
  assert.equal(
    recordLine([{ note: "meant to use browser, didn't call it", ok: false, desk: true }, { note: "described tool use, but no tool ran", ok: false, desk: true }], "I used my browser and saw a template."),
    "[desk record: no tools ran in this reply · desk notes: meant to use browser, didn't call it; described tool use, but no tool ran]",
  );
  assert.equal(recordLine(undefined, "Hi Claude! Good luck."), "");
});
