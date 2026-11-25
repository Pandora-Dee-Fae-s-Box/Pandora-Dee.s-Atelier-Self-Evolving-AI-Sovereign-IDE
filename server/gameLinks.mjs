// Games across linked SEASIDEs (a jetty for one game, in Dee's words: only what's named, for as long as it's named,
// with a way to close it). Built on linked servers (peers.mjs): one SEASIDE offers one game to a linked one, for a
// few hours; the other accepts or declines. Then both play one game:
// - The one that offered is the host: its log of the game's updates is the one true order. The guest sends its moves
//   to the host and mirrors the host's log in the same order (its own copy of the game starts empty), so every copy
//   on both sides sees the same updates with the same numbers.
// - The realtime channel (webxdc's joinRealtimeChannel, how OpenTTD plays multiplayer) goes through both servers to
//   every open copy, both ways. It also carries realtime between devices on one SEASIDE.
// - The guest fetches the game's package from the host if it doesn't have it.
// - Either side can close the link, and it closes by itself when its time is up.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const TIMEOUT_MS = 5000;
const SYNC_MS = 1200;
const MAX_HOURS = 24;
const clip = (s, n) => String(s ?? "").trim().slice(0, n);
const err = (message, status = 400) => Object.assign(new Error(message), { status });
const ID = /^[a-z0-9]{12}$/;

/** The local scope a guest plays a linked game in: its own, empty to start, mirroring the host's. */
export const guestScope = (id) => `link-${id}`;

