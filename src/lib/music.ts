// The music player: your library (folders the desktop's server scans), internet radio, one queue,
// and a Web Audio chain (volume → analyser) that the visualizers and the characters' "listening" read.

import { create } from "zustand";
import { desk, useDesk } from "./store.ts";
import { outbound } from "./outbound.ts";
import { allowed, blockedBecause } from "./privacy.ts";
import { speech } from "./voice.ts";
import { pack, unpack } from "./musicPlace.ts";
import { previousRun, runKey } from "./musicRuns.ts";
import { placeInQueue, type QueueWhere } from "./queueOps.ts";
import { albumHome } from "./albumGroups.ts";
import { LEAD, QUIET, TAIL, peakOf, quietEnding, upcoming } from "./gapless.ts";

export type { MusicPlaylist, MusicPrefs, Station } from "./musicPrefs.ts";
import type { Station } from "./musicPrefs.ts";
export type Item = ({ kind: "track" } & Track) | ({ kind: "radio" } & Station);
export type Track = {
  id: string; title: string; artist: string; album: string; year: number; track: number; genre: string; duration: number; cover: boolean; bitrate: number; size: number; folder: string; comment?: string;
  /** the file's own name */ file?: string;
  /** where it is inside its music folder (for playlist files) */ rel?: string;
  /** a song another device is sharing (lib/musicShare.ts): where it plays from, and which device has it */ src?: string; device?: string;
};

type Runtime = {
  tracks: Track[];
  own: string;
  /** The music folders, as the desktop's server keeps them (the same for every device). */
  folders: string[];
  loaded: boolean;
  scanning: string;
  queue: Item[];
  index: number;
  playing: boolean;
  position: number;
  duration: number;
  error: string;
};

export const useMusic = create<Runtime>(() => ({ tracks: [], own: "", folders: [], loaded: false, scanning: "", queue: [], index: -1, playing: false, position: 0, duration: 0, error: "" }));
const mu = () => useMusic.getState();
const prefs = () => desk().music;
const setPrefs = (p: Partial<import("./musicPrefs.ts").MusicPrefs>) => desk().set({ music: { ...desk().music, ...p } });

// ---------- the sound chain ----------

let audio: HTMLAudioElement | null = null;
let ctx: AudioContext | null = null;
let gain: GainNode | null = null;
let analyser: AnalyserNode | null = null;
let ducked = false;

/** A player for one song. There are two: the one playing and, with gapless on, the next song waiting beside it;
 *  only the one playing speaks for Music (its time, play and pause, its end, its errors). */
function makePlayer(): HTMLAudioElement {
  const el = new Audio();
  el.preload = "auto";
  el.crossOrigin = "anonymous";
  const mine = () => el === audio;
  el.addEventListener("timeupdate", () => {
    if (!mine()) return;
    useMusic.setState({ position: el.currentTime, duration: Number.isFinite(el.duration) ? el.duration : 0 });
    watchEnd();
  });
  el.addEventListener("play", () => mine() && useMusic.setState({ playing: true, error: "" }));
  el.addEventListener("pause", () => mine() && useMusic.setState({ playing: false }));
  // a station that keeps playing: its next drop gets a fresh round of reconnecting
  el.addEventListener("playing", () => mine() && (clearTimeout(radio.stall), (radio.since = Date.now())));
  // a station stuck buffering for a while has dropped as surely as one that ended
  el.addEventListener("waiting", () => {
    if (!mine() || current()?.kind !== "radio") return;
    clearTimeout(radio.stall);
    radio.stall = window.setTimeout(() => mine() && !el.paused && el.readyState < 3 && radioDropped(), 15000);
  });
  // a live stream "ends" when the station (or the connection to it) drops: reconnect rather than move on
  el.addEventListener("ended", () => mine() && !radioDropped() && void next(true));
  el.addEventListener("error", () => {
    if (!mine()) return;
    const cur = current();
    const code = el.error?.code ?? 0;
    if (cur?.kind === "radio") return radioDropped() || useMusic.setState({ playing: false, error: `${cur.name} isn't answering.` });
    useMusic.setState({ playing: false, error: "That file couldn't be played." });
    if (cur?.kind === "track") void whyNot(cur, code).then((error) => current() === cur && useMusic.setState({ error }));
  });
  wire(el);
  return el;
}

