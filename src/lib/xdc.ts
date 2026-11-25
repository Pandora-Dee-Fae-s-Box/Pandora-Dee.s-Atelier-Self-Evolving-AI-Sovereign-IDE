// The desktop side of webxdc: the library on disk (through /api) and the bridge that carries
// updates between open apps, the people playing, and the characters playing along.

export type Pkg = {
  id: string;
  appKey: string;
  name: string;
  version: string;
  filename: string;
  size: number;
  fileCount: number;
  added: number;
  built: number;
  description: string;
  source: string;
  icon: string;
  parent: string;
  notes: string;
};

export type Update = { payload: unknown; info?: string; summary?: string; document?: string; href?: string; serial: number; max_serial?: number };
export type Row = { serial: number; at: number; from: string; name: string; update: Omit<Update, "serial" | "max_serial">; descr?: string };

// ---------- players' addresses ----------
// In a game linked from another SEASIDE (server/gameLinks.mjs, played here in a scope "link-…"), both SEASIDEs have a
// "you" and their own Dee, so every address made here carries this SEASIDE's mark ("ai:dee@second-seaside"), and the
// players stay apart. Games played only here keep plain addresses.
let hereTag = "elsewhere";
if (typeof fetch !== "undefined" && typeof window !== "undefined")
  void fetch("/api/pads/servers")
    .then((r) => r.json())
    .then((j: { me?: { name?: string; id?: string } }) => {
      const name = String(j.me?.name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30);
      hereTag = name || String(j.me?.id ?? "elsewhere").slice(0, 8);
    })
    .catch(() => {});
export const linkTag = (scope?: string | null) => (scope && /^link-/.test(scope) ? `@${hereTag}` : "");
/** A character's address in a game. */
export const aiAddr = (id: string, scope?: string | null) => `ai:${id}${linkTag(scope)}`;

/** Apps run on a different origin from the desktop, so they can't read its storage. */
export function appOrigin(): { origin: string; isolated: boolean } {
  const { protocol, hostname, port } = window.location;
  const p = port ? `:${port}` : "";
  if (hostname === "localhost") return { origin: `${protocol}//127.0.0.1${p}`, isolated: true };
  if (hostname === "127.0.0.1") return { origin: `${protocol}//localhost${p}`, isolated: true };
  return { origin: window.location.origin, isolated: false };
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/${path}`, init);
  const type = res.headers.get("content-type") ?? "";
  const body = type.includes("json") ? await res.json() : await res.text();
  if (!res.ok) throw new Error((body as { error?: string })?.error ?? `The desktop server answered ${res.status}.`);
  return body as T;
}

export type UpdateRow = {
  name: string;
  appKey: string;
  repo: string;
  local: string;
  latest: string;
  newer: boolean;
  sourceAhead?: boolean;
  prerelease?: boolean;
  published?: string;
  note?: string;
  asset?: { name: string; url: string; size: number };
};

/** What a web game import made, and what it did on the way. */
export type WebImport = { pkg: Pkg; base: string; name: string; done: string[]; fetched: { kept: number; bytes: number }; still: { loads: string[]; mentioned: string[] } };

/** What a web game import did, in a few plain sentences. */
export function webImportSaid(r: WebImport, web: boolean): string {
  const parts = [`${r.name} is a Mini App now, open as a draft to edit.`, ...r.done];
  if (r.fetched.kept) parts.push(`${r.fetched.kept} file${r.fetched.kept === 1 ? "" : "s"} it loaded from the internet ${r.fetched.kept === 1 ? "is" : "are"} kept inside it now.`);
  if (r.still.loads.length) parts.push(`Still on the internet, so ${r.still.loads.length === 1 ? "it" : "they"} won't load in a Mini App${web ? "" : " (the web is off in Privacy, so nothing was fetched)"}: ${r.still.loads.slice(0, 4).join(", ")}${r.still.loads.length > 4 ? "…" : ""}.`);
  if (r.still.mentioned.length) parts.push(`Its code also reaches for ${r.still.mentioned.slice(0, 4).join(", ")}${r.still.mentioned.length > 4 ? "…" : ""}; Mini Apps can't, so that part (scores, sign-ins, ads) won't work.`);
  return parts.join(" ");
}

