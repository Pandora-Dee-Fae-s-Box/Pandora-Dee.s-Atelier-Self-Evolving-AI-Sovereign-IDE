// Media Theatre's side of the desktop: the video library (server/theater.mjs), backing videos up from a phone in
// checked pieces that carry on after a dropped connection, thumbnails made by whichever page can play the video,
// and where each video was left off (kept per device).

import { useSyncExternalStore } from "react";
import type { QueueWhere } from "./queueOps.ts";
import { rawUrl } from "./explorer.ts";
import { deviceName } from "./devshare.ts";
import { sendPieces, wholeUpload } from "./uploadCore.ts";

export type Video = { id: string; path: string; name: string; ext: string; shelf: string; size: number; mtime: number; seconds: number; thumb: 1 | 0 | -1; fav: boolean; watched?: boolean; device?: boolean; folder?: string;
  /** a YouTube link (played from YouTube; its title and thumbnail kept here) */ link?: "youtube"; yt?: string; start?: number; author?: string };
export type Playlist = { id: string; name: string; items: string[]; made: number };
/** Shows gathered under a name ("Kids"), in an order of one's own: each item is "<shelf>/<folder inside it>". */
export type Collection = { id: string; name: string; items: string[]; kids?: boolean };
export type Library = { root: string; shelves: string[]; videos: Video[]; playlists?: Playlist[]; folders?: { path: string; name: string }[]; canAddFolders?: boolean; scanning?: string[]; collections?: Collection[];
  /** which device each shelf came from (the one that made it, or first backed videos up to it) */ from?: Record<string, string> };

async function call<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error || `It answered ${r.status}.`);
  return j as T;
}

// ---- the library ----

let lib: Library | null = null;
let loading: Promise<void> | null = null;
let libError = "";
const libListeners = new Set<() => void>();
const libChanged = () => libListeners.forEach((fn) => fn());

let again = 0;
/** The library again (fresh: watched folders read again too). While a watched folder is still being read, it looks
 *  again every few seconds until it's in. */
export function refreshLibrary(fresh = false): Promise<void> {
  return (loading ??= call<Library>(`/api/theater/list${fresh ? "?fresh=1" : ""}`)
    .then((l) => {
      lib = l;
      libError = "";
      window.clearTimeout(again);
      if (l.scanning?.length) again = window.setTimeout(() => void refreshLibrary(), 3000);
    })
    .catch((e) => {
      libError = e instanceof Error ? e.message : String(e);
    })
    .finally(() => {
      loading = null;
      libChanged();
    }));
}

export function useLibrary(): { lib: Library | null; error: string } {
  const l = useSyncExternalStore(
    (fn) => (libListeners.add(fn), () => libListeners.delete(fn)),
    () => lib,
  );
  return { lib: l, error: libError };
}

export const theaterApi = {
  fav: (id: string, on: boolean) => call<{ fav: boolean }>("/api/theater/fav", { id, on }),
  move: (path: string, shelf: string) => call<{ path: string }>("/api/theater/move", { path, shelf }),
  addLink: (url: string, shelf: string) => call<{ id: string; shelf: string; title: string; again: boolean }>("/api/theater/link", { url, shelf }),
  dropLink: (id: string) => call<{ ok: true }>("/api/theater/link", { id, drop: true }),
  shelf: (name: string) => call<{ shelf: string }>("/api/theater/shelf", { name, device: deviceName() }),
  /** A shelf, or a show folder on one, added to another shelf (moved there as a folder of its own); to "" it
   *  becomes a shelf of its own. */
  addToShelf: (shelf: string, folder: string, to: string) => call<{ shelf: string; folder: string }>("/api/theater/add-to-shelf", { shelf, folder, to }),
  renameShelf: (shelf: string, name: string) => call<{ shelf: string }>("/api/theater/rename-shelf", { shelf, name }),
  /** A show or season folder on a vault shelf, renamed where it is. */
  renameFolder: (shelf: string, folder: string, name: string) => call<{ folder: string }>("/api/theater/rename-folder", { shelf, folder, name }),
  have: (items: { name: string; size: number }[]) => call<{ have: (string | null)[] }>("/api/theater/have", { items }),
  /** Make a playlist (no id), or change one's name or videos. */
  playlist: (p: { id?: string; name?: string; items?: string[] }) => call<Playlist>("/api/theater/playlist", p),
  dropPlaylist: (id: string) => call<{ ok: true }>("/api/theater/playlist", { id, drop: true }),
  /** Make a collection (no id), or change its name, its shows, or where it sits among the others (at). */
  collection: (c: { id?: string; name?: string; items?: string[]; at?: number; kids?: boolean }) => call<Collection>("/api/theater/collection", c),
  dropCollection: (id: string) => call<{ ok: true }>("/api/theater/collection", { id, drop: true }),
  /** A folder watched where it is (a network share, a folder on this computer): a shelf of its own. */
  addFolder: (path: string, name?: string) => call<{ path: string; name: string }>("/api/theater/folder", { path, name }),
  dropFolder: (path: string) => call<{ ok: true }>("/api/theater/folder", { path, drop: true }),
  /** The videos in a device's shared folder (played from that device while its page is open). */
  deviceVideos: (path: string) => call<{ videos: Video[] }>(`/api/theater/device?path=${encodeURIComponent(path)}`),
};

