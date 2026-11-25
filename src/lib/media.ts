// Making pictures and songs with engines you run (usually on another computer on your network, like a Mac with
// the models): ComfyUI, Automatic1111-style servers (Draw Things, Forge, SD.Next) and OpenAI-style image APIs for
// pictures; ACE-Step 1.5's API and YuE2 (through ComfyUI, with the official workflow) for songs. Requests go
// through the desktop's relay, so the other computer needs no browser settings. Results land in the vault
// (pictures) and the music library (songs).

import { desk } from "./store.ts";
import { outbound } from "./outbound.ts";
import { scopeOf } from "./model.ts";
import { allowed, blockedBecause, type Feature } from "./privacy.ts";
import { scan, type Item } from "./music.ts";
import { SONG_NOTES_DEFAULT, type ImageEngine, type MadeSong, type SongEngine } from "./mediaPrefs.ts";
import yue2Workflow from "./workflows/yue2-text2music.json";
import { engineLyrics, parseSong, styleWithArrangement } from "./songText.ts";

export type PictureAsk = { prompt: string; negative?: string; width: number; height: number; seed?: number; count?: number };
export type SongAsk = { title: string; style: string; lyrics: string; seconds: number; seed?: number; instrumental?: boolean };
export type Progress = (text: string) => void;

const trim = (u: string) => u.trim().replace(/\/+$/, "");
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((ok, no) => {
    const t = setTimeout(ok, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), no(new DOMException("Stopped", "AbortError"))), { once: true });
  });
const randomSeed = () => Math.floor(Math.random() * 2 ** 31);
/** A unique id (crypto.randomUUID only exists on https pages, and the desktop is often opened over http). */
export const uid = () => (typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

/** Whether the privacy settings let the desktop reach this engine, and why not if they don't. */
export function engineAllowed(url: string): string {
  if (desk().toddler) return "Picture and song makers are resting: toddler mode is on. The adult passcode turns it off.";
  const scope = scopeOf(url);
  if (scope === "device") return "";
  const f: Feature = scope === "network" ? "network-models" : "online-models";
  return allowed(desk().privacy, f) ? "" : blockedBecause(desk().privacy, f);
}

type Engine = { url: string; keyName?: string; via?: import("./outbound.ts").Via; name: string };
function headersFor(e: Engine, body: boolean): Record<string, string> {
  const key = e.keyName ? desk().env[e.keyName] ?? "" : "";
  const headers: Record<string, string> = { Accept: "*/*" };
  if (body) headers["Content-Type"] = "application/json";
  if (key) headers.Authorization = /^Bearer /i.test(key) ? key : `Bearer ${key}`;
  return headers;
}
function call(e: Engine, path: string, init: { method?: string; body?: unknown; timeout?: number; signal?: AbortSignal } = {}) {
  const why = engineAllowed(e.url);
  if (why) throw new Error(why);
  const headers = headersFor(e, init.body !== undefined);
  return outbound(`${trim(e.url)}${path}`, { method: init.method ?? (init.body !== undefined ? "POST" : "GET"), headers, body: init.body !== undefined ? JSON.stringify(init.body) : undefined, timeout: init.timeout ?? 120, signal: init.signal }, e.via ?? desk().net.via);
}
async function json<T>(e: Engine, path: string, init: Parameters<typeof call>[2] = {}): Promise<T> {
  const r = await call(e, path, init);
  const text = await r.text();
  if (!r.ok) throw new Error(`${e.name} answered ${r.status}: ${text.replace(/<[^>]+>/g, " ").trim().slice(0, 300) || r.statusText}`);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${e.name} didn't answer with JSON: ${text.slice(0, 200)}`);
  }
}
async function blob(e: Engine, path: string, signal?: AbortSignal): Promise<Blob> {
  const r = await call(e, path, { timeout: 300, signal });
  if (!r.ok) throw new Error(`${e.name} answered ${r.status} for the file.`);
  return r.blob();
}
const fromB64 = (b64: string, type = "image/png") => {
  const bin = atob(b64.replace(/^data:[^,]+,/, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return new Blob([out], { type });
};

// ---------- ComfyUI (pictures and YuE2) ----------

type ComfyFile = { filename: string; subfolder: string; type: string };
type Workflow = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

/** Queue a workflow and wait for its files (pictures or audio). */
async function runComfy(e: Engine, workflow: Workflow, want: "images" | "audio", progress: Progress, signal?: AbortSignal): Promise<Blob[]> {
  const client_id = uid();
  const q = await json<{ prompt_id?: string; error?: { message?: string }; node_errors?: Record<string, { errors?: { message: string; details?: string }[] }> }>(e, "/prompt", { body: { prompt: workflow, client_id }, signal });
  if (!q.prompt_id) {
    const nodeErr = Object.values(q.node_errors ?? {}).flatMap((n) => n.errors ?? []).map((x) => `${x.message}${x.details ? ` (${x.details})` : ""}`)[0];
    throw new Error(`ComfyUI didn't take the job: ${nodeErr || q.error?.message || "unknown reason"}`);
  }
  const started = Date.now();
  for (;;) {
    await sleep(2000, signal);
    const h = await json<Record<string, { status?: { status_str?: string; completed?: boolean; messages?: [string, { exception_message?: string }][] }; outputs?: Record<string, Record<string, ComfyFile[]>> }>>(e, `/history/${q.prompt_id}`, { signal });
    const run = h[q.prompt_id];
    if (run?.status?.status_str === "error") {
      const msg = run.status.messages?.find((m) => m[0] === "execution_error")?.[1]?.exception_message;
      throw new Error(`ComfyUI stopped with an error${msg ? `: ${msg.trim()}` : "."}`);
    }
    if (run?.outputs && (run.status?.completed || run.status?.status_str === "success")) {
      const files = Object.values(run.outputs).flatMap((o) => (o[want] ?? []).filter((f) => f.type === "output" || want === "images"));
      if (!files.length) throw new Error(`ComfyUI finished but gave back no ${want === "images" ? "pictures" : "audio"}.`);
      return Promise.all(files.map((f) => blob(e, `/view?${new URLSearchParams({ filename: f.filename, subfolder: f.subfolder, type: f.type })}`, signal)));
    }
    progress(`Working… ${Math.round((Date.now() - started) / 1000)} s`);
  }
}

/** A basic text-to-picture workflow for any Stable Diffusion-style checkpoint. */
function basicWorkflow(ckpt: string, a: PictureAsk, steps: number, seed: number): Workflow {
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: ckpt } },
    "2": { class_type: "CLIPTextEncode", inputs: { text: a.prompt, clip: ["1", 1] } },
    "3": { class_type: "CLIPTextEncode", inputs: { text: a.negative || "", clip: ["1", 1] } },
    "4": { class_type: "EmptyLatentImage", inputs: { width: a.width, height: a.height, batch_size: Math.max(1, Math.min(4, a.count ?? 1)) } },
    "5": { class_type: "KSampler", inputs: { seed, steps, cfg: 6, sampler_name: "euler", scheduler: "normal", denoise: 1, model: ["1", 0], positive: ["2", 0], negative: ["3", 0], latent_image: ["4", 0] } },
    "6": { class_type: "VAEDecode", inputs: { samples: ["5", 0], vae: ["1", 2] } },
    "7": { class_type: "SaveImage", inputs: { filename_prefix: "pandora", images: ["6", 0] } },
  };
}

