// Music: your folders scanned for audio (tags and covers read with music-metadata), files served with
// seeking, and internet radio relayed so the page's visualizer may read it. Only files in the index can
// be served: a folder is added from the desktop page, never from a request's path.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { execFile } from "node:child_process";

/** "/f/Music" (how Git Bash writes F:\Music) → "F:\Music" on Windows. */
export function fromMsys(p) {
  const m = /^\/([a-zA-Z])(\/.*)?$/.exec(p);
  return m && process.platform === "win32" ? `${m[1].toUpperCase()}:${(m[2] || "/").replace(/\//g, "\\")}` : p;
}

/**
 * Folders inside a folder, for picking music folders from the desktop page (names only, no files). With no
 * path: the drives (Windows) or the usual places (Mac, Linux).
 */
export async function listFolders(where, placesFile, { newPlaces = true } = {}) {
  const home = process.env.USERPROFILE || process.env.HOME || "/";
  const share = netShare(String(where || ""));
  // Opening a network address makes this computer connect (and sign in) to it, so a new one is only reached from the
  // computer itself; other devices browse the places already opened here and the mapped drives.
  if (share && !newPlaces) {
    if (!(await knownPlace(where, placesFile))) throw new Error("A new network place is opened from the desktop's own computer first; then it's here for every device.");
  }
  if (share?.host && !share.share) {
    // a computer on the network: its shared folders (Windows' own `net view`; some networks don't answer it)
    const shares = await netView(share.host);
    if (!shares.length) throw new Error(`Couldn't see what \\\\${share.host} shares. Type the share's address too, like \\\\${share.host}\\media.`);
    return { path: `\\\\${share.host}`, parent: "", folders: shares.map((n) => ({ path: `\\\\${share.host}\\${n}`, name: n })), audio: 0 };
  }
  if (!where) {
    // each place is checked at the same time, and a disconnected network drive gets 1.5 s before it's left out
    const isDir = (p) =>
      Promise.race([fs.promises.stat(p).then((s) => s.isDirectory(), () => false), new Promise((ok) => setTimeout(() => ok(false), 1500))]);
    const candidates = [[path.join(home, "Music"), "Music (yours)"], [home, "Home"]];
    if (process.platform === "win32") for (const l of "CDEFGHIJKLMNOPQRSTUVWXYZ") candidates.push([`${l}:\\`, `${l}:`]);
    else candidates.push(["/Volumes", "Volumes"], ["/media", "media"], ["/mnt", "mnt"], ["/", "/"]);
    const ok = await Promise.all(candidates.map(([p]) => isDir(p)));
    // a drive that's a network share says which (M: · \\ALICEMOVIES\1 Alice), and network places opened before come after
    const mapped = await netUse();
    const places = readPlaces(placesFile).filter((p) => !Object.values(mapped).some((r) => r.toLowerCase() === p.toLowerCase()));
    const folders = candidates.filter((_, i) => ok[i]).map(([p, name]) => ({ path: p, name: mapped[name] ? `${name} · ${mapped[name]}` : name }));
    return { path: "", parent: null, folders: [...folders, ...places.map((p) => ({ path: p, name: p }))], audio: 0 };
  }
  const dir = path.resolve(fromMsys(String(where)));
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    if (share) throw new Error(`Couldn't open ${dir}. If it asks for a sign-in, open it once in Windows' File Explorer (Windows remembers it), then try again.`);
    throw e;
  }
  if (share?.share) rememberPlace(placesFile, `\\\\${share.host}\\${share.share}`);
  const folders = [];
  let audio = 0;
  for (const e of entries) {
    if (e.name.startsWith(".") || e.name === "$RECYCLE.BIN" || e.name === "System Volume Information") continue;
    let isDir = e.isDirectory();
    if (e.isSymbolicLink()) {
      try {
        isDir = fs.statSync(path.join(dir, e.name)).isDirectory();
      } catch {
        isDir = false;
      }
    }
    if (isDir) folders.push({ path: path.join(dir, e.name), name: e.name });
    else if (AUDIO.test(e.name)) audio++;
  }
  folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
  const up = path.dirname(dir);
  // (a share's top goes up to its computer's list of shares)
  return { path: dir, parent: up === dir ? (share ? `\\\\${share.host}` : "") : up, folders, audio };
}