/** Change a playlist on the desktop, and in the list here straight away. */
export async function changePlaylist(p: { id?: string; name?: string; items?: string[] }) {
  const saved = await theaterApi.playlist(p);
  if (lib) {
    const others = (lib.playlists ?? []).filter((x) => x.id !== saved.id);
    lib = { ...lib, playlists: p.id ? (lib.playlists ?? []).map((x) => (x.id === saved.id ? saved : x)) : [...others, saved] };
    libChanged();
  }
  return saved;
}
export async function deletePlaylist(id: string) {
  await theaterApi.dropPlaylist(id);
  if (lib) {
    lib = { ...lib, playlists: (lib.playlists ?? []).filter((x) => x.id !== id) };
    libChanged();
  }
}

export const thumbUrl = (id: string) => `/api/theater/thumb?id=${encodeURIComponent(id)}`;
export const videoUrl = (v: Video) => rawUrl(v.path);

/** Change one video in the list straight away (the server already has it). */
export function patchVideo(id: string, patch: Partial<Video>) {
  if (!lib) return;
  lib = { ...lib, videos: lib.videos.map((v) => (v.id === id ? { ...v, ...patch } : v)) };
  libChanged();
}

// ---- thumbnails ----

const triedThumbs = new Set<string>();
let thumbRunning = false;

/** A still from the video and its length, made here and kept on the desktop for every device. One at a time. */
export async function makeThumbs(videos: Video[]) {
  if (thumbRunning) return;
  thumbRunning = true;
  try {
    for (const v of videos) {
      if (v.thumb !== 0 || triedThumbs.has(v.id)) continue;
      triedThumbs.add(v.id);
      const got = await still(videoUrl(v)).catch(() => null);
      if (got === null) continue; // too slow this time: try again another day
      const r = await fetch(`/api/theater/thumb?id=${encodeURIComponent(v.id)}&seconds=${got.seconds}`, { method: "POST", body: got.jpeg ?? new Blob([]) });
      if (r.ok) patchVideo(v.id, { thumb: got.jpeg ? 1 : -1, seconds: got.seconds || v.seconds });
    }
  } finally {
    thumbRunning = false;
  }
}

/** A JPEG from a little way in, or `jpeg: null` when this browser can't play the video at all. */
function still(src: string): Promise<{ jpeg: Blob | null; seconds: number }> {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.muted = true;
    v.preload = "metadata";
    v.playsInline = true;
    const done = (out: { jpeg: Blob | null; seconds: number } | null) => {
      clearTimeout(timer);
      v.removeAttribute("src");
      v.load();
      if (out) resolve(out);
      else reject(new Error("slow"));
    };
    const timer = setTimeout(() => done(null), 25_000);
    v.onerror = () => done({ jpeg: null, seconds: 0 });
    v.onloadedmetadata = () => {
      const d = Number.isFinite(v.duration) ? v.duration : 0;
      v.currentTime = Math.min(1.5, d * 0.1);
    };
    v.onseeked = () => {
      const d = Number.isFinite(v.duration) ? v.duration : 0;
      if (!v.videoWidth) return done({ jpeg: null, seconds: d });
      const w = 360, h = Math.round((v.videoHeight / v.videoWidth) * w);
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      c.getContext("2d")?.drawImage(v, 0, 0, w, h);
      c.toBlob((b) => done({ jpeg: b, seconds: d }), "image/jpeg", 0.75);
    };
    v.src = src;
  });
}

