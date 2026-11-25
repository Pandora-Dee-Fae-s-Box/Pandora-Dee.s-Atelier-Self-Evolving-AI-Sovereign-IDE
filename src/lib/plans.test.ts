import test from "node:test";
import assert from "node:assert/strict";
import { applyPlan, plansLine } from "./plans.ts";

test("a plan goes on the table, is revised by someone else, then kept", () => {
  let r = applyPlan([], { do: "add", by: "Dee", text: "On my turn, if the frost reaches column 3, I'll cover the pumpkins", id: "p1", at: 0 });
  assert.match(r.said, /p1/);
  r = applyPlan(r.list, { do: "revise", id: "p1", by: "Claude", text: "Cover the pumpkins with the fleece, not a cloche", at: 120_000 });
  assert.equal(r.list[0].revisedBy, "Claude");
  assert.match(plansLine(r.list, 180_000), /\[p1\] Dee: "Cover the pumpkins with the fleece, not a cloche" \(3 min ago, revised by Claude\)/);
  r = applyPlan(r.list, { do: "done", id: "p1", by: "Dee" });
  assert.equal(r.list[0].status, "done");
  assert.equal(plansLine(r.list), "");
});

test("a plan can be named by a few of its words; an unknown one says what's on the table", () => {
  let r = applyPlan([], { do: "add", by: "Jade", text: "Wake Dusk before Gloam", id: "p2", at: 0 });
  r = applyPlan(r.list, { do: "cancel", id: "dusk before", by: "Dee" });
  assert.equal(r.list[0].status, "cancelled");
  r = applyPlan(r.list, { do: "cancel", id: "p9", by: "Dee" });
  assert.match(r.said, /no open plan "p9"/);
  assert.match(applyPlan([], { do: "add", by: "Dee", text: "  " }).said, /Say what/);
});