/** Your own workflow, with the placeholders filled in (as JSON strings or numbers where they stand alone). */
function fillWorkflow(text: string, values: Record<string, string | number>): Workflow {
  const filled = text.replace(/"\{\{(\w+)\}\}"|\{\{(\w+)\}\}/g, (whole, quoted: string | undefined, bare: string | undefined) => {
    const k = (quoted || bare)!;
    if (!(k in values)) return whole;
    const v = values[k];
    if (quoted) return typeof v === "number" ? String(v) : JSON.stringify(v);
    return typeof v === "number" ? String(v) : JSON.stringify(v).slice(1, -1);
  });
  try {
    return JSON.parse(filled) as Workflow;
  } catch {
    throw new Error("The ComfyUI workflow isn't valid JSON. Export it with “Save (API Format)” / “Export (API)” in ComfyUI.");
  }
}

/** What a ComfyUI server has: its checkpoints, and whether the YuE2 nodes are there. */
export async function comfyInfo(e: Engine): Promise<{ checkpoints: string[]; yue2: boolean }> {
  const info = await json<Record<string, { input?: { required?: { ckpt_name?: [string[]] } } }>>(e, "/object_info/CheckpointLoaderSimple");
  const checkpoints = info.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] ?? [];
  let yue2 = false;
  try {
    const y = await json<Record<string, unknown>>(e, "/object_info/YuE2GenerateMusic");
    yue2 = Boolean(y.YuE2GenerateMusic);
  } catch {
    /* no YuE2 nodes */
  }
  return { checkpoints, yue2 };
}

/** The models an engine has, for choosing from a list (Scan in its settings): ComfyUI's checkpoints, an
 *  Automatic1111-style server's models, an OpenAI-style service's models, the music bridge's or mlx-serve's
 *  downloaded music models. Throws with the engine's own answer when it doesn't list them. */
export async function engineModels(e: ImageEngine | SongEngine): Promise<string[]> {
  if (e.kind === "comfyui" || e.kind === "yue2-comfyui") return (await comfyInfo(e)).checkpoints;
  if (e.kind === "a1111") return (await json<{ title?: string; model_name?: string }[]>(e, "/sdapi/v1/sd-models", { timeout: 30 })).map((m) => m.title || m.model_name || "").filter(Boolean);
  const ids = async (path: string) => ((await json<{ data?: { id: string }[] }>(e, path, { timeout: 30 })).data ?? []).map((m) => m.id).filter(Boolean);
  if (e.kind === "openai") {
    const all = await ids("/models");
    // the picture models first (gpt-image-1, dall-e…), then the rest
    return [...all.filter((m) => /image|dall-?e|flux|sd|diffusion/i.test(m)), ...all.filter((m) => !/image|dall-?e|flux|sd|diffusion/i.test(m))];
  }
  // music: the bridge and mlx-serve list models at /v1/models; ACE-Step builds that list theirs do so there too
  let all: string[] = [];
  let err: unknown = null;
  for (const path of ["/v1/models", "/models"]) {
    try {
      all = await ids(path);
      if (all.length) break;
    } catch (x) {
      err ??= x;
    }
  }
  if (!all.length && err) throw err;
  const music = all.filter((m) => /music|ace-?step|song|yue/i.test(m));
  return music.length ? music : all;
}

/** How much memory the machine running a music bridge has (it says so in /health), or undefined. */
export async function engineMemory(e: SongEngine): Promise<number | undefined> {
  if (e.kind !== "mlx-serve") return undefined;
  try {
    const h = await json<{ memory_gb?: number }>(e, "/health", { timeout: 15 });
    return typeof h.memory_gb === "number" ? h.memory_gb : undefined;
  } catch {
    return undefined;
  }
}