// ---- where each video was left off, on this device ----

const POS_KEY = "pdd-theater-pos";
function positions(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(POS_KEY) || "{}");
  } catch {
    return {};
  }
}
export const leftOff = (id: string) => positions()[id] ?? 0;
export function rememberPosition(id: string, at: number, length: number) {
  const all = positions();
  // the very start and the last few seconds count as "not started" and "finished"
  if (at < 8 || (length && at > length - 8)) delete all[id];
  else all[id] = Math.round(at);
  const keys = Object.keys(all);
  if (keys.length > 300) for (const k of keys.slice(0, keys.length - 300)) delete all[k];
  try {
    localStorage.setItem(POS_KEY, JSON.stringify(all));
  } catch {
    /* private mode: it just won't remember */
  }
}

// ---- backing up from this device ----

export type Job = {
  key: string;
  file: File;
  shelf: string;
  state: "checking" | "waiting" | "sending" | "done" | "kept" | "failed";
  sent: number;
  error?: string;
  /** the device stopped letting the page read the file: choosing it again carries on */
  reread?: boolean;
  /** where it's kept on the desktop */
  path?: string;
};

let jobs: Job[] = [];
const jobListeners = new Set<() => void>();
const jobsChanged = () => {
  jobs = [...jobs];
  jobListeners.forEach((fn) => fn());
};
const setJob = (j: Job, patch: Partial<Job>) => {
  Object.assign(j, patch);
  jobsChanged();
};

export function useJobs(): Job[] {
  return useSyncExternalStore(
    (fn) => (jobListeners.add(fn), () => jobListeners.delete(fn)),
    () => jobs,
  );
}

export const isVideoFile = (f: File) => f.type.startsWith("video/") || /\.(mp4|m4v|mov|webm|mkv|3gp|avi|ogv)$/i.test(f.name);

/** Back these up onto a shelf. Ones the desktop already has are marked kept straight away. */
export async function backUp(files: File[], shelf: string) {
  const videos = files.filter(isVideoFile);
  // the same video chosen again for a backup that stopped: it takes the new file and carries on from what arrived
  let resumed = 0;
  const rest = videos.filter((file) => {
    const old = jobs.find((j) => j.shelf === shelf && j.file.name === file.name && j.file.size === file.size && (j.state === "failed" || j.reread));
    if (!old) return true;
    setJob(old, { file, state: "waiting", error: undefined, reread: false });
    resumed++;
    return false;
  });
  if (resumed) void run();
  const fresh: Job[] = rest.map((file) => ({ key: `${file.name}\u0000${file.size}\u0000${Math.random()}`, file, shelf, state: "checking", sent: 0 }));
  if (!fresh.length) return resumed;
  jobs = [...jobs, ...fresh];
  jobsChanged();
  try {
    const { have } = await theaterApi.have(fresh.map((j) => ({ name: j.file.name, size: j.file.size })));
    fresh.forEach((j, i) => setJob(j, have[i] ? { state: "kept", sent: j.file.size, path: have[i]! } : { state: "waiting" }));
  } catch {
    fresh.forEach((j) => setJob(j, { state: "waiting" }));
  }
  void run();
  return fresh.length + resumed;
}

export function clearFinished() {
  jobs = jobs.filter((j) => !["done", "kept"].includes(j.state));
  jobsChanged();
}

export function cancelJob(j: Job) {
  jobs = jobs.filter((x) => x !== j);
  jobsChanged();
  const q = new URLSearchParams({ shelf: j.shelf, name: j.file.name, size: String(j.file.size) });
  if (j.state !== "done" && j.state !== "kept") void fetch(`/api/theater/upload?${q}`, { method: "DELETE" }).catch(() => {});
}

export function retryJob(j: Job) {
  setJob(j, { state: "waiting", error: undefined });
  void run();
}