/** Whether a folder is a network place this computer has already opened (or a mapped drive's), or not on the network. */
export async function knownPlace(folder, placesFile) {
  const s = netShare(String(folder));
  if (!s) return true;
  const known = [...readPlaces(placesFile), ...Object.values(await netUse())].map((p) => p.toLowerCase());
  return Boolean(s.share) && known.includes(`\\\\${s.host}\\${s.share}`.toLowerCase());
}

/** "\\host", "\\host\share" or a path inside a share → its host and share; anything else → null. */
export function netShare(p) {
  const m = /^\\\\([^\\/]+)(?:\\([^\\/]+))?/.exec(p.replace(/\//g, "\\"));
  return m ? { host: m[1], share: m[2] || "" } : null;
}

const run = (cmd, args) =>
  new Promise((ok) => execFile(cmd, args, { windowsHide: true, timeout: 8000 }, (_e, out) => ok(String(out || ""))));

/** Windows' mapped network drives: { "M:": "\\host\share" }. */
export async function netUse() {
  if (process.platform !== "win32") return {};
  const out = {};
  for (const line of (await run("net", ["use"])).split(/\r?\n/)) {
    // (a drive Windows can't reach right now, "Unavailable" or "Disconnected", is left out)
    const m = /^(\S*)\s+([A-Z]:)\s+(\\\\\S.*?)\s{2,}/.exec(line);
    if (m && !/^(Unavailable|Disconnected)$/i.test(m[1])) out[m[2]] = m[3].trim();
  }
  return out;
}

/** The disk shares a computer on the network offers (empty when it doesn't answer). */
export async function netView(host) {
  if (process.platform !== "win32" || !/^[\w.-]+$/.test(host)) return [];
  return parseNetView(await run("net", ["view", `\\\\${host}`]));
}
export function parseNetView(out) {
  const shares = [];
  for (const line of out.split(/\r?\n/)) {
    const cols = line.split(/\s{2,}/);
    if (cols.length >= 2 && /^Disk$/i.test(cols[1].trim()) && cols[0].trim()) shares.push(cols[0].trim());
  }
  return shares;
}

export function readPlaces(file) {
  try {
    return file ? JSON.parse(fs.readFileSync(file, "utf8")).filter((p) => typeof p === "string") : [];
  } catch {
    return [];
  }
}
export function rememberPlace(file, place) {
  if (!file) return;
  const now = readPlaces(file);
  if (now.some((p) => p.toLowerCase() === place.toLowerCase())) return;
  try {
    fs.writeFileSync(file, JSON.stringify([...now, place], null, 2));
  } catch {
    /* only a convenience */
  }
}

const AUDIO = /\.(mp3|m4a|m4b|aac|flac|ogg|oga|opus|wav|wma|webm|mka|aiff?|caf|alac)$/i;
const MIME = { mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", flac: "audio/flac", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg", wav: "audio/wav", webm: "audio/webm", mka: "audio/x-matroska", aif: "audio/aiff", aiff: "audio/aiff", wma: "audio/x-ms-wma" };
const MAX_FILES = 50_000;

export function createMusic(dataDir) {
  const indexFile = path.join(dataDir, "music-index.json");
  const ownDir = path.join(dataDir, "music");
  let index = { folders: [], tracks: {} };
  try {
    index = JSON.parse(fs.readFileSync(indexFile, "utf8"));
  } catch {
    /* first time */
  }
  const save = () => {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(indexFile, JSON.stringify(index));
  };
  const idOf = (p) => createHash("sha1").update(p).digest("hex").slice(0, 16);

  // folders read in the last scan, and ones that couldn't be opened
  let walked = 0;
  let unreadable = [];

  /** Every audio file under `dir`, following folder junctions and links (Windows libraries, OneDrive, moved Music folders). */
  function walk(dir, out, depth = 0, seen = new Set()) {
    if (depth > 24 || out.length >= MAX_FILES) return out;
    let real = dir;
    try {
      real = fs.realpathSync(dir);
    } catch {
      /* use it as given */
    }
    if (seen.has(real)) return out; // a link back up the tree
    seen.add(real);
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
      walked++;
    } catch {
      unreadable.push(dir);
      return out;
    }
    for (const e of entries) {
      if (e.name.startsWith(".") || e.name === "$RECYCLE.BIN" || e.name === "System Volume Information") continue;
      const full = path.join(dir, e.name);
      let isDir = e.isDirectory();
      let isFile = e.isFile();
      if (e.isSymbolicLink() || (!isDir && !isFile)) {
        try {
          const st = fs.statSync(full);
          isDir = st.isDirectory();
          isFile = st.isFile();
        } catch {
          continue;
        }
      }
      if (isDir) walk(full, out, depth + 1, seen);
      else if (isFile && AUDIO.test(e.name)) out.push(full);
      if (out.length >= MAX_FILES) break;
    }
    return out;
  }

  /** Read every folder again; only new or changed files are opened. */
  async function scan(folders) {
    const { parseFile } = await import("music-metadata");
    walked = 0;
    unreadable = [];
    const list = [...new Set([ownDir, ...folders.map((f) => path.resolve(fromMsys(String(f).trim().replace(/^["']|["']$/g, ""))))])];
    index.folders = list.filter((f) => f !== ownDir);
    const seen = new Set();
    let read = 0;
    let failed = 0;
    for (const folder of list) {
      if (!fs.existsSync(folder)) continue;
      for (const file of walk(folder, [])) {
        const id = idOf(file);
        seen.add(id);
        let st;
        try {
          st = fs.statSync(file);
        } catch {
          continue;
        }
        const old = index.tracks[id];
        if (old && old.mtime === st.mtimeMs && old.size === st.size) continue;
        const base = path.basename(file).replace(/\.[^.]+$/, "");
        const t = { id, path: file, folder, size: st.size, mtime: st.mtimeMs, title: base, artist: "", album: "", year: 0, track: 0, genre: "", duration: 0, cover: false, bitrate: 0 };
        try {
          const m = await parseFile(file, { duration: false, skipCovers: false });
          const c = m.common;
          Object.assign(t, {
            title: c.title || base,
            artist: c.artist || (c.artists || []).join(", ") || "",
            album: c.album || "",
            year: c.year || 0,
            track: c.track?.no || 0,
            genre: (c.genre || []).join(", "),
            duration: Math.round(m.format.duration || 0),
            bitrate: Math.round((m.format.bitrate || 0) / 1000),
            cover: Boolean(c.picture?.length),
            comment: (c.comment || []).map((x) => (typeof x === "string" ? x : x.text)).filter(Boolean).join(" ").slice(0, 300),
          });
          read++;
        } catch {
          failed++;
        }
        index.tracks[id] = t;
      }
    }
    for (const id of Object.keys(index.tracks)) if (!seen.has(id)) delete index.tracks[id];
    save();
    return { tracks: Object.keys(index.tracks).length, read, failed, folders: index.folders, walked, unreadable: unreadable.slice(0, 5) };
  }

  // (the file's own name goes along, for saying which file when one won't play; its full path stays here)
  const list = () => ({ folders: index.folders, own: ownDir, tracks: Object.values(index.tracks).map(({ path: p, mtime: _m, ...t }) => ({ ...t, file: path.basename(p), rel: path.relative(t.folder, p) })) });

  /** Stream a track, with byte ranges so seeking works. */
  function serve(req, res, id) {
    const t = index.tracks[id];
    if (!t || !fs.existsSync(t.path)) {
      res.statusCode = 404;
      return res.end();
    }
    const size = fs.statSync(t.path).size;
    const type = MIME[path.extname(t.path).slice(1).toLowerCase()] || "application/octet-stream";
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ""));
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Type", type);
    res.setHeader("Cache-Control", "no-store");
    if (range) {
      const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(size - 1, Number(range[2])) : size - 1;
      if (start >= size || start > end) {
        res.statusCode = 416;
        res.setHeader("Content-Range", `bytes */${size}`);
        return res.end();
      }
      res.statusCode = 206;
      res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
      res.setHeader("Content-Length", end - start + 1);
      return fs.createReadStream(t.path, { start, end }).pipe(res);
    }
    res.statusCode = 200;
    res.setHeader("Content-Length", size);
    fs.createReadStream(t.path).pipe(res);
  }

  async function cover(res, id) {
    const t = index.tracks[id];
    if (!t?.cover) {
      res.statusCode = 404;
      return res.end();
    }
    try {
      const { parseFile, selectCover } = await import("music-metadata");
      const m = await parseFile(t.path, { duration: false });
      const pic = selectCover(m.common.picture);
      if (!pic) throw new Error("none");
      res.setHeader("Content-Type", pic.format || "image/jpeg");
      res.setHeader("Cache-Control", "max-age=86400");
      res.end(Buffer.from(pic.data));
    } catch {
      res.statusCode = 404;
      res.end();
    }
  }

  /** Relay a radio stream (same-origin for the page, so its visualizer can read the sound). */
  async function radio(req, res, url) {
    let u;
    try {
      u = new URL(url);
    } catch {
      res.statusCode = 400;
      return res.end("Bad address");
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      res.statusCode = 400;
      return res.end("Bad address");
    }
    const ctrl = new AbortController();
    req.on("close", () => ctrl.abort());
    try {
      const r = await fetch(u, { headers: { "User-Agent": "PandoraDeeDesktop/3.10", "Icy-MetaData": "0" }, signal: ctrl.signal, redirect: "follow" });
      if (!r.ok || !r.body) {
        res.statusCode = 502;
        return res.end(`The station answered ${r.status}`);
      }
      res.statusCode = 200;
      res.setHeader("Content-Type", r.headers.get("content-type") || "audio/mpeg");
      res.setHeader("Cache-Control", "no-store");
      Readable.fromWeb(r.body).on("error", () => res.end()).pipe(res);
    } catch {
      if (!res.headersSent) res.statusCode = 502;
      res.end();
    }
  }

  /** A file added from the page goes into the data folder's music/. */
  function upload(name, bytes) {
    fs.mkdirSync(ownDir, { recursive: true });
    const clean = path.basename(String(name)).replace(/[\\/:*?"<>|]+/g, "_") || "track";
    if (!AUDIO.test(clean)) throw new Error("That isn't an audio file this player knows.");
    let target = path.join(ownDir, clean);
    for (let i = 2; fs.existsSync(target); i++) target = path.join(ownDir, clean.replace(/(\.[^.]+)$/, ` ${i}$1`));
    fs.writeFileSync(target, bytes);
    return path.basename(target);
  }

  /** Everything about one song for its Properties: where the file is, and how it's encoded. */
  async function info(id) {
    const t = index.tracks[id];
    if (!t) return null;
    let st = null;
    try {
      st = fs.statSync(t.path);
    } catch {
      /* gone since the last scan */
    }
    let format = {};
    try {
      const { parseFile } = await import("music-metadata");
      const m = await parseFile(t.path, { duration: true, skipCovers: true });
      const f = m.format;
      format = { container: f.container, codec: f.codec, sampleRate: f.sampleRate, channels: f.numberOfChannels, bitsPerSample: f.bitsPerSample, lossless: f.lossless, bitrate: f.bitrate ? Math.round(f.bitrate) : undefined, duration: f.duration };
    } catch {
      /* not readable now */
    }
    const { mtime: _m, ...rest } = t;
    return { ...rest, ...format, size: st?.size ?? t.size, modified: st?.mtimeMs ?? t.mtime, exists: Boolean(st), own: path.dirname(t.path) === ownDir || t.path.startsWith(ownDir + path.sep) };
  }

  /** A song's file renamed in its folder (its kind kept: .mp3 stays .mp3). Its id follows its path, so the new id comes
   *  back for playlists to follow. From another device only songs added here (the data folder's music/) can be. */
  function rename(id, name, { local = false } = {}) {
    const t = index.tracks[id];
    if (!t) throw Object.assign(new Error("That song isn't in the library any more."), { status: 404 });
    const own = t.path.startsWith(ownDir + path.sep);
    if (!local && !own) throw Object.assign(new Error("Songs in your music folders are renamed on the desktop's own computer; songs added from a device can be renamed from anywhere."), { status: 403 });
    const ext = path.extname(t.path);
    let stem = String(name ?? "").replace(/[\\/:*?"<>|\x00-\x1f]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 150);
    if (stem.toLowerCase().endsWith(ext.toLowerCase())) stem = stem.slice(0, -ext.length).trim();
    if (!stem || stem.startsWith(".")) throw Object.assign(new Error("What should it be called?"), { status: 400 });
    const target = path.join(path.dirname(t.path), stem + ext);
    if (target === t.path) return { id, file: path.basename(target) };
    if (target.toLowerCase() !== t.path.toLowerCase() && fs.existsSync(target)) throw Object.assign(new Error("Another song there already has that name."), { status: 409 });
    fs.renameSync(t.path, target);
    const old = path.basename(t.path, ext);
    const nid = idOf(target);
    delete index.tracks[id];
    // (the title follows when it was only ever the file's name)
    index.tracks[nid] = { ...t, id: nid, path: target, title: t.title === old ? stem : t.title };
    save();
    return { id: nid, file: path.basename(target) };
  }

  return { scan, list, serve, cover, radio, upload, info, rename, folders: () => index.folders };
}
