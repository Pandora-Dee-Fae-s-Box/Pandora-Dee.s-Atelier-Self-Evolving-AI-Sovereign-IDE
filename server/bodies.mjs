// Each character's files on disk, so her other bodies can share them: data/bodies/<id>/, in Classic's layout
// (/Pandora/SOUL.md, /Pandora/Memory.md, /agents.md, /Pandora/Journal/…), the layout Pandora Dee, Jade Vault and
// jade-py read as a vault. The desktop mirrors her files here (lib/bodies.ts); what another body changes since the
// last mirror can be taken back from here, file by file, when the person asks.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const hash = (text) => crypto.createHash("sha256").update(String(text)).digest("hex").slice(0, 32);

export const BODY_ID = /^[\w-]{1,64}$/;
const TEXT = /\.(md|json|txt|js|ts|py|yaml|yml|csv|lisp|dl|html|css)$/i;
const MANIFEST = ".mirror.json";

export function createBodies({ dataDir }) {
  const dirOf = (id) => {
    if (!BODY_ID.test(id)) throw Object.assign(new Error("That isn't a character id."), { status: 400 });
    return path.join(dataDir(), "bodies", id);
  };
  /** A vault path ("/Pandora/SOUL.md") inside her folder, refusing anything that climbs out. */
  const fileIn = (dir, p) => {
    const full = path.resolve(dir, String(p).replace(/^\/+/, ""));
    if (!full.startsWith(dir + path.sep)) throw Object.assign(new Error(`${p} isn't inside her folder.`), { status: 400 });
    return full;
  };
  const walk = (dir, base = dir, out = []) => {
    if (!fs.existsSync(dir)) return out;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, base, out);
      else if (e.name !== MANIFEST && TEXT.test(e.name)) out.push(full);
    }
    return out;
  };
  const vaultPath = (dir, full) => "/" + path.relative(dir, full).split(path.sep).join("/");
  const readManifest = (dir) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, MANIFEST), "utf8"));
    } catch {
      return {};
    }
  };

  return {
    dir: dirOf,

    /** Mirror her files (vault path → text): written, and anything of hers no longer there removed. */
    write(id, files) {
      const dir = dirOf(id);
      fs.mkdirSync(dir, { recursive: true });
      const manifest = {};
      for (const [p, text] of Object.entries(files)) {
        const full = fileIn(dir, p);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        if (!fs.existsSync(full) || fs.readFileSync(full, "utf8") !== text) fs.writeFileSync(full, String(text));
        manifest[vaultPath(dir, full)] = fs.statSync(full).mtimeMs;
      }
      for (const full of walk(dir)) if (!(vaultPath(dir, full) in manifest)) fs.rmSync(full, { force: true });
      fs.writeFileSync(path.join(dir, MANIFEST), JSON.stringify(manifest));
      return { dir, files: Object.keys(manifest).length };
    },

    /**
     * Two ways, safely: the desktop's files and her folder agree file by file against what they last agreed on (a
     * fingerprint kept in the folder). Only the desktop changed a file: the folder gets it. Only the folder changed
     * it (another body, a resident working there): it comes back to the desktop. A new file in the folder comes back
     * too, instead of being removed. Both changed it: the desktop's version stays, and the folder's is kept beside it
     * as a dated copy, which also comes back, so nothing is lost. Returns what comes back and what clashed.
     */
    sync(id, files) {
      const dir = dirOf(id);
      fs.mkdirSync(dir, { recursive: true });
      const old = readManifest(dir);
      // older folders kept only a time per file; then "agreed" means: not touched since that time
      const agreed = (p, full) => {
        const m = old[p];
        if (m && typeof m === "object") return m.h;
        if (typeof m === "number" && fs.existsSync(full) && fs.statSync(full).mtimeMs <= m + 1) return hash(fs.readFileSync(full, "utf8"));
        return undefined;
      };
      const incoming = {};
      const clashes = [];
      const manifest = {};
      // this computer's own time, as people read it (2026-11-08 0732)
      const n = new Date();
      const two = (x) => String(x).padStart(2, "0");
      const stamp = `${n.getFullYear()}-${two(n.getMonth() + 1)}-${two(n.getDate())} ${two(n.getHours())}${two(n.getMinutes())}`;
      const seen = new Set();
      for (const [p, text] of Object.entries(files)) {
        const full = fileIn(dir, p);
        const vp = vaultPath(dir, full);
        seen.add(vp);
        const was = agreed(vp, full);
        const desk = hash(text);
        const disk = fs.existsSync(full) ? hash(fs.readFileSync(full, "utf8")) : undefined;
        if (disk === desk) manifest[vp] = { h: desk };
        else if (disk === undefined || disk === was) {
          // the folder didn't change it (or doesn't have it): the desktop's version goes there
          fs.mkdirSync(path.dirname(full), { recursive: true });
          fs.writeFileSync(full, String(text));
          manifest[vp] = { h: desk };
        } else if (desk === was) {
          // only the folder changed it: it comes back
          incoming[vp] = fs.readFileSync(full, "utf8");
          manifest[vp] = { h: disk };
        } else {
          // both changed it: the desktop's stays, the folder's is kept as a dated copy (and comes back)
          const theirs = fs.readFileSync(full, "utf8");
          const ext = path.extname(full);
          const copy = `${full.slice(0, full.length - ext.length)} (from the folder ${stamp})${ext}`;
          fs.writeFileSync(copy, theirs);
          fs.writeFileSync(full, String(text));
          const cp = vaultPath(dir, copy);
          incoming[cp] = theirs;
          manifest[vp] = { h: desk };
          manifest[cp] = { h: hash(theirs) };
          seen.add(cp);
          clashes.push(vp);
        }
      }
      for (const full of walk(dir)) {
        const vp = vaultPath(dir, full);
        if (seen.has(vp)) continue;
        const now = hash(fs.readFileSync(full, "utf8"));
        const was = agreed(vp, full);
        if (was !== undefined && now === was) {
          // the desktop let go of it, and the folder didn't touch it since: it goes
          fs.rmSync(full, { force: true });
        } else {
          // new in the folder, or changed there after the desktop let go of it: it comes back
          incoming[vp] = fs.readFileSync(full, "utf8");
          manifest[vp] = { h: now };
        }
      }
      fs.writeFileSync(path.join(dir, MANIFEST), JSON.stringify(manifest));
      return { dir, incoming, clashes };
    },

    /** Her folder as it is, and which files another body changed (or added) since the last mirror. */
    read(id) {
      const dir = dirOf(id);
      const manifest = readManifest(dir);
      const files = {};
      const changed = [];
      for (const full of walk(dir)) {
        const p = vaultPath(dir, full);
        files[p] = fs.readFileSync(full, "utf8");
        const m = manifest[p];
        const moved = m === undefined || (typeof m === "object" ? hash(files[p]) !== m.h : fs.statSync(full).mtimeMs > m + 1);
        if (moved) changed.push(p);
      }
      return { dir, files, changed };
    },
  };
}
