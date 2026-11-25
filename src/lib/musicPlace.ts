// Where the music player was, kept on this device so a reload carries on: the queue in its own order (an album
// shuffle stays as it was shuffled), which song, and how far in. Songs from the library are kept by id and found
// again in it; a station, or a song another device shares, is kept whole. No DOM here (musicPlace.test.ts).

import type { Item, Track } from "./music.ts";

export type Saved = { v: 1; q: ({ t: string } | Item)[]; i: number; at: number };

export function pack(queue: Item[], index: number, position: number): Saved {
  return { v: 1, q: queue.map((it) => (it.kind === "track" && !it.src ? { t: it.id } : it)), i: index, at: Math.max(0, Math.floor(position)) };
}

/** The queue again, from the library as it is now. Songs no longer there are left out, and the place moves with
 *  them; if the song that was playing is gone, it carries on at the next one, from its start. */
export function unpack(saved: unknown, tracks: Track[]): { queue: Item[]; index: number; position: number } | null {
  const s = saved as Saved | null;
  if (!s || s.v !== 1 || !Array.isArray(s.q) || !s.q.length) return null;
  const byId = new Map(tracks.map((t) => [t.id, t]));
  const queue: Item[] = [];
  let index = -1, position = 0;
  s.q.forEach((x, i) => {
    let it: Item | undefined;
    if (x && typeof x === "object" && "t" in x && !("kind" in x)) {
      const t = byId.get(String(x.t));
      if (t) it = { kind: "track", ...t };
    } else if (x && typeof x === "object" && "kind" in x && (x.kind === "track" || x.kind === "radio")) it = x as Item;
    if (!it) return;
    if (i === s.i) (index = queue.length), (position = Number(s.at) || 0);
    else if (index < 0 && i > s.i) index = queue.length;
    queue.push(it);
  });
  if (!queue.length) return null;
  if (index < 0) index = queue.length - 1;
  return { queue, index, position };
}
