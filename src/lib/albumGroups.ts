// Albums as the library shows them: one per album per folder. The same album kept in two places (a 128k copy, a 320k
// copy and a FLAC rip, say) shows as separate albums, each labelled so they can be told apart, instead of one album
// with every song two or three times. A disc folder (CD1, Disc 2…) counts as its album's folder, so a two-disc set
// stays one album. Songs in one folder with one album name are one album even when the artists differ (a compilation).
// No DOM here (albumGroups.test.ts).

import type { Track } from "./music.ts";

const DISC = /^(cd|dis[ck])\s*[-_.]?\s*\d+$/i;

/** The folder a song's album lives in: its own folder, or the one above a disc folder. Songs another device shares
 *  count by that device. */
export function albumHome(t: Pick<Track, "folder" | "rel" | "device">, keepCase = false): string {
  const whole = `${t.folder ?? ""}/${t.rel ?? ""}`.replace(/\\/g, "/");
  const parts = whole.split("/").filter(Boolean);
  if (whole.startsWith("/")) parts[0] = `/${parts[0] ?? ""}`;
  if (t.rel) parts.pop(); // the file itself; with no rel, the music folder stands for it
  if (parts.length > 1 && DISC.test(parts[parts.length - 1])) parts.pop();
  const home = `${t.device ? `${t.device}:` : ""}${parts.join("/")}`;
  return keepCase ? home : home.toLowerCase();
}

export type Album = { key: string; name: string; artist: string; tracks: Track[]; cover?: Track; label?: string };

const STANDARD = [32, 48, 64, 96, 112, 128, 160, 192, 224, 256, 320];
/** 318k reads as 320k; a VBR rip in between reads as about what it is. */
const rate = (k: number) => {
  const near = STANDARD.find((s) => Math.abs(s - k) <= 4);
  return near ? `${near}k` : `~${Math.round(k / 10) * 10}k`;
};

const ext = (t: Track) => (/\.([a-z0-9]+)$/i.exec(t.file ?? t.rel ?? "")?.[1] ?? "").toUpperCase();
const LOSSLESS = new Set(["FLAC", "WAV", "ALAC", "APE", "AIFF", "AIF", "WV"]);

/** What a copy is: "FLAC", "MP3 320k"… (the most common kind among its songs). */
function kindOf(ts: Track[]): string {
  const count = new Map<string, number>();
  for (const t of ts) {
    const e = ext(t);
    const k = !e ? "" : LOSSLESS.has(e) || !t.bitrate ? e : `${e} ${rate(t.bitrate)}`;
    count.set(k, (count.get(k) ?? 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}
/** Where each copy is, by the part of its folder path the copies don't share ("128" and "320" for Music/128/Tide
 *  and Music/320/Tide). */
function whereEach(homes: string[]): string[] {
  const segs = homes.map((h) => h.split(/[/:]/).filter(Boolean));
  let pre = 0;
  while (segs.every((s) => pre < s.length - 1 && s[pre].toLowerCase() === segs[0][pre]?.toLowerCase())) pre++;
  let suf = 0;
  while (segs.every((s) => suf < s.length - pre - 1 && s[s.length - 1 - suf].toLowerCase() === segs[0][segs[0].length - 1 - suf]?.toLowerCase())) suf++;
  return segs.map((s) => s.slice(pre, s.length - suf).join("/") || s[s.length - 1] || "");
}

export function groupAlbums(songs: Track[]): Album[] {
  const map = new Map<string, Track[]>();
  for (const t of songs) {
    const k = t.album ? `${t.album.trim().toLowerCase()}\u0000${albumHome(t)}` : "\u0000singles";
    map.set(k, [...(map.get(k) ?? []), t]);
  }
  const albums: Album[] = [...map.entries()].map(([key, ts]) => {
    ts.sort((a, b) => a.track - b.track || a.title.localeCompare(b.title));
    const artists = new Set(ts.map((t) => t.artist).filter(Boolean));
    return {
      key,
      name: ts[0].album || "Singles",
      artist: !ts[0].album ? "" : artists.size > 1 ? "Various artists" : ([...artists][0] ?? ""),
      tracks: ts,
      cover: ts.find((t) => t.cover),
    };
  });
  // copies of one album: say what each is, and where when that's the same too
  const same = new Map<string, Album[]>();
  for (const a of albums) if (a.key !== "\u0000singles") {
    const k = `${a.name.trim().toLowerCase()}\u0000${a.artist.toLowerCase()}`;
    same.set(k, [...(same.get(k) ?? []), a]);
  }
  for (const copies of same.values()) {
    if (copies.length < 2) continue;
    const kinds = copies.map((a) => kindOf(a.tracks));
    const where = whereEach(copies.map((a) => albumHome(a.tracks[0], true)));
    copies.forEach((a, i) => {
      const clash = kinds.filter((k) => k === kinds[i]).length > 1;
      a.label = [kinds[i], clash || !kinds[i] ? where[i] : ""].filter(Boolean).join(" · ") || where[i];
    });
  }
  return albums;
}