export type ModelDownload = { state: "none" | "working" | "done" | "error"; got?: number; total?: number; error?: string };

/** Have the music bridge download a model from Hugging Face now (so the first song with it doesn't wait). Older
 *  bridges can't: the answer says to update it. */
export async function downloadModel(e: SongEngine, model: string): Promise<ModelDownload> {
  const r = await call(e, "/v1/models/download", { body: { model }, timeout: 30 });
  if (r.status === 404) throw new Error(`${e.name} can't download models yet: update the Mac's engines (the one line under the engine's settings), or pick it anyway and it downloads with the first song.`);
  const j = (await r.json().catch(() => ({}))) as ModelDownload & { error?: string };
  if (!r.ok) throw new Error(j.error || `${e.name} answered ${r.status}.`);
  return j;
}

export async function downloadStatus(e: SongEngine, model: string): Promise<ModelDownload> {
  return json<ModelDownload>(e, `/v1/models/download?model=${encodeURIComponent(model)}`, { timeout: 20 });
}

// ---------- pictures ----------

export async function makePictures(e: ImageEngine, a: PictureAsk, progress: Progress, signal?: AbortSignal): Promise<Blob[]> {
  const seed = a.seed ?? randomSeed();
  const count = Math.max(1, Math.min(4, a.count ?? 1));
  progress("Asking…");
  if (e.kind === "openai") {
    const body = { model: e.model || "gpt-image-1", prompt: a.prompt, n: count, size: `${a.width}x${a.height}` };
    let r = await call(e, "/images/generations", { body: { ...body, response_format: "b64_json" }, timeout: 300, signal });
    // some services (gpt-image-1) refuse response_format; they answer with base64 anyway
    if (r.status === 400) r = await call(e, "/images/generations", { body, timeout: 300, signal });
    const text = await r.text();
    if (!r.ok) throw new Error(`${e.name} answered ${r.status}: ${text.slice(0, 300)}`);
    const j = JSON.parse(text) as { data?: { b64_json?: string; url?: string }[] };
    return Promise.all((j.data ?? []).map(async (d) => (d.b64_json ? fromB64(d.b64_json) : (await outbound(d.url!, {}, e.via ?? desk().net.via)).blob())));
  }
  if (e.kind === "a1111") {
    const j = await json<{ images?: string[] }>(e, "/sdapi/v1/txt2img", {
      body: { prompt: a.prompt, negative_prompt: a.negative || "", width: a.width, height: a.height, steps: e.steps || 20, seed, batch_size: count, n_iter: 1 },
      timeout: 600,
      signal,
    });
    if (!j.images?.length) throw new Error(`${e.name} gave back no pictures.`);
    return j.images.map((b) => fromB64(b));
  }
  // ComfyUI
  let wf: Workflow;
  if (e.workflow?.trim()) wf = fillWorkflow(e.workflow, { prompt: a.prompt, negative: a.negative || "", seed, width: a.width, height: a.height, steps: e.steps || 20, count });
  else {
    let ckpt = e.model || "";
    if (!ckpt) {
      const { checkpoints } = await comfyInfo(e);
      // the first picture checkpoint (a ComfyUI that also makes songs has YuE2 / ACE-Step ones too)
      ckpt = checkpoints.find((c) => !/yue|ace.?step|audio|music|song/i.test(c)) ?? "";
      if (!ckpt) throw new Error("This ComfyUI has no checkpoints in models/checkpoints. Add one, or give it your own workflow.");
    }
    wf = basicWorkflow(ckpt, a, e.steps || 20, seed);
  }
  return runComfy(e, wf, "images", progress, signal);
}