// reconnecting a station that dropped (the station's server, or the internet, for a moment): a few tries, further
// apart each time; a station that then plays for a minute starts with fresh tries at its next drop
const RETRY_WAIT = [1, 2, 4, 8, 15, 30];
const radio = { tries: 0, since: 0, timer: 0, stall: 0, url: "", waiting: false };
/** The station playing dropped: try it again in a moment (true), or give up (false: it dropped too often). */
function radioDropped(): boolean {
  const cur = current();
  if (cur?.kind !== "radio") return false;
  // (an error and an end can both report one drop: a try already waiting covers it)
  if (radio.waiting && radio.url === cur.url) return true;
  // another station, or this one played well for a minute since it last dropped: fresh tries
  if (radio.url !== cur.url || (radio.since && Date.now() - radio.since > 60_000)) radio.tries = 0;
  radio.url = cur.url;
  radio.since = 0;
  if (radio.tries >= RETRY_WAIT.length) return false;
  const wait = RETRY_WAIT[radio.tries++] * 1000;
  useMusic.setState({ error: `${cur.name} dropped out; reconnecting${radio.tries > 1 ? ` (try ${radio.tries} of ${RETRY_WAIT.length})` : ""}…` });
  const at = mu().index;
  window.clearTimeout(radio.timer);
  radio.waiting = true;
  radio.timer = window.setTimeout(() => {
    radio.waiting = false;
    // only if it's still the station chosen (not another song, not stopped meanwhile)
    if (mu().index === at && current() === cur) void start(at);
  }, wait);
  return true;
}

function element(): HTMLAudioElement {
  return (audio ??= makePlayer());
}

/** Into the sound chain (volume, visualizers), once Web Audio is running. */
const wired = new WeakSet<HTMLAudioElement>();
function wire(el: HTMLAudioElement | null) {
  if (!el || !ctx || !gain || wired.has(el)) return;
  ctx.createMediaElementSource(el).connect(gain);
  wired.add(el);
}

// ---------- gapless (gapless.ts) ----------

let spare: HTMLAudioElement | null = null;
/** What the spare player has loaded: the queue position and its file. */
let ready: { at: number; src: string } | null = null;
let handTimer = 0;
let quietSince: number | null = null;
const wave = new Uint8Array(2048);

/** The song that comes next on its own, when both it and this one are songs (stations don't end). */
function nextSong() {
  const { queue, index } = mu();
  const at = upcoming(queue.length, index, prefs().repeat);
  const it = queue[at];
  return at >= 0 && it?.kind === "track" && queue[index]?.kind === "track" ? { at, it } : null;
}

/** On each tick of the song playing: load the next one near the end, and start it the moment this one ends. */
function watchEnd() {
  const a = audio;
  if (!prefs().gapless || !a || a.paused || !Number.isFinite(a.duration)) return;
  const n = nextSong();
  if (!n) return;
  const left = a.duration - a.currentTime;
  const src = srcOf(n.it);
  if (left < 30 && ready?.src !== src) {
    spare ??= makePlayer();
    spare.src = src;
    spare.load();
    ready = { at: n.at, src };
  }
  // the analyser hears the music after the volume, so its level is scaled back; turned right down, nothing is judged
  const level = gain?.gain.value ?? 1;
  if (analyser && level > 0.02 && left <= TAIL) {
    analyser.getByteTimeDomainData(wave);
    const now = performance.now() / 1000;
    if (peakOf(wave) / level > QUIET) quietSince = null;
    else quietSince ??= now;
    if (quietEnding(left, quietSince, now)) return handOff();
  }
  if (left <= 1 && !handTimer) handTimer = window.setTimeout(handOff, Math.max(0, (left - LEAD) / (a.playbackRate || 1)) * 1000);
}

/** The next song starts and becomes the one playing; this one stops a moment later. If the queue changed since the
 *  next song was loaded, nothing happens here and the song's own end carries on as usual. */
function handOff() {
  window.clearTimeout(handTimer);
  handTimer = 0;
  quietSince = null;
  const n = nextSong();
  const old = audio;
  if (!n || !spare || !old || ready?.src !== srcOf(n.it)) return;
  const sp = spare;
  spare = old;
  audio = sp;
  ready = null;
  sp.currentTime = 0;
  applyVolume();
  void sp.play().catch(() => {});
  window.setTimeout(() => old.pause(), 300);
  useMusic.setState({ index: n.at, position: 0, duration: n.it.duration, error: "", playing: true });
  mediaSession(n.it);
  for (const fn of listeners) fn(n.it);
}