let running = false;
let lock: { release: () => Promise<void> } | null = null;

// keep the phone's screen on while it sends, or it stops halfway when the screen goes dark. The browser lets go of
// the lock whenever the page is hidden, so it's asked for again each time the page comes back.
async function holdScreen() {
  if (lock || document.visibilityState !== "visible") return;
  try {
    const l = (await (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> } & EventTarget> } }).wakeLock?.request("screen")) ?? null;
    if (!running) return void l?.release().catch(() => {});
    lock = l;
    l?.addEventListener("release", () => {
      if (lock === l) lock = null;
    });
  } catch {
    lock = null;
  }
}

// a wait between tries ends early when the connection or the page comes back
let wakeUp: (() => void) | null = null;
const pause = (ms: number) =>
  new Promise<void>((r) => {
    const t = setTimeout(() => ((wakeUp = null), r()), ms);
    wakeUp = () => (clearTimeout(t), (wakeUp = null), r());
  });
if (typeof window !== "undefined") {
  window.addEventListener("online", () => wakeUp?.());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !running) return;
    void holdScreen();
    wakeUp?.();
  });
}

async function run() {
  if (running) return;
  running = true;
  await holdScreen();
  try {
    let j: Job | undefined;
    while ((j = jobs.find((x) => x.state === "waiting"))) await send(j);
  } finally {
    running = false;
    void lock?.release().catch(() => {});
    lock = null;
    void refreshLibrary();
  }
}

async function sha256(b: ArrayBuffer): Promise<string> {
  // crypto.subtle needs the secure (https) address; over plain http the desktop takes the piece unchecked
  if (!crypto.subtle) return "";
  const d = await crypto.subtle.digest("SHA-256", b);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function send(j: Job) {
  const f = j.file;
  const base = { shelf: j.shelf, name: f.name, size: String(f.size), modified: String(f.lastModified || ""), device: deviceName() };
  setJob(j, { state: "sending", error: undefined, reread: false });
  const end = await sendPieces({
    file: f,
    url: (offset) => `/api/theater/upload?${new URLSearchParams(offset === undefined ? base : { ...base, offset: String(offset) })}`,
    fetch: (...a) => fetch(...a),
    sha256,
    alive: () => jobs.includes(j),
    progress: (sent, note) => setJob(j, { sent, error: note }),
    pause,
    whole: (url, file, progress) => wholeUpload(url, file, progress),
  });
  if (end.state === "done") setJob(j, { state: "done", error: undefined, path: end.path });
  else if (end.state === "failed") setJob(j, { state: "failed", error: end.error, reread: !!end.reread });
}

export const sizeText = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${Math.round(n / 1e6)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
export const lengthText = (s: number) => {
  if (!s) return "";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
};

/** Change a collection on the desktop, then the library (its order among the others may have changed). */
export async function changeCollection(c: { id?: string; name?: string; items?: string[]; at?: number; kids?: boolean }) {
  const saved = await theaterApi.collection(c);
  await refreshLibrary();
  return saved;
}

// ── a video handed over from Explorer ("Open in… → Theatre") ─────────────────────────────────────────────
let asked: string | null = null;
/** Play this file in the Theatre: the library's copy when it's on a shelf, or just the file when it isn't. */
export function askTheater(path: string) {
  asked = path;
  window.dispatchEvent(new Event("pdd-theater-ask"));
}
/** The file asked for, once (the Theatre takes it when it opens, or straight away if it's open). */
export function takeTheaterAsk(): string | null {
  const p = asked;
  asked = null;
  return p;
}

// ── videos put in the queue from outside the Theatre (a tool, a ferry window, a jetty): by id, plain data ──────
let queued: { ids: string[]; where: QueueWhere }[] = [];
/** Queue these videos (by library id) next, last, or after the current show's season; the Theatre takes them when it
 *  opens, or straight away if it's open. */
export function queueInTheatre(ids: string[], where: QueueWhere) {
  queued.push({ ids, where });
  window.dispatchEvent(new Event("pdd-theater-queue"));
}
/** What's waiting to be queued, once. */
export function takeTheatreQueue(): { ids: string[]; where: QueueWhere }[] {
  const q = queued;
  queued = [];
  return q;
}