export const library = {
  available: async () => {
    try {
      await api("info");
      return true;
    } catch {
      return false;
    }
  },
  info: () => api<{ dataDir: string; xdcDir: string }>("info"),
  list: () => api<Pkg[]>("xdc"),
  /** Newer releases where the apps are made (GitHub, Codeberg). Only when asked. */
  newerReleases: () => api<UpdateRow[]>("xdc/updates", { method: "POST" }),
  fetchUpdate: (url: string) => api<{ added: Pkg[]; duplicates: number; errors: string[] }>("xdc/fetch-update", { method: "POST", body: JSON.stringify({ url }) }),
  import: (file: File, onProgress?: (text: string) => void) => {
    onProgress?.(`Reading ${file.name}…`);
    return api<{ added: Pkg[]; duplicates: number; errors: string[] }>("xdc/import", {
      method: "POST",
      headers: { "x-filename": encodeURIComponent(file.name) },
      body: file,
    });
  },
  /** A web game made into a Mini App and opened as a draft: a .zip of it or its .html page from this device, or its
   *  folder (or .zip or page) on the desktop. `web`: fetch and keep what it loads from the internet. */
  importWeb: (from: File | { path: string } | { game: string }, web: boolean) =>
    api<WebImport>("xdc/import-web", from instanceof File
      ? { method: "POST", headers: { "x-filename": encodeURIComponent(from.name), "x-web": web ? "1" : "0" }, body: from }
      : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...from, web }) }),
  update: (id: string, patch: Partial<Pkg>) => api<Pkg>(`xdc/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  remove: (id: string) => api<{ ok: boolean }>(`xdc/${id}`, { method: "DELETE" }),
  fork: (id: string, version: string) => api<Pkg>(`xdc/${id}/fork`, { method: "POST", body: JSON.stringify({ version }) }),
  files: (id: string) => api<string[]>(`xdc/${id}/files`),
  read: async (id: string, path: string) => {
    const res = await fetch(`/api/xdc/${id}/file?path=${encodeURIComponent(path)}`);
    if (!res.ok) throw new Error(`Couldn't open ${path}.`);
    return res.text();
  },
  write: (id: string, path: string, body: string | Blob) => api(`xdc/${id}/file?path=${encodeURIComponent(path)}`, { method: "PUT", body }),
  removeFile: (id: string, path: string) => api(`xdc/${id}/file?path=${encodeURIComponent(path)}`, { method: "DELETE" }),
  exportUrl: (id: string) => `/api/xdc/${id}/export`,
  iconUrl: (p: Pkg) => (p.icon ? `/api/xdc/${p.id}/icon` : ""),
  runUrl: (p: Pkg, scope: string, addr: string, name: string) =>
    `${appOrigin().origin}/run/${p.id}/index.html?scope=${encodeURIComponent(scope)}&addr=${encodeURIComponent(addr)}&name=${encodeURIComponent(name)}`,
  updates: (scope: string, since = 0) => api<Row[]>(`state/${encodeURIComponent(scope)}?since=${since}`),
  // (the bridge forgets how far this app had got, so a new game's first updates aren't taken for old ones)
  clearUpdates: (scope: string) => api(`state/${encodeURIComponent(scope)}`, { method: "DELETE" }).then((r) => (seen.delete(scope), r)),
};

