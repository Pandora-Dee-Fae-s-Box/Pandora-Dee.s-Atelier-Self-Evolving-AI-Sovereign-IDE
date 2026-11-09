// Playlist files: M3U / M3U8 (what VLC, Windows Media Player, Kodi and the Xbox's media player read and write) and
// PLS, read into entries and matched against what's here; and written back out as M3U8. Pure (no page, no store),
// so it's tested on its own (playlistFile.test.ts).

export type Entry = { path: string; title?: string; seconds?: number };

/** The entries in a playlist file, in order (M3U, M3U8, PLS, or just one path a line). */
export function parsePlaylist(text: string): Entry[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).map((l) => l.trim());
  if (/^\[playlist\]/i.test(lines.find(Boolean) ?? "")) {
    const files = new Map<number, Entry>();
    for (const l of lines) {
      const m = /^(File|Title|Length)(\d+)\s*=\s*(.*)$/i.exec(l);
      if (!m) continue;
      const n = Number(m[2]);
      const e = files.get(n) ?? { path: "" };
      const k = m[1].toLowerCase();
      if (k === "file") e.path = clean(m[3]);
      else if (k === "title") e.title = m[3].trim() || undefined;
      else if (Number(m[3]) > 0) e.seconds = Number(m[3]);
      files.set(n, e);
    }
    return [...files.entries()].sort((a, b) => a[0] - b[0]).map(([, e]) => e).filter((e) => e.path);
  }
  const out: Entry[] = [];
  let info: { title?: string; seconds?: number } = {};
  for (const l of lines) {
    if (!l) continue;
    if (l.startsWith("#")) {
      const m = /^#EXTINF:\s*(-?\d+(?:\.\d+)?)?[^,]*,(.*)$/i.exec(l);
      if (m) info = { seconds: Number(m[1]) > 0 ? Number(m[1]) : undefined, title: m[2].trim() || undefined };
      continue;
    }
    out.push({ path: clean(l), ...info });
    info = {};
  }
  return out;
}

/** file:///C:/x%20y.mp4 → C:/x y.mp4; file://HOST/share → //HOST/share. */
function clean(p: string): string {
  let s = p.trim().replace(/^["']|["']$/g, "");
  if (/^file:/i.test(s)) {
    s = s.replace(/^file:\/\/\/(?=[a-z]:)/i, "").replace(/^file:/i, "");
    try {
      s = decodeURIComponent(s);
    } catch {
      /* left as it is */
    }
  }
  return s;
}

/** An M3U8 file of these (UTF-8, with titles and lengths, so other players show the names). */
export function writeM3u(entries: Entry[]): string {
  const body = entries.map((e) => `#EXTINF:${Math.round(e.seconds ?? 0) || -1},${(e.title ?? "").replace(/[\r\n]+/g, " ")}\n${e.path}`).join("\n");
  return `#EXTM3U\n${body}\n`;
}

const parts = (p: string) => p.toLowerCase().split(/[\\/]+/).filter(Boolean);
const isUrl = (p: string) => /^[a-z][a-z0-9+.-]+:\/\//i.test(p) && !/^file:/i.test(p);

/** The things here each entry means: the same path, or else the one whose path ends the same way for the most
 *  folders (a playlist made on another computer, or with paths relative to where the file was, still finds them by
 *  name and the folders above it). Entries that match nothing are counted, not guessed. */
export function matchEntries<T>(entries: Entry[], items: T[], pathOf: (t: T) => string): { found: T[]; missing: Entry[] } {
  const byName = new Map<string, { t: T; segs: string[] }[]>();
  for (const t of items) {
    const segs = parts(pathOf(t));
    const name = segs.at(-1);
    if (!name) continue;
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name)!.push({ t, segs });
  }
  const found: T[] = [], missing: Entry[] = [];
  for (const e of entries) {
    if (isUrl(e.path)) {
      missing.push(e);
      continue;
    }
    const want = parts(e.path);
    const options = byName.get(want.at(-1) ?? "") ?? [];
    let best: T | undefined, score = 0;
    for (const o of options) {
      let k = 0;
      while (k < want.length && k < o.segs.length && want[want.length - 1 - k] === o.segs[o.segs.length - 1 - k]) k++;
      if (k > score) (best = o.t), (score = k);
    }
    if (best !== undefined) found.push(best);
    else missing.push(e);
  }
  return { found, missing };
}

/** A name for the playlist from its file's name ("Saturday cartoons.m3u8" → "Saturday cartoons"). */
export const nameFromFile = (file: string) => file.split(/[\\/]/).pop()!.replace(/\.(m3u8?|pls)$/i, "").trim() || "Playlist";

/** Saved on the device being used, as a file. */
export function saveTextToDevice(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "audio/x-mpegurl" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Saved in the vault's Playlists folder (beside the videos and music, where VLC or the Xbox can open it too). */
export async function saveToVault(name: string, text: string): Promise<string> {
  const o = (await fetch("/api/files/places").then((r) => r.json())) as { places?: { id: string; path: string }[] };
  const vault = o.places?.find((p) => p.id === "vault")?.path;
  if (!vault) throw new Error("The vault isn't reachable from here.");
  const dir = `${vault}${vault.includes("\\") ? "\\" : "/"}Playlists`;
  const r = await fetch(`/api/files/upload?dir=${encodeURIComponent(dir)}`, { method: "POST", headers: { "x-filename": encodeURIComponent(name) }, body: new Blob([text]) });
  const j = (await r.json().catch(() => ({}))) as { path?: string; error?: string };
  if (!r.ok || !j.path) throw new Error(j.error || `It answered ${r.status}.`);
  return j.path;
}

/** A playlist file's text: from this device (a file picker), or from the desktop's own files. */
export function readDeviceFile(): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".m3u,.m3u8,.pls,audio/x-mpegurl,audio/mpegurl,audio/x-scpls";
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      void f.text().then((text) => resolve({ name: f.name, text }), () => resolve(null));
    };
    input.click();
  });
}
