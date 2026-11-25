// A web game (a folder, a .zip of one, or a single .html page) made into a webxdc Mini App, ready to edit in XDC
// Studio. Mini Apps can't reach the internet, so scripts, stylesheets and fonts the game loads from elsewhere (a CDN)
// are fetched once and kept inside it when the web is allowed; what's still out there afterwards is listed, so it's
// clear what may not work. Pure apart from `fetchLinked` and `readFolder` (webgame.test.mjs).

import fs from "node:fs";
import path from "node:path";
import { strFromU8, strToU8, unzipSync } from "fflate";

const JUNK = /(^|\/)(__MACOSX|\.git|\.svn|node_modules|\.DS_Store|Thumbs\.db|desktop\.ini)(\/|$)/i;
const HTML = /\.html?$/i;
export const LIMIT = { files: 5000, bytes: 300_000_000, fetched: 60, fetchedBytes: 40_000_000 };

/** The game's files from what was sent: a zip, or one page. */
export function fromUpload(bytes, filename) {
  const name = String(filename || "game");
  if (/\.zip$/i.test(name) || (bytes[0] === 0x50 && bytes[1] === 0x4b)) {
    let files;
    try {
      files = unzipSync(new Uint8Array(bytes));
    } catch {
      throw new Error(`${name} couldn't be opened as a zip.`);
    }
    return { files: Object.fromEntries(Object.entries(files).filter(([k]) => !k.endsWith("/"))), stem: name.replace(/\.[^.]+$/, "") };
  }
  if (HTML.test(name)) return { files: { [path.basename(name)]: new Uint8Array(bytes) }, stem: name.replace(/\.[^.]+$/, "") };
  throw new Error(`${name} isn't a web game: send its folder, a .zip of it, or its .html page.`);
}

/** The game's files from a folder on the desktop (not too many, not too big). */
export function readFolder(dir) {
  const files = {};
  let count = 0;
  let size = 0;
  const walk = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (JUNK.test(r)) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full, r);
      else if (e.isFile()) {
        if (++count > LIMIT.files) throw new Error(`That folder has more than ${LIMIT.files} files; is it really one game?`);
        const b = fs.readFileSync(full);
        size += b.length;
        if (size > LIMIT.bytes) throw new Error("That folder is over 300 MB, too big for a Mini App.");
        files[r] = new Uint8Array(b);
      }
    }
  };
  walk(dir, "");
  return { files, stem: path.basename(dir) };
}

/** From one file's folder to another file: "a/b.html" → "img/x.png" is "../img/x.png". */
function relTo(from, to) {
  const a = from.split("/").slice(0, -1);
  const b = to.split("/");
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => ".."), ...b.slice(i)].join("/") || to;
}