/** Compare version labels so 0.10 sorts after 0.9. */
export function compareVersions(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

/** Versions of every app, newest first. */
export function groupApps(pkgs: Pkg[]) {
  const map = new Map<string, Pkg[]>();
  for (const p of pkgs) map.set(p.appKey, [...(map.get(p.appKey) ?? []), p]);
  for (const list of map.values()) list.sort((a, b) => compareVersions(b.version, a.version) || b.built - a.built);
  return map;
}

// ---------- the bridge ----------

type Frame = { win: Window; scope: string; addr: string; name: string; at?: number; atTime?: number };
const frames = new Set<Frame>();
const progress = new WeakMap<Window, { scope: string; at: number; atTime: number }>();
type Watcher = (scope: string, row: Row) => void;
const watchers = new Set<Watcher>();
let chatHandler: (from: string, app: string, content: { text?: string; file?: { name: string; dataUrl: string } }) => void = () => {};

const toUpdate = (r: Row, max: number): Update => ({ ...r.update, serial: r.serial, max_serial: max });

// The newest update each open app has seen here. Another device on this SEASIDE (a phone, another PC) playing the same
// app sends its updates to the same server; they're fetched every couple of seconds while the app is open, so both
// devices play one game. (Each device runs only the characters it has playing.)
const seen = new Map<string, number>();

function broadcast(scope: string, rows: Row[]) {
  if (!rows.length) return;
  const last = rows[rows.length - 1];
  lastMove.set(scope, { name: last.name, at: last.at || Date.now(), serial: last.serial });
  if (last.serial > (seen.get(scope) ?? 0)) newestAt.set(scope, Date.now());
  seen.set(scope, Math.max(seen.get(scope) ?? 0, rows[rows.length - 1].serial));
  const max = rows[rows.length - 1].serial;
  const updates = rows.map((r) => toUpdate(r, max));
  for (const f of frames) if (f.scope === scope) f.win.postMessage({ __pdd: "xdc", type: "updates", updates }, "*");
}

/** Send an update into an app's shared state, as a person or as a character. */
export async function sendUpdate(scope: string, from: string, name: string, update: Omit<Update, "serial" | "max_serial">, descr = "") {
  const clean = JSON.parse(JSON.stringify(update)) as Row["update"];
  const res = await fetch(`/api/state/${encodeURIComponent(scope)}`, { method: "POST", body: JSON.stringify({ from, name, update: clean, descr }) });
  const row = (await res.json()) as Row;
  // another device's update may have reached the server just before this one: pass it on first, in order, or this
  // page would skip past it
  const before = seen.get(scope);
  const rows = before !== undefined && row.serial > before + 1 ? (await library.updates(scope, before).catch(() => [row])).filter((r) => r.serial > before && r.serial <= row.serial) : [row];
  if (!rows.some((r) => r.serial === row.serial)) rows.push(row);
  broadcast(scope, rows);
  for (const r of rows) for (const w of watchers) w(scope, r);
  return row;
}

// Live (realtime) messages aren't saved by webxdc, but characters need to see them to take part.
type Live = { at: number; from: string; name: string; text: string };
const liveLog = new Map<string, Live[]>();
const decoder = new TextDecoder();

function recordLive(scope: string, from: string, name: string, data: number[] | Uint8Array) {
  let text = "";
  try {
    text = decoder.decode(data instanceof Uint8Array ? data : new Uint8Array(data));
  } catch {
    text = `(${data.length} bytes)`;
  }
  const list = [...(liveLog.get(scope) ?? []), { at: Date.now(), from, name, text: text.slice(0, 1500) }].slice(-60);
  liveLog.set(scope, list);
}

export function recentLive(scope: string, limit = 15) {
  return (liveLog.get(scope) ?? []).slice(-limit);
}

/** Send a live message to every open copy of an app, as a character would from their own device. */
export function sendLive(scope: string, from: string, name: string, text: string) {
  const bytes = Array.from(new TextEncoder().encode(text));
  recordLive(scope, from, name, bytes);
  for (const f of frames) if (f.scope === scope) f.win.postMessage({ __pdd: "xdc", type: "rt", data: bytes }, "*");
  sendOut(scope, bytes, from, name);
}

// ---------- the realtime channel beyond this page ----------
// Live messages also go through this SEASIDE's server, to its other devices with the app open and to a linked SEASIDE
// playing it (server/gameLinks.mjs); theirs come back on one stream per open app.
const pageId = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}${Math.random()}`).replace(/[^a-z0-9]/gi, "").slice(0, 24);
const outbox = new Map<string, { data: number[]; from: string; name: string }[]>();
let outTimer = 0;
function sendOut(scope: string, data: number[], from: string, name: string) {
  outbox.set(scope, [...(outbox.get(scope) ?? []), { data, from, name }]);
  // a few milliseconds' messages go together (a game can send many small ones)
  if (!outTimer)
    outTimer = window.setTimeout(() => {
      outTimer = 0;
      for (const [sc, msgs] of outbox) void fetch(`/api/rt/${encodeURIComponent(sc)}`, { method: "POST", body: JSON.stringify({ page: pageId, msgs }) }).catch(() => {});
      outbox.clear();
    }, 15);
}
const streams = new Map<string, EventSource>();
function listenOut(scope: string) {
  if (streams.has(scope) || typeof EventSource === "undefined") return;
  const es = new EventSource(`/api/rt/${encodeURIComponent(scope)}/events?page=${pageId}`);
  es.onmessage = (e) => {
    let msgs: { data: number[]; from?: string; name?: string }[] = [];
    try {
      msgs = JSON.parse(e.data);
    } catch {
      return;
    }
    for (const m of msgs) {
      recordLive(scope, m.from ?? "elsewhere", m.name ?? "Another device", m.data);
      for (const f of frames) if (f.scope === scope) f.win.postMessage({ __pdd: "xdc", type: "rt", data: m.data }, "*");
    }
  };
  streams.set(scope, es);
}
function stopListening() {
  for (const [scope, es] of streams) if (![...frames].some((f) => f.scope === scope)) (es.close(), streams.delete(scope));
}

// ---------- the lantern (Dee's idea): is every copy of this game seeing the same thing? ----------

const lastMove = new Map<string, { name: string; at: number; serial: number }>();
const lastPull = new Map<string, number>();
const newestAt = new Map<string, number>(); // when this desk first knew of the newest update
export type Lantern = {
  newest: number;
  copies: { name: string; addr: string; at: number; behindFor: number }[];
  lastMove: { name: string; at: number; serial: number } | null;
  pulledAt: number;
  inStep: boolean;
};
/** Each open copy of an app (the person's, each character's seat) and how far it has got, against the newest update
 *  this desk knows of. A copy more than a few seconds behind isn't in step. */
export function lanternOf(scope: string): Lantern {
  const newest = seen.get(scope) ?? 0;
  const now = Date.now();
  const copies = [...frames]
    .filter((f) => f.scope === scope)
    .map((f) => ({ name: f.name, addr: f.addr, at: f.at ?? 0, behindFor: (f.at ?? 0) < newest ? now - (newestAt.get(scope) ?? now) : 0 }));
  return { newest, copies, lastMove: lastMove.get(scope) ?? null, pulledAt: lastPull.get(scope) ?? 0, inStep: copies.every((c) => c.at >= newest || c.behindFor < 4000) };
}
/** One line for a character: whether every copy agrees, or which one is behind. */
export function lanternLine(scope: string) {
  const l = lanternOf(scope);
  if (!l.copies.length) return "";
  const behind = l.copies.filter((c) => c.at < l.newest && c.behindFor >= 4000);
  return behind.length
    ? `Lantern: not every copy is in step. ${behind.map((c) => `${c.name}'s copy has seen up to #${c.at}`).join("; ")}, the newest is #${l.newest}. What a copy that's behind shows may be out of date.`
    : `Lantern: all ${l.copies.length} copies of this game are in step at update #${l.newest}.`;
}
/** Catch up every copy that's behind: send it what it missed, in order. */
export async function bringInStep(scope: string) {
  const l = lanternOf(scope);
  for (const f of frames) {
    if (f.scope !== scope || (f.at ?? 0) >= l.newest) continue;
    const rows = await library.updates(scope, f.at ?? 0).catch(() => [] as Row[]);
    if (!rows.length) continue;
    const max = rows[rows.length - 1].serial;
    f.win.postMessage({ __pdd: "xdc", type: "updates", updates: rows.map((r) => toUpdate(r, max)) }, "*");
  }
}

