// A request with Node's own http/https modules, answering like a small fetch() Response whose body is a Node stream.
// For long downloads and streams from song engines: Node's built-in fetch (undici) can crash the whole server
// (an internal assert(!this.paused)) when a body being read slowly (backpressure: the disk, a player that's paused)
// has its connection closed by the other side, which an HTTP/1.0 server like Python's does after every answer.
// Plain http streams don't have that problem.

import http from "node:http";
import https from "node:https";

/** url, { method, headers, body, signal } → { ok, status, headers: { get }, body (a readable stream), text(), json() } */
export function httpRequest(url, { method = "GET", headers = {}, body, signal } = {}) {
  const u = url instanceof URL ? url : new URL(String(url));
  const lib = u.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(u, { method, headers, signal }, (res) => {
      const read = async () => {
        const parts = [];
        for await (const c of res) parts.push(c);
        return Buffer.concat(parts).toString("utf8");
      };
      resolve({
        ok: res.statusCode >= 200 && res.statusCode < 300,
        status: res.statusCode ?? 0,
        headers: { get: (k) => (res.headers[String(k).toLowerCase()] ?? null) },
        body: res,
        text: read,
        json: async () => JSON.parse(await read()),
      });
    });
    req.on("error", reject);
    if (body != null) req.write(body);
    req.end();
  });
}