const ATTR = /\b(src|href|poster|data-src)\s*=\s*(["'])([^"']*)\2/gi;
const CSS_URL = /url\(\s*(["']?)([^"')]+)\1\s*\)/gi;
const REMOTE = /^(https?:)?\/\//i;
/** The tag an attribute at `i` is in ("script", "link", "a"…). */
const tagAt = (text, i) => (/<\s*([a-z0-9-]+)[^<]*$/i.exec(text.slice(Math.max(0, i - 2000), i))?.[1] ?? "").toLowerCase();
/** An address the page loads (not a link to follow): src and poster anywhere, href only on <link>. */
const loaded = (text, m) => REMOTE.test(m[3]) && (m[1].toLowerCase() !== "href" || tagAt(text, m.index) === "link");

/** Links that start with "/" (the root of the site the game was made for) pointed at the game's own files. */
function rootLinks(text, file, have) {
  const fix = (u) => {
    if (!u.startsWith("/") || u.startsWith("//")) return null;
    const clean = u.slice(1).split(/[?#]/)[0];
    return have.has(clean) ? relTo(file, clean) + u.slice(1 + clean.length) : null;
  };
  return text
    .replace(ATTR, (m, a, q, u) => {
      const f = fix(u);
      return f === null ? m : `${a}=${q}${f}${q}`;
    })
    .replace(CSS_URL, (m, q, u) => {
      const f = fix(u);
      return f === null ? m : `url(${q}${f}${q})`;
    });
}

const titleOf = (html) => (/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ?? "").replace(/\s+/g, " ").trim();
const tomlStr = (s) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** The files made into a Mini App: its page found (or made) as index.html, clutter left out, links from the site's
 *  root pointed at its own files, a manifest and an icon. Returns what was done, in plain words. */
export function makeMiniApp(input, stem) {
  let files = Object.fromEntries(Object.entries(input).filter(([k]) => !JUNK.test(k)).map(([k, v]) => [k.replace(/\\/g, "/").replace(/^\.?\//, ""), v]));
  const done = [];
  // everything inside one folder (a zip of the game's folder): that folder is the game
  const tops = new Set(Object.keys(files).map((k) => k.split("/")[0]));
  if (tops.size === 1 && !files["index.html"]) {
    const [top] = tops;
    if (Object.keys(files).every((k) => k.startsWith(`${top}/`))) {
      files = Object.fromEntries(Object.entries(files).map(([k, v]) => [k.slice(top.length + 1), v]));
      stem ||= top;
    }
  }
  let page = files["index.html"] ? "index.html" : files["index.htm"] ? "index.htm" : "";
  if (!page) {
    const pages = Object.keys(files).filter((k) => HTML.test(k)).sort((a, b) => a.split("/").length - b.split("/").length || a.length - b.length);
    if (!pages.length) throw new Error("There's no .html page in it, so there's nothing to play.");
    page = pages[0];
  }
  if (page !== "index.html") {
    if (!page.includes("/")) {
      files["index.html"] = files[page];
      if (page !== "index.htm") done.push(`${page} is its first page (index.html).`);
      delete files[page];
    } else {
      // the page is in a folder: a first page that opens it, so its own links keep working
      files["index.html"] = strToU8(`<!doctype html><meta charset="utf-8"><title>${stem}</title><meta http-equiv="refresh" content="0; url=${encodeURI(page)}"><a href="${encodeURI(page)}">Start</a>`);
      done.push(`It starts from ${page}.`);
    }
  }
  // links from the site's root
  const have = new Set(Object.keys(files));
  let fixed = 0;
  for (const k of Object.keys(files)) {
    if (!HTML.test(k) && !/\.css$/i.test(k)) continue;
    const before = strFromU8(files[k]);
    const after = rootLinks(before, k, have);
    if (after !== before) {
      files[k] = strToU8(after);
      fixed++;
    }
  }
  if (fixed) done.push(`Links from the site's root ("/…") point at the game's own files (${fixed} file${fixed === 1 ? "" : "s"}).`);
  const index = strFromU8(files["index.html"]);
  const name = titleOf(index) || prettify(stem || "Web game");
  if (!files["manifest.toml"]) {
    files["manifest.toml"] = strToU8(`name = ${tomlStr(name)}\nversion = "0.1.0"\ndescription = ${tomlStr("A web game, made into a Mini App in PDA SEASIDE")}\n`);
    done.push("A manifest was added (its name, and version 0.1.0).");
  }
  // an icon: the page's own (favicon or apple-touch-icon), or a picture called icon/logo
  if (!Object.keys(files).some((k) => /^icon\.(png|jpe?g)$/i.test(k))) {
    const linked = [...index.matchAll(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*>/gi)].map((m) => /href=["']([^"']+)["']/i.exec(m[0])?.[1] ?? "").find((h) => h && !REMOTE.test(h) && /\.(png|jpe?g)$/i.test(h));
    const pick = (linked && files[linked.replace(/^\.?\//, "")] ? linked.replace(/^\.?\//, "") : "") || Object.keys(files).find((k) => /(^|\/)(icon|logo|favicon)[^/]*\.(png|jpe?g)$/i.test(k));
    if (pick) {
      files[`icon.${/\.png$/i.test(pick) ? "png" : "jpg"}`] = files[pick];
      done.push(`Its icon is ${pick}.`);
    }
  }
  return { files, name, done };
}

function prettify(stem) {
  return String(stem).replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim().replace(/^./, (c) => c.toUpperCase()) || "Web game";
}

/** The internet addresses its pages and stylesheets load (scripts, styles, pictures, fonts), and the hosts its code
 *  mentions, which a Mini App can't reach. */
export function remoteRefs(files) {
  const loads = new Set();
  const mentioned = new Set();
  for (const [k, v] of Object.entries(files)) {
    if (HTML.test(k)) {
      const text = strFromU8(v);
      for (const m of text.matchAll(ATTR)) if (loaded(text, m)) loads.add(m[3].startsWith("//") ? `https:${m[3]}` : m[3]);
    }
    if (/\.css$/i.test(k) || HTML.test(k)) for (const m of strFromU8(v).matchAll(CSS_URL)) if (REMOTE.test(m[2])) loads.add(m[2].startsWith("//") ? `https:${m[2]}` : m[2]);
    if (/\.(m?js)$/i.test(k))
      for (const m of strFromU8(v).matchAll(/["'`](https?:\/\/[a-z0-9.-]+)/gi)) {
        const host = m[1].replace(/^https?:\/\//i, "").toLowerCase();
        if (!/(^|\.)w3\.org$|^localhost$|^example\.(com|org)$/.test(host)) mentioned.add(host);
      }
  }
  return { loads: [...loads], mentioned: [...mentioned] };
}

const privateHost = (h) => /^(localhost|.*\.local|.*\.lan|.*\.home|.*\.internal|.*\.ts\.net)$/i.test(h) || /^(10|127|0)\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\.|^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|^\[|:/.test(h) || !h.includes(".");
const KEEP = /\.(js|mjs|css|woff2?|ttf|otf|png|jpe?g|gif|webp|svg|json|wasm|mp3|ogg|wav)(\?|$)/i;

/** Scripts, stylesheets, fonts and pictures the game loads from the internet, fetched once and kept in vendor/, with
 *  its pages and stylesheets pointed at the kept copies. A stylesheet's own fonts come too. Only https/http on the
 *  open internet; a size and count limit; whatever can't be fetched is left as it was. */
export async function fetchLinked(files, fetchFn = fetch) {
  const got = new Map(); // url → path in the app
  let total = 0;
  const keep = async (url) => {
    if (got.has(url)) return got.get(url);
    if (got.size >= LIMIT.fetched) return null;
    let u;
    try {
      u = new URL(url);
    } catch {
      return null;
    }
    if (!/^https?:$/.test(u.protocol) || privateHost(u.hostname)) return null;
    const looksCss = /fonts\.googleapis\.com/i.test(u.hostname) || /\.css(\?|$)/i.test(u.pathname);
    if (!looksCss && !KEEP.test(u.pathname)) return null;
    try {
      const r = await fetchFn(u.href, { signal: AbortSignal.timeout(15000), headers: { "User-Agent": "Mozilla/5.0 (PDA SEASIDE web game import)" } });
      if (!r.ok) return null;
      let body = new Uint8Array(await r.arrayBuffer());
      total += body.length;
      if (total > LIMIT.fetchedBytes) return null;
      const isCss = looksCss || /text\/css/i.test(r.headers?.get?.("content-type") ?? "");
      let rel = `vendor/${u.hostname}${decodeURIComponent(u.pathname).replace(/[^A-Za-z0-9._/-]+/g, "_")}`.replace(/\/$/, "/index");
      if (isCss && !/\.css$/i.test(rel)) rel += ".css";
      if (u.search && !isCss) rel = rel.replace(/(\.[A-Za-z0-9]+)?$/, (ext) => `-${Math.abs(hash(u.search)).toString(36)}${ext}`);
      got.set(url, rel);
      if (isCss) {
        // its own fonts and pictures, kept beside it
        let css = strFromU8(body);
        for (const m of [...css.matchAll(CSS_URL)]) {
          const inner = new URL(m[2], u).href;
          if (!/^https?:/i.test(inner) || m[2].startsWith("data:")) continue;
          const at = await keep(inner);
          if (at) css = css.split(m[0]).join(`url(${relTo(rel, at)})`);
        }
        body = strToU8(css);
      }
      files[rel] = body;
      return rel;
    } catch {
      return null;
    }
  };
  for (const k of Object.keys(files)) {
    if (!HTML.test(k) && !/\.css$/i.test(k)) continue;
    let text = strFromU8(files[k]);
    const swaps = [];
    for (const m of text.matchAll(ATTR)) if (loaded(text, m)) swaps.push(m[3]);
    for (const m of text.matchAll(CSS_URL)) if (REMOTE.test(m[2])) swaps.push(m[2]);
    let changed = false;
    for (const url of new Set(swaps)) {
      const at = await keep(url.startsWith("//") ? `https:${url}` : url);
      if (!at) continue;
      text = text.split(url).join(relTo(k, at));
      changed = true;
    }
    if (changed) files[k] = strToU8(text);
  }
  return { kept: got.size, bytes: total };
}

function hash(s) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return h;
}