let pulling = false;
async function pullOthers() {
  if (pulling) return;
  pulling = true;
  try {
    for (const scope of new Set([...frames].map((f) => f.scope))) {
      const since = seen.get(scope);
      if (since === undefined) continue; // not started yet: its frames ask for everything themselves
      const got = await library.updates(scope, since).catch(() => [] as Row[]);
      lastPull.set(scope, Date.now());
      const now = seen.get(scope) ?? since; // (this page may have sent one meanwhile)
      const rows = got.filter((r) => r.serial > now);
      if (!rows.length) continue;
      broadcast(scope, rows);
      for (const r of rows) for (const w of watchers) w(scope, r);
    }
  } finally {
    pulling = false;
  }
}
let pullTimer = 0;
function startPulling(scope: string) {
  if (!seen.has(scope)) void library.updates(scope, 0).then((rows) => seen.set(scope, Math.max(seen.get(scope) ?? 0, rows.length ? rows[rows.length - 1].serial : 0))).catch(() => seen.set(scope, 0));
  if (!pullTimer) pullTimer = window.setInterval(() => (frames.size ? void pullOthers() : (window.clearInterval(pullTimer), (pullTimer = 0))), 2000);
}

export const bridge = {
  attach(win: Window, scope: string, addr: string, name: string) {
    // (a frame is attached again on each render of its view: it keeps how far it had got)
    const before = progress.get(win);
    const f: Frame = { win, scope, addr, name, ...(before && before.scope === scope ? { at: before.at, atTime: before.atTime } : {}) };
    frames.add(f);
    startPulling(scope);
    listenOut(scope);
    return () => {
      frames.delete(f);
      // (a frame re-attached on the next render keeps its stream; one that's really gone lets it go a moment later)
      window.setTimeout(stopListening, 3000);
    };
  },
  watch(fn: Watcher) {
    watchers.add(fn);
    return () => {
      watchers.delete(fn);
    };
  },
  onChat(fn: typeof chatHandler) {
    chatHandler = fn;
  },
};

