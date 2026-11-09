// The shared desk: SEASIDE's state on the server, one desk every device opens (lib/deskSync.ts). Kept in sections
// (characters, chats, settings…, and each character's files on their own), sealed under the resident vault's master
// key like the heart's copy (the household's Keys live in it). A page saves only the sections it changed and picks up
// what other devices changed since its last revision; if two devices changed the same section, the later one stands and
// both are told. What's per device (window layout, the dock, text size) never comes here.
//
// The first copy is made from the desktop's own computer. Devices that had a desk of their own before can leave a copy
// of it here (keys left out), so it can be brought in later even if that device is reset.

import fs from "node:fs";
import path from "node:path";

const NAME = /^[A-Za-z][\w:.-]{0,80}$/;

export function createDeskState({ dataDir, seal, open, now = Date.now }) {
  const dir = () => path.join(dataDir(), "desk");
  const file = () => path.join(dir(), "state.sealed");
  let cache = null; // { rev, sections: { name: { rev, at, by, value } } }

  function read() {
    if (cache) return cache;
    try {
      cache = open(fs.readFileSync(file(), "utf8"));
    } catch {
      cache = { rev: 0, sections: {} };
    }
    return cache;
  }
  function write(st) {
    fs.mkdirSync(dir(), { recursive: true });
    fs.writeFileSync(`${file()}.tmp`, seal(st));
    fs.renameSync(`${file()}.tmp`, file());
    cache = st;
  }

  /** Everything (since 0), or what changed after a revision, plus where the desk is now. */
  function get(since = 0) {
    const st = read();
    const sections = {};
    for (const [k, s] of Object.entries(st.sections)) if (s.rev > since) sections[k] = { rev: s.rev, value: s.value, by: s.by };
    return { rev: st.rev, empty: st.rev === 0, sections };
  }

  /**
   * A device's changes. `base` says which revision of each section it last saw; a section someone else changed since
   * is a clash: this change still stands (it's the later one), and it's reported. Founding (the very first save) is
   * only allowed when `mayFound` (the desktop's own computer).
   */
  function put({ device, base = {}, changes = {}, merge = [] }, { mayFound = false } = {}) {
    const st = read();
    if (st.rev === 0 && !mayFound) throw Object.assign(new Error("The shared desk is started from the desktop's own computer."), { status: 409 });
    const by = String(device || "").slice(0, 60) || "a device";
    const clashes = [];
    // sections the device merges itself (a room's conversation): a stale copy isn't written over a newer one; the
    // device is told, takes the newer one in, and sends the two together
    const merging = new Set(Array.isArray(merge) ? merge.map(String) : []);
    const stale = [];
    let rev = st.rev;
    const sections = { ...st.sections };
    for (const [k, value] of Object.entries(changes ?? {})) {
      if (!NAME.test(k)) continue;
      const cur = sections[k];
      if (cur && Number(base[k] ?? 0) < cur.rev && cur.by !== by) {
        if (merging.has(k)) {
          stale.push(k);
          continue;
        }
        clashes.push({ section: k, with: cur.by });
      }
      rev += 1;
      if (value === null) delete sections[k];
      else sections[k] = { rev, at: now(), by, value };
    }
    if (rev !== st.rev) write({ rev, sections });
    return { rev, clashes, stale };
  }

  /** A device's old desk, kept as it was (the page leaves the keys' values out; anything that slips through is blanked). */
  function keepLegacy(device, blob) {
    const d = path.join(dir(), "devices");
    fs.mkdirSync(d, { recursive: true });
    let text = String(blob || "");
    try {
      const j = JSON.parse(text);
      const env = j?.state?.env;
      if (env && typeof env === "object") for (const k of Object.keys(env)) env[k] = "";
      text = JSON.stringify(j);
    } catch {
      /* not JSON: kept as given */
    }
    const name = `${String(device || "device").replace(/[^\w.-]+/g, "-").slice(0, 60)}-${new Date(now()).toISOString().slice(0, 10)}.json`;
    fs.writeFileSync(path.join(d, name), text);
    return { kept: name };
  }

  /** The old desks kept here, newest first (for bringing things in later). */
  function legacyList() {
    const d = path.join(dir(), "devices");
    try {
      return fs.readdirSync(d).filter((n) => n.endsWith(".json")).map((n) => ({ name: n, at: fs.statSync(path.join(d, n)).mtimeMs })).sort((a, b) => b.at - a.at);
    } catch {
      return [];
    }
  }
  const legacyRead = (name) => {
    if (!/^[\w.-]+\.json$/.test(String(name))) throw Object.assign(new Error("Which one?"), { status: 400 });
    return fs.readFileSync(path.join(dir(), "devices", name), "utf8");
  };

  return { get, put, keepLegacy, legacyList, legacyRead };
}