export type EditAsk = { prompt: string; image: Blob; width: number; height: number; transparent?: boolean };
/** An OpenAI-style image size near the asked shape (the sizes gpt-image-1 takes). */
const editSize = (w: number, h: number) => (w > h * 1.15 ? "1536x1024" : h > w * 1.15 ? "1024x1536" : "1024x1024");
const toB64 = async (b: Blob) => {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

/**
 * Change a picture with the desktop's picture engine (a game's "draw on my cat"): OpenAI-style engines edit it
 * (/images/edits, keeping a transparent background when asked), Automatic1111 / Draw Things repaint it (img2img).
 * ComfyUI has no editing workflow here, so it makes a new picture from the words, and `note` says so.
 */
export async function editPicture(e: ImageEngine, a: EditAsk, progress: Progress, signal?: AbortSignal): Promise<{ picture: Blob; note?: string }> {
  progress("Asking…");
  if (e.kind === "openai") {
    const why = engineAllowed(e.url);
    if (why) throw new Error(why);
    const fd = new FormData();
    fd.append("model", e.model || "gpt-image-1");
    fd.append("prompt", a.prompt);
    fd.append("image", a.image, "image.png");
    fd.append("size", editSize(a.width, a.height));
    fd.append("n", "1");
    if (a.transparent) fd.append("background", "transparent");
    // the form, packed by the browser (with its boundary), sent as bytes: the desktop relay carries bytes, not forms
    const packed = new Response(fd);
    const body = new Uint8Array(await packed.arrayBuffer());
    const key = e.keyName ? desk().env[e.keyName] ?? "" : "";
    const headers: Record<string, string> = { Accept: "*/*", "Content-Type": packed.headers.get("content-type") || "multipart/form-data" };
    if (key) headers.Authorization = /^Bearer /i.test(key) ? key : `Bearer ${key}`;
    const r = await outbound(`${trim(e.url)}/images/edits`, { method: "POST", headers, body, timeout: 300, signal }, e.via ?? desk().net.via);
    const text = await r.text();
    if (!r.ok) throw new Error(`${e.name} answered ${r.status}: ${text.slice(0, 300)}`);
    const d = (JSON.parse(text) as { data?: { b64_json?: string; url?: string }[] }).data?.[0];
    if (!d) throw new Error(`${e.name} gave back no picture.`);
    return { picture: d.b64_json ? fromB64(d.b64_json) : await (await outbound(d.url!, {}, e.via ?? desk().net.via)).blob() };
  }
  if (e.kind === "a1111") {
    const j = await json<{ images?: string[] }>(e, "/sdapi/v1/img2img", {
      body: { init_images: [await toB64(a.image)], prompt: a.prompt, denoising_strength: 0.55, width: a.width, height: a.height, steps: e.steps || 20, seed: randomSeed() },
      timeout: 600,
      signal,
    });
    if (!j.images?.length) throw new Error(`${e.name} gave back no picture.`);
    return { picture: fromB64(j.images[0]), note: a.transparent ? "This engine repaints the whole picture, so the background isn't kept transparent." : undefined };
  }
  const [picture] = await makePictures(e, { prompt: a.prompt, width: a.width, height: a.height, count: 1 }, progress, signal);
  return { picture, note: "ComfyUI made a new picture from the words (it has no editing workflow here), so it won't be the same cat." };
}

/** Save pictures into the vault's folder for made pictures; returns their vault paths. */
export async function savePictures(pics: Blob[], prompt: string): Promise<string[]> {
  const folder = desk().media.pictureFolder.replace(/^\/+|\/+$/g, "") || "pictures/made";
  const slug = prompt.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").slice(0, 6).join(" ") || "picture";
  const d = new Date();
  const two = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}.${two(d.getMinutes())}`;
  const out: string[] = [];
  for (const [i, b] of pics.entries()) {
    const ext = /jpeg/.test(b.type) ? "jpg" : /webp/.test(b.type) ? "webp" : "png";
    const p = `${folder}/${stamp} ${slug}${pics.length > 1 ? ` ${i + 1}` : ""}.${ext}`;
    const r = await fetch(`/api/vault/file?path=${encodeURIComponent(p)}`, { method: "PUT", body: b });
    if (!r.ok) throw new Error(`Couldn't save ${p}.`);
    out.push(p);
  }
  return out;
}

// ---------- songs ----------

/** A made song's audio, and the seed it was made with; or, when the desktop's server fetched it straight into the
 *  music library, the file's name there instead of the audio. */
export type MadeAudio = { audio?: Blob; ext: string; seed: number; file?: string; onEngine?: string };

/** A made song's audio (for callers that didn't ask for it to go into the library). */
export function audioOf(m: MadeAudio): Blob {
  if (!m.audio) throw new Error("The engine gave back no song.");
  return m.audio;
}

/** The style with the production notes added (Music → Make a song → production notes), unless they're off or in it. */
export function withNotes(style: string): string {
  const m = desk().media;
  if (m.songNotesOn === false) return style;
  const notes = (m.songNotes ?? "").trim() || SONG_NOTES_DEFAULT;
  if (style.toLowerCase().includes(notes.toLowerCase())) return style;
  return style.trim() ? `${style.trim().replace(/[,.\s]+$/, "")}, ${notes}` : notes;
}

const mb = (n: number) => `${(n / 1048576).toFixed(n < 10 * 1048576 ? 1 : 0)} MB`;
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, "0")}`;

// how long an engine takes per second of song, from its earlier songs (kept on this device), for an estimate
const PACE_KEY = "pdd-song-pace";
function paceOf(e: Engine): number {
  try {
    return Number((JSON.parse(localStorage.getItem(PACE_KEY) || "{}") as Record<string, number>)[trim(e.url)]) || 0;
  } catch {
    return 0;
  }
}
function learnPace(e: Engine, workSeconds: number, songSeconds: number) {
  if (workSeconds < 5 || songSeconds < 10) return;
  try {
    const all = JSON.parse(localStorage.getItem(PACE_KEY) || "{}") as Record<string, number>;
    const was = Number(all[trim(e.url)]) || 0;
    const now = workSeconds / songSeconds;
    all[trim(e.url)] = was ? was * 0.5 + now * 0.5 : now;
    localStorage.setItem(PACE_KEY, JSON.stringify(all));
  } catch {
    /* no estimate next time */
  }
}
/** "Making it… 2:10 of about 5:30", from what the engine says (its own progress line) or its earlier songs. */
function makingText(e: Engine, elapsed: number, songSeconds: number, said = "", percent: number | null = null): string {
  const own = said ? ` · ${said}` : "";
  if (percent != null && percent > 0) return `Making it… ${clock(elapsed)} · ${percent}%${own}`;
  const about = paceOf(e) * songSeconds;
  if (about > 30)
    return elapsed < about ? `Making it… ${clock(elapsed)} of about ${clock(about)} (going by its earlier songs)${own}` : `Making it… ${clock(elapsed)} (longer than its earlier songs)${own}`;
  return `Making it… ${clock(elapsed)}${own}`;
}

type FetchStatus = { state?: string; got?: number; total?: number; waited?: number; bytesPerSecond?: number; name?: string; error?: string };

/** Have the desktop's own server fetch a song from the engine straight into the music library (server/songFetch.mjs):
 *  one hop, whichever device this page is on. With `making`, the request is the one that makes the song (mlx-serve
 *  answers it with the song), so the server holds that wait too. Answers the file's name in the library. */
async function intoLibrary(e: Engine, path: string, init: { body?: unknown; title: string; making?: number }, progress: Progress, signal?: AbortSignal, onStart?: (id: string) => void): Promise<string> {
  const why = engineAllowed(e.url);
  if (why) throw new Error(why);
  const hasBody = init.body !== undefined;
  const r = await fetch("/api/music/fetch-song", {
    method: "POST",
    body: JSON.stringify({ url: `${trim(e.url)}${path}`, method: hasBody ? "POST" : "GET", headers: headersFor(e, hasBody), body: hasBody ? JSON.stringify(init.body) : undefined, title: init.title, timeout: 3600 }),
    signal,
  });
  const j = (await r.json().catch(() => ({}))) as { id?: string; error?: string };
  if (!r.ok || !j.id) throw new Error(j.error || `The desktop's server answered ${r.status}.`);
  onStart?.(j.id);
  return followFetch(e, j.id, init.making ?? 0, progress, signal);
}