// What each copy of an app warned about lately (its console warnings and errors), by scope and player: a game that
// refuses a move often says why only there.
type Said = { at: number; level: string; text: string };
const consoleLog = new Map<string, Said[]>();

/** The warnings a player's own copy of an app gave since a moment (e.g. since that player sent a move). */
export function appSaid(scope: string, addr: string, since: number) {
  return (consoleLog.get(`${scope}\n${addr}`) ?? []).filter((l) => l.at >= since);
}

window.addEventListener("message", (e) => {
  const c = e.data as { __pdd?: string; level?: string; text?: string } | null;
  if (!c || c.__pdd !== "console") return;
  const frame = [...frames].find((f) => f.win === e.source);
  if (!frame) return;
  const key = `${frame.scope}\n${frame.addr}`;
  consoleLog.set(key, [...(consoleLog.get(key) ?? []), { at: Date.now(), level: String(c.level ?? "warn"), text: String(c.text ?? "").slice(0, 400) }].slice(-30));
});

window.addEventListener("message", (e) => {
  const m = e.data as { __pdd?: string; type?: string; rid?: number; [k: string]: unknown } | null;
  if (!m || m.__pdd !== "xdc") return;
  const frame = [...frames].find((f) => f.win === e.source);
  if (!frame) return;
  const reply = (value: unknown) => frame.win.postMessage({ __pdd: "xdc", type: "reply", rid: m.rid, value }, "*");
  if (m.type === "send") {
    void sendUpdate(frame.scope, frame.addr, frame.name, m.update as Row["update"], String(m.descr ?? ""));
  } else if (m.type === "listen") {
    void library.updates(frame.scope, Number(m.since ?? 0)).then((rows) => {
      const max = rows.length ? rows[rows.length - 1].serial : 0;
      reply(rows.map((r) => toUpdate(r, max)));
    });
  } else if (m.type === "chat") {
    chatHandler(frame.name, frame.scope, (m.content ?? {}) as Parameters<typeof chatHandler>[2]);
    reply(undefined);
  } else if (m.type === "at") {
    frame.at = Number(m.serial) || 0;
    frame.atTime = Date.now();
    progress.set(frame.win, { scope: frame.scope, at: frame.at, atTime: frame.atTime });
  } else if (m.type === "rt-send") {
    recordLive(frame.scope, frame.addr, frame.name, m.data as number[]);
    for (const f of frames) if (f !== frame && f.scope === frame.scope) f.win.postMessage({ __pdd: "xdc", type: "rt", data: m.data }, "*");
    sendOut(frame.scope, m.data as number[], frame.addr, frame.name);
  }
});

