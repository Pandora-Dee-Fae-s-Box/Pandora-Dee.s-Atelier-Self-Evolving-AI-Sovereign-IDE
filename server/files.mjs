// Explorer: the desktop's file explorer. It reaches the desktop's own places (the vault, Vector's files, music
// folders, the data folder's music), and the rest of this computer only when that's switched on, and then only
// for requests made on this computer itself (never from phones or other devices on the network).
//
// Deleting moves to the data folder's trash, with a note of where each thing came from, so it can be restored.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { unzipSync } from "fflate";
import { netShare, netUse, netView, readPlaces, rememberPlace } from "./music.mjs";

const win = process.platform === "win32";
const mac = process.platform === "darwin";
const ZIP_MAX = 1_000_000_000; // a zip read whole into memory to unpack: up to 1 GB
const UNPACKED_MAX = 4_000_000_000;

/** A zip's file names made safe to write under a folder: no going up, no drive letters, no absolute paths. */
export function safeZipPath(name) {
  const parts = String(name).replace(/\\/g, "/").split("/").filter((x) => x && x !== "." && x !== "..");
  if (!parts.length || /^[a-z]:$/i.test(parts[0])) return null;
  return parts.map((p) => p.replace(/[<>:"|?*\x00-\x1f]/g, "_")).join("/");
}

export function createFiles({ dataDir, musicFolders, videoFolders = () => [], getWholePc, setWholePc, getSharing = () => ({}), setSharing = () => {} }) {
  // network places opened on this computer (\\computer\share), the same list Music's folder picker keeps
  const placesFile = () => path.join(dataDir(), "network-places.json");
  // what this computer shares with the other devices on the network: chosen folders, or all of it (both off at first)
  const sharing = () => {
    const s = getSharing() || {};
    return { wholePc: s.wholePc === true, folders: Array.isArray(s.folders) ? s.folders.filter((f) => typeof f === "string") : [] };
  };
  const trashDir = () => path.join(dataDir(), "trash");
  const trashIndex = () => path.join(trashDir(), "index.json");

  /** The desktop's own places: always reachable, from any device that opens the desktop. */
  function places() {
    const d = dataDir();
    const list = [
      { id: "vault", name: "Vault", path: path.join(d, "vault"), kind: "vault" },
      { id: "vector", name: "Vector files", path: path.join(d, "vector-host", "downloads"), kind: "vector" },
      { id: "music", name: "Music added here", path: path.join(d, "music"), kind: "music" },
      ...musicFolders().map((f, i) => ({ id: `music-${i}`, name: path.basename(f) || f, path: f, kind: "music" })),
      // Theater's watched folders (videos played where they are)
      ...videoFolders().map((f, i) => ({ id: `video-${i}`, name: f.name, path: f.path, kind: "video" })),
    ];
    for (const p of list) if ((p.kind !== "music" && p.kind !== "video") || p.id === "music") fs.mkdirSync(p.path, { recursive: true });
    return list.filter((p) => fs.existsSync(p.path));
  }

  /** The computer's drives, for when the whole computer is allowed. */
  function drives() {
    if (win)
      return [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"]
        .filter((l) => {
          try {
            return fs.statSync(`${l}:\\`).isDirectory();
          } catch {
            return false; // no such drive, or one with nothing in it (an empty card reader)
          }
        })
        .map((l) => ({ id: `drive-${l}`, name: `${l}:\\`, path: `${l}:\\`, kind: "drive" }));
    return [{ id: "home", name: "Home", path: os.homedir(), kind: "drive" }, { id: "root", name: "/", path: "/", kind: "drive" }];
  }

  const inside = (full, root) => {
    const a = path.resolve(full).toLowerCase(), b = path.resolve(root).toLowerCase();
    return a === b || a.startsWith(b.endsWith(path.sep) ? b : b + path.sep);
  };

  /** A path this request may use, or an error. `local`: the request came from this computer itself. */
  function allowed(p, local) {
    if (!p) throw Object.assign(new Error("No path."), { status: 400 });
    const full = path.resolve(String(p));
    if (local && getWholePc()) return full;
    // a network place, opened from this computer itself (typing its address is the choice to go there)
    if (local && netShare(full)?.share) return full;
    if (places().some((pl) => inside(full, pl.path))) return full;
    // a network place this computer has opened before (or a mapped drive's share): any device may go there too
    // (or any share on a computer one of those is on, since this computer already goes there; never a hidden admin
    // share like C$, which this computer's own sign-in might open)
    const ns = netShare(full);
    if (ns?.share && (knownPlaces().some((pl) => inside(full, pl)) || (knownHost(ns.host) && !ns.share.endsWith("$")))) return full;
    const sh = sharing();
    if (sh.wholePc || sh.folders.some((f) => inside(full, f))) return full;
    throw Object.assign(new Error("That's outside the desktop's places."), { status: 403 });
  }

  // the mapped drives' shares, as last read (net use takes a moment; read again with every Network list)
  let mappedShares = [];
  const knownPlaces = () => [...readPlaces(placesFile()), ...mappedShares];
  /** A computer one of the known places is on (its share list can be shown to any device). */
  const knownHost = (host) => knownPlaces().some((p) => netShare(p)?.host?.toLowerCase() === String(host).toLowerCase());

  /** Network places: the ones this computer opened before, and the mapped drives' shares. Every device sees them;
   *  only this computer opens new ones (opening one makes this computer connect to that host). */
  async function network(local) {
    mappedShares = Object.values(await netUse());
    void local;
    const seen = new Set();
    return knownPlaces()
      .filter((p) => !seen.has(p.toLowerCase()) && seen.add(p.toLowerCase()))
      .map((p, i) => ({ id: `net-${i}`, name: p.replace(/^\\\\/, ""), path: p, kind: "network" }));
  }

  /** A folder's contents, a network computer's shares, or a network share (remembered once it opens). */
  async function listAny(p, local) {
    const s = netShare(String(p || ""));
    if (s && !s.share) {
      if (!local && !knownHost(s.host)) throw Object.assign(new Error("New network places are opened on the desktop's own computer first; then every device has them."), { status: 403 });
      const shares = await netView(s.host);
      if (!shares.length) throw Object.assign(new Error(`Couldn't see what \\\\${s.host} shares. Type the share's address too, like \\\\${s.host}\\media.`), { status: 404 });
      return { path: `\\\\${s.host}`, parent: null, entries: shares.map((n) => ({ name: n, path: `\\\\${s.host}\\${n}`, dir: true, size: 0, mtime: 0, ext: "" })) };
    }
    let out;
    try {
      out = list(p, local);
    } catch (e) {
      if (s && e.code && e.code !== "EACCES") throw Object.assign(new Error(`Couldn't open ${p}. If it asks for a sign-in, open it once in Windows' File Explorer (Windows remembers it), then try again.`), { status: 404 });
      throw e;
    }
    if (s) {
      if (local) rememberPlace(placesFile(), `\\\\${s.host}\\${s.share}`);
      if (!out.parent) out.parent = `\\\\${s.host}`; // a share's top goes up to its computer's shares
    }
    return out;
  }

  /** A .zip unpacked into a new folder beside it, named after it. Nothing already there is overwritten. */
  function unzip(p, local) {
    const file = allowed(p, local);
    const st = fs.statSync(file);
    if (st.size > ZIP_MAX) throw Object.assign(new Error("That zip is over 1 GB; unpack it on the computer itself."), { status: 413 });
    let items;
    try {
      items = unzipSync(new Uint8Array(fs.readFileSync(file)));
    } catch {
      throw Object.assign(new Error(`${path.basename(file)} couldn't be opened as a zip.`), { status: 400 });
    }
    const total = Object.values(items).reduce((n, b) => n + b.length, 0);
    if (total > UNPACKED_MAX) throw Object.assign(new Error("That zip unpacks to more than 4 GB."), { status: 413 });
    const dir = freeName(path.dirname(file), path.basename(file).replace(/\.zip$/i, "") || "unpacked");
    fs.mkdirSync(dir, { recursive: true });
    let count = 0;
    for (const [name, bytes] of Object.entries(items)) {
      const rel = safeZipPath(name);
      if (!rel) continue;
      const to = path.join(dir, ...rel.split("/"));
      if (!inside(to, dir)) continue;
      if (name.endsWith("/")) {
        fs.mkdirSync(to, { recursive: true });
        continue;
      }
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.writeFileSync(to, bytes, { flag: "wx" });
      count++;
    }
    return { path: dir, files: count };
  }

  function overview(local) {
    return {
      places: places(),
      wholePc: { on: Boolean(getWholePc()), local, drives: (local && getWholePc()) || sharing().wholePc ? drives() : [] },
      // what's shared with the network; only the computer itself can change it
      sharing: {
        wholePc: sharing().wholePc,
        folders: sharing().folders.filter((f) => fs.existsSync(f)).map((f, i) => ({ id: `share-${i}`, name: path.basename(f) || f, path: f, kind: "shared" })),
        canChange: local,
      },
      deviceExplorer: local,
    };
  }

  /** A folder's contents (folders first). The vault's own housekeeping folders stay out of sight. */
  function list(p, local) {
    const dir = allowed(p, local);
    if (!fs.statSync(dir).isDirectory()) throw Object.assign(new Error("That's not a folder."), { status: 400 });
    const hidden = new Set([".trash", ".pandora", "node_modules", ".git"]);
    const entries = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (hidden.has(e.name)) continue;
      const full = path.join(dir, e.name);
      let st;
      try {
        st = fs.statSync(full);
      } catch {
        continue; // a broken link, or something not ours to read
      }
      entries.push({ name: e.name, path: full, dir: st.isDirectory(), size: st.isDirectory() ? 0 : st.size, mtime: st.mtimeMs, ext: st.isDirectory() ? "" : path.extname(e.name).slice(1).toLowerCase() });
    }
    entries.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
    // the folder above, while it's still somewhere this request may go
    const up = path.dirname(dir);
    let parent = null;
    try {
      if (up !== dir) parent = allowed(up, local);
    } catch {
      parent = null;
    }
    return { path: dir, parent, entries };
  }

  function stat(p, local) {
    const full = allowed(p, local);
    const st = fs.statSync(full);
    return { path: full, name: path.basename(full), dir: st.isDirectory(), size: st.size, mtime: st.mtimeMs, ctime: st.birthtimeMs || st.ctimeMs, ext: path.extname(full).slice(1).toLowerCase() };
  }

  const safeName = (n) => path.basename(String(n || "")).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim() || "file";

  /** A free name in `dir` ("photo.jpg", then "photo (2).jpg"…). */
  function freeName(dir, name) {
    const ext = path.extname(name), stem = name.slice(0, name.length - ext.length);
    let n = 1, candidate = name;
    while (fs.existsSync(path.join(dir, candidate))) candidate = `${stem} (${++n})${ext}`;
    return path.join(dir, candidate);
  }

  function upload(dirP, name, bytes, local) {
    const dir = allowed(dirP, local);
    fs.mkdirSync(dir, { recursive: true });
    const file = freeName(dir, safeName(name));
    fs.writeFileSync(file, bytes);
    return file;
  }

  function mkdir(dirP, name, local) {
    const parent = allowed(dirP, local);
    const dir = freeName(parent, safeName(name || "New folder"));
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  /** Move across drives too (copy, then remove the original). */
  function moveAny(from, to) {
    try {
      fs.renameSync(from, to);
    } catch (e) {
      if (e.code !== "EXDEV") throw e;
      fs.cpSync(from, to, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
      fs.rmSync(from, { recursive: true, force: true });
    }
  }

  /** Rename (a new name in the same folder) or move (into another folder). */
  function move(fromP, { name, into }, local) {
    const from = allowed(fromP, local);
    const dir = into ? allowed(into, local) : path.dirname(from);
    if (inside(dir, from)) throw Object.assign(new Error("A folder can't go inside itself."), { status: 400 });
    const target = path.join(dir, name ? safeName(name) : path.basename(from));
    if (path.resolve(target).toLowerCase() === path.resolve(from).toLowerCase() && target !== from) {
      fs.renameSync(from, target); // only the letters' case changed
      return target;
    }
    if (fs.existsSync(target)) throw Object.assign(new Error("Something there already has that name."), { status: 409 });
    moveAny(from, target);
    return target;
  }

  function readTrash() {
    try {
      return JSON.parse(fs.readFileSync(trashIndex(), "utf8"));
    } catch {
      return [];
    }
  }
  const writeTrash = (list) => (fs.mkdirSync(trashDir(), { recursive: true }), fs.writeFileSync(trashIndex(), JSON.stringify(list, null, 1)));

  function trash(p, local) {
    const from = allowed(p, local);
    if (places().some((pl) => path.resolve(pl.path).toLowerCase() === from.toLowerCase())) throw Object.assign(new Error("A place itself can't go to the trash."), { status: 400 });
    const id = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
    const to = path.join(trashDir(), id, path.basename(from));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    moveAny(from, to);
    writeTrash([...readTrash(), { id, from, name: path.basename(from), at: Date.now() }]);
    return { id };
  }

  function trashList() {
    return readTrash().filter((t) => fs.existsSync(path.join(trashDir(), t.id, t.name))).sort((a, b) => b.at - a.at);
  }

  /** Back where it was (or beside it, with a new name, if that name is taken now). */
  function restore(id, local) {
    const list = readTrash();
    const t = list.find((x) => x.id === id);
    if (!t) throw Object.assign(new Error("That isn't in the trash."), { status: 404 });
    const dir = allowed(path.dirname(t.from), local);
    fs.mkdirSync(dir, { recursive: true });
    const to = freeName(dir, t.name);
    moveAny(path.join(trashDir(), t.id, t.name), to);
    fs.rmSync(path.join(trashDir(), t.id), { recursive: true, force: true });
    writeTrash(list.filter((x) => x.id !== id));
    return to;
  }

  /** The computer's own file manager, with the file selected (only for requests made on this computer). */
  function revealOnDevice(p, local) {
    if (!local) throw Object.assign(new Error("That opens on the computer running the desktop; it isn't available from here."), { status: 403 });
    const full = allowed(p, local);
    const isDir = fs.statSync(full).isDirectory();
    // Explorer wants exactly /select,"C:\a path\file" (its own quoting, not the usual)
    if (win) spawn("explorer.exe", [isDir ? `"${full}"` : `/select,"${full}"`], { detached: true, stdio: "ignore", windowsVerbatimArguments: true }).unref();
    else if (mac) spawn("open", isDir ? [full] : ["-R", full], { detached: true, stdio: "ignore" }).unref();
    else spawn("xdg-open", [isDir ? full : path.dirname(full)], { detached: true, stdio: "ignore" }).unref();
  }

  function setWhole(on, local) {
    if (!local) throw Object.assign(new Error("This can only be changed on the computer running the desktop."), { status: 403 });
    setWholePc(Boolean(on));
    return overview(local);
  }

  /** Share a folder with the network, or stop; or the whole computer (only from the computer itself). */
  function share({ path: p, on, wholePc }, local) {
    if (!local) throw Object.assign(new Error("Sharing is changed on the computer running the desktop."), { status: 403 });
    const s = sharing();
    if (typeof wholePc === "boolean") s.wholePc = wholePc;
    if (p) {
      const full = path.resolve(String(p));
      if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) throw Object.assign(new Error("Only folders can be shared."), { status: 400 });
      s.folders = s.folders.filter((f) => path.resolve(f).toLowerCase() !== full.toLowerCase());
      if (on) s.folders.push(full);
    }
    setSharing(s);
    return overview(local);
  }

  return { share, overview, network, list, listAny, unzip, stat, allowed, upload, mkdir, move, trash, trashList, restore, revealOnDevice, setWhole };
}
