// Shared music libraries: any device can share its music (a folder on a computer, or picked songs on a phone) and the
// others see it as one more machine's library. The files stay on the device sharing them (lib/devshare.ts answers
// while its page is open) and play from it through the server, seeking included; any of them can also be copied to
// the server's own library. The server's library is the one every device sees without anyone sharing.

import { useEffect, useState } from "react";
import { addFiles, type Track } from "./music.ts";
import { deviceName, publishMusic, shareSource, type DirHandle } from "./devshare.ts";

export const AUDIO = /\.(mp3|flac|ogg|oga|opus|m4a|aac|wav|webm|wma|aiff?)$/i;

type Song = { path: string; title: string; artist: string; album: string; folder: string; size: number };

/** What a song is called and where it sits, from its path in the shared folder (Artist/Album/03 Song.mp3 is common). */
export function songOf(path: string, size: number): Song {
  const parts = path.split("/").filter(Boolean);
  const file = parts.at(-1) ?? path;
  const title = file.replace(/\.[^.]+$/, "").replace(/^\d{1,3}[\s._-]+/, "").trim() || file;
  const album = parts.length > 1 ? parts.at(-2)! : "";
  const artist = parts.length > 2 ? parts.at(-3)! : "";
  return { path, title, artist, album, folder: parts.slice(0, -1).join("/"), size };
}

/** Every audio file in a folder this device picked, with its path inside it (and the file, for copying). */
async function walk(dir: DirHandle, base = "", out: { path: string; file: File }[] = []) {
  for await (const h of dir.values()) {
    if (out.length >= 20_000) break;
    const p = base ? `${base}/${h.name}` : h.name;
    if (h.kind === "directory") await walk(h as DirHandle, p, out);
    else if (AUDIO.test(h.name)) {
      try {
        out.push({ path: p, file: await (h as FileSystemFileHandle).getFile() });
      } catch {
        /* a file the browser won't open */
      }
    }
  }
  return out;
}

/** Share a music folder from this device (Chrome and Edge on computers). How many songs, or null if cancelled. */
export async function shareMusicFolder(): Promise<number | null> {
  let dir: DirHandle;
  try {
    dir = (await (window as unknown as { showDirectoryPicker: (o: object) => Promise<DirHandle> }).showDirectoryPicker({ mode: "read" })) as DirHandle;
  } catch {
    return null;
  }
  const found = await walk(dir);
  const s = await shareSource(dir.name, { kind: "folder", dir });
  await publishMusic(s.id, found.map((f) => songOf(f.path, f.file.size)));
  return found.length;
}

/** Share songs this device picked (phones: their own storage). How many. */
export async function shareMusicFiles(files: File[]): Promise<number> {
  const songs = files.filter((f) => AUDIO.test(f.name) || f.type.startsWith("audio/"));
  if (!songs.length) return 0;
  const s = await shareSource(songs.length === 1 ? songs[0].name : `${songs.length} songs`, { kind: "files", files: songs });
  await publishMusic(s.id, songs.map((f) => songOf(f.name, f.size)));
  return songs.length;
}

/** Copy songs another device is sharing into the server's own library (fetched from that device, then added). */
export async function copyToServer(tracks: Track[]) {
  const files: File[] = [];
  for (const t of tracks) {
    if (!t.src) continue;
    const r = await fetch(t.src);
    if (!r.ok) throw new Error(`"${t.title}" couldn't be fetched from ${t.device || "that device"}.`);
    files.push(new File([await r.blob()], t.file || `${t.title}.mp3`, { type: r.headers.get("Content-Type") || "audio/mpeg" }));
  }
  return files.length ? addFiles(files) : { tracks: 0 };
}

export type SharedLibrary = { id: string; name: string; device: string; tracks: Track[] };

/** The libraries other devices are sharing now (and this one's own), refreshed every few seconds while shown. */
export function useSharedLibraries(): SharedLibrary[] {
  const [libs, setLibs] = useState<SharedLibrary[]>([]);
  useEffect(() => {
    let on = true;
    const load = async () => {
      try {
        const j = (await (await fetch("/api/music/shared")).json()) as { libraries?: { id: string; name: string; device: string; tracks: Song[] }[] };
        if (!on) return;
        setLibs(
          (j.libraries ?? []).map((l) => ({
            id: l.id,
            name: l.name,
            device: l.device,
            tracks: l.tracks.map((s) => ({
              id: `dev:${l.id}:${s.path}`,
              title: s.title,
              artist: s.artist,
              album: s.album,
              year: 0,
              track: 0,
              genre: "",
              duration: 0,
              cover: false,
              bitrate: 0,
              size: s.size,
              folder: s.folder,
              file: s.path.split("/").pop(),
              src: `/api/files/raw?path=${encodeURIComponent(`device:${l.id}/${s.path}`)}`,
              device: l.device,
            })),
          })),
        );
      } catch {
        /* the server isn't answering: keep what was shown */
      }
    };
    void load();
    const t = window.setInterval(() => void load(), 5000);
    return () => ((on = false), window.clearInterval(t));
  }, []);
  return libs;
}

/** What the server calls itself (PADS's server name), for "the server" as one machine among the others. */
export function useServerName(): string {
  const [name, setName] = useState("");
  useEffect(() => {
    void fetch("/api/pads/servers")
      .then((r) => r.json())
      .then((j: { me?: { name?: string } }) => setName(j.me?.name || ""))
      .catch(() => undefined);
  }, []);
  return name;
}

export const thisDevice = deviceName;