/** Starting a song by hand: the waiting one is set aside. */
function dropSpare() {
  window.clearTimeout(handTimer);
  handTimer = 0;
  quietSince = null;
  ready = null;
  spare?.pause();
}

const KIND_OF: Record<string, string> = { mp3: "audio/mpeg", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg; codecs=opus", wav: "audio/wav", flac: "audio/flac", m4a: "audio/mp4", aac: "audio/aac", webm: "audio/webm" };
/** Whether this browser plays that kind of file at all (so a failure is the file's, not the browser's). */
const playsKind = (ext: string) => Boolean(KIND_OF[ext] && new Audio().canPlayType(KIND_OF[ext]));

/** Which file wouldn't play, why, and where it is, in plain words. */
async function whyNot(t: Track, code: number) {
  const which = `"${t.title}${t.artist ? ` · ${t.artist}` : ""}"`;
  // a song shared by another device plays only while that device's page is open and awake
  if (t.src) return `${which} is on ${t.device || "another device"}, which isn't answering: its SEASIDE page closed, or it's asleep.`;
  const name = t.file ?? "";
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  const where = `${name ? `${name}, ` : ""}in ${t.folder || "your music"}`;
  let status = 0;
  try {
    status = (await fetch(`/api/music/file?id=${t.id}`, { headers: { Range: "bytes=0-0" } })).status;
  } catch {
    status = -1;
  }
  const why =
    status === 404
      ? "it isn't there any more: moved, renamed or deleted since Music last looked (Rescan in Music's folders picks up the change)"
      : status === 403
        ? "the desktop isn't allowed to read it (its folder may have been taken out of Music)"
        : status === -1
          ? "the desktop didn't answer (is it still running, and is this device still connected?)"
          : status === 415
          ? "no browser plays it, and the desktop couldn't convert it (on Windows it uses Windows' own converter; elsewhere it needs ffmpeg)"
          : code === 3
            ? "it looks damaged partway through (it may not have finished copying or downloading)"
            : code === 2
              ? "the connection dropped while it was loading"
              : playsKind(ext)
                ? `it isn't a playable .${ext} (it may be damaged, cut short, or not really audio)`
                : `this browser can't play ${ext ? `.${ext} files` : "this kind of file"}${ext === "flac" || ext === "alac" || ext === "ape" || ext === "wma" ? " (another browser, or converting it to MP3 or Opus, will)" : ""}`;
  return `Couldn't play ${which} (${where}): ${why}.`;
}

/** Web Audio starts on the first play (browsers only allow it after a click). */
function chain() {
  if (ctx) return;
  ctx = new AudioContext();
  gain = ctx.createGain();
  analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.8;
  gain.connect(analyser);
  analyser.connect(ctx.destination);
  wire(element());
  wire(spare);
  applyVolume();
}

export const audioGraph = () => ({ ctx, analyser, gain, source: gain });

/** A short burst of shortwave static between stations (the worldband dial). */
export function staticBurst(seconds = 0.7) {
  chain();
  if (!ctx || !gain) return;
  void ctx.resume();
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const fade = Math.min(1, i / (ctx.sampleRate * 0.05), (len - i) / (ctx.sampleRate * 0.15));
    // hiss with a slow warble, like tuning across the band
    d[i] = (Math.random() * 2 - 1) * 0.35 * fade * (0.6 + 0.4 * Math.sin(i / (ctx.sampleRate / 9)));
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 1800;
  band.Q.value = 0.7;
  src.connect(band);
  band.connect(gain);
  src.start();
}

// ---------- worldband: stations on the map ----------

/**
 * Ask radio-browser.info, trying its servers in turn: they're run by volunteers and some are often down. The
 * one that answered is tried first next time.
 */
const MIRRORS = ["de1", "de2", "all", "fi1", "nl1", "at1"];
let lastGood = "de1";
async function directory(path: string, timeout: number): Promise<Response> {
  const errors: string[] = [];
  for (const m of [lastGood, ...MIRRORS.filter((x) => x !== lastGood)]) {
    try {
      const r = await outbound(`https://${m}.api.radio-browser.info${path}`, { headers: { "User-Agent": "PandoraDeeDesktop/3.10" }, timeout }, desk().net.via);
      if (r.ok) {
        lastGood = m;
        return r;
      }
      errors.push(`${m}: ${r.status}`);
    } catch (e) {
      errors.push(`${m}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  throw new Error(`The radio directory didn't answer (${errors.slice(0, 3).join("; ")}).`);
}

export type GeoStation = Station & { lat: number; lon: number };
let world: Promise<GeoStation[]> | null = null;

/** Stations with a place on the map (radio-browser.info), the most listened-to first. Fetched once per session. */
export function worldStations(): Promise<GeoStation[]> {
  if (!allowed(desk().privacy, "web")) return Promise.reject(new Error(blockedBecause(desk().privacy, "web")));
  return (world ??= (async () => {
    const params = new URLSearchParams({ has_geo_info: "true", limit: "5000", hidebroken: "true", order: "clickcount", reverse: "true" });
    const r = await directory(`/json/stations/search?${params}`, 60);
    const rows = (await r.json()) as { name: string; url_resolved?: string; url: string; favicon?: string; tags?: string; country?: string; codec?: string; bitrate?: number; homepage?: string; geo_lat?: number; geo_long?: number }[];
    return rows
      .filter((x) => Number.isFinite(x.geo_lat) && Number.isFinite(x.geo_long) && Math.abs(x.geo_lat!) <= 90)
      .map((x) => ({ name: x.name.trim(), url: x.url_resolved || x.url, favicon: x.favicon || undefined, tags: x.tags, country: x.country, codec: x.codec, bitrate: x.bitrate, homepage: x.homepage, lat: x.geo_lat!, lon: x.geo_long! }));
  })().catch((e) => {
    world = null;
    throw e;
  }));
}

/** Tune to a station: a moment of static, then the station. */
export function tune(st: Station) {
  staticBurst(0.6);
  window.setTimeout(() => playList([{ kind: "radio", ...st }], 0), 450);
}

function applyVolume() {
  const v = prefs().volume * (ducked && prefs().duck ? 0.3 : 1);
  if (gain && ctx) gain.gain.setTargetAtTime(v, ctx.currentTime, 0.25);
  else for (const el of [audio, spare]) if (el) el.volume = v;
}

// lower the music while a character speaks; follow the volume setting
speech.subscribe(() => {
  const now = Boolean(speech.get().who);
  if (now !== ducked) {
    ducked = now;
    applyVolume();
  }
});
useDesk.subscribe((s, p) => {
  if (s.music?.volume !== p.music?.volume || s.music?.duck !== p.music?.duck) applyVolume();
});

// ---------- library ----------

export async function loadLibrary() {
  const r = await fetch("/api/music/library");
  const j = (await r.json()) as { tracks: Track[]; own: string; folders?: string[] };
  useMusic.setState({ tracks: j.tracks.sort(byAlbum), own: j.own, folders: j.folders ?? [], loaded: true });
  restorePlace();
}

/** Read the music folders again. The folders are the server's own list (the same on every device): pass `folders`
 *  only to change that list (adding or removing one). Sending a device's own idea of them once wiped the library
 *  down to the one song just made, on a device that had never had the folders added. */
export async function scan(folders?: string[]) {
  useMusic.setState({ scanning: "Reading your music…" });
  try {
    const r = await fetch("/api/music/scan", { method: "POST", body: JSON.stringify(folders ? { folders } : {}) });
    const j = (await r.json()) as { tracks: number; read: number; failed: number; walked?: number; unreadable?: string[] };
    await loadLibrary();
    return j;
  } finally {
    useMusic.setState({ scanning: "" });
  }
}

export async function addFiles(files: File[]) {
  for (const [i, f] of files.entries()) {
    useMusic.setState({ scanning: `Adding ${i + 1} of ${files.length}: ${f.name}` });
    const r = await fetch("/api/music/upload", { method: "POST", headers: { "x-filename": encodeURIComponent(f.name) }, body: f });
    if (!r.ok) desk().say(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `Couldn't add ${f.name}.`);
  }
  return scan();
}

function byAlbum(a: Track, b: Track) {
  return (a.artist || "~").localeCompare(b.artist || "~") || (a.album || "~").localeCompare(b.album || "~") || albumHome(a).localeCompare(albumHome(b)) || a.track - b.track || a.title.localeCompare(b.title);
}

export function searchLibrary(q: string, limit = 200): Track[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return mu().tracks.slice(0, limit);
  return mu()
    .tracks.filter((t) => {
      const hay = `${t.title} ${t.artist} ${t.album} ${t.genre} ${t.year || ""}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    })
    .slice(0, limit);
}

// ---------- radio ----------

/** Stations from radio-browser.info (a free, open directory), through the chosen connection method. */
export async function findStations(q: string, by: "name" | "tag" | "country" = "name"): Promise<Station[]> {
  if (!allowed(desk().privacy, "web")) throw new Error(blockedBecause(desk().privacy, "web"));
  const params = new URLSearchParams({ [by]: q, limit: "40", hidebroken: "true", order: "clickcount", reverse: "true" });
  const r = await directory(`/json/stations/search?${params}`, 30);
  const rows = (await r.json()) as { name: string; url_resolved?: string; url: string; favicon?: string; tags?: string; country?: string; codec?: string; bitrate?: number; homepage?: string }[];
  return rows.map((x) => ({ name: x.name.trim(), url: x.url_resolved || x.url, favicon: x.favicon || undefined, tags: x.tags, country: x.country, codec: x.codec, bitrate: x.bitrate, homepage: x.homepage }));
}

export function saveStation(st: Station) {
  if (prefs().stations.some((x) => x.url === st.url)) return;
  setPrefs({ stations: [...prefs().stations, st] });
}
export function forgetStation(url: string) {
  setPrefs({ stations: prefs().stations.filter((x) => x.url !== url) });
}

// ---------- playing ----------

export const current = (): Item | undefined => mu().queue[mu().index];
const srcOf = (it: Item) => (it.kind === "track" ? (it.src ?? `/api/music/file?id=${it.id}`) : `/api/music/radio?url=${encodeURIComponent(it.url)}`);
export const coverOf = (it?: Item) => (!it ? "" : it.kind === "track" ? (it.cover && !it.src ? `/api/music/cover?id=${it.id}` : "") : it.favicon ?? "");
export const label = (it?: Item) => (!it ? "" : it.kind === "track" ? `${it.title}${it.artist ? ` · ${it.artist}` : ""}` : it.name);

const listeners = new Set<(it: Item) => void>();
/** Something to do whenever a new song or station starts (the characters' comments). */
export function onStart(fn: (it: Item) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function start(i: number, at = 0) {
  const it = mu().queue[i];
  if (!it) return;
  if (it.kind === "radio" && !allowed(desk().privacy, "web")) {
    useMusic.setState({ error: blockedBecause(desk().privacy, "web") });
    return;
  }
  chain();
  await ctx?.resume();
  dropSpare();
  const a = element();
  useMusic.setState({ index: i, position: 0, duration: it.kind === "track" ? it.duration : 0, error: "" });
  a.src = srcOf(it);
  // carrying on after a reload: the same second of the same song
  if (at > 0 && it.kind === "track") a.addEventListener("loadedmetadata", () => (a.currentTime = Math.min(at, Math.max(0, a.duration - 1))), { once: true });
  applyVolume();
  try {
    await a.play();
  } catch {
    /* the error event explains */
  }
  mediaSession(it);
  for (const fn of listeners) fn(it);
}

/** Play these (a list, an album, a station), starting at `at`. `inOrder` keeps the order given even when shuffle is on. */
export function playList(items: Item[], at = 0, inOrder = false) {
  let list = items;
  let first = at;
  if (prefs().shuffle && !inOrder && items.length > 1) {
    const pick = items[at];
    list = [pick, ...items.filter((_, i) => i !== at).sort(() => Math.random() - 0.5)];
    first = 0;
  }
  useMusic.setState({ queue: list });
  void start(first);
}

/** A copy in random order. */
export function shuffled<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** An artist's songs album by album (oldest first), each album in track order. */
export function albumOrder(ts: Track[]): Track[] {
  return [...ts].sort((a, b) => (a.year || 9999) - (b.year || 9999) || (a.album || "~").localeCompare(b.album || "~") || albumHome(a).localeCompare(albumHome(b)) || a.track - b.track || a.title.localeCompare(b.title));
}

/** Play the song at this place in the queue (the queue view). */
export function playAt(i: number) {
  if (i >= 0 && i < mu().queue.length) void start(i);
}

/** Take a song out of the queue; the one playing keeps playing. */
export function removeAt(i: number) {
  const { queue, index } = mu();
  if (i < 0 || i >= queue.length || i === index) return;
  useMusic.setState({ queue: [...queue.slice(0, i), ...queue.slice(i + 1)], index: i < index ? index - 1 : index });
}

export function enqueue(items: Item[]) {
  queueAs(items, "last");
}

/** Put songs (or stations) in the queue: next, last, or after the album that's playing (lib/queueOps.ts). With
 *  nothing playing they go at the end and start. Says what it did. */
export function queueAs(items: Item[], where: QueueWhere): string {
  if (!items.length) return "Nothing to queue.";
  const { queue, index } = mu();
  const placed = placeInQueue(queue, index, items, where, (it) => runKey(it, "album"));
  useMusic.setState({ queue: placed.queue });
  if (index < 0) void start(placed.at);
  const n = `${items.length} ${items.length === 1 ? "song" : "songs"}`;
  return index < 0 ? `Playing ${n}.` : where === "next" ? `${n} up next.` : where === "last" ? `${n} at the end of the queue.` : `${n} after this album.`;
}

/** Play these now without losing the queue: they go in right after what's playing and start, and the rest of the
 *  queue carries on after them. With no queue they simply play. */
export function playNow(items: Item[]) {
  if (!items.length) return;
  const { queue, index } = mu();
  if (!queue.length || index < 0) return playList(items, 0, true);
  useMusic.setState({ queue: [...queue.slice(0, index + 1), ...items, ...queue.slice(index + 1)] });
  void start(index + 1);
}

/** The same by library id, for anything outside this page (a ferry window, a jetty, a tool): plain data, no songs
 *  passed around. Ids not in the library are skipped. */
export function queueIds(ids: string[], where: QueueWhere): string {
  const byId = new Map(mu().tracks.map((t) => [t.id, t]));
  const items = ids.flatMap((id) => (byId.has(id) ? [{ kind: "track", ...byId.get(id)! } as Item] : []));
  return queueAs(items, where);
}

export function toggle() {
  const a = element();
  if (mu().index < 0) {
    const all = mu().tracks.map((t) => ({ kind: "track", ...t }) as Item);
    if (all.length) playList(all, prefs().shuffle ? Math.floor(Math.random() * all.length) : 0);
    return;
  }
  // the queue came back after a reload, but nothing is loaded yet: start that song where it was
  if (!a.getAttribute("src")) return void start(mu().index, mu().position);
  chain();
  void ctx?.resume();
  if (a.paused) void a.play();
  else a.pause();
}

export function pause() {
  audio?.pause();
}

export async function next(auto = false) {
  const { queue, index } = mu();
  if (!queue.length) return;
  if (auto && prefs().repeat === "one") return start(index);
  if (index + 1 < queue.length) return start(index + 1);
  if (prefs().repeat === "all" || !auto) return start(0);
  useMusic.setState({ playing: false });
}

/** Skip the rest of this album, or everything by this artist that comes next, to the first song in the queue from
 *  another album (or artist). Playing by artist or album, or albums shuffled, keeps them together in the queue, so
 *  this skips the whole run. With repeat on it wraps round. Says what it did. */
export function skipBy(by: "album" | "artist"): string {
  const { queue, index } = mu();
  const cur = queue[index];
  if (!cur || cur.kind !== "track") {
    void next();
    return "Next.";
  }
  // songs with no album (or artist) count as their own
  const key = (it: Item) => runKey(it, by);
  const here = key(cur);
  const after = queue.slice(index + 1).findIndex((it) => key(it) !== here);
  if (after >= 0) {
    void start(index + 1 + after);
    return "";
  }
  if (prefs().repeat !== "off") {
    const from = queue.slice(0, index).findIndex((it) => key(it) !== here);
    if (from >= 0) {
      void start(from);
      return "";
    }
  }
  return by === "album" ? "That's the last album in the list." : "That's the last artist in the list.";
}

/** Back to the first song of the album (or artist) before this one in the queue. With repeat on it wraps round. */
export function backBy(by: "album" | "artist"): string {
  const { queue, index } = mu();
  const at = previousRun(queue, index, by, prefs().repeat !== "off");
  if (at >= 0) {
    void start(at);
    return "";
  }
  return by === "album" ? "That's the first album in the list." : "That's the first artist in the list.";
}

export function previous() {
  const a = element();
  if (a.currentTime > 4) {
    a.currentTime = 0;
    return;
  }
  const { queue, index } = mu();
  if (queue.length) void start((index - 1 + queue.length) % queue.length);
}

export function seek(seconds: number) {
  const a = element();
  if (Number.isFinite(a.duration)) a.currentTime = Math.max(0, Math.min(a.duration, seconds));
}

export function stop() {
  dropSpare();
  if (!audio) return;
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  useMusic.setState({ playing: false, index: -1, position: 0 });
}

/** The keyboard's media keys and the system's "now playing". */
function mediaSession(it: Item) {
  const ms = navigator.mediaSession;
  if (!ms) return;
  const art = coverOf(it);
  ms.metadata = new MediaMetadata({
    title: it.kind === "track" ? it.title : it.name,
    artist: it.kind === "track" ? it.artist : "Internet radio",
    album: it.kind === "track" ? it.album : it.country ?? "",
    artwork: art ? [{ src: art }] : [],
  });
  ms.setActionHandler("play", () => toggle());
  ms.setActionHandler("pause", () => pause());
  ms.setActionHandler("nexttrack", () => void next());
  ms.setActionHandler("previoustrack", () => previous());
}

// ---------- listening ----------

/**
 * A short listen: how loud, how bright, and a rough tempo, so a character can say something about the
 * sound itself. Takes about `seconds` while the music plays.
 */
export async function listen(seconds = 8): Promise<{ loudness: string; brightness: string; tempo: number } | null> {
  if (!analyser || !ctx || audio?.paused) return null;
  const a = analyser;
  const freq = new Uint8Array(a.frequencyBinCount);
  const wave = new Uint8Array(a.fftSize);
  const energies: number[] = [];
  let rmsSum = 0;
  let centroidSum = 0;
  let n = 0;
  const end = performance.now() + seconds * 1000;
  while (performance.now() < end) {
    a.getByteTimeDomainData(wave);
    a.getByteFrequencyData(freq);
    let s = 0;
    for (const v of wave) s += ((v - 128) / 128) ** 2;
    const rms = Math.sqrt(s / wave.length);
    let num = 0;
    let den = 0;
    freq.forEach((v, i) => ((num += v * i), (den += v)));
    rmsSum += rms;
    centroidSum += den ? num / den : 0;
    energies.push(rms);
    n++;
    await new Promise((r) => setTimeout(r, 20));
  }
  if (!n || rmsSum / n < 0.005) return null;
  // tempo: the most common gap between energy peaks (50 frames a second)
  const peaks: number[] = [];
  const mean = energies.reduce((x, y) => x + y, 0) / energies.length;
  for (let i = 1; i < energies.length - 1; i++) if (energies[i] > mean * 1.25 && energies[i] > energies[i - 1] && energies[i] >= energies[i + 1]) peaks.push(i);
  const gaps = peaks.slice(1).map((p, i) => p - peaks[i]).filter((g) => g >= 15 && g <= 75);
  const counts = new Map<number, number>();
  for (const g of gaps) counts.set(g, (counts.get(g) ?? 0) + 1);
  const best = [...counts.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
  const tempo = best ? Math.round((60 * 50) / best) : 0;
  const rms = rmsSum / n;
  const centroidHz = ((centroidSum / n) * (ctx.sampleRate / 2)) / freq.length;
  return {
    loudness: rms > 0.25 ? "loud and full" : rms > 0.12 ? "moderately loud" : "soft",
    brightness: centroidHz > 3000 ? "bright, lots of treble" : centroidHz > 1500 ? "balanced" : "dark and bass-heavy",
    tempo,
  };
}

export function nowPlayingText(): string {
  const it = current();
  if (!it) return "Nothing is playing.";
  const st = mu();
  const pos = `${Math.floor(st.position / 60)}:${String(Math.floor(st.position % 60)).padStart(2, "0")}`;
  if (it.kind === "radio") return `${st.playing ? "Playing" : "Paused"}: the radio station ${it.name}${it.country ? ` (${it.country})` : ""}${it.tags ? `, ${it.tags}` : ""}.`;
  return `${st.playing ? "Playing" : "Paused"}: "${it.title}"${it.artist ? ` by ${it.artist}` : ""}${it.album ? `, from ${it.album}` : ""}${it.year ? ` (${it.year})` : ""}${it.genre ? `, ${it.genre}` : ""}, at ${pos}${it.duration ? ` of ${Math.floor(it.duration / 60)}:${String(it.duration % 60).padStart(2, "0")}` : ""}.`;
}

// ---------- carrying on after a reload ----------
// The queue, which song and how far in, kept on this device (musicPlace.ts). It comes back paused: browsers don't
// let a page start sound by itself, so Play carries on from there.

const PLACE_KEY = "pdd-music-place";
// The queue is kept apart from the place in it: a shuffled library is thousands of songs, written only when the queue
// itself changes (and when the page is idle), while which song and how far in (a few bytes) is kept every few seconds.
const QUEUE_KEY = "pdd-music-queue";
let restored = false;

function restorePlace() {
  if (restored) return;
  restored = true;
  if (mu().queue.length) return;
  let saved: unknown = null;
  try {
    const place = JSON.parse(localStorage.getItem(PLACE_KEY) ?? "null") as { v?: number; i?: number; at?: number } | null;
    // older pages kept the queue in the place itself (v1); now it's beside it (v2)
    if (place?.v === 2) {
      const q = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "null") as { q?: unknown[] } | null;
      saved = q?.q ? { v: 1, q: q.q, i: place.i, at: place.at } : null;
    } else saved = place;
  } catch {
    return;
  }
  const back = unpack(saved, mu().tracks);
  if (!back) return;
  const it = back.queue[back.index];
  useMusic.setState({ queue: back.queue, index: back.index, position: back.position, duration: it?.kind === "track" ? it.duration : 0, playing: false });
  savedQueue = mu().queue; // as it was read back: nothing to write again
}

let lastSaved = 0;
let savedQueue: Item[] | null = null;
let queueTimer = 0;
const idle = (fn: () => void): number => {
  const w = window as unknown as { requestIdleCallback?: (f: () => void, o: { timeout: number }) => number };
  return w.requestIdleCallback ? w.requestIdleCallback(fn, { timeout: 3000 }) : window.setTimeout(fn, 300);
};

/** The queue itself, written when it has changed, when the page has a moment (or straight away when it's closing). */
function saveQueue(now = false) {
  const { queue } = mu();
  // on the way out, a queue whose copy has gone missing (cleared, or another tab's) is written again
  if (now && queue.length && queue === savedQueue && localStorage.getItem(QUEUE_KEY) === null) savedQueue = null;
  if (queue === savedQueue) return;
  const write = () => {
    queueTimer = 0;
    const q = mu().queue;
    if (q === savedQueue) return;
    try {
      if (!q.length) localStorage.removeItem(QUEUE_KEY);
      else localStorage.setItem(QUEUE_KEY, JSON.stringify({ v: 2, q: pack(q, 0, 0).q }));
      savedQueue = q;
    } catch {
      /* full or blocked: it just won't carry on */
    }
  };
  if (now) return write();
  if (!queueTimer) queueTimer = idle(write);
}

function savePlace(closing = false) {
  lastSaved = Date.now();
  try {
    // not over what was saved before it has been read back (a station tuned before the library is read is fine)
    if (!restored) {
      if (localStorage.getItem(PLACE_KEY)) return;
      restored = true;
    }
    const { queue, index, position } = mu();
    if (!queue.length) {
      localStorage.removeItem(PLACE_KEY);
      localStorage.removeItem(QUEUE_KEY);
      savedQueue = queue;
      return;
    }
    // a new queue is set a moment before its song is chosen: wait for that
    if (index < 0) return;
    localStorage.setItem(PLACE_KEY, JSON.stringify({ v: 2, i: index, at: Math.max(0, Math.floor(position)), n: queue.length }));
    saveQueue(closing);
  } catch {
    /* full or blocked: it just won't carry on */
  }
}

if (typeof window !== "undefined") {
  useMusic.subscribe((now, was) => {
    if (now.queue !== was.queue || now.index !== was.index) savePlace();
    else if (now.position !== was.position && Date.now() - lastSaved > 5000) savePlace();
  });
  addEventListener("pagehide", () => savePlace(true));
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && savePlace(true));
  // something to carry on with: read the library (that puts the queue back) without waiting for the Music window
  try {
    if (localStorage.getItem(PLACE_KEY)) setTimeout(() => void loadLibrary().catch(() => undefined), 1500);
  } catch {
    /* no storage */
  }
}
