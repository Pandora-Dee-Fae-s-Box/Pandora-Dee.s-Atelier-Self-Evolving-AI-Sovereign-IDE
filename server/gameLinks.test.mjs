import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createGameLinks, guestScope } from "./gameLinks.mjs";

// a library kept in memory: just enough for game links
function memLibrary(pkgs = []) {
  const logs = new Map();
  const list = [...pkgs];
  return {
    get: (id) => list.find((p) => p.id === id),
    readUpdates: (scope, since = 0) => (logs.get(scope) ?? []).filter((r) => r.serial > since),
    appendUpdate(scope, entry) {
      const all = logs.get(scope) ?? [];
      const row = { ...entry, serial: (all.at(-1)?.serial ?? 0) + 1, at: Date.now() };
      logs.set(scope, [...all, row]);
      return row;
    },
    appendExact(scope, row) {
      const all = logs.get(scope) ?? [];
      if (row.serial !== (all.at(-1)?.serial ?? 0) + 1) return false;
      logs.set(scope, [...all, row]);
      return true;
    },
    clearUpdates: (scope) => logs.delete(scope),
    exportZip: (id) => (list.find((p) => p.id === id) ? Buffer.from(`zip of ${id}`) : null),
    importXdc(bytes) {
      const pkg = { id: String(bytes).replace("zip of ", ""), appKey: "secret-word", name: "Secret Word", version: "5" };
      list.push(pkg);
      return { pkg, added: true };
    },
  };
}

// two servers, each knowing the other by a token, calling each other's handler directly
function pair() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gamelinks-"));
  const servers = {};
  const make = (me, other, lib) => {
    const peer = { id: other, name: `${other}'s SEASIDE`, url: `http://${other}`, token: `to-${other}` };
    const peers = {
      get: (id) => (id === other ? peer : null),
      list: () => [peer],
      touch: () => {},
      check: (req) => (req.headers.authorization === `Bearer to-${me}` ? { id: other, name: `${other}'s SEASIDE` } : null),
    };
    const fetchImpl = async (url, init) => {
      const u = new URL(url);
      const target = servers[u.host];
      const body = init.body ? Buffer.from(init.body) : Buffer.alloc(0);
      let status = 200;
      let out = Buffer.alloc(0);
      const headers = {};
      const res = {
        writeHead: (s, h) => ((status = s), Object.assign(headers, h)),
        end: (b) => (out = Buffer.from(b ?? "")),
      };
      await target.handle({ method: init.method, headers: { authorization: init.headers.Authorization } }, res, u, {
        readBody: async () => body,
        send: (r, s, v) => ((status = s), (out = Buffer.from(JSON.stringify(v)))),
      });
      return { status, ok: status < 400, json: async () => JSON.parse(String(out)), arrayBuffer: async () => out };
    };
    return createGameLinks({ peers, library: () => lib, file: () => path.join(dir, `${me}.json`), fetchImpl });
  };
  const hostLib = memLibrary([{ id: "pkg1", appKey: "secret-word", name: "Secret Word", version: "5" }]);
  const guestLib = memLibrary();
  servers.host = make("host", "guest", hostLib);
  servers.guest = make("guest", "host", guestLib);
  return { host: servers.host, guest: servers.guest, hostLib, guestLib };
}

test("one SEASIDE offers a game, the other accepts it, and both keep one log in one order", async () => {
  const { host, guest, hostLib, guestLib } = pair();
  hostLib.appendUpdate("secret-word", { from: "you:h", name: "H", update: { payload: { type: "join" } } });
  const offered = await host.offer({ peerId: "guest", scope: "secret-word", pkgId: "pkg1", hours: 2, by: "Sam" });
  const invite = guest.list().find((l) => l.status === "invited");
  assert.equal(invite.name, "Secret Word");
  assert.equal(invite.peerName, "host's SEASIDE");
  // accepting fetches the game (the guest didn't have it) and opens the link on both sides
  await guest.accept(offered.id);
  assert.ok(guestLib.get("pkg1"));
  assert.equal(host.list()[0].status, "open");
  const gs = guestScope(offered.id);
  // the guest's copy catches up with what the host had
  await guest.syncAll();
  assert.equal(guestLib.readUpdates(gs).length, 1);
  // a guest's move goes to the host first, and both logs have it with the same number
  const row = await guest.sendAsGuest(gs, { from: "you:g", name: "G", update: { payload: { type: "join" } } });
  assert.equal(row.serial, 2);
  hostLib.appendUpdate("secret-word", { from: "ai:dee", name: "Dee", update: { payload: { type: "round" } } });
  await guest.syncAll();
  assert.deepEqual(guestLib.readUpdates(gs).map((r) => `${r.serial}:${r.from}`), hostLib.readUpdates("secret-word").map((r) => `${r.serial}:${r.from}`));
  // closing on the host ends it for the guest too
  await host.close(offered.id);
  assert.equal(guest.list()[0].status, "closed");
  assert.equal(guest.guestLink(gs), null);
});

test("realtime messages reach the other side's open copies, and not the page that sent them", async () => {
  const { host, guest } = pair();
  const offered = await host.offer({ peerId: "guest", scope: "openttd", pkgId: "pkg1", hours: 1 });
  await guest.accept(offered.id);
  const heard = { host: [], guest: [], sender: [] };
  const fakeRes = (into) => ({ writeHead() {}, write: (s) => s.startsWith("data:") && into.push(JSON.parse(s.slice(5))), on() {} });
  host.listen("openttd", "hostpage", fakeRes(heard.host));
  guest.listen(guestScope(offered.id), "guestpage", fakeRes(heard.guest));
  guest.listen(guestScope(offered.id), "sender", fakeRes(heard.sender));
  guest.realtime(guestScope(offered.id), "sender", [{ data: [1, 2, 3], from: "you:g", name: "G" }]);
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(heard.guest[0][0].data, [1, 2, 3]); // another page on the guest's own SEASIDE
  assert.deepEqual(heard.host[0][0].data, [1, 2, 3]); // the host's page
  assert.equal(heard.sender.length, 0);
});

test("a declined or expired offer isn't open, and a stranger can't ask anything", async () => {
  const { host, guest } = pair();
  const offered = await host.offer({ peerId: "guest", scope: "x", pkgId: "pkg1", hours: 1 });
  await guest.decline(offered.id);
  assert.equal(host.list()[0].status, "declined");
  let status = 0;
  await host.handle({ method: "GET", headers: {} }, {}, new URL("http://host/pads-peer/game/rows?link=x"), { readBody: async () => Buffer.alloc(0), send: (r, s) => (status = s) });
  assert.equal(status, 401);
});
