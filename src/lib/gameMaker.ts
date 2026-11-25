// "Imagine a game" (and "Change this game"): the character you're with writes a game as a Mini App with her own
// model; the sounds it asks for are made here, its pictures and music by your picture and song engines when there
// are some. Each change is a new version of the same app, so every earlier one can still be played. The asking and
// reading of her answer is in gameFiles.ts.

import { zipSync, strToU8 } from "fflate";
import { desk } from "./store.ts";
import { library, type Pkg } from "./xdc.ts";
import { filesForChange, gameSystem, manifestFor, nextVersion, parseGame, type Asset } from "./gameFiles.ts";
import { kindFor, render, sfxOf, wav } from "./sfx.ts";
import { audioOf, makePictures, makeSong } from "./media.ts";

export type Made = { pkg: Pkg; title: string; note: string; made: string[]; skipped: string[] };
export type Imagine = {
  charId: string;
  ask: string;
  /** A game to change: its current version (its files are what's changed). */
  base?: Pkg;
  /** Every version of it there is, to number the new one. */
  versions?: string[];
  pictures: boolean;
  music: boolean;
  progress: (text: string) => void;
  signal?: AbortSignal;
};

const TEXT = /\.(html?|css|m?js|json|toml|md|txt|svg)$/i;

/** All of a version's files, text as text and the rest as bytes. */
async function filesOf(pkg: Pkg): Promise<{ text: Record<string, string>; bytes: Record<string, Uint8Array> }> {
  const text: Record<string, string> = {};
  const bytes: Record<string, Uint8Array> = {};
  for (const p of await library.files(pkg.id)) {
    const r = await fetch(`/api/xdc/${pkg.id}/file?path=${encodeURIComponent(p)}`);
    if (!r.ok) continue;
    if (TEXT.test(p)) text[p] = await r.text();
    else bytes[p] = new Uint8Array(await r.arrayBuffer());
  }
  return { text, bytes };
}

const seedOf = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7) >>> 0;

export async function imagineGame(o: Imagine): Promise<Made> {
  const s = desk();
  if (s.toddler) throw new Error("The AI is resting: toddler mode is on.");
  const who = s.visibleCharacters().find((c) => c.id === o.charId)?.name ?? "a friend";
  const images = s.media.images.filter((e) => e.enabled);
  const songs = s.media.songs.filter((e) => e.enabled);
  const canPictures = o.pictures && images.length > 0;
  const canMusic = o.music && songs.length > 0;
  const before = o.base ? await filesOf(o.base) : { text: {}, bytes: {} };

  const { chainFor } = await import("./agent.ts");
  const { streamOnce, credential } = await import("./model.ts");
  const { list } = chainFor(o.charId);
  if (!list.length) throw new Error(`${who} has no AI connection to write with. Pick one in Settings → AI.`);
  const turns = [
    { role: "system" as const, content: gameSystem(who, { pictures: canPictures, music: canMusic }) },
    {
      role: "user" as const,
      content: o.base
        ? `Here's the game as it is now:\n${filesForChange(before.text)}\n\nChange it: ${o.ask.trim()}`
        : `Make this game: ${o.ask.trim()}`,
    },
  ];
  let answer = null as ReturnType<typeof parseGame> | null;
  let last = "";
  for (const { conn, model } of list) {
    try {
      let out = "";
      o.progress(`${who} is writing it…`);
      const r = await streamOnce(conn, model, credential(conn, s.env), turns, [], 0.7, (p) => {
        out += p;
        o.progress(`${who} is writing it… (${Math.round(out.length / 1000)}k characters so far)`);
      }, o.signal);
      const g = parseGame(r.text || out);
      if (g.files["index.html"] || (o.base && Object.keys(g.files).length)) {
        answer = g;
        break;
      }
      last = "The answer didn't have the game's files in it.";
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") throw e;
      last = e instanceof Error ? e.message : String(e);
    }
  }
  if (!answer) throw new Error(`${who} couldn't write it. ${last}`.trim());

  const files: Record<string, Uint8Array> = { ...before.bytes };
  for (const [k, v] of Object.entries({ ...before.text, ...answer.files })) files[k] = strToU8(v);
  const made: string[] = [];
  const skipped: string[] = [];
  for (const a of answer.assets as Asset[]) {
    if (files[a.path]) continue; // kept from the version before
    try {
      if (a.kind === "sound") {
        const seed = seedOf(a.path + a.about);
        files[a.path] = wav(render(sfxOf(kindFor(`${a.path} ${a.about}`), seed), seed));
        made.push(a.path);
      } else if (a.kind === "picture" && canPictures) {
        o.progress(`Making ${a.path}…`);
        const [pic] = await makePictures(images[0], { prompt: a.about, width: 512, height: 512, count: 1 }, o.progress, o.signal);
        if (pic) (files[a.path] = new Uint8Array(await pic.arrayBuffer())), made.push(a.path);
      } else if (a.kind === "music" && canMusic) {
        o.progress(`Making ${a.path} (this can take a few minutes)…`);
        const song = await makeSong(songs[0], { title: answer.title || "Theme", style: a.about, lyrics: "[Instrumental]", seconds: 60, instrumental: true }, o.progress, o.signal);
        const p = a.path.replace(/\.[a-z0-9]+$/i, `.${song.ext}`);
        files[p] = new Uint8Array(await audioOf(song).arrayBuffer());
        if (p !== a.path) for (const k of Object.keys(files)) if (TEXT.test(k)) files[k] = strToU8(new TextDecoder().decode(files[k]).split(a.path).join(p));
        made.push(p);
      } else skipped.push(a.path);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") throw e;
      skipped.push(a.path);
    }
  }

  const name = (o.base?.name ?? answer.title) || "A new game";
  const version = nextVersion(o.versions ?? (o.base ? [o.base.version] : []));
  files["manifest.toml"] = strToU8(manifestFor(name, version, answer.note || `Made with ${who}`));
  o.progress("Putting it in Games…");
  const r = await library.import(new File([zipSync(files, { level: 6 }) as Uint8Array<ArrayBuffer>], `${name}.xdc`));
  const pkg = r.added[0];
  if (!pkg) throw new Error("That version is exactly like one already here.");
  await library.update(pkg.id, { notes: `${o.base ? "Changed" : "Imagined"} with ${who}: ${o.ask.trim()}` });
  return { pkg, title: name, note: answer.note, made, skipped };
}
