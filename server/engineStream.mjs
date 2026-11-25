// Songs played straight from a song engine (the music bridge keeps every song it makes), the way a player reads a
// network share: nothing is copied into SEASIDE's library. The page asks for a link to one song (with the engine's
// key, if it has one, kept here rather than in the link), then plays /api/music/engine-song/<id>; the player's Range
// requests (starting at once, seeking) are passed through to the engine. (engineStream.test.mjs)

import { randomUUID } from "node:crypto";
import { httpRequest } from "./httpGet.mjs";

const PASS = ["content-type", "content-length", "content-range", "accept-ranges", "last-modified", "etag"];

export function createEngineStream({ now = Date.now, fetchFn = httpRequest, ttl = 24 * 3600_000 } = {}) {
  const links = new Map();

  /** A link for one song: { url, headers } → id. The same song asked again gets the same link. */
  function link({ url, headers }) {
    let u;
    try {
      u = new URL(String(url));
    } catch {
      throw Object.assign(new Error("That isn't a web address."), { status: 400 });
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") throw Object.assign(new Error("Only http:// and https:// addresses."), { status: 400 });
    for (const [k, v] of links) if (now() - v.at > ttl) links.delete(k);
    for (const [k, v] of links) if (v.url === u.href) return (v.at = now()), k;
    const id = randomUUID();
    const h = Object.fromEntries(Object.entries(headers || {}).filter(([, v]) => typeof v === "string"));
    links.set(id, { url: u.href, headers: h, at: now() });
    return id;
  }

  /** Play one: the engine's answer (whole, or the part asked for) passed on as it comes. */
  async function serve(req, res, id) {
    const l = links.get(id);
    if (!l) {
      res.writeHead(404, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "That link has expired; open the song again." }));
    }
    l.at = now();
    const ctrl = new AbortController();
    req.on("close", () => ctrl.abort());
    try {
      const headers = { ...l.headers };
      if (req.headers.range) headers.Range = String(req.headers.range);
      const r = await fetchFn(l.url, { method: req.method === "HEAD" ? "HEAD" : "GET", headers, signal: ctrl.signal });
      const out = { "Cache-Control": "no-store" };
      for (const k of PASS) {
        const v = r.headers.get(k);
        if (v) out[k] = v;
      }
      res.writeHead(r.status, out);
      if (!r.body || req.method === "HEAD") return res.end();
      r.body.on("error", () => res.end()).pipe(res);
    } catch (e) {
      if (res.headersSent) return res.end();
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: ctrl.signal.aborted ? "Stopped." : `Couldn't reach the engine (${e?.cause?.code || e?.message || e}).` }));
    }
  }

  return { link, serve };
}