/** Follow a fetch the server is doing (also after a reload, from its id). */
async function followFetch(e: Engine, id: string, making: number, progress: Progress, signal?: AbortSignal): Promise<string> {
  signal?.addEventListener("abort", () => void fetch(`/api/music/fetch-song/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {}), { once: true });
  for (;;) {
    await sleep(1000, signal);
    let s: FetchStatus;
    try {
      const r = await fetch(`/api/music/fetch-song/${encodeURIComponent(id)}`, { signal });
      s = (await r.json()) as FetchStatus;
      if (r.status === 404) throw new Error(`${s.error || "The desktop's server no longer has this fetch."} If ${e.name} kept the song, it's under "Songs kept on the engine".`);
    } catch (err) {
      if (signal?.aborted || /no longer has/.test(String(err))) throw err;
      progress("Waiting for the desktop's server to answer…");
      continue;
    }
    if (s.state === "error") throw new Error(s.error || `${e.name} couldn't send the song.`);
    if (s.state === "done") {
      if (making) learnPace(e, s.waited ?? 0, making);
      return s.name || "";
    }
    if (s.state === "waiting") progress(making ? makingText(e, s.waited ?? 0, making) : "Asking the engine for the song…");
    else {
      const rate = s.bytesPerSecond ?? 0;
      progress(`Fetching the song… ${mb(s.got ?? 0)}${s.total ? ` of ${mb(s.total)}` : ""}${rate ? ` · ${rate >= 1048576 ? `${(rate / 1048576).toFixed(1)} MB` : `${Math.round(rate / 1024)} KB`}/s` : ""}`);
    }
  }
}

/**
 * Make one song; returns the audio. When the engine works in jobs (ACE-Step, and the MLX Audio bridge), `onJob`
 * hears the job's reference as soon as there is one, so the wait can be picked up again after the page reloads
 * (resumeSong).
 */
