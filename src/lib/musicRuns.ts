// Runs in the queue: songs from one album (or one artist) in a row, as playing by album or artist, or albums
// shuffled, keeps them. Skipping forward goes past the rest of this run; going back goes to the start of the run
// before it. No DOM here (musicRuns.test.ts).

import type { Item } from "./music.ts";
import { albumHome } from "./albumGroups.ts";

/** What a song counts as for skipping: its album or artist. Songs with neither, and stations, count as their own. */
export const runKey = (it: Item, by: "album" | "artist") =>
  it.kind !== "track" ? `\u0001${it.url}` : by === "album" ? (it.album ? `${it.album.trim().toLowerCase()}\u0000${albumHome(it)}` : `\u0002${it.id}`) : it.artist ? it.artist.trim().toLowerCase() : `\u0002${it.id}`;

/** Where this run starts. */
function runStart(queue: Item[], i: number, by: "album" | "artist") {
  const k = runKey(queue[i], by);
  while (i > 0 && runKey(queue[i - 1], by) === k) i--;
  return i;
}

/** The first song of the album (or artist) before this one, or -1. With `wrap` (repeat on) the last run comes
 *  round before the first. */
export function previousRun(queue: Item[], index: number, by: "album" | "artist", wrap: boolean): number {
  if (index < 0 || index >= queue.length) return -1;
  const here = runStart(queue, index, by);
  if (here > 0) return runStart(queue, here - 1, by);
  if (!wrap) return -1;
  const last = runStart(queue, queue.length - 1, by);
  return last === here ? -1 : last;
}
