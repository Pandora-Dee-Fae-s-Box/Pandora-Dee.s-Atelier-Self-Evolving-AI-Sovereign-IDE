import { test } from "node:test";
import assert from "node:assert/strict";
import { applySections, extraIn, hasOwnStuff, keepsWhenAbsent, mergeMessages, toSections } from "./deskSections.ts";

test("the shared desk in sections: each character's files apart, the device's layout left out", () => {
  const state = { wins: { room: { x: 1 } }, uiScale: 1.2, model: { tools: true }, files: { dee: { "SOUL.md": "# Dee" }, jade: { "SOUL.md": "# Jade" } }, chats: [], set: () => 0 };
  assert.deepEqual(toSections(state), { model: { tools: true }, "files:dee": { "SOUL.md": "# Dee" }, "files:jade": { "SOUL.md": "# Jade" }, chats: [] });
});

test("sections laid back in keep this device's own parts", () => {
  const mine = { wins: { room: { x: 9 } }, uiScale: 0.9, model: { tools: false }, files: { dee: { "SOUL.md": "old" } } };
  const next = applySections(mine, { model: { tools: true }, "files:dee": { "SOUL.md": "# Dee" }, "files:noe": { "SOUL.md": "# Noe" }, wins: { room: { x: 1 } } });
  assert.deepEqual(next.wins, { room: { x: 9 } }, "a shared section never moves this device's windows");
  assert.equal(next.uiScale, 0.9);
  assert.deepEqual(next.model, { tools: true });
  assert.deepEqual(next.files, { dee: { "SOUL.md": "# Dee" }, noe: { "SOUL.md": "# Noe" } });
  assert.deepEqual(applySections(next, { "files:noe": null }).files, { dee: { "SOUL.md": "# Dee" } }, "null removes a character's files");
});

test("only what the shared desk doesn't have counts", () => {
  const shared = { custom: [{ id: "forge" }], chats: [{ id: "c1" }], env: { A: "" }, "files:dee": { "SOUL.md": "# Dee" } };
  assert.equal(extraIn({ custom: [{ id: "forge" }], chats: [{ id: "c1" }], env: { A: "x" }, files: { dee: { "SOUL.md": "# Dee" } } }, shared), 0, "the same desk: nothing to ask about");
  assert.equal(extraIn({ custom: [{ id: "phonefriend" }], chats: [{ id: "c9" }], env: { B: "y" }, files: { dee: { "SOUL.md": "# Dee, on the phone" } } }, shared), 4);
});

test("a desk worth asking about", () => {
  assert.equal(hasOwnStuff({ wins: {}, model: {} }), false);
  assert.equal(hasOwnStuff({ chats: [{ id: "c" }] }), true);
  assert.equal(hasOwnStuff({ custom: [{ id: "x" }] }), true);
  assert.equal(hasOwnStuff({ env: { KEY: "v" } }), true);
});

const m = (id: string, at: number, text = id, v?: number) => ({ id, at, text, ...(v ? { v } : {}) });

test("the Home room is the sections it always was; another room is one section of its own", () => {
  const talk = { messages: [m("a", 1)], members: ["dee"], chatId: "c1", gone: [], focus: "dee", model: {} };
  assert.deepEqual(Object.keys(toSections(talk)).sort(), ["chatId", "gone", "members", "messages", "model"]);
  const phone = toSections({ ...talk, roomId: "phone1", roomTabs: ["phone1"] });
  assert.deepEqual(Object.keys(phone).sort(), ["model", "room:phone1"]);
  assert.deepEqual(phone["room:phone1"], { messages: [m("a", 1)], members: ["dee"], chatId: "c1", gone: [] });
  assert.ok(keepsWhenAbsent("room:pc") && keepsWhenAbsent("messages") && !keepsWhenAbsent("files:dee"));
});

test("a device takes in only the room it's in", () => {
  const sections = { messages: [m("home", 1)], members: ["dee"], chatId: "c1", "room:phone1": { messages: [m("ph", 2)], members: ["jade"], chatId: "c9" } };
  const atHome = applySections({ chatId: "c1", messages: [] }, sections);
  assert.deepEqual([atHome.messages, atHome.members], [[m("home", 1)], ["dee"]]);
  const onPhone = applySections({ roomId: "phone1", chatId: "c9", messages: [] }, sections);
  assert.deepEqual([onPhone.messages, onPhone.members, onPhone.chatId], [[m("ph", 2)], ["jade"], "c9"]);
  assert.equal(onPhone["room:phone1"], undefined, "no stray keys");
});

test("two devices talking in one room at once both keep what they said; removals stay removed", () => {
  const before = [m("x", 1), m("y", 2)];
  const mine = [...before, m("a", 3)];
  const theirs = [...before, m("b", 4)];
  assert.deepEqual(mergeMessages(mine, theirs).map((x) => x.id), ["x", "y", "a", "b"]);
  assert.deepEqual(mergeMessages(mine, [m("x", 1)], ["y"]).map((x) => x.id), ["x", "a"], "y was removed over there");
  // a reply still being written here isn't set back by an older copy
  assert.equal(mergeMessages([m("r", 5, "Hello there, friend", 9)], [m("r", 5, "Hel", 2)])[0].text, "Hello there, friend");
  // another branch comes in whole, not merged
  const other = applySections({ chatId: "c1", messages: mine }, { chatId: "c2", messages: [m("new", 9)] });
  assert.deepEqual((other.messages as { id: string }[]).map((x) => x.id), ["new"]);
});

test("who's signed in and an unlocked adult shelf stay on the device: never sent, never taken in", () => {
  const out = toSections({ session: "Technomancer", adultOpen: true, sensorPass: true, busy: { dee: "typing" }, toast: "hi", game: null, model: {} });
  assert.deepEqual(Object.keys(out), ["model"]);
  const next = applySections({ adultOpen: false, session: null }, { adultOpen: true, session: "someone", sensorPass: true, toast: "x" });
  assert.equal(next.adultOpen, false);
  assert.equal(next.session, null);
  assert.equal(next.sensorPass, undefined);
});
