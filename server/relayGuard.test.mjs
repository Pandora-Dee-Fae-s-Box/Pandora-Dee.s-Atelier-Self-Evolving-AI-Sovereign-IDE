import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { EventEmitter } from "node:events";
import { localRefusal, relay } from "./relay.mjs";

// a stand-in for the page's request and the server's response
function call(job) {
  return new Promise((resolve) => {
    const req = new EventEmitter();
    const res = new EventEmitter();
    let status = 0, headers = {}, body = "";
    Object.assign(res, {
      headersSent: false,
      writeHead(s, h) {
        status = s;
        headers = h;
        this.headersSent = true;
      },
      write(c) {
        body += c;
      },
      end(c) {
        if (c) body += c;
        resolve({ status, headers, body });
      },
      on: res.on.bind(res),
      once: res.once.bind(res),
      emit: res.emit.bind(res),
      removeListener: res.removeListener.bind(res),
    });
    relay(req, res, job);
  });
}

test("a character's request: a redirect hop to an unlisted local address is stopped; with a key, nothing is followed", async () => {
  const inner = http.createServer((_, r) => r.end("inner secrets")).listen(0, "127.0.0.1");
  await new Promise((r) => inner.once("listening", r));
  const outer = http.createServer((_, r) => (r.writeHead(302, { Location: `http://localhost:${inner.address().port}/` }), r.end())).listen(0, "127.0.0.1");
  await new Promise((r) => outer.once("listening", r));
  const first = `http://127.0.0.1:${outer.address().port}/`;
  try {
    const stopped = await call({ url: first, hopGuard: { local: `127.0.0.1:${outer.address().port}` } });
    assert.equal(stopped.status, 403);
    assert.match(stopped.body, /localhost is on this computer or the local network/);
    const kept = await call({ url: first, noRedirect: true });
    assert.equal(kept.headers["X-Relay-Status"], "302", "the redirect comes back as it is");
    assert.equal(localRefusal(new URL("https://api.github.com/"), ""), "");
    assert.equal(localRefusal(new URL("http://nas:8080/"), "nas:8080"), "");
  } finally {
    inner.close();
    outer.close();
  }
});