export function createGameLinks({ peers, library, file, fetchImpl = (...a) => fetch(...a) }) {
  const read = () => {
    try {
      const j = JSON.parse(fs.readFileSync(file(), "utf8"));
      return Array.isArray(j.links) ? j.links : [];
    } catch {
      return [];
    }
  };
  const write = (links) => {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(`${file()}.tmp`, JSON.stringify({ links: links.slice(-100) }, null, 1));
    fs.renameSync(`${file()}.tmp`, file());
  };
  /** The links, with any whose time is up closed. */
  const links = () => {
    const all = read();
    let changed = false;
    for (const l of all) if ((l.status === "open" || l.status === "offered" || l.status === "invited") && l.until < Date.now()) (l.status = "closed"), (l.why = "its time was up"), (changed = true);
    if (changed) write(all);
    return all;
  };
  const patch = (id, p) => {
    const all = links();
    const l = all.find((x) => x.id === id);
    if (!l) throw err("There's no such game link.", 404);
    Object.assign(l, p);
    write(all);
    return l;
  };
  const scopeOf = (l) => (l.role === "host" ? l.scope : guestScope(l.id));

  async function call(peer, route, body, raw = false) {
    const r = await fetchImpl(`${peer.url}/pads-peer/game/${route}`, {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${peer.token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(raw ? 60_000 : TIMEOUT_MS),
      redirect: "error",
    });
    if (r.status === 401) throw err(`${peer.name} no longer knows this server (it was unlinked there).`, 502);
    if (raw) {
      if (!r.ok) throw err(`${peer.name} couldn't send the game (${r.status}).`, 502);
      return Buffer.from(await r.arrayBuffer());
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw err(j.error || `${peer.name} answered ${r.status}.`, 502);
    peers.touch(peer.id);
    return j;
  }
  const peerOf = (l) => {
    const p = peers.get(l.peerId);
    if (!p) throw err("That server isn't linked any more.", 404);
    return p;
  };

  // ---------- what this SEASIDE's own pages do ----------

  /** For the desk: every link, with the other server's name (never tokens). */
  function list() {
    return links().map((l) => ({ ...l, peerName: peers.get(l.peerId)?.name ?? "a server no longer linked", localScope: scopeOf(l) }));
  }

  /** Offer one game (the scope it's played in here) to a linked server, for some hours. */
  async function offer({ peerId, scope, pkgId, hours, by }) {
    const peer = peers.get(String(peerId));
    if (!peer) throw err("Link that SEASIDE first (PADS › Servers).");
    const pkg = library().get(String(pkgId));
    if (!pkg) throw err("That game isn't in this library.");
    const id = crypto.randomBytes(9).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "").padEnd(12, "0").slice(0, 12);
    const until = Date.now() + Math.max(0.25, Math.min(MAX_HOURS, Number(hours) || 3)) * 3_600_000;
    const link = { id, role: "host", peerId: peer.id, scope: clip(scope, 120), pkgId: pkg.id, appKey: pkg.appKey, name: pkg.name, version: pkg.version, until, by: clip(by, 60), made: Date.now(), status: "offered" };
    await call(peer, "offer", { id, pkg: { id: pkg.id, appKey: pkg.appKey, name: pkg.name, version: pkg.version }, until, by: link.by });
    write([...links(), link]);
    return link;
  }

  /** The guest says yes: the game is fetched from the host if it isn't here, and play can start. */
  async function accept(id) {
    const l = links().find((x) => x.id === id && x.role === "guest");
    if (!l || l.status !== "invited") throw err("That invitation isn't waiting any more.");
    const peer = peerOf(l);
    if (!library().get(l.pkgId)) {
      const bytes = await call(peer, `pkg?link=${encodeURIComponent(id)}`, null, true);
      const r = library().importXdc(bytes, `${l.appKey || "game"}.xdc`);
      if (r.pkg.id !== l.pkgId) l.pkgId = r.pkg.id;
    }
    await call(peer, "accept", { id });
    library().clearUpdates(guestScope(id));
    return patch(id, { status: "open", pkgId: l.pkgId, opened: Date.now() });
  }

  async function decline(id) {
    const l = links().find((x) => x.id === id && x.role === "guest");
    if (!l) throw err("There's no such invitation.");
    await call(peerOf(l), "close", { id, why: "declined" }).catch(() => {});
    return patch(id, { status: "declined" });
  }

  async function close(id) {
    const l = links().find((x) => x.id === id);
    if (!l) throw err("There's no such game link.");
    await call(peerOf(l), "close", { id, why: "closed" }).catch(() => {});
    return patch(id, { status: "closed", why: "closed here" });
  }

  /** The open guest link a local scope belongs to (its moves go to the host). */
  const guestLink = (scope) => {
    const m = /^link-([a-z0-9]{12})$/.exec(String(scope));
    return m ? links().find((l) => l.id === m[1] && l.role === "guest" && l.status === "open") ?? null : null;
  };
  const hostLinks = (scope) => links().filter((l) => l.role === "host" && l.status === "open" && l.scope === scope);

  /** A guest's copy, writing the host's rows in the host's order (the same numbers, from an empty start). */
  function mirror(scope, rows) {
    const L = library();
    let last = (L.readUpdates(scope).at(-1)?.serial ?? 0);
    for (const r of rows) {
      if (r.serial !== last + 1) continue;
      L.appendExact(scope, r);
      last = r.serial;
    }
    return last;
  }

  /** A move made in a guest's copy goes to the host, and comes back in the host's order. */
  async function sendAsGuest(scope, entry) {
    const l = guestLink(scope);
    if (!l) return null;
    const since = library().readUpdates(scope).at(-1)?.serial ?? 0;
    const j = await call(peerOf(l), "send", { id: l.id, entry, since });
    if (Array.isArray(j.rows)) mirror(scope, j.rows);
    return j.row ?? null;
  }

  // guests keep their copy in step with the host's, every second or so while a link is open
  let syncing = false;
  async function syncAll() {
    if (syncing) return;
    syncing = true;
    try {
      for (const l of links().filter((x) => x.role === "guest" && x.status === "open")) {
        const scope = guestScope(l.id);
        const since = library().readUpdates(scope).at(-1)?.serial ?? 0;
        try {
          const j = await call(peerOf(l), `rows?link=${l.id}&since=${since}`);
          if (j.closed) patch(l.id, { status: "closed", why: `closed on ${peerOf(l).name}` });
          else if (Array.isArray(j.rows) && j.rows.length) mirror(scope, j.rows);
        } catch {
          /* the host isn't answering just now: tried again in a moment */
        }
      }
    } finally {
      syncing = false;
    }
  }
  const timer = setInterval(() => void syncAll(), SYNC_MS);
  timer.unref?.();

  // ---------- realtime: every open copy, on every device, on both sides ----------

  const streams = new Map(); // scope → Set<{ res, page }>
  /** A page listening for a scope's realtime messages (server-sent events). */
  function listen(scope, page, res) {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write(": open\n\n");
    const me = { res, page: clip(page, 60) };
    if (!streams.has(scope)) streams.set(scope, new Set());
    streams.get(scope).add(me);
    const ping = setInterval(() => res.write(": ping\n\n"), 20_000);
    ping.unref?.();
    res.on("close", () => {
      clearInterval(ping);
      streams.get(scope)?.delete(me);
    });
  }
  function emit(scope, msgs, exceptPage = "") {
    const set = streams.get(scope);
    if (!set) return;
    const line = `data: ${JSON.stringify(msgs)}\n\n`;
    for (const s of set) if (s.page !== exceptPage) s.res.write(line);
  }
  /** Realtime messages from a page here: to the other pages here, and across any open link for this scope. */
  function realtime(scope, page, msgs) {
    const clean = (Array.isArray(msgs) ? msgs : []).slice(0, 200).map((m) => ({ data: Array.isArray(m.data) ? m.data.slice(0, 128_000) : [], from: clip(m.from, 80), name: clip(m.name, 60) }));
    if (!clean.length) return;
    emit(scope, clean, page);
    const out = guestLink(scope) ? [guestLink(scope)] : hostLinks(scope);
    for (const l of out) void call(peerOf(l), "rt", { id: l.id, msgs: clean }).catch(() => {});
  }

  // ---------- what linked servers ask (with their token) ----------

  async function handle(req, res, url, { readBody, send }) {
    if (!url.pathname.startsWith("/pads-peer/game/")) return false;
    const route = url.pathname.slice("/pads-peer/game/".length);
    try {
      const peer = peers.check(req);
      if (!peer) return send(res, 401, { error: "This server isn't linked here." }), true;
      peers.touch(peer.id);
      const mine = (id, role) => {
        const l = links().find((x) => x.id === String(id) && x.peerId === peer.id && x.role === role);
        if (!l) throw err("There's no such game link with this server.", 404);
        return l;
      };
      if (route === "offer" && req.method === "POST") {
        const b = JSON.parse((await readBody(req, 20_000)).toString("utf8") || "{}");
        if (!ID.test(String(b.id))) throw err("That isn't a game link.");
        const link = { id: b.id, role: "guest", peerId: peer.id, pkgId: clip(b.pkg?.id, 40), appKey: clip(b.pkg?.appKey, 80), name: clip(b.pkg?.name, 80) || "A game", version: clip(b.pkg?.version, 40), until: Math.min(Number(b.until) || 0, Date.now() + MAX_HOURS * 3_600_000), by: clip(b.by, 60), made: Date.now(), status: "invited" };
        write([...links().filter((x) => x.id !== link.id), link]);
        return send(res, 200, { ok: true }), true;
      }
      if (route === "accept" && req.method === "POST") {
        const b = JSON.parse((await readBody(req, 10_000)).toString("utf8") || "{}");
        const l = mine(b.id, "host");
        if (l.status !== "offered") throw err("That offer isn't open any more.");
        patch(l.id, { status: "open", opened: Date.now() });
        return send(res, 200, { ok: true }), true;
      }
      if (route === "close" && req.method === "POST") {
        const b = JSON.parse((await readBody(req, 10_000)).toString("utf8") || "{}");
        const l = links().find((x) => x.id === String(b.id) && x.peerId === peer.id);
        if (l && l.status !== "closed") patch(l.id, { status: b.why === "declined" ? "declined" : "closed", why: `${b.why === "declined" ? "declined" : "closed"} on ${peer.name}` });
        return send(res, 200, { ok: true }), true;
      }
      if (route === "pkg" && req.method === "GET") {
        const l = mine(url.searchParams.get("link"), "host");
        const zip = library().exportZip(l.pkgId);
        if (!zip) throw err("The game isn't here any more.", 404);
        res.writeHead(200, { "Content-Type": "application/zip", "Content-Length": zip.length });
        return res.end(zip), true;
      }
      if (route === "rows" && req.method === "GET") {
        const l = mine(url.searchParams.get("link"), "host");
        if (l.status !== "open") return send(res, 200, { closed: l.status === "closed", rows: [] }), true;
        return send(res, 200, { rows: library().readUpdates(l.scope, Number(url.searchParams.get("since")) || 0).slice(0, 500) }), true;
      }
      if (route === "send" && req.method === "POST") {
        const b = JSON.parse((await readBody(req, 2_000_000)).toString("utf8") || "{}");
        const l = mine(b.id, "host");
        if (l.status !== "open") throw err("That game link is closed.");
        const e = b.entry ?? {};
        const row = library().appendUpdate(l.scope, { from: clip(e.from, 80), name: clip(e.name, 60), update: e.update ?? {}, descr: clip(e.descr, 400) });
        // the guest gets everything after what its copy has, its own move included, so its copy stays in order
        return send(res, 200, { row, rows: library().readUpdates(l.scope, Math.max(0, Number(b.since) || 0)).filter((r) => r.serial <= row.serial).slice(0, 500) }), true;
      }
      if (route === "rt" && req.method === "POST") {
        const b = JSON.parse((await readBody(req, 8_000_000)).toString("utf8") || "{}");
        const l = links().find((x) => x.id === String(b.id) && x.peerId === peer.id && x.status === "open");
        if (!l) throw err("That game link is closed.", 404);
        const scope = scopeOf(l);
        const msgs = Array.isArray(b.msgs) ? b.msgs : [];
        emit(scope, msgs);
        // a host passes a guest's realtime on to its other guests of the same game
        if (l.role === "host") for (const o of hostLinks(l.scope)) if (o.id !== l.id) void call(peerOf(o), "rt", { id: o.id, msgs }).catch(() => {});
        return send(res, 200, { ok: true }), true;
      }
      return send(res, 404, { error: "Not something linked servers ask for." }), true;
    } catch (e) {
      return send(res, e?.status ?? 400, { error: e instanceof Error ? e.message : String(e) }), true;
    }
  }

  return { list, offer, accept, decline, close, guestLink, sendAsGuest, listen, realtime, handle, syncAll, mirror };
}
