import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createLan, parseArp, parseNbtstat } from "./lan.mjs";

const WIN = `
Interface: 192.168.1.10 --- 0x7
  Internet Address      Physical Address      Type
  192.168.1.1           a4-5e-60-00-00-01     dynamic
  192.168.1.20          a4-5e-60-00-00-20     dynamic
  192.168.1.255         ff-ff-ff-ff-ff-ff     static
  224.0.0.22            01-00-5e-00-00-16     static
  239.255.255.250       01-00-5e-7f-ff-fa     static
`;

test("the ARP table, without multicast and broadcast", () => {
  assert.deepEqual(parseArp(WIN), [
    { ip: "192.168.1.1", mac: "a4:5e:60:00:00:01" },
    { ip: "192.168.1.20", mac: "a4:5e:60:00:00:20" },
  ]);
  assert.deepEqual(parseArp("? (10.0.0.5) at 3c:22:fb:aa:bb:cc on en0 ifscope [ethernet]"), [{ ip: "10.0.0.5", mac: "3c:22:fb:aa:bb:cc" }]);
});

test("a computer's name from nbtstat", () => {
  const t = "    Name               Type         Status\n    ---------------------------------------------\n    ALICEMOVIES    <00>  UNIQUE      Registered\n    WORKGROUP      <00>  GROUP       Registered";
  assert.equal(parseNbtstat(t), "ALICEMOVIES");
});

test("the first look learns the house; after that, a new device is an event", async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "pdd-lan-"));
  let t = 1000;
  const L = createLan({ dataDir: () => d, now: () => ++t });
  const first = await L.scan({ table: WIN });
  assert.equal(first.devices.length, 2);
  assert.deepEqual(first.fresh, [], "nothing is new on the very first look");
  const again = await L.scan({ table: `${WIN}\n  192.168.1.33          de-ad-be-ef-00-33     dynamic` });
  assert.deepEqual(again.fresh.map((e) => [e.kind, e.ip]), [["new", "192.168.1.33"]]);
  assert.equal((await L.scan({ table: WIN })).fresh.length, 0, "a device that's quiet for now is still known");
  assert.equal(L.label("DE:AD:BE:EF:00:33", "Kai's tablet").devices.find((x) => x.mac === "de:ad:be:ef:00:33").label, "Kai's tablet");
});
