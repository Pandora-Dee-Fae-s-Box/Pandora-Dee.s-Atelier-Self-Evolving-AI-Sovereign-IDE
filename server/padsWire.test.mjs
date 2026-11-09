import { test } from "node:test";
import assert from "node:assert/strict";
import { createPadsWire } from "./padsWire.mjs";

const conn = () => {
  const c = { got: [], open: true, sendText: (s) => c.got.push(JSON.parse(s)), close: () => { c.open = false; c.onclose?.(); } };
  return c;
};
const pads = { has: (account, id) => account === "mrrowr" && ["deskAAAA1", "laptopBB2"].includes(id) || (account === "other" && id === "strangerC3") };

test("only an account's own devices, and input only where it's allowed", () => {
  const wire = createPadsWire({ pads });
  const desk = conn(), laptop = conn(), stranger = conn(), unknown = conn();
  wire.attach(desk, { account: "mrrowr", device: "deskAAAA1" });
  wire.attach(laptop, { account: "mrrowr", device: "laptopBB2" });
  wire.attach(stranger, { account: "other", device: "strangerC3" });
  wire.attach(unknown, { account: "mrrowr", device: "notInPads9" });
  assert.equal(unknown.open, false);
  assert.deepEqual(wire.connected().sort(), ["deskAAAA1", "laptopBB2", "strangerC3"]);

  // the laptop hasn't allowed control yet: input is refused, other messages pass
  desk.onmessage(JSON.stringify({ type: "to", to: "laptopBB2", ctl: true, ev: { t: "move", dx: 5, dy: 0 } }));
  assert.deepEqual(desk.got.at(-1), { type: "refused", id: "laptopBB2" });
  desk.onmessage(JSON.stringify({ type: "to", to: "laptopBB2", ev: { t: "hello" } }));
  assert.deepEqual(laptop.got.at(-1), { type: "from", from: "deskAAAA1", ctl: false, ev: { t: "hello" } });

  // allowed: input passes, and everyone in the account hears who allows what
  laptop.onmessage(JSON.stringify({ type: "allow", allow: true }));
  assert.deepEqual(desk.got.at(-1), { type: "peers", peers: [{ id: "deskAAAA1", allow: false }, { id: "laptopBB2", allow: true }] });
  desk.onmessage(JSON.stringify({ type: "to", to: "laptopBB2", ctl: true, ev: { t: "move", dx: 5, dy: 0 } }));
  assert.deepEqual(laptop.got.at(-1), { type: "from", from: "deskAAAA1", ctl: true, ev: { t: "move", dx: 5, dy: 0 } });

  // another account's device can't be reached, and can't reach in
  desk.onmessage(JSON.stringify({ type: "to", to: "strangerC3", ev: { t: "hello" } }));
  assert.deepEqual(desk.got.at(-1), { type: "gone", id: "strangerC3" });
  const before = laptop.got.length;
  stranger.onmessage(JSON.stringify({ type: "to", to: "laptopBB2", ctl: true, ev: { t: "move" } }));
  assert.equal(laptop.got.length, before);

  // the laptop's page goes: it leaves the roster
  laptop.close();
  assert.deepEqual(wire.connected().sort(), ["deskAAAA1", "strangerC3"]);
});
