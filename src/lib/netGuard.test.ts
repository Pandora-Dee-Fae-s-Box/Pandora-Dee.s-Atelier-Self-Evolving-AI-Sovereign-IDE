import { test } from "node:test";
import assert from "node:assert/strict";
import { isPrivateHost, keysIn, refusal } from "./netGuard.ts";

test("the local network, by name or address", () => {
  for (const h of ["localhost", "127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.1.1", "100.100.1.1", "::1", "fd00::1", "nas", "printer.local", "pc.tail1234.ts.net", "router.home.arpa"]) assert.equal(isPrivateHost(h), true, h);
  for (const h of ["api.github.com", "8.8.8.8", "localhost.example.com", "100.200.1.1"]) assert.equal(isPrivateHost(h), false, h);
  assert.equal(isPrivateHost(new URL("http://2130706433/").hostname), true, "127.0.0.1 written as one number");
});

test("a character's request: never SEASIDE itself, the local network only when listed, a key only to its hosts", () => {
  const rules = { self: "localhost:15693", localHosts: "192.168.1.20, homeassistant.local", keyHosts: { GH_TOKEN: "api.github.com, *.githubusercontent.com" } };
  assert.match(refusal("http://localhost:15693/api/resident-keys/x/values", [], rules), /SEASIDE's own address/);
  assert.match(refusal("http://127.0.0.1:15693/api/desk", [], { ...rules, localHosts: "127.0.0.1" }), /SEASIDE's own address/, "even when listed");
  assert.match(refusal("http://192.168.1.1/admin", [], rules), /local network/);
  assert.equal(refusal("http://192.168.1.20:8123/api/", [], rules), "");
  assert.equal(refusal("http://homeassistant.local:8123/", [], rules), "");
  assert.match(refusal("https://evil.example/", ["GH_TOKEN"], rules), /only goes to api\.github\.com/);
  assert.equal(refusal("https://api.github.com/user", ["GH_TOKEN"], rules), "");
  assert.equal(refusal("https://raw.githubusercontent.com/x", ["GH_TOKEN"], rules), "");
  assert.equal(refusal("https://anywhere.example/", ["OTHER_KEY"], rules), "", "a key not tied to hosts goes anywhere public");
  assert.deepEqual([...keysIn("token=ghs_abcdef&x=1", { GH_TOKEN: "ghs_abcdef", SHORT: "x=1"[0] })], ["GH_TOKEN"]);
});
