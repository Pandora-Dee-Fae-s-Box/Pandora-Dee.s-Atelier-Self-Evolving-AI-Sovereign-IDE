// Linked folders: a folder somewhere else (a network share like \\ALICEMOVIES\texts, or any folder on this computer)
// that characters can read as part of their files, under library/<name>/…, without it being copied into SEASIDE.
// Read-only: they list, read and search it; it stays where it is. A link is made on the desktop's own computer (it
// decides what this computer reads); the characters can read through it from any device.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const TEXT = /\.(txt|md|markdown|json|jsonl|csv|tsv|xml|html?|yml|yaml|toml|ini|log|srt|vtt|rtf|tex|org|adoc|rst)$/i;
const READ_MAX = 2_000_000; // one file read whole
const SEARCH_FILES = 4000; // files looked through by one search
const SEARCH_HITS = 60;

const clean = (s, n) => String(s ?? "").replace(/[\x00-\x1f]/g, "").trim().slice(0, n);
export const linkName = (s) => clean(s, 60).replace(/[\\/:*?"<>|]/g, "-").replace(/^\.+/, "") || "linked";

export function createLibrary({ dataDir }) {
  const file = () => path.join(dataDir(), "library-links.json");
  const catalogs = new Map(); // who → { at, files } (the fserve, below)
  const read = () => {
    try {
      const j = JSON.parse(fs.readFileSync(file(), "utf8"));
      return Array.isArray(j) ? j.filter((l) => l && typeof l.name === "string" && typeof l.path === "string") : [];
    } catch {
      return [];
    }
  };
  // (what each character hands out is looked at again whenever the links change)
  const write = (links) => (fs.writeFileSync(file(), JSON.stringify(links, null, 2)), catalogs.clear());

  /** The links one character may read ("all" links, and the ones made for them). */
  const forChar = (who) => read().filter((l) => !l.for?.length || l.for.includes(String(who)));

  /** Link a folder (from the computer itself): for everyone, or for the characters named. Same folder: updated. */
  function link({ path: p, name, for: whom }) {
    const full = path.resolve(String(p || ""));
    if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) throw Object.assign(new Error("Only a folder can be linked."), { status: 400 });
    const links = read().filter((l) => path.resolve(l.path).toLowerCase() !== full.toLowerCase());
    let n = linkName(name || path.basename(full) || full);
    const taken = new Set(links.map((l) => l.name.toLowerCase()));
    for (let i = 2; taken.has(n.toLowerCase()); i++) n = `${linkName(name || path.basename(full))} ${i}`;
    const entry = { name: n, path: full, for: Array.isArray(whom) ? whom.map(String).filter(Boolean) : [], at: Date.now() };
    write([...links, entry]);
    return entry;
  }
  function unlink(p) {
    const full = path.resolve(String(p || "")).toLowerCase();
    write(read().filter((l) => path.resolve(l.path).toLowerCase() !== full && l.name !== p));
    return { ok: true };
  }

  /** "name/a/b" for this character → the link and the full path inside it (or an error a character can read). */
  function resolve(who, rel) {
    const parts = String(rel || "").replace(/\\/g, "/").split("/").filter((x) => x && x !== "." && x !== "..");
    const l = forChar(who).find((x) => x.name.toLowerCase() === String(parts[0] || "").toLowerCase());
    if (!l) throw Object.assign(new Error(`There's no linked folder called "${parts[0] || ""}". Your linked folders: ${forChar(who).map((x) => x.name).join(", ") || "none yet"}.`), { status: 404 });
    const full = path.join(l.path, ...parts.slice(1));
    const base = path.resolve(l.path).toLowerCase();
    if (!(path.resolve(full).toLowerCase() === base || path.resolve(full).toLowerCase().startsWith(base + path.sep))) throw Object.assign(new Error("That's outside the linked folder."), { status: 403 });
    return { l, full, rel: parts.join("/") };
  }

  /** A folder inside a link (or the links themselves, for "" ): names, folders marked with a trailing /. */
  function list(who, rel) {
    if (!String(rel || "").replace(/[\\/]/g, "")) return forChar(who).map((l) => ({ name: `${l.name}/`, dir: true }));
    const { full } = resolve(who, rel);
    return fs
      .readdirSync(full, { withFileTypes: true })
      .filter((e) => !e.name.startsWith("."))
      .map((e) => ({ name: e.isDirectory() ? `${e.name}/` : e.name, dir: e.isDirectory() }))
      .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
  }

  /** A text file inside a link (up to 2 MB). */
  function readFile(who, rel) {
    const { full } = resolve(who, rel);
    const st = fs.statSync(full);
    if (st.isDirectory()) throw Object.assign(new Error("That's a folder: list it to see what's inside."), { status: 400 });
    if (st.size > READ_MAX) throw Object.assign(new Error(`That file is ${Math.round(st.size / 1e6)} MB, more than can be read at once.`), { status: 413 });
    const buf = fs.readFileSync(full);
    if (!TEXT.test(full) && buf.subarray(0, 4000).includes(0)) throw Object.assign(new Error("That isn't a text file."), { status: 415 });
    return buf.toString("utf8");
  }

  /** Lines containing the words, through the text files of one link (or all of them), "path:line: text". */
  function search(who, query, within = "") {
    const q = String(query || "").toLowerCase().trim();
    if (!q) return [];
    const roots = within ? [resolve(who, within)] : forChar(who).map((l) => ({ l, full: l.path, rel: l.name }));
    const hits = [];
    let seen = 0;
    const walk = (dir, rel, depth) => {
      if (depth > 12 || hits.length >= SEARCH_HITS || seen >= SEARCH_FILES) return;
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (hits.length >= SEARCH_HITS || seen >= SEARCH_FILES || e.name.startsWith(".")) continue;
        const full = path.join(dir, e.name), r = `${rel}/${e.name}`;
        if (e.isDirectory()) walk(full, r, depth + 1);
        else if (TEXT.test(e.name)) {
          seen++;
          let text;
          try {
            if (fs.statSync(full).size > READ_MAX) continue;
            text = fs.readFileSync(full, "utf8");
          } catch {
            continue;
          }
          if (!text.toLowerCase().includes(q)) continue;
          text.split(/\r?\n/).forEach((line, i) => {
            if (hits.length < SEARCH_HITS && line.toLowerCase().includes(q)) hits.push(`${r}:${i + 1}: ${line.trim().slice(0, 240)}`);
          });
        }
      }
    };
    for (const { full, rel } of roots) walk(full, rel, 0);
    return hits;
  }

  // ---- the fserve: a character hands out files from the linked folders she may serve (each keeps her own library) ----

  /** Whether the characters a folder is linked for may hand out its files (on Vector and Discord). */
  function setServe(p, on) {
    const full = path.resolve(String(p || "")).toLowerCase();
    const links = read();
    const l = links.find((x) => path.resolve(x.path).toLowerCase() === full || x.name === p);
    if (!l) throw Object.assign(new Error("That folder isn't linked."), { status: 404 });
    l.serve = Boolean(on);
    write(links);
    return l;
  }

  /** Every file she may hand out, numbered (shelf by shelf, names in order): what `!list`, `@find` and `!get 12` use. */
  function catalog(who, fresh = false) {
    const c = catalogs.get(who);
    if (c && !fresh && Date.now() - c.at < 5 * 60_000) return c.files;
    const files = [];
    for (const l of forChar(who).filter((x) => x.serve).sort((a, b) => a.name.localeCompare(b.name))) {
      const walk = (dir, rel, depth) => {
        if (depth > 6 || files.length >= 5000) return;
        let entries;
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
          return;
        }
        entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
        for (const e of entries) {
          if (e.name.startsWith(".") || files.length >= 5000) continue;
          const full = path.join(dir, e.name);
          if (e.isDirectory()) walk(full, `${rel}/${e.name}`, depth + 1);
          else {
            let size = 0;
            try {
              size = fs.statSync(full).size;
            } catch {
              continue;
            }
            files.push({ n: files.length + 1, shelf: l.name, rel: `${rel}/${e.name}`.replace(/^\//, ""), name: e.name, size, full });
          }
        }
      };
      walk(l.path, "", 0);
    }
    catalogs.set(who, { at: Date.now(), files });
    return files;
  }
  const publicOf = ({ full: _f, ...rest }) => rest;

  /** Her shelves: names and how many files each holds. */
  const shelves = (who) => {
    const out = new Map();
    for (const f of catalog(who)) out.set(f.shelf, (out.get(f.shelf) ?? 0) + 1);
    return [...out.entries()].map(([name, count]) => ({ name, count }));
  };
  /** Files whose name or path has every word. */
  function find(who, words) {
    const w = String(words || "").toLowerCase().split(/\s+/).filter(Boolean);
    if (!w.length) return [];
    return catalog(who)
      .filter((f) => w.every((x) => `${f.shelf}/${f.rel}`.toLowerCase().includes(x)))
      .slice(0, 25)
      .map(publicOf);
  }
  /** One file by its number (or its exact name). */
  function pick(who, which) {
    const all = catalog(who);
    const n = Number(String(which).replace(/^#/, ""));
    const f = Number.isInteger(n) && n > 0 ? all[n - 1] : all.find((x) => x.name.toLowerCase() === String(which).toLowerCase().trim());
    if (!f) throw Object.assign(new Error("There's no file with that number on the shelves; !list or @find shows them."), { status: 404 });
    return f;
  }

  // SHA-256 of each file handed out, kept by path, size and date so it's worked out once
  const hashFile = () => path.join(dataDir(), "fserve-hashes.json");
  async function sha256(f) {
    let st;
    try {
      st = fs.statSync(f.full);
    } catch {
      throw Object.assign(new Error("That file isn't there any more."), { status: 404 });
    }
    let all = {};
    try {
      all = JSON.parse(fs.readFileSync(hashFile(), "utf8"));
    } catch {
      /* none yet */
    }
    const key = `${f.full}\u0000${st.size}\u0000${Math.round(st.mtimeMs)}`;
    if (all[key]) return all[key];
    const h = crypto.createHash("sha256");
    await new Promise((resolve, reject) => fs.createReadStream(f.full).on("data", (d) => h.update(d)).on("end", resolve).on("error", reject));
    all[key] = h.digest("hex");
    fs.writeFileSync(hashFile(), JSON.stringify(all));
    return all[key];
  }

  // links for big files: a ticket good for a day, for that one file
  // (kept in the data folder, so a link still works after the server restarts)
  const ticketFile = () => path.join(dataDir(), "fserve-tickets.json");
  const readTickets = () => {
    try {
      return JSON.parse(fs.readFileSync(ticketFile(), "utf8"));
    } catch {
      return {};
    }
  };
  function ticket(f, hours = 24) {
    const t = crypto.randomBytes(18).toString("base64url");
    const all = Object.fromEntries(Object.entries(readTickets()).filter(([, v]) => v.until > Date.now()));
    all[t] = { full: f.full, name: f.name, until: Date.now() + hours * 3600_000 };
    fs.writeFileSync(ticketFile(), JSON.stringify(all));
    return t;
  }
  const redeem = (t) => {
    const x = readTickets()[String(t)];
    return x && x.until > Date.now() ? x : null;
  };

  return { links: read, forChar, link, unlink, list, readFile, search, setServe, catalog: (who, fresh) => catalog(who, fresh).map(publicOf), shelves, find, pick, sha256, ticket, redeem };
}