export async function makeSong(e: SongEngine, a: SongAsk, progress: Progress, signal?: AbortSignal, onJob?: (ref: string, seed: number) => void, toLibrary = false): Promise<MadeAudio> {
  const seed = a.seed ?? randomSeed();
  // what's in square brackets besides a section's name ("[Verse 1 - soft piano]") would be sung word for word:
  // the tags go plain, and those directions join the style as its arrangement (lib/songText.ts)
  const sent = a.instrumental || !a.lyrics.trim() ? { lyrics: "[Instrumental]", notes: [] } : engineLyrics(a.lyrics);
  const lyrics = sent.lyrics;
  const seconds = Math.max(10, Math.min(600, Math.round(a.seconds)));
  const style = styleWithArrangement(withNotes(a.style), sent.notes);
  if (e.kind === "mlx-serve") {
    const body = { ...(e.model ? { model: e.model } : {}), prompt: style, lyrics, duration_seconds: seconds, seed, ...(a.title ? { title: a.title } : {}) };
    if (await bridgeJobs(e)) {
      // the MLX Audio bridge: a job, so a long song survives a reload or a dropped connection
      progress("Queued…");
      const j = await json<{ id?: string }>(e, "/v1/audio/music-generations", { body: { ...body, async: true }, signal });
      if (!j.id) throw new Error(`${e.name} didn't give a job id.`);
      onJob?.(`bridge:${j.id}`, seed);
      return { ...(await waitBridge(e, j.id, progress, signal, toLibrary ? { title: a.title, seconds } : undefined)), seed };
    }
    if (toLibrary) {
      // mlx-serve answers the making request with the song: the desktop's server holds that wait and writes the
      // song straight into the library, so a reload or a closed page doesn't lose it
      progress("Making it…");
      const file = await intoLibrary(e, "/v1/audio/music-generations", { body, title: a.title || "Untitled", making: seconds }, progress, signal, (id) => onJob?.(`server:${id}:${seconds}`, seed));
      return { file, ext: file.split(".").pop() || "wav", seed };
    }
    // mlx-serve (MLX Core on a Mac): one request, the song comes back as a WAV when it's done
    progress("Making it… (the engine answers when the song is done)");
    const started = Date.now();
    const tick = setInterval(() => progress(`Making it… ${Math.round((Date.now() - started) / 1000)} s`), 1000);
    try {
      const r = await call(e, "/v1/audio/music-generations", { body, timeout: 3600, signal });
      const type = r.headers.get("content-type") || "";
      if (!r.ok) throw new Error(`${e.name} answered ${r.status}: ${(await r.text()).slice(0, 300)}`);
      if (/json/i.test(type)) {
        // in case a build answers OpenAI-style with base64 or a link instead of the file itself
        const j = (await r.json()) as { data?: { b64_json?: string; url?: string }[]; audio?: string };
        const d = j.data?.[0];
        if (d?.b64_json || j.audio) return { audio: fromB64(d?.b64_json || j.audio!, "audio/wav"), ext: "wav", seed };
        if (d?.url) return { audio: await (await outbound(d.url, {}, e.via ?? desk().net.via)).blob(), ext: "wav", seed };
        throw new Error(`${e.name} answered without a song.`);
      }
      const audio = await r.blob();
      const ext = /mpeg|mp3/i.test(type) ? "mp3" : /flac/i.test(type) ? "flac" : "wav";
      return { audio, ext, seed };
    } finally {
      clearInterval(tick);
    }
  }
  if (e.kind === "acestep") {
    progress("Queued…");
    const made = await json<{ data?: { task_id?: string } }>(e, "/release_task", {
      body: { prompt: style, lyrics, audio_duration: seconds, batch_size: 1, audio_format: "mp3", seed, use_random_seed: false, ...(e.model ? { model: e.model } : {}) },
      signal,
    });
    const id = made.data?.task_id;
    if (!id) throw new Error("ACE-Step didn't give a task id.");
    onJob?.(`ace:${id}`, seed);
    return { ...(await waitAce(e, id, progress, signal, toLibrary ? { title: a.title, seconds } : undefined)), seed };
  }
  // YuE2 through ComfyUI: the official text-to-music workflow with the song's words, style, length and seed
  const wf = structuredClone(yue2Workflow) as Workflow;
  wf["33:36"].inputs.value = style;
  wf["33:37"].inputs.value = lyrics;
  wf["33:34"].inputs.seed = seed;
  wf["33:25"].inputs.max_duration = seconds;
  wf["10"].inputs.filename_prefix = "audio/pandora";
  const [audio] = await runComfy(e, wf, "audio", progress, signal);
  return { audio, ext: "flac", seed };
}

/** Pick up the wait for a song an engine is still making (after the page reloaded). */
export async function resumeSong(e: SongEngine, ref: string, seed: number, progress: Progress, signal?: AbortSignal, ask?: { title: string; seconds: number }): Promise<MadeAudio> {
  const [kind, id] = [ref.slice(0, ref.indexOf(":")), ref.slice(ref.indexOf(":") + 1)];
  if (kind === "bridge") return { ...(await waitBridge(e, id, progress, signal, ask)), seed };
  if (kind === "ace") return { ...(await waitAce(e, id, progress, signal, ask)), seed };
  if (kind === "server") {
    // the desktop's server is holding the engine's answer (server:<fetch id>:<song seconds>)
    const [fid, secs] = id.split(":");
    const file = await followFetch(e, fid, Number(secs) || 0, progress, signal);
    return { file, ext: file.split(".").pop() || "wav", seed };
  }
  throw new Error("That song's engine can't be picked up again.");
}

// whether an mlx-serve engine is the MLX Audio bridge with jobs (asked once per address)
const jobsAt = new Map<string, Promise<boolean>>();
function bridgeJobs(e: SongEngine): Promise<boolean> {
  const key = trim(e.url);
  if (!jobsAt.has(key))
    jobsAt.set(
      key,
      json<{ features?: string[] }>(e, "/health", { timeout: 15 }).then(
        (h) => Array.isArray(h.features) && h.features.includes("jobs"),
        () => false,
      ),
    );
  return jobsAt.get(key)!;
}

/** The song once the engine has it: into the library by the desktop's server when `lib` is given (falling back to
 *  this page if the server can't reach the engine), otherwise its audio here. */
async function finished(e: SongEngine, path: string, ext: string, progress: Progress, signal: AbortSignal | undefined, lib?: { title: string }): Promise<{ audio?: Blob; file?: string; ext: string }> {
  if (lib) {
    try {
      const file = await intoLibrary(e, path, { title: lib.title || "Untitled" }, progress, signal);
      return { file, ext: file.split(".").pop() || ext };
    } catch (err) {
      if (signal?.aborted) throw err;
      progress(`The desktop's server couldn't fetch it (${err instanceof Error ? err.message : err}); fetching it here…`);
    }
  }
  progress("Fetching the song…");
  return { audio: await blob(e, path, signal), ext };
}