// ---------- reading what an app or game shows ----------

let screenSeq = 0;
/** Ask a frame for its visible text. Works across origins through the injected helper. */
export function readScreen(win: Window | null | undefined, timeout = 1500): Promise<string> {
  if (!win) return Promise.resolve("");
  return new Promise((resolve) => {
    const rid = ++screenSeq;
    const done = (text: string) => {
      window.removeEventListener("message", on);
      clearTimeout(t);
      resolve(text);
    };
    const on = (e: MessageEvent) => {
      const d = e.data as { __pdd?: string; rid?: number; text?: string } | null;
      if (e.source === win && d?.__pdd === "screen-reply" && d.rid === rid) done(d.text ?? "");
    };
    const t = window.setTimeout(() => done(""), timeout);
    window.addEventListener("message", on);
    win.postMessage({ __pdd: "screen", rid }, "*");
  });
}

let actSeq = 0;
export type SeatAct = { do: "type" | "click" | "choose" | "use"; target: string; text?: string; enter?: boolean };
/** Use a control on a seat's own screen (type, click, choose), the way its player would on their own device. */
export function actOnScreen(win: Window | null | undefined, act: SeatAct, timeout = act.do === "use" ? 45000 : 2000): Promise<{ ok: boolean; said: string }> {
  if (!win) return Promise.resolve({ ok: false, said: "Your seat isn't open." });
  return new Promise((resolve) => {
    const rid = ++actSeq;
    const done = (r: { ok: boolean; said: string }) => {
      window.removeEventListener("message", on);
      clearTimeout(t);
      resolve(r);
    };
    const on = (e: MessageEvent) => {
      const d = e.data as { __pdd?: string; rid?: number; ok?: boolean; said?: string } | null;
      if (e.source === win && d?.__pdd === "act-reply" && d.rid === rid) done({ ok: Boolean(d.ok), said: String(d.said ?? "") });
    };
    const t = window.setTimeout(() => done({ ok: false, said: "Your seat didn't answer (it may still be loading)." }), timeout);
    window.addEventListener("message", on);
    win.postMessage({ __pdd: "act", rid, act }, "*");
  });
}

/** A short, readable account of recent updates for a character. */
export function describeRows(rows: Row[], limit = 12) {
  return rows
    .slice(-limit)
    .map((r) => {
      const payload = JSON.stringify(r.update.payload);
      return `#${r.serial} ${r.name}: ${r.update.info ? `${r.update.info} · ` : ""}${payload.length > 400 ? `${payload.slice(0, 400)}…` : payload}`;
    })
    .join("\n");
}
