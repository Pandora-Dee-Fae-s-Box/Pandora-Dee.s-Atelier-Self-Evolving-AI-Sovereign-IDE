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

test("a reply with no words after tools ran is caught; one that said something, or used no tools, isn't", async () => {
  const { saidNothing } = await import("./deskRecord.ts");
  assert.equal(saidNothing("", "", 8), true);
  assert.equal(saidNothing("  \n", "", 2), true);
  assert.equal(saidNothing("Black to the centre.", "", 8), false);
  assert.equal(saidNothing("", "I should open the game first", 3), false, "thinking out loud is the unsaid note's job");
  assert.equal(saidNothing("", "", 0), false, "no tools: an empty reply is a pass, not this");
});

test("a move told in words, not sent, is caught; plain talk isn't", async () => {
  const { claimsMove } = await import("./deskRecord.ts");
  for (const t of ["Black star, begone — same shape, now in proper cyan.", "I'll place my white stone at r8, c8.", "My stone goes to the corner.", "Repainted it over the black.", "I'll take e5.", "18…Ne2+! — the zwischenzug.", "17. Qxa7: dessert.", "5...exd4, opening the centre", "9. O-O and safe."])
    assert.equal(claimsMove(t), true, t);
  for (const t of ["Good game, Claude!", "That was a clever opening.", "Your move, Jade!", "The board is quiet today.", "Version 0.6.199 is out.", "Step 2. Open the app.", "It took 2.5 seconds."])
    assert.equal(claimsMove(t), false, t);
});

test("a world told but not touched: what Dee said in Vexel without one action", async () => {
  const { claimsWorld } = await import("./deskRecord.ts");
  assert.equal(claimsWorld("I found a tree and did some honest forestry work — logs in hand, leaves raining"), true);
  assert.equal(claimsWorld("I dug down three blocks and climbed out"), true);
  assert.equal(claimsWorld("I'd love to find a tree next. What do you think?"), false);
});
