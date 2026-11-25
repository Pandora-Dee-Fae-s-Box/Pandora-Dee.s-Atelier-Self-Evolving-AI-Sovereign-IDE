// Where new things go in a play queue: next (right after what's playing), last (at the end), or after the current
// album (after the rest of the run the playing item belongs to: an album in Music, a folder or season in the
// Theatre). Plain data in, plain data out, no DOM and no player: the Music player, the Theatre, characters' tools
// and anything driving SEASIDE from elsewhere (a ferry window, a jetty) all place things the same way, by name.
// (queueOps.test.ts)

export type QueueWhere = "next" | "last" | "after-album";

export const QUEUE_WHERE: readonly QueueWhere[] = ["next", "last", "after-album"];

/** The menu wording for each place. */
export const WHERE_LABEL: Record<QueueWhere, string> = {
  next: "Play next in queue",
  last: "Play last in queue",
  "after-album": "Play after the current album",
};

/** A place from loose words ("next", "play_last", "after album", "after_album"), or null. */
export function whereOf(s: unknown): QueueWhere | null {
  const w = String(s ?? "").toLowerCase().replace(/^(play|queue)[\s_-]*/, "").replace(/[\s_]+/g, "-");
  return w === "next" || w === "last" ? w : w === "after-album" || w === "after-current-album" || w === "after-this-album" ? "after-album" : null;
}

/** Where in the queue the new things start. With nothing playing (`index` < 0) everything goes at the end. */
export function insertionPoint<T>(queue: readonly T[], index: number, where: QueueWhere, runKey: (t: T) => string): number {
  if (where === "last" || index < 0 || index >= queue.length) return queue.length;
  if (where === "next") return index + 1;
  const here = runKey(queue[index]);
  let i = index + 1;
  while (i < queue.length && runKey(queue[i]) === here) i++;
  return i;
}

/** The queue with `items` put in at that place; the playing item stays where it is (its index doesn't move). */
export function placeInQueue<T>(queue: readonly T[], index: number, items: readonly T[], where: QueueWhere, runKey: (t: T) => string): { queue: T[]; at: number } {
  const at = insertionPoint(queue, index, where, runKey);
  return { queue: [...queue.slice(0, at), ...items, ...queue.slice(at)], at };
}
