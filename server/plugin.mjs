// The desktop's local server, mounted into Vite (dev and preview).
//   http://localhost:PORT      the desktop, plus /api for the library and shared game state
//   http://127.0.0.1:PORT      apps and games, on their own origin so they can't read the desktop's keys

import fs from "node:fs";
import path from "node:path";
import * as WG from "./webgame.mjs";
import * as AN from "./appNet.mjs";
import * as OV from "./omargVoices.mjs";
import { zipSync } from "fflate";
import { createLibrary } from "./xdc.mjs";
import { classicRelayScript, helperScript, webxdcScript } from "./inject.mjs";
import { sshOp } from "./ssh.mjs";
import { inbound } from "./inbound.mjs";
import { relay } from "./relay.mjs";
import { createMusic, knownPlace, listFolders } from "./music.mjs";
import { createLibrary as createLinked } from "./library.mjs";
import { createAvatars } from "./avatars.mjs";
import { createCreative } from "./creative.mjs";
import { createBrowser } from "./browse.mjs";
import { createVector } from "./vector.mjs";
import { createVectorHost } from "./vectorHost.mjs";
import { createFiles } from "./files.mjs";
import { createDevShare, isDevicePath } from "./devshare.mjs";
import { createTravel } from "./travel.mjs";
import { createEngine } from "./engine.mjs";
import { createUngoogled, DOWNLOADS } from "./ungoogled.mjs";
import { createVecMem } from "./vecmem.mjs";
import { createMcpStdio } from "./mcpstdio.mjs";
import { createNgit } from "./ngit.mjs";
import { createResidentKeys } from "./residentKeys.mjs";
import { createHeart } from "./heart.mjs";
import { createDeskState } from "./deskState.mjs";
import { createLan } from "./lan.mjs";
import { createBodies } from "./bodies.mjs";
import { createModules } from "./modules.mjs";
import { createTheater, PIECE_MAX, VIDEO_EXT } from "./theater.mjs";
import { createPairs, pairedCors } from "./pairs.mjs";
import { acceptSocket } from "./wsframes.mjs";
import { createPads } from "./pads.mjs";
import { createMemory } from "./memory.mjs";
import { createLuanti } from "./luanti.mjs";
import { createLuantiWeb } from "./luantiWeb.mjs";
import { createLuantiRelay } from "./luantiRelay.mjs";
import { openDuplex } from "./wsduplex.mjs";
import { createTerminals } from "./terminal.mjs";
import { ensureKey, sshShell } from "./terminalSsh.mjs";
import { createPadsWire } from "./padsWire.mjs";
import { createRequire } from "node:module";
import { createPeers } from "./peers.mjs";
import { createGameLinks } from "./gameLinks.mjs";
import { createPadsLink } from "./padsLink.mjs";
import { createSongFetch } from "./songFetch.mjs";
import { createEngineStream } from "./engineStream.mjs";
import os from "node:os";
import dns from "node:dns";
import { createHash } from "node:crypto";
import { checkUpdates, download } from "./upstreams.mjs";
import * as aicordAuth from "./oauth.mjs";
import { findCurl, findPython, forgetPrograms } from "./programs.mjs";

const MIME = {
  html: "text/html; charset=utf-8",
  apng: "image/apng",
  avif: "image/avif",
  mov: "video/quicktime",
  vrm: "model/gltf-binary",
  glb: "model/gltf-binary",
  moc3: "application/octet-stream",
  htm: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  wasm: "application/wasm",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
  opus: "audio/ogg",
  m4a: "audio/mp4",
  flac: "audio/flac",
  aac: "audio/aac",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mkv: "video/x-matroska",
  "3gp": "video/3gpp",
  ogv: "video/ogg",
  avi: "video/x-msvideo",
  webm: "video/webm",
  ttf: "font/ttf",
  otf: "font/otf",
  woff: "font/woff",
  woff2: "font/woff2",
  txt: "text/plain; charset=utf-8",
  md: "text/plain; charset=utf-8",
  toml: "text/plain; charset=utf-8",
  xml: "application/xml",
  data: "application/octet-stream",
};

// webxdc apps must not reach the network; this keeps them on their own files.
const XDC_CSP = [
  "default-src 'self' data: blob: 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'",
  "connect-src 'self' data: blob:",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "font-src 'self' data:",
  "worker-src 'self' blob: data:",
].join("; ");