async function waitBridge(e: SongEngine, id: string, progress: Progress, signal?: AbortSignal, lib?: { title: string; seconds: number }): Promise<{ audio?: Blob; file?: string; ext: string; onEngine?: string }> {
  for (;;) {
    await sleep(3000, signal);
    let s: { state?: string; elapsed?: number; error?: string; said?: string; percent?: number | null; kept?: string | null };
    try {
      s = await json(e, `/v1/jobs/${encodeURIComponent(id)}`, { timeout: 30, signal });
    } catch (err) {
      if (signal?.aborted) throw err;
      if (/answered 404/.test(String(err))) throw new Error(`${e.name} no longer has this job (it may have restarted). If it finished, it's in the songs the engine kept.`);
      progress("Waiting for the engine to answer…");
      continue; // the Mac asleep, or the network gone for a moment: keep waiting
    }
    if (s.state === "error") throw new Error(`${e.name} couldn't make the song: ${s.error ?? "unknown reason"}`);
    if (s.state === "done") {
      if (lib) learnPace(e, s.elapsed ?? 0, lib.seconds);
      // left on the engine (Make a song → where finished songs live): it plays from there, nothing is copied
      if (lib && s.kept && desk().media.songsStay === "engine") return { onEngine: s.kept, ext: "wav" };
      return finished(e, `/v1/jobs/${encodeURIComponent(id)}/audio`, "wav", progress, signal, lib);
    }
    // the engine's own words for where it is (the newest bridge passes on the model's progress line)
    progress(s.state === "queued" ? "Waiting its turn…" : makingText(e, s.elapsed ?? 0, lib?.seconds ?? 0, (s.said ?? "").slice(0, 120), s.percent ?? null));
  }
}

async function waitAce(e: SongEngine, id: string, progress: Progress, signal?: AbortSignal, lib?: { title: string; seconds: number }): Promise<{ audio?: Blob; file?: string; ext: string }> {
  const started = Date.now();
  for (;;) {
    await sleep(2500, signal);
    const q = await json<{ data?: { task_id: string; status: number; result?: string }[] }>(e, "/query_result", { body: { task_id_list: [id] }, signal });
    const t = q.data?.find((x) => x.task_id === id);
    if (t?.status === 2) throw new Error("ACE-Step couldn't make the song.");
    if (t?.status === 1) {
      let files: { file?: string }[] = [];
      try {
        files = JSON.parse(t.result || "[]") as { file?: string }[];
      } catch {
        /* below */
      }
      const file = files.find((f) => f.file)?.file;
      if (!file) throw new Error("ACE-Step finished without a file.");
      if (lib) learnPace(e, (Date.now() - started) / 1000, lib.seconds);
      return finished(e, file.startsWith("/") ? file : `/${file}`, "mp3", progress, signal, lib);
    }
    progress(makingText(e, (Date.now() - started) / 1000, lib?.seconds ?? 0));
  }
}

/** Songs the MLX Audio bridge kept (every song it made), newest first. */
/** A verdict on a song: good or bad, and why (by a person or a character). */
export type SongEval = { verdict: "good" | "bad" | ""; why: string; by?: string; at?: number };
export type KeptSong = { name: string; size: number; made: number; about: string; eval?: SongEval | null };

export async function keptSongs(e: SongEngine): Promise<KeptSong[]> {
  const j = await json<{ data?: KeptSong[] }>(e, "/v1/songs", { timeout: 30 });
  return j.data ?? [];
}

/** What a kept song's notes say (the bridge writes Title, Style, Length asked, Seed, then the words). */
function aboutOf(name: string, about: string) {
  const line = (k: string) => new RegExp(`^${k}: (.*)$`, "m").exec(about)?.[1]?.trim() ?? "";
  const lyrics = about.split(/\n\n/).slice(1).join("\n\n").trim();
  return {
    title: line("Title") || name.replace(/^\d{4}-\d\d-\d\d \d\d\.\d\d\.\d\d /, ""),
    style: line("Style"),
    lyrics: lyrics === "[instrumental]" ? "" : lyrics,
    seconds: Number(line("Length asked").replace(/\D/g, "")) || 0,
    instrumental: lyrics === "[instrumental]",
    seed: Number(line("Seed")) || 0,
  };
}

/** Bring a song the bridge kept into the music library (and the list of made songs). The desktop's server fetches
 *  it straight from the engine, so `progress` hears MB so far and the speed. */
export async function fetchKept(e: SongEngine, name: string, about: string, progress: Progress = () => {}, signal?: AbortSignal): Promise<MadeSong> {
  const a = aboutOf(name, about);
  const got = await finished(e, `/v1/songs/${encodeURIComponent(name)}.wav`, "wav", progress, signal, { title: a.title });
  return keepSong(a, { ...got, seed: a.seed }, e);
}

/** A song on the engine as something the music player can play, straight from there (nothing copied): the
 *  desktop's server streams it, seeking included (server/engineStream.mjs). */
export async function engineSongItem(e: SongEngine, name: string, about = ""): Promise<Item> {
  const why = engineAllowed(e.url);
  if (why) throw new Error(why);
  const r = await fetch("/api/music/engine-link", { method: "POST", body: JSON.stringify({ url: `${trim(e.url)}/v1/songs/${encodeURIComponent(name)}.wav`, headers: headersFor(e, false) }) });
  const j = (await r.json().catch(() => ({}))) as { id?: string; error?: string };
  if (!r.ok || !j.id) throw new Error(j.error || `The desktop's server answered ${r.status}.`);
  const a = aboutOf(name, about);
  return { kind: "track", id: `engine:${e.id}:${name}`, title: a.title, artist: e.name, album: "Songs on the engine", year: 0, track: 0, genre: "", duration: 0, cover: false, bitrate: 0, size: 0, folder: "", src: `/api/music/engine-song/${j.id}` };
}

/** Delete a song from the engine (its audio, words and verdict). It can't be undone there. */
export async function deleteKept(e: SongEngine, name: string): Promise<void> {
  await json(e, `/v1/songs/${encodeURIComponent(name)}`, { method: "DELETE", timeout: 30 });
}

export type SoundCheck = { seconds: number; peak_dbfs: number; loudness_dbfs: number; clipped_percent: number; dynamics_db: number; silent_end_seconds: number; cut_off: boolean; notes: string[]; error?: string };