export function deskServer() {
  let root = process.cwd();
  let dataDir = "";
  let voices = null; // SEASIDE's own voices (omargVoices.mjs), made when first asked for
  let publicDir = "";
  let lib;
  let mus;
  const music = () => (mus ??= createMusic(dataDir));
  let sf;
  // songs fetched by this server straight from a song engine into the library (songFetch.mjs)
  const songFetch = () => (sf ??= createSongFetch({ dir: () => music().ownDir() }));
  // songs played straight from a song engine, not copied (engineStream.mjs)
  const engineStream = createEngineStream();
  let crt;
  const creative = () => (crt ??= createCreative(() => dataDir));
  const browser = createBrowser();
  let vec;
  const vector = () => (vec ??= createVector(() => dataDir));
  let vh;
  const vectorHost = () => (vh ??= createVectorHost(() => dataDir));
  // PDD_CONFIG: another settings file (a test copy keeps its own, so it never changes the real desktop's)
  const configFile = () => process.env.PDD_CONFIG || path.join(root, "pdd.config.json");
  // pdd.config.json: this computer's own settings for the desktop (data folder, network sharing, …), kept whole
  const readConfig = () => {
    try {
      return JSON.parse(fs.readFileSync(configFile(), "utf8"));
    } catch {
      return {};
    }
  };
  const writeConfig = (patch) => fs.writeFileSync(configFile(), JSON.stringify({ ...readConfig(), ...patch }, null, 2));
  let fl;
  const files = () =>
    (fl ??= createFiles({
      dataDir: () => dataDir,
      musicFolders: () => music().folders(),
      videoFolders: () => theater.folders(),
      getWholePc: () => readConfig().filesWholeComputer === true,
      setWholePc: (on) => writeConfig({ filesWholeComputer: on }),
      getSharing: () => readConfig().filesSharing,
      setSharing: (s) => writeConfig({ filesSharing: s }),
    }));
  // other devices sharing their own files, while their page is open (see devshare.mjs)
  const devices = createDevShare();
  // folders linked for the characters to read, without copying them in (see library.mjs)
  const linked = createLinked({ dataDir: () => dataDir });
  // accounts that travel between devices (see travel.mjs)
  const travel = createTravel(() => dataDir);
  // the full browser: a real Chromium-family engine shown live in the Browser window (see engine.mjs)
  const deskPorts = new Set();
  const vecmem = createVecMem({ dataDir: () => dataDir });
  const residentKeys = createResidentKeys({ dataDir: () => dataDir });
  const bodies = createBodies({ dataDir: () => dataDir });
  // real terminals (terminal.mjs): node-pty is loaded only when one is opened, so SEASIDE still runs without it
  let ptySpawn = null;
  const termKeyDir = () => path.join(dataDir, "terminal");
  const terminals = createTerminals({
    dataDir: () => dataDir,
    // shells under a separate account: an SSH login to this computer with SEASIDE's own key (terminalSsh.mjs)
    separate: (opts) => sshShell({ ...opts, privateKey: ensureKey(termKeyDir()).privateKey }),
    keyFor: () => ensureKey(termKeyDir()).publicKey,
    spawn: (...a) => {
      ptySpawn ||= createRequire(import.meta.url)("@lydell/node-pty").spawn;
      return ptySpawn(...a);
    },
  });
  const modules = createModules({ dataDir: () => dataDir, importXdc: (bytes, name) => library().importAny(bytes, name) });
  const stdio = createMcpStdio();
  const ngit = createNgit({ stdio, config: readConfig().ngitReader });
  // Media Theatre: videos kept in the vault (see theater.mjs)
  const theater = createTheater({ vaultDir: () => path.join(dataDir, "vault") });
  // Classic opened on its own (a plain browser tab), paired with this desktop to use its relay (see pairs.mjs)
  const pairs = createPairs({ file: () => path.join(dataDir, "classic-pairs.json") });
  // PADS: the account's devices, what's on them, and how they're arranged (see pads.mjs)
  const pads = createPads({ dataDir: () => dataDir });
  // PADS's live wire (padsWire.mjs): a mouse and keyboard crossing between an account's devices
  const padsWire = createPadsWire({ pads });
  // linked servers (one per device): PADS and "Send to" across all of them (see peers.mjs, padsLink.mjs)
  const peers = createPeers({ file: () => path.join(dataDir, "pads-servers.json") });
  let padsLink = null; // made once vaultFile is defined, below
  let gameLinks = null;
  /** A paired page may use the relay, but never to reach the desktop itself (its own server, by any name that
   *  leads to this computer, after any redirect): that would give it the desktop's controls. */
  const notTheDesktop = (req) => async (u) => {
    const port = Number(u.port || (u.protocol === "https:" ? 443 : 80));
    if (!deskPorts.has(port) && port !== req.socket.localPort) return "";
    const own = new Set(Object.values(os.networkInterfaces()).flat().filter(Boolean).map((i) => i.address));
    const found = await dns.promises.lookup(u.hostname.replace(/^\[|\]$/g, ""), { all: true }).catch(() => []);
    const local = found.some(({ address }) => /^(127\.|0\.0\.0\.0$|::1$|::$|::ffff:127\.)/.test(address) || own.has(address));
    return local ? "A paired page can use the relay, but not to reach the desktop itself." : "";
  };
  setTimeout(() => dataDir && theater.sweep(), 30_000).unref?.();
  // the tool-server programs the locksmith allowed, by fingerprint (what runs, never the keys' values)
  const stdioFile = () => path.join(dataDir, "mcp-commands.json");
  const stdioAllowed = () => {
    try {
      return JSON.parse(fs.readFileSync(stdioFile(), "utf8"));
    } catch {
      return {};
    }
  };
  const stdioPrint = (b) => createHash("sha256").update(JSON.stringify([String(b.command || ""), (b.args ?? []).map(String), String(b.cwd || ""), Object.entries(b.env ?? {}).map(([k, v]) => [k, String(v)]).sort()])).digest("hex").slice(0, 32);
  const engine = createEngine({ dataDir: () => dataDir, getChoice: () => readConfig().browserEngine, deskPorts: () => [...deskPorts] });
  // the shared desk (deskState.mjs): SEASIDE's state on the server, sealed, one desk every device opens
  // the devices on the local network (lan.mjs): for Sentry's network watch and Explorer's computers
  const lanWatch = createLan({ dataDir: () => dataDir });
  const desk = createDeskState({ dataDir: () => dataDir, seal: (o) => residentKeys.seal(o), open: (x) => residentKeys.open(x) });

  // the heart (heart.mjs): one page does the background work; with "keep them running" on, the keeper opens the
  // desktop headless, in its own profile, while the desktop on this computer is closed
  const heart = createHeart({
    dataDir: () => dataDir,
    seal: (o) => residentKeys.seal(o),
    open: (s) => residentKeys.open(s),
    launch: async (url) => {
      const eng = engine.pick();
      if (!eng) throw new Error("no Chromium-family browser on this computer (Edge, Chrome, Brave or Chromium)");
      const { chromium } = await import("playwright-core");
      const profile = path.join(dataDir, "heart", "profile");
      fs.mkdirSync(profile, { recursive: true });
      const ctx = await chromium.launchPersistentContext(profile, { executablePath: eng.path, headless: true, chromiumSandbox: true, args: ["--no-first-run", "--no-default-browser-check"] });
      const page = ctx.pages()[0] ?? (await ctx.newPage());
      await page.goto(url);
      return { close: () => ctx.close() };
    },
  });
  setInterval(() => dataDir && void heart.tick(), 10_000).unref?.();
  // memory on this computer: what's in use, the browser engine sleeping when idle, regular clean-ups (see memory.mjs)
  const memory = createMemory({ engine, readConfig, writeConfig });
  const beats = new Map(); // character heartbeats: when each was last taken (account|character → time)
  // Luanti: the family's servers, the public list, and the real Luanti program on this computer (see luanti.mjs)
  const luanti = createLuanti({ readConfig, writeConfig });
  // Luanti in the browser: the real client built for WebAssembly, served here, its connections relayed here
  const luantiWeb = createLuantiWeb({ dataDir: () => dataDir });
  const luantiRelay = createLuantiRelay();
  // Ungoogled Chromium, downloaded into the data folder when asked (see ungoogled.mjs)
  const downloads = DOWNLOADS.map((entry) => createUngoogled({ browserDir: () => path.join(dataDir, "browser"), hold: () => engine.hold(), entry }));
  const ungoogled = downloads[0];
  const withDevices = (o) => ({ ...o, devices: devices.places() });
  const library = () => {
    if (!lib) {
      lib = createLibrary(dataDir);
      const apps = path.join(publicDir || path.join(root, "public"), "apps");
      const builtIn = path.join(apps, "jade-link.xdc");
      if (fs.existsSync(builtIn) && !lib.list().some((p) => p.appKey === "jade-link")) {
        try {
          lib.importAny(fs.readFileSync(builtIn), "jade-link.xdc");
        } catch {
          /* the library still works without it */
        }
      }
      // apps that come with the desktop (public/apps/shipped.json): each added once per data folder, so one
      // that someone removes stays removed; a newer shipped version is added next to the old
      try {
        const shipped = JSON.parse(fs.readFileSync(path.join(apps, "shipped.json"), "utf8"));
        const noteFile = path.join(dataDir, "xdc", "shipped.json");
        let done = [];
        try {
          done = JSON.parse(fs.readFileSync(noteFile, "utf8"));
        } catch {
          done = [];
        }
        const before = done.length;
        for (const s of shipped) {
          const file = path.join(apps, path.basename(String(s.file)));
          if (done.includes(s.file) || !fs.existsSync(file)) continue;
          try {
            lib.importAny(fs.readFileSync(file), path.basename(file), { ...(s.source ? { source: s.source } : {}), ...(s.name ? { name: s.name } : {}) });
            done.push(s.file);
          } catch {
            /* a broken file: tried again next time */
          }
        }
        if (done.length !== before) fs.writeFileSync(noteFile, JSON.stringify(done, null, 1));
      } catch {
        /* no list, or it can't be read: nothing shipped to add */
      }
    }
    return lib;
  };
  const vaultDir = () => path.join(dataDir, "vault");
  /** A path inside the files folder, refusing anything that climbs out. */
  const vaultFile = (rel) => {
    const base = vaultDir();
    const full = path.resolve(base, String(rel || "").replace(/^\/+/, ""));
    return full === base || full.startsWith(base + path.sep) ? full : null;
  };

  padsLink = createPadsLink({ pads, peers, vaultFile });
  // games across linked SEASIDEs, and the realtime channel across devices (see gameLinks.mjs)
  gameLinks = createGameLinks({ peers, library, file: () => path.join(dataDir, "game-links.json") });
  /** Where other devices can reach this server: this computer, and its home-network (and Tailscale) addresses. */
  const addressesOf = (port) => [
    `http://localhost:${port}`,
    ...Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === "IPv4" && !i.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.)/.test(i.address)).map((i) => `http://${i.address}:${port}`),
  ];

  const hostOf = (req) => String(req.headers.host || "").replace(/:\d+$/, "").toLowerCase();
  const isAppHost = (req) => hostOf(req) === "127.0.0.1";
  const isDeskHost = (req) => hostOf(req) === "localhost" || hostOf(req).endsWith(".localhost");
  // reached through Tailscale (`tailscale serve`, or the tailnet name): one address for the desktop and its apps
  const viaTailnet = (req) => hostOf(req).endsWith(".ts.net");
  const lan = () => process.env.PDD_LAN === "1";
  // made on this computer itself: from this machine, to the local address (not through Tailscale or the network)
  const onThisPc = (req) =>
    /^(127\.|::1$|::ffff:127\.)/.test(String(req.socket.remoteAddress || "")) && (isDeskHost(req) || hostOf(req) === "127.0.0.1" || hostOf(req) === "[::1]");

  // Asked by one of SEASIDE's own pages. A browser says where each request comes from (Sec-Fetch-Site, or the page it was
  // made on); a plain program on this computer doesn't, so a tool a character drives (her own http request, a script)
  // can't be steered into reading the household's or the characters' keys. (The lasting answer is the server filling
  // keys in itself, so they never leave it; until then, keys go only to pages.)
  const fromOwnPage = (req) => {
    const site = String(req.headers["sec-fetch-site"] || "");
    if (site) return site === "same-origin";
    try {
      return new URL(String(req.headers.referer || "")).host === String(req.headers.host || "");
    } catch {
      return false;
    }
  };
  const PAGES_ONLY = "Keys are handed only to SEASIDE's own pages, not to other programs.";

  const send = (res, code, body, type = "application/json") => {
    res.statusCode = code;
    res.setHeader("Content-Type", type);
    res.setHeader("Cache-Control", "no-store");
    res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };

  const readBody = (req, limit = 1_200_000_000) =>
    new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on("data", (c) => {
        size += c.length;
        if (size > limit) {
          reject(new Error("too large"));
          req.destroy();
        } else chunks.push(c);
      });
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });

  /** A file in pieces when asked (Range), so audio and video can seek. */
  function serveRange(req, res, file) {
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, "Not found", "text/plain");
    const size = fs.statSync(file).size;
    res.setHeader("Content-Type", MIME[path.extname(file).slice(1).toLowerCase()] || "application/octet-stream");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "no-cache");
    const r = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ""));
    if (r && size) {
      const start = r[1] ? Number(r[1]) : Math.max(0, size - Number(r[2]));
      const end = r[1] && r[2] ? Math.min(Number(r[2]), size - 1) : size - 1;
      if (start > end || start >= size) return (res.statusCode = 416), res.setHeader("Content-Range", `bytes */${size}`), void res.end();
      res.statusCode = 206;
      res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
      res.setHeader("Content-Length", end - start + 1);
      return void fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.statusCode = 200;
    res.setHeader("Content-Length", size);
    fs.createReadStream(file).pipe(res);
  }

  function serveFile(res, file, inject) {
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, "Not found", "text/plain");
    const ext = path.extname(file).slice(1).toLowerCase();
    const type = MIME[ext] || "application/octet-stream";
    let body = fs.readFileSync(file);
    if (inject && (ext === "html" || ext === "htm")) {
      const html = body.toString("utf8");
      const tag = `<script>${inject}</script>`;
      // only a <head> before any script is the real one (inlined libraries can contain "<head>" in their code);
      // otherwise the tag goes first, after a doctype if there is one so the page keeps its rendering mode
      const head = html.search(/<head[^>]*>/i);
      const script = html.search(/<script/i);
      const doctype = html.match(/^\s*<!doctype[^>]*>/i);
      body = Buffer.from(
        head >= 0 && (script < 0 || head < script)
          ? html.slice(0, head) + html.slice(head).replace(/<head[^>]*>/i, (m) => m + tag)
          : doctype ? doctype[0] + tag + html.slice(doctype[0].length) : tag + html,
        "utf8",
      );
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", type);
    res.setHeader("Cache-Control", "no-cache");
    res.end(body);
  }

  async function api(req, res, url) {
    const parts = url.pathname.split("/").filter(Boolean).slice(1); // after "api"
    const m = req.method;
    const L = library();
    // SEASIDE's own voices (omargVoices.mjs: the OMARG engine, sherpa-onnx), as a voice engine at /api/voices/v1/…
    if (parts[0] === "voices" && parts[1] === "v1") {
      voices ??= OV.createVoices(path.join(dataDir, "voices"));
      try {
        if (parts[2] === "models" && m === "GET") return send(res, 200, { object: "list", data: voices.packs().map((p) => ({ id: p.id, object: "model", owned_by: "seaside" })) });
        if (parts[2] === "audio" && parts[3] === "voices" && m === "GET") return send(res, 200, { voices: voices.packs().flatMap((p) => p.voices.map((v) => ({ id: v.name, name: v.name, pack: p.id, lang: v.lang }))) });
        if (parts[2] === "audio" && parts[3] === "speech" && m === "POST") {
          const b = JSON.parse((await readBody(req, 200_000)).toString("utf8") || "{}");
          const audio = await voices.speak({ input: b.input, voice: b.voice, speed: b.speed });
          res.writeHead(200, { "Content-Type": "audio/wav", "Content-Length": audio.length });
          return void res.end(audio);
        }
        return send(res, 404, { error: "No such voice route." });
      } catch (e) {
        return send(res, e?.status || 500, { error: e instanceof Error ? e.message : String(e) });
      }
    }
    // the module door (modules.mjs): looking in the Box and bringing modules in, from this computer or Tailscale's https
    if (parts[0] === "modules") {
      try {
        if (!onThisPc(req) && !viaTailnet(req)) return send(res, 403, { error: "Modules are brought in on the desktop's own computer." });
        const b = m === "POST" ? JSON.parse((await readBody(req, 100_000)).toString("utf8") || "{}") : {};
        if (parts[1] === "installed" && m === "GET") return send(res, 200, modules.installed());
        if (parts[1] === "look" && m === "POST") return send(res, 200, await modules.look((Array.isArray(b.orgs) ? b.orgs : []).map(String).slice(0, 10)));
        if (parts[1] === "install" && m === "POST") return send(res, 200, await modules.install(String(b.org || ""), String(b.repo || ""), String(b.commit || "")));
        return send(res, 404, { error: "Not found" });
      } catch (e) {
        return send(res, e.status && e.status < 600 ? e.status : 500, { error: e.message });
      }
    }
    // real terminals: from this computer or Tailscale's https only; switching them on only from this computer
    if (parts[0] === "terminal") {
      try {
        if (!onThisPc(req) && !viaTailnet(req)) return send(res, 403, { error: "The real terminal opens on the desktop's own computer or over your tailnet." });
        const b = m === "POST" ? JSON.parse((await readBody(req, 20_000)).toString("utf8") || "{}") : {};
        if (!parts[1] && m === "GET") return send(res, 200, { ...terminals.settings(), sessions: terminals.list(), workspaces: terminals.workspaces(), here: onThisPc(req) });
        if (parts[1] === "on" && m === "POST") {
          if (b.on && !onThisPc(req)) return send(res, 403, { error: "Switch the real terminal on from the desktop's own computer." });
          return send(res, 200, terminals.setOn(Boolean(b.on)));
        }
        if (parts[1] === "open" && m === "POST") return send(res, 200, terminals.open({ workspace: b.workspace, cols: b.cols, rows: b.rows, as: b.as === "separate" ? "separate" : "you" }));
        // which separate account shells may run as, and forgetting its pinned host key: on this computer only
        if ((parts[1] === "separate" || parts[1] === "forget-host-key") && m === "POST") {
          if (!onThisPc(req)) return send(res, 403, { error: "The separate account is set up on the desktop's own computer." });
          if (parts[1] === "separate") terminals.setSeparate({ user: b.user, port: b.port });
          else terminals.forgetHostKey();
          return send(res, 200, terminals.settings());
        }
        if (parts[1] === "close" && m === "POST") return send(res, 200, { ok: terminals.close(String(b.id || "")) });
        return send(res, 404, { error: "Not found" });
      } catch (e) {
        return send(res, e.status && e.status < 600 ? e.status : 500, { error: e.message });
      }
    }
    // each character's files on disk, for her other bodies (bodies.mjs): only from this computer or Tailscale's https
    if (parts[0] === "bodies") {
      try {
        if (!onThisPc(req) && !viaTailnet(req)) return send(res, 403, { error: "A character's folder is kept from the desktop's own computer." });
        const id = decodeURIComponent(parts[1] || "");
        if (m === "GET") return send(res, 200, bodies.read(id));
        if (m === "PUT") {
          const b = JSON.parse((await readBody(req, 200_000_000)).toString("utf8") || "{}");
          // two ways (sync), or the old one-way mirror for anything that still asks for it
          return send(res, 200, b.sync ? bodies.sync(id, b.files ?? {}) : bodies.write(id, b.files ?? {}));
        }
        return send(res, 404, { error: "Not found" });
      } catch (e) {
        return send(res, e.status || 500, { error: e.message });
      }
    }
    // each character's own keys (residentKeys.mjs): names for any desktop page; values are seen and set only on this
    // computer, or over Tailscale's https
    if (parts[0] === "resident-keys") {
      try {
        const see = onThisPc(req) || viaTailnet(req);
        if (!parts[1] && m === "GET") return send(res, 200, { names: residentKeys.names(), canSee: see });
        if (!see) return send(res, 403, { error: "A character's keys are seen and set on the desktop's own computer, or over Tailscale's https." });
        if (!fromOwnPage(req)) return send(res, 403, { error: PAGES_ONLY });
        const id = decodeURIComponent(parts[1] || "");
        if (parts[2] === "values" && m === "GET") return send(res, 200, { values: residentKeys.values(id) });
        if (!parts[2] && m === "PUT") {
          const b = JSON.parse((await readBody(req, 100_000)).toString("utf8") || "{}");
          return send(res, 200, { names: residentKeys.set(id, String(b.name || ""), String(b.value ?? "")) });
        }
        return send(res, 404, { error: "Not found" });
      } catch (e) {
        return send(res, e.status || 500, { error: e.message });
      }
    }
    if (parts[0] === "mcp-stdio") {
      // (a character's own server starts with her keys: only her pages start, stop or talk to it)
      if (!fromOwnPage(req)) return send(res, 403, { error: PAGES_ONLY });
      try {
        if (parts[1] === "rpc" && m === "POST") {
          const msg = JSON.parse((await readBody(req, 20_000_000)).toString("utf8") || "{}");
          const one = (x) => stdio.send(String(parts[2] || ""), x);
          const out = Array.isArray(msg) ? (await Promise.all(msg.map(one))).filter(Boolean) : await one(msg);
          if (out == null || (Array.isArray(out) && !out.length)) return send(res, 202, "", "text/plain");
          return send(res, 200, out);
        }
        if (parts[1] === "rpc") return send(res, 405, { error: "Use POST." });
        if (m === "GET") return send(res, 200, { running: stdio.list(), allowed: stdioAllowed() });
        const b = JSON.parse((await readBody(req, 200_000)).toString("utf8") || "{}");
        // what she asked to run, as she wrote it (${NAME} still in place): that's what gets allowed
        const asked = { command: b.command, args: b.args ?? [], cwd: b.cwd ?? "", env: b.env ?? {} };
        const print = stdioPrint(asked);
        if (parts[1] === "allow" && m === "POST") {
          if (!onThisPc(req)) return send(res, 403, { error: "Programs are allowed from the desktop's own computer." });
          const all = stdioAllowed();
          if (b.allow === false) delete all[print];
          else all[print] = { ...asked, name: String(b.name || ""), owner: String(b.owner || ""), at: Date.now() };
          fs.writeFileSync(stdioFile(), JSON.stringify(all, null, 2));
          return send(res, 200, { print, allowed: b.allow !== false });
        }
        if (parts[1] === "start" && m === "POST") {
          if (!stdioAllowed()[print]) return send(res, 403, { error: "This program hasn't been allowed yet.", print });
          // the keys' values replace their ${NAME}s only now: a character's own server gets her own keys first, read
          // here from her sealed vault (they never pass through a page), then the household's Keys the page sent
          // (whose it is was settled when it was allowed: a page can't claim it for someone else when starting it)
          const owner = String(stdioAllowed()[print].owner || "");
          let own = {};
          try {
            own = owner ? residentKeys.values(owner) : {};
          } catch {
            own = {};
          }
          const values = { ...(b.values ?? {}), ...own };
          const fill = (v) => String(v).replace(/\$\{([A-Za-z0-9_]+)\}/g, (_, n) => String(values[n] ?? process.env[n] ?? ""));
          return send(res, 200, stdio.start({ id: String(b.id || ""), command: asked.command, args: asked.args.map(fill), cwd: asked.cwd, env: Object.fromEntries(Object.entries(asked.env).map(([k, v]) => [k, fill(v)])) }));
        }
        if (parts[1] === "stop" && m === "POST") return send(res, 200, { stopped: stdio.stop(String(b.id || "")) });
        if (parts[1] === "status" && m === "POST") return send(res, 200, { ...stdio.status(String(b.id || "")), print, allowed: Boolean(stdioAllowed()[print]) });
      } catch (e) {
        return send(res, e?.status ?? 400, { error: e instanceof Error ? e.message : String(e) });
      }
    }
    if (parts[0] === "ngit") {
      if (!fromOwnPage(req)) return send(res, 403, { error: PAGES_ONLY });
      try {
        if (parts[1] === "tools" && m === "GET") return send(res, 200, await ngit.tools());
        if (parts[1] === "config" && m === "GET") return send(res, 200, ngit.config());
        if (parts[1] === "call" && m === "POST") {
          const b = JSON.parse((await readBody(req, 20_000_000)).toString("utf8") || "{}");
          return send(res, 200, await ngit.call(String(b.name || ""), b.args ?? {}));
        }
        return send(res, 404, { error: "No such ngit route." });
      } catch (e) {
        return send(res, e?.status ?? 400, { error: e instanceof Error ? e.message : String(e) });
      }
    }
    if (parts[0] === "vecmem" && m === "POST") {
      try {
        return send(res, 200, vecmem.run(JSON.parse((await readBody(req, 50_000_000)).toString("utf8") || "{}")));
      } catch (e) {
        return send(res, 400, { error: e instanceof Error ? e.message : String(e) });
      }
    }
    if (parts[0] === "oauth" && parts[1] === "aicord") {
      if (parts[2] === "start" && m === "POST") {
        const b = JSON.parse((await readBody(req, 20_000)).toString("utf8") || "{}");
        try {
          return send(res, 200, aicordAuth.begin({ clientId: String(b.clientId || ""), redirectUri: String(b.redirectUri || ""), scopes: Array.isArray(b.scopes) ? b.scopes : [] }));
        } catch (e) {
          return send(res, 400, { error: e instanceof Error ? e.message : String(e) });
        }
      }
      if (parts[2] === "result") return send(res, 200, aicordAuth.result(url.searchParams.get("state")));
    }
    if (parts[0] === "relay" && parts[1] === "programs") {
      if (url.searchParams.get("refresh")) forgetPrograms();
      const py = findPython(url.searchParams.get("python") || "");
      const curl = findCurl();
      return send(res, 200, { python: py && { path: py.cmd + (py.args.length ? ` ${py.args.join(" ")}` : ""), version: py.version }, curl: curl && { path: curl.cmd, version: curl.version } });
    }
    // creative apps: GIMP, Krita, Inkscape, the Craft apps (install on request, open vault files in them)
    if (parts[0] === "create") {
      const C = creative();
      try {
        if (parts[1] === "apps" && m === "GET") return send(res, 200, C.list());
        if (m === "POST") {
          const b = JSON.parse((await readBody(req, 100_000)).toString("utf8") || "{}");
          if (parts[1] === "install") return send(res, 200, C.install(String(b.id)));
          if (parts[1] === "remove") return send(res, 200, (C.remove(String(b.id)), { ok: true }));
          if (parts[1] === "open") {
            const file = b.path ? vaultFile(String(b.path)) : "";
            if (b.path && (!file || !fs.existsSync(file))) return send(res, 400, { error: "That file isn't in the vault." });
            return send(res, 200, C.open(String(b.id), file || ""));
          }
        }
      } catch (e) {
        return send(res, 400, { error: e instanceof Error ? e.message : String(e) });
      }
    }
    // voice samples: a short WAV per character, in the vault under .pandora/voices/<character>/
    if (parts[0] === "voice-sample") {
      const char = String(url.searchParams.get("char") || "").replace(/[^\w.-]+/g, "_").slice(0, 80);
      if (!char) return send(res, 400, { error: "Which character?" });
      const dir = path.join(vaultDir(), ".pandora", "voices", char);
      if (m === "POST") {
        const bytes = await readBody(req, 30_000_000);
        if (bytes.subarray(0, 4).toString("latin1") !== "RIFF" || bytes.subarray(8, 12).toString("latin1") !== "WAVE") return send(res, 400, { error: "Send the sample as a WAV." });
        fs.mkdirSync(dir, { recursive: true });
        const name = `${Date.now().toString(36)}.wav`;
        fs.writeFileSync(path.join(dir, name), bytes);
        return send(res, 200, { entry: [".pandora", "voices", char, name].join("/") });
      }
      if (m === "DELETE") {
        const name = path.basename(String(url.searchParams.get("entry") || ""));
        if (/^[\w.-]+\.wav$/.test(name)) fs.rmSync(path.join(dir, name), { force: true });
        return send(res, 200, { ok: true });
      }
    }
    if (parts[0] === "avatar") {
      const A = createAvatars(vaultDir);
      const charId = String(url.searchParams.get("char") || "");
      try {
        if (m === "POST") return send(res, 200, A.upload(charId, decodeURIComponent(String(req.headers["x-filename"] || "avatar")), await readBody(req, 300_000_000)));
        if (m === "DELETE") return send(res, 200, A.remove(charId, String(url.searchParams.get("entry") || "")));
      } catch (e) {
        return send(res, 400, { error: e instanceof Error ? e.message : String(e) });
      }
    }
    // Vault files by path (/api/vault/raw/a/b/model.model3.json), so a model's own relative paths work
    if (parts[0] === "vault" && parts[1] === "raw" && m === "GET") {
      const file = vaultFile(parts.slice(2).map(decodeURIComponent).join("/"));
      return serveFile(res, file);
    }
    // folders on this computer, for picking music folders (names only)
    // Vector for the people using the desktop (vector-agent per account; see vector.mjs)
    if (parts[0] === "vector") {
      const V = vector();
      try {
        if (parts[1] === "status" && m === "GET") return send(res, 200, V.status());
        if (parts[1] === "file" && m === "POST") {
          const r = await V.sendFile(req.headers["x-vector-token"], String(url.searchParams.get("to") || ""), decodeURIComponent(String(req.headers["x-filename"] || "file")), await readBody(req, 200_000_000));
          return send(res, 200, { ok: true, result: r });
        }
        if (m === "POST") {
          const b = JSON.parse((await readBody(req, 2_000_000)).toString("utf8") || "{}");
          const token = req.headers["x-vector-token"];
          if (parts[1] === "start") return send(res, 200, await V.start(b.nsec, b.password));
          if (parts[1] === "stop") return send(res, 200, (V.stop(token), { ok: true }));
          if (parts[1] === "call") return send(res, 200, { result: await V.call(token, String(b.name), b.args) });
          if (parts[1] === "attachment") {
            const bytes = await V.attachment(token, b.attachment ?? {});
            const ext = String(b.attachment?.extension || "").toLowerCase();
            return send(res, 200, bytes, MIME[ext] || "application/octet-stream");
          }
          if (parts[1] === "open-app") {
            // a Mini App someone sent: into Games & Apps (it runs on the apps' address like any other)
            const bytes = await V.attachment(token, b.attachment ?? {});
            const name = /\.xdc$/i.test(String(b.attachment?.name || "")) ? String(b.attachment.name) : `${String(b.attachment?.name || "app").replace(/\.[^.]*$/, "")}.xdc`;
            const r = library().importAny(bytes, name);
            return send(res, 200, { ok: true, added: r.added.length, duplicates: r.duplicates, id: r.found[0]?.id ?? null, errors: r.errors });
          }
        }
      } catch (e) {
        return send(res, e?.status || 400, { error: e instanceof Error ? e.message : String(e) });
      }
    }
    // Vector's own app inside the desktop (Vector built in host mode; see vectorHost.mjs)
    if (parts[0] === "vector-host") {
      const H = vectorHost();
      try {
        if (parts[1] === "status" && m === "GET") return send(res, 200, H.status());
        if (parts[1] === "events" && m === "GET") return void H.connect(req, res);
        if (parts[1] === "asset" && m === "GET") return serveRange(req, res, H.assetPath(url.searchParams.get("p")));
        // a Mini App from Vector's own folders, into Games & Apps (the same file is found again, a new version added)
        if (parts[1] === "import-xdc" && m === "POST") {
          const b = JSON.parse((await readBody(req, 100_000)).toString("utf8") || "{}");
          const file = H.assetPath(b.path);
          if (!file || !fs.existsSync(file)) return send(res, 404, { error: "That Mini App isn't in Vector's folders." });
          const r = library().importAny(fs.readFileSync(file), path.basename(file));
          return send(res, 200, { id: r.found[0]?.id ?? null, added: r.added.length, errors: r.errors });
        }
        if (parts[1] === "upload" && m === "POST") return send(res, 200, { path: H.upload(decodeURIComponent(String(req.headers["x-filename"] || "file")), await readBody(req, 500_000_000)) });
        if (m === "POST") {
          const b = JSON.parse((await readBody(req, 300_000_000)).toString("utf8") || "{}");
          if (parts[1] === "start") return send(res, 200, H.start(req.socket.localPort));
          if (parts[1] === "stop") return send(res, 200, H.stop());
          if (parts[1] === "sub") return send(res, 200, (H.subscribe(String(b.client), String(b.event)), {}));
          if (parts[1] === "emit") return send(res, 200, (H.emit(b.event, b.payload), {}));
          if (parts[1] === "invoke") {
            try {
              return send(res, 200, { ok: (await H.invoke(String(b.cmd), b.args ?? {})) ?? null });
            } catch (e) {
              // Vector's own errors go back as Vector gave them (often plain strings its interface shows)
              if (e?.fromVector) return send(res, 400, { error: e.value });
              throw e;
            }
          }
        }
      } catch (e) {
        return send(res, e?.status || 400, { error: e instanceof Error ? e.message : String(e) });
      }
    }
    // the full browser: its state, its live stream, and everything the Browser window asks of it
    if (parts[0] === "engine") {
      deskPorts.add(req.socket.localPort);
      try {
        if (parts[1] === "status" && m === "GET")
          return send(res, 200, { ...engine.status(), ungoogled: ungoogled.status(), downloads: downloads.map((d) => d.status()), downloaded: engine.downloaded(), canChange: onThisPc(req) });
        // which engine, and fetching Ungoogled Chromium: only from the computer itself
        if ((parts[1] === "choose" || parts[1] === "ungoogled" || parts[1] === "download") && m === "POST") {
          if (!onThisPc(req)) return send(res, 403, { error: "The browser's engine can only be changed on the desktop's own computer." });
          const b = JSON.parse((await readBody(req, 10_000)).toString("utf8") || "{}");
          if (parts[1] === "choose") {
            // "" = automatic; else a browser found on this computer, a downloaded engine, or a program the person
            // picked themselves (b.custom: any Chromium-family browser's program file)
            const p = String(b.path || "");
            const found = [...engine.installedEngines(), ...engine.downloaded()].find((e) => e.path === p);
            const custom = !found && b.custom && p && fs.existsSync(p) && fs.statSync(p).isFile() ? { name: String(b.name || path.basename(p).replace(/\.(exe|app)$/i, "")).slice(0, 60), path: path.resolve(p) } : null;
            if (p && !found && !custom) return send(res, 400, { error: b.custom ? "There's no program at that path." : "That isn't one of the browsers found on this computer." });
            const pickedEngine = found ?? custom;
            writeConfig({ browserEngine: pickedEngine ? { name: pickedEngine.name, path: pickedEngine.path } : null });
            engine.forgetLast();
            const reopen = await engine.restart();
            return send(res, 200, { ...engine.status(), reopen });
          }
          const d = parts[1] === "ungoogled" ? ungoogled : downloads.find((x) => x.id === String(b.id || ""));
          if (!d) return send(res, 404, { error: "There's no such download." });
          if (b.op === "check") return send(res, 200, { ...d.status(), latest: await d.latest() });
          if (b.op === "install") {
            // this one is used next (chosen, so a newer download of another doesn't take over)
            writeConfig({ browserEngine: { name: d.name, path: d.program() } });
            engine.forgetLast();
            return send(res, 200, d.install());
          }
          if (b.op === "remove") {
            if (readConfig().browserEngine?.path === d.program()) writeConfig({ browserEngine: null });
            return send(res, 200, await d.remove());
          }
        }
        if (parts[1] === "stream" && m === "GET") return engine.stream(res, url.searchParams.get("frames") !== "0");
        if (!parts[1] && m === "POST") return send(res, 200, await engine.cmd(JSON.parse((await readBody(req, 200_000)).toString("utf8") || "{}")));
      } catch (e) {
        return send(res, e?.status || 400, { error: e instanceof Error ? e.message.split("\n")[0] : String(e) });
      }
    }
    // accounts that travel: who travels, one account's desktop, keep it, stop keeping it
    if (parts[0] === "travel") {
      try {
        const name = String(url.searchParams.get("name") || "");
        if (m === "GET" && !parts[1]) return send(res, 200, travel.list());
        if (parts[1] === "state" && m === "GET") return send(res, 200, travel.get(name));
        if (parts[1] === "state" && m === "POST") return send(res, 200, travel.put(name, JSON.parse((await readBody(req, 80_000_000)).toString("utf8") || "{}")));
        if (parts[1] === "stop" && m === "POST") return send(res, 200, travel.stop(name));
      } catch (e) {
        return send(res, e?.status || 400, { error: e instanceof Error ? e.message : String(e) });
      }
    }
    // a device sharing its own files: its page opens a share, waits for requests, and answers them
    if (parts[0] === "devshare") {
      try {
        const id = url.searchParams.get("id"), token = url.searchParams.get("token");
        if (parts[1] === "next" && m === "GET") return devices.next(id, token, res);
        if (parts[1] === "reply" && m === "POST") return send(res, 200, { ok: await devices.reply(id, token, url.searchParams.get("rid"), req) });
        // a device sharing its music library: the list of songs Music shows the other devices (files stay there).
        // Before the general POST below, which reads the body (a body can only be read once).
        if (parts[1] === "music" && m === "POST") {
          const b = JSON.parse((await readBody(req, 20_000_000)).toString("utf8") || "{}");
          return send(res, 200, devices.setMusic(id, token, b.tracks));
        }
        if (m === "POST") {
          const b = JSON.parse((await readBody(req, 10_000)).toString("utf8") || "{}");
          if (parts[1] === "open") return send(res, 200, devices.open(b));
          if (parts[1] === "close") return send(res, 200, (devices.close(b.id, b.token), { ok: true }));
        }
      } catch (e) {
        return send(res, e?.status || 400, { error: e instanceof Error ? e.message : String(e) });
      }
    }
    // Explorer: the desktop's places, and the computer when that's allowed (see files.mjs)
    // pairings for Classic opened elsewhere: listed here; made and removed only on the desktop's own computer
    if (parts[0] === "pads") {
      try {
        if (parts[1] === "roster" && m === "GET") return send(res, 200, await padsLink.roster(String(url.searchParams.get("account") || "")));
        // linked servers: this one's name, the others, and (on this computer only) linking, unlinking, renaming
        if (parts[1] === "servers") {
          if (m === "GET") return send(res, 200, { me: peers.me(), servers: peers.list(), canChange: onThisPc(req), addresses: addressesOf(req.socket.localPort), lan: lan() });
          if (!onThisPc(req)) return send(res, 403, { error: "Servers are linked and unlinked on each server's own computer." });
          const b = JSON.parse((await readBody(req, 10_000)).toString("utf8") || "{}");
          if (b.op === "invite") return send(res, 200, peers.invite());
          if (b.op === "link") return send(res, 200, await padsLink.link(String(b.address || ""), String(b.code || ""), { port: req.socket.localPort, url: String(b.url || "") }));
          if (b.op === "unlink") return send(res, 200, peers.remove(String(b.id || "")));
          if (b.op === "rename") return send(res, 200, peers.rename(String(b.name || "")));
          return send(res, 400, { error: "Which change?" });
        }
        if (m === "POST") {
          const b = JSON.parse((await readBody(req, 200_000)).toString("utf8") || "{}");
          // the roster that comes back includes linked servers' devices, as last known (it doesn't wait for them)
          if (parts[1] === "hello") {
            const here = pads.hello(b);
            return send(res, 200, { ...here, ...(await padsLink.roster(String(b.account || ""), { wait: false })) });
          }
          if (parts[1] === "arrange") return send(res, 200, pads.arrange(String(b.account || ""), b.positions));
          if (parts[1] === "forget") return send(res, 200, pads.forget(String(b.account || ""), String(b.id || "")));
          if (parts[1] === "send") return send(res, 200, await padsLink.send(String(b.account || ""), b));
        }
      } catch (e) {
        return send(res, e?.status ?? 400, { error: e instanceof Error ? e.message : String(e) });
      }
    }
    if (parts[0] === "pairs") {
      if (m === "GET") {
        // where a paired Classic can find the desktop: this computer, and its home-network addresses (those answer
        // only when the desktop is shared on the network)
        const port = req.socket.localPort;
        const lanIps = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === "IPv4" && !i.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.)/.test(i.address)).map((i) => `http://${i.address}:${port}`);
        return send(res, 200, { pairs: pairs.list(), canChange: onThisPc(req), addresses: [`http://localhost:${port}`, ...lanIps], lan: lan() });
      }
      if (m === "POST") {
        if (!onThisPc(req)) return send(res, 403, { error: "Pairings are made and removed on the desktop's own computer." });
        const b = JSON.parse((await readBody(req, 10_000)).toString("utf8") || "{}");
        if (b.op === "add") return send(res, 200, pairs.add(b.name));
        if (b.op === "remove") return send(res, 200, pairs.remove(b.id));
      }
    }
    if (parts[0] === "theater") {
      const p = Object.fromEntries(url.searchParams.entries());
      try {
        if (parts[1] === "list" && m === "GET") return send(res, 200, { ...theater.list(Boolean(p.fresh)), canAddFolders: onThisPc(req) });
        // a device's shared folder, as videos (its page lists each folder; up to three folders down)
        if (parts[1] === "device" && m === "GET") {
          const out = [];
          const walk = async (dir, depth) => {
            for (const e of (await devices.list(dir)).entries) {
              if (out.length >= 2000) return;
              if (e.dir) {
                if (depth < 3) await walk(e.path, depth + 1);
              } else if (VIDEO_EXT.has(e.ext))
                out.push({ id: `d${e.size.toString(36)}-${Math.round(e.mtime / 1000).toString(36)}`, path: e.path, name: e.name.replace(/\.[^.]+$/, ""), ext: e.ext, shelf: "", size: e.size, mtime: e.mtime, seconds: 0, thumb: 0, fav: false, device: true });
            }
          };
          await walk(String(p.path || ""), 0);
          return send(res, 200, { videos: out.sort((a, b) => b.mtime - a.mtime) });
        }
        // a folder watched where it is (a network share, a folder on this computer): added on the computer itself
        if (parts[1] === "folder" && m === "POST") {
          if (!onThisPc(req)) return send(res, 403, { error: "Folders are added to the Theatre on the desktop's own computer." });
          const b = JSON.parse((await readBody(req, 100_000)).toString("utf8") || "{}");
          return send(res, 200, b.drop ? theater.dropFolder(b.path) : theater.addFolder(b.path));
        }
        if (parts[1] === "video" && m === "GET") {
          const id = String(p.id || "");
          const shelf = String(p.shelf || "");
          const info = theater.find(id, shelf);
          if (!info) return send(res, 404, { error: "Not found" });
          return serveRange(req, res, info.file);
        }
        if (parts[1] === "thumb" && m === "GET") {
          const id = String(p.id || "");
          const shelf = String(p.shelf || "");
          const info = theater.find(id, shelf);
          if (!info || !info.thumb) return send(res, 404, { error: "No thumb" });
          return serveFile(res, info.thumb);
        }
        if (parts[1] === "delete" && m === "POST") {
          if (!onThisPc(req)) return send(res, 403, { error: "Videos are removed on the desktop's own computer." });
          return send(res, 200, theater.remove(String(p.id || ""), String(p.shelf || "")));
        }
        return send(res, 404, { error: "Not found" });
      } catch (e) {
        return send(res, e?.status ?? 400, { error: e instanceof Error ? e.message : String(e) });
      }
    }
    if (parts[0] === "webxdc") {
      // the library of webxdc apps (xdc.mjs): list, import, download, delete
      try {
        if (parts[1] === "list" && m === "GET") return send(res, 200, L.list());
        if (parts[1] === "import" && m === "POST") {
          const name = decodeURIComponent(String(req.headers["x-filename"] || "app.xdc"));
          const r = L.importAny(await readBody(req, 300_000_000), name);
          return send(res, 200, { added: r.added.length, duplicates: r.duplicates, id: r.found[0]?.id ?? null, errors: r.errors });
        }
        if (parts[1] === "download" && m === "POST") {
          const b = JSON.parse((await readBody(req, 50_000)).toString("utf8") || "{}");
          const r = await L.download(String(b.id || ""), String(b.url || ""));
          return send(res, 200, r);
        }
        if (parts[1] === "delete" && m === "POST") {
          const b = JSON.parse((await readBody(req, 50_000)).toString("utf8") || "{}");
          L.remove(String(b.id || ""));
          return send(res, 200, { ok: true });
        }
        if (parts[1] === "data" && m === "GET") {
          const app = L.find(String(parts[2] || ""));
          if (!app) return send(res, 404, { error: "App not found" });
          const dataDir = path.join(vaultDir(), ".pandora", "xdc-data", app.appKey);
          try {
            return send(res, 200, JSON.parse(fs.readFileSync(path.join(dataDir, "data.json"), "utf8")));
          } catch {
            return send(res, 200, {});
          }
        }
        if (parts[1] === "data" && m === "POST") {
          const app = L.find(String(parts[2] || ""));
          if (!app) return send(res, 404, { error: "App not found" });
          const dataDir = path.join(vaultDir(), ".pandora", "xdc-data", app.appKey);
          fs.mkdirSync(dataDir, { recursive: true });
          fs.writeFileSync(path.join(dataDir, "data.json"), JSON.stringify(JSON.parse((await readBody(req, 50_000_000)).toString("utf8") || "{}"), null, 2));
          return send(res, 200, { ok: true });
        }
      } catch (e) {
        return send(res, e?.status ?? 400, { error: e instanceof Error ? e.message : String(e) });
      }
    }
    if (parts[0] === "music") {
      // the music library (music.mjs): folders, listing, covers, and the current queue
      const M = music();
      try {
        if (parts[1] === "folders" && m === "GET") return send(res, 200, { folders: M.folders(), places: knownPlace() });
        if (parts[1] === "set-folders" && m === "POST") {
          if (!onThisPc(req)) return send(res, 403, { error: "Music folders are set on the desktop's own computer." });
          const b = JSON.parse((await readBody(req, 100_000)).toString("utf8") || "{}");
          return send(res, 200, M.setFolders(b.folders));
        }
        if (parts[1] === "list" && m === "GET") return send(res, 200, M.list());
        if (parts[1] === "cover" && m === "GET") {
          const cover = M.cover(String(parts[2] || ""));
          if (!cover) return send(res, 404, { error: "No cover" });
          return serveFile(res, cover);
        }
        if (parts[1] === "file" && m === "GET") {
          const file = M.file(String(parts[2] || ""));
          if (!file) return send(res, 404, { error: "Not found" });
          return serveRange(req, res, file);
        }
        if (parts[1] === "song-fetch" && m === "POST") {
          const b = JSON.parse((await readBody(req, 50_000)).toString("utf8") || "{}");
          return send(res, 200, await songFetch().fetch(String(b.engine || ""), String(b.id || ""), b.options ?? {}));
        }
        if (parts[1] === "stream" && m === "POST") {
          const b = JSON.parse((await readBody(req, 50_000)).toString("utf8") || "{}");
          return send(res, 200, engineStream.start(String(b.engine || ""), String(b.id || ""), b));
        }
        if (parts[1] === "stream" && m === "GET") {
          const id = String(url.searchParams.get("id") || "");
          return engineStream.serve(req, res, id);
        }
        return send(res, 404, { error: "Not found" });
      } catch (e) {
        return send(res, e?.status ?? 400, { error: e instanceof Error ? e.message : String(e) });
      }
    }
    if (parts[0] === "files") {
      // the desktop's own files, when the person has allowed it (see files.mjs)
      const F = files();
      try {
        if (m === "GET") {
          const q = String(url.searchParams.get("q") || "").toLowerCase();
          return send(res, 200, F.list(q, { device: url.searchParams.get("device") }));
        }
        if (m === "POST") {
          const b = JSON.parse((await readBody(req, 100_000)).toString("utf8") || "{}");
          if (parts[1] === "open") return send(res, 200, F.open(b.path));
          if (parts[1] === "set-whole-pc") {
            if (!onThisPc(req)) return send(res, 403, { error: "Whole-computer sharing is set on the desktop's own computer." });
            F.setWholePc(Boolean(b.on));
            return send(res, 200, { wholeComputer: F.getWholePc() });
          }
          if (parts[1] === "set-sharing") {
            if (!onThisPc(req)) return send(res, 403, { error: "Sharing is set on the desktop's own computer." });
            F.setSharing(b.sharing);
            return send(res, 200, { sharing: F.getSharing() });
          }
        }
      } catch (e) {
        return send(res, e?.status ?? 400, { error: e instanceof Error ? e.message : String(e) });
      }
    }
    if (parts[0] === "library") {
      // linked folders (library.mjs): add, list, remove, and read files through them
      try {
        if (m === "GET") {
          if (parts[1] === "list") return send(res, 200, linked.list());
          if (parts[1] === "file") {
            const file = linked.file(String(parts[2] || ""), parts.slice(3).map(decodeURIComponent).join("/"));
            if (!file) return send(res, 404, { error: "Not found" });
            return serveFile(res, file);
          }
        }
        if (m === "POST") {
          const b = JSON.parse((await readBody(req, 100_000)).toString("utf8") || "{}");
          if (parts[1] === "add") {
            if (!onThisPc(req)) return send(res, 403, { error: "Linked folders are added on the desktop's own computer." });
            return send(res, 200, linked.add(String(b.name || ""), String(b.path || "")));
          }
          if (parts[1] === "remove") {
            if (!onThisPc(req)) return send(res, 403, { error: "Linked folders are removed on the desktop's own computer." });
            return send(res, 200, linked.remove(String(b.id || "")));
          }
        }
      } catch (e) {
        return send(res, e?.status ?? 400, { error: e instanceof Error ? e.message : String(e) });
      }
    }
    if (parts[0] === "upstreams") {
      // check for and download SEASIDE updates (upstreams.mjs)
      try {
        if (parts[1] === "check" && m === "GET") return send(res, 200, await checkUpdates());
        if (parts[1] === "download" && m === "POST") {
          if (!onThisPc(req)) return send(res, 403, { error: "Updates are downloaded on the desktop's own computer." });
          const b = JSON.parse((await readBody(req, 50_000)).toString("utf8") || "{}");
          return send(res, 200, await download(String(b.id || "")));
        }
      } catch (e) {
        return send(res, e?.status ?? 400, { error: e instanceof Error ? e.message : String(e) });
      }
    }
    if (parts[0] === "relay") {
      // the paired-Classic relay (relay.mjs): a page opened in Classic asks this desktop to proxy a request for it
      try {
        return send(res, 200, await relay({ req, res, url, notTheDesktop: notTheDesktop(req), pairedCors: pairedCors(req) }));
      } catch (e) {
        return send(res, e?.status ?? 400, { error: e instanceof Error ? e.message : String(e) });
      }
    }
    if (parts[0] === "inbound") {
      // inbound messages from other servers: pads linking, game invites, Vector mini-apps, and so on (see inbound.mjs)
      try {
        return send(res, 200, await inbound({ req, res, url, peers, padsLink, gameLinks, library }));
      } catch (e) {
        return send(res, e?.status ?? 400, { error: e instanceof Error ? e.message : String(e) });
      }
    }
    if (parts[0] === "game-links") {
      try {
        const b = m === "POST" ? JSON.parse((await readBody(req, 200_000)).toString("utf8") || "{}") : {};
        if (parts[1] === "list" && m === "GET") return send(res, 200, gameLinks.list());
        if (parts[1] === "create" && m === "POST") return send(res, 200, gameLinks.create(b));
        if (parts[1] === "join" && m === "POST") return send(res, 200, await gameLinks.join(b));
        if (parts[1] === "leave" && m === "POST") return send(res, 200, gameLinks.leave(b));
        return send(res, 404, { error: "Not found" });
      } catch (e) {
        return send(res, e?.status ?? 400, { error: e instanceof Error ? e.message : String(e) });
      }
    }
    if (parts[0] === "luanti") {
      // Luanti servers and the real client (luanti.mjs, luantiWeb.mjs, luantiRelay.mjs)
      try {
        if (parts[1] === "servers" && m === "GET") return send(res, 200, luanti.list());
        if (parts[1] === "status" && m === "GET") return send(res, 200, luanti.status());
        if (m === "POST") {
          const b = JSON.parse((await readBody(req, 100_000)).toString("utf8") || "{}");
          if (parts[1] === "add") return send(res, 200, luanti.add(b));
          if (parts[1] === "remove") return send(res, 200, luanti.remove(String(b.id || "")));
          if (parts[1] === "start") return send(res, 200, luanti.start(String(b.id || "")));
          if (parts[1] === "stop") return send(res, 200, luanti.stop(String(b.id || "")));
          if (parts[1] === "client") return send(res, 200, luantiWeb.client(String(b.id || ""), String(b.server || "")));
          if (parts[1] === "relay") return send(res, 200, luantiRelay.connect(b));
        }
        if (parts[1] === "wasm" && m === "GET") {
          const file = luantiWeb.asset(parts.slice(2).join("/"));
          if (!file) return send(res, 404, { error: "Not found" });
          return serveFile(res, file);
        }
      } catch (e) {
        return send(res, e?.status ?? 400, { error: e instanceof Error ? e.message : String(e) });
      }
    }
    if (parts[0] === "ssh") {
      // one-off SSH operations from the desktop to another computer (ssh.mjs)
      try {
        if (!onThisPc(req) && !viaTailnet(req)) return send(res, 403, { error: "SSH is run from the desktop's own computer or over your tailnet." });
        const b = JSON.parse((await readBody(req, 200_000)).toString("utf8") || "{}");
        return send(res, 200, await sshOp(b));
      } catch (e) {
        return send(res, e?.status ?? 400, { error: e instanceof Error ? e.message : String(e) });
      }
    }
    if (parts[0] === "webgame") {
      // shared state for webxdc and browser games (webgame.mjs)
      try {
        if (m === "GET") {
          const state = WG.get(String(parts[1] || ""));
          return send(res, 200, state ?? {});
        }
        if (m === "POST") {
          const b = JSON.parse((await readBody(req, 200_000)).toString("utf8") || "{}");
          return send(res, 200, WG.set(String(parts[1] || ""), b));
        }
      } catch (e) {
        return send(res, e?.status ?? 400, { error: e instanceof Error ? e.message : String(e) });
      }
    }
    if (parts[0] === "app-net") {
      // appNet: a simple pub/sub bus between apps on the same desktop (appNet.mjs)
      try {
        if (m === "GET") return send(res, 200, AN.read(String(parts[1] || "")));
        if (m === "POST") {
          const b = JSON.parse((await readBody(req, 200_000)).toString("utf8") || "{}");
          return send(res, 200, AN.write(String(parts[1] || ""), b));
        }
      } catch (e) {
        return send(res, e?.status ?? 400, { error: e instanceof Error ? e.message : String(e) });
      }
    }
    if (parts[0] === "pads-wire") {
      // mouse/keyboard crossing between devices (padsWire.mjs): only from this computer
      try {
        if (!onThisPc(req)) return send(res, 403, { error: "The pads wire is controlled from the desktop's own computer." });
        const b = JSON.parse((await readBody(req, 50_000)).toString("utf8") || "{}");
        if (m === "POST") return send(res, 200, padsWire.send(b));
      } catch (e) {
        return send(res, e?.status ?? 400, { error: e instanceof Error ? e.message : String(e) });
      }
    }
    if (parts[0] === "pads-link") {
      // linked SEASIDE servers: the realtime wire (padsLink.mjs)
      try {
        const b = JSON.parse((await readBody(req, 200_000)).toString("utf8") || "{}");
        if (parts[1] === "send" && m === "POST") return send(res, 200, await padsLink.send(String(b.account || ""), b));
        if (parts[1] === "roster" && m === "POST") return send(res, 200, await padsLink.roster(String(b.account || ""), b));
      } catch (e) {
        return send(res, e?.status ?? 400, { error: e instanceof Error ? e.message : String(e) });
      }
    }
    if (parts[0] === "ws") {
      // WebSocket upgrade endpoints
      if (parts[1] === "frames" && m === "GET") return acceptSocket(req, res, url);
      if (parts[1] === "duplex" && m === "GET") return openDuplex(req, res);
    }
    return send(res, 404, { error: "Not found" });
  }

  return {
    name: "desk-server",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
        if (url.pathname.startsWith("/api/")) return api(req, res, url);
        // apps on 127.0.0.1 serve themselves from public/apps/<app>, with injected webxdc helpers
        if (isAppHost(req)) {
          const appName = url.pathname.split("/").filter(Boolean)[0];
          if (appName) {
            const appFile = path.join(publicDir || path.join(root, "public"), "apps", appName, "index.html");
            if (fs.existsSync(appFile)) {
              res.setHeader("Content-Security-Policy", XDC_CSP);
              return serveFile(res, appFile, `${webxdcScript}\n${helperScript}`);
            }
          }
          return serveFile(res, path.join(publicDir || path.join(root, "public"), "apps", "index.html"));
        }
        // the desktop on localhost serves index.html, with the Classic relay script injected so Classic can pair
        if (url.pathname === "/" || url.pathname === "/index.html") {
          const indexFile = path.join(publicDir || path.join(root, "public"), "index.html");
          return serveFile(res, indexFile, classicRelayScript);
        }
        // a few files the desktop needs that are not part of the Vite build
        if (url.pathname === "/webxdc.js") return serveFile(res, path.join(publicDir || path.join(root, "public"), "webxdc.js"));
        if (url.pathname === "/helper.js") return serveFile(res, path.join(publicDir || path.join(root, "public"), "helper.js"));
        if (url.pathname === "/relay.js") return serveFile(res, path.join(publicDir || path.join(root, "public"), "relay.js"));
        next();
      });
    },
    config(config) {
      root = path.resolve(config.root || process.cwd());
      dataDir = path.resolve(config.dataDir || path.join(root, "data"));
      publicDir = config.publicDir ? path.resolve(config.publicDir) : path.join(root, "public");
      fs.mkdirSync(dataDir, { recursive: true });
    },
    closeBundle() {
      stdio.closeAll();
      ngit.close();
      engine.forgetLast();
      heart.stop?.();
      memory.stop?.();
      terminals.closeAll();
      luantiRelay.close();
      browser.close();
      vector().stop();
      vectorHost().stop();
      memory.stop?.();
      ungoogled.stop();
      devices.closeAll();
      lanWatch.stop();
    },
  };
}