/** What the engine can measure about a kept song: clipping, loudness, dynamics, and whether it was cut off. */
export async function checkKept(e: SongEngine, name: string): Promise<SoundCheck> {
  return json<SoundCheck>(e, `/v1/songs/${encodeURIComponent(name)}/check`, { timeout: 120 });
}

/** Give a kept song a verdict. It's kept beside the song on the engine, and in SEASIDE (the newest 40), where the
 *  song writer reads them to learn what's liked and what isn't. */
export async function evalKept(e: SongEngine, name: string, about: string, ev: SongEval): Promise<SongEval> {
  const saved = await json<SongEval>(e, `/v1/songs/${encodeURIComponent(name)}/eval`, { body: ev, timeout: 30 });
  const a = aboutOf(name, about);
  const m = desk().media;
  const rest = (m.evals ?? []).filter((x) => x.song !== name);
  desk().set({ media: { ...m, evals: ev.verdict ? [{ song: name, title: a.title, style: a.style, verdict: ev.verdict, why: ev.why, by: ev.by, at: Date.now() }, ...rest].slice(0, 40) : rest } });
  return saved;
}

/** Put a made song into the music library and the list of made songs. */
export async function keepSong(a: SongAsk, made: MadeAudio, engine: SongEngine): Promise<MadeSong> {
  const name = `${(a.title || "Untitled").replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 80) || "Untitled"}.${made.ext}`;
  if (made.onEngine) {
    // left on the engine: listed here, played from there
    const song: MadeSong = { id: uid(), title: a.title || "Untitled", style: a.style, lyrics: a.instrumental ? "" : a.lyrics, seconds: a.seconds, seed: made.seed, engine: engine.name, file: "", onEngine: { engineId: engine.id, name: made.onEngine }, at: Date.now() };
    const m = desk().media;
    desk().set({ media: { ...m, made: [song, ...m.made].slice(0, 500) } });
    return song;
  }
  let j: { name?: string; error?: string } = { name: made.file };
  if (!made.file) {
    // (the desktop's server didn't fetch it into the library itself: this page sends it there)
    if (!made.audio) throw new Error("The engine gave back no song.");
    const r = await fetch("/api/music/upload", { method: "POST", headers: { "x-filename": encodeURIComponent(name) }, body: made.audio });
    j = (await r.json().catch(() => ({}))) as { name?: string; error?: string };
    if (!r.ok) throw new Error(j.error || "Couldn't add the song to the music library.");
  }
  await scan();
  const song: MadeSong = { id: uid(), title: a.title || "Untitled", style: a.style, lyrics: a.instrumental ? "" : a.lyrics, seconds: a.seconds, seed: made.seed, engine: engine.name, file: j.name || name, at: Date.now() };
  const m = desk().media;
  desk().set({ media: { ...m, made: [song, ...m.made].slice(0, 500) } });
  return song;
}

// ---------- words for songs, written by a character ----------

/** A character writes a title, a style and lyrics from a description (Suno's "simple" mode). */
/** What the household thought of recent songs (their verdicts, with why), so the next one learns from them. */
function verdictsNote(): string {
  const v = (desk().media.evals ?? []).filter((x) => x.why.trim()).slice(0, 8);
  if (!v.length) return "";
  return `\n\nHow recent songs went (learn from these; don't copy them):\n${v.map((x) => `- ${x.verdict === "good" ? "Liked" : "Not liked"}: “${x.title}” (${x.style.slice(0, 80)}): ${x.why.slice(0, 200)}`).join("\n")}`;
}

export async function writeSong(charId: string, description: string, instrumental: boolean): Promise<{ title: string; style: string; lyrics: string }> {
  if (desk().toddler) throw new Error("The AI is resting: toddler mode is on.");
  const { chainFor } = await import("./agent.ts");
  const { streamOnce, credential } = await import("./model.ts");
  const { list } = chainFor(charId);
  if (!list.length) throw new Error("No AI connection is available to write the song.");
  const turns = [
    {
      role: "system" as const,
      content:
        "You write songs for a music generator. Answer with exactly three parts and nothing else:\nTITLE: a short title\nSTYLE: one line of comma-separated genre, mood, instruments, tempo and vocal description, then production notes (how it's mixed and recorded: e.g. warm analog mix, tight punchy drums, airy vocals) (under 240 characters)\nLYRICS:\n the lyrics, with section tags on their own lines like [Intro], [Verse], [Chorus], [Bridge], [Outro]; a tag may say how that part should sound, like [Chorus - full band, layered harmonies] or [Bridge - stripped back, piano only] (those directions are taken out before singing and given to the engine as the arrangement, so they're never sung). Round brackets are sung, as backing vocals: use them only for words to sing. Two verses, a chorus that repeats, about 16 to 28 lines.",
    },
    { role: "user" as const, content: `${description.trim()}${instrumental ? "\n\n(Instrumental: write LYRICS: [Instrumental])" : ""}${verdictsNote()}` },
  ];
  let last = "";
  for (const { conn, model } of list) {
    try {
      let out = "";
      const r = await streamOnce(conn, model, credential(conn, desk().env), turns, [], 0.9, (p) => (out += p));
      const song = parseSong(r.text || out, instrumental);
      if (song) return song;
      last = "The answer didn't have a style line.";
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(`Couldn't write the song. ${last}`.trim());
}

export function newEngineId() {
  return Math.random().toString(36).slice(2, 10);
}
