// Shows, seasons and episodes in the order people mean: Season 2 before Season 10, S01E09 before S01E10, whatever
// the folder names look like. Pure (no page, no store), so it's tested on its own (episodes.test.ts).

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
/** Names compared with their numbers as numbers: "Season 2" < "Season 10", "ep9" < "ep10". */
export const natural = (a: string, b: string) => collator.compare(a, b);

/** The season and episode a file name says, if it says (S01E02, s1e2, 1x02, "Season 1 Episode 2"). */
export function episodeOf(name: string): { season?: number; episode?: number } {
  const n = name.replace(/[._]/g, " ");
  let m = /\bs(\d{1,3})\s*-?\s*e(\d{1,4})/i.exec(n) ?? /\b(\d{1,2})x(\d{1,3})\b/i.exec(n);
  if (m) return { season: Number(m[1]), episode: Number(m[2]) };
  m = /\bseason\s*(\d{1,3})\D+?(?:episode|ep)\s*(\d{1,4})/i.exec(n);
  if (m) return { season: Number(m[1]), episode: Number(m[2]) };
  m = /\b(?:episode|ep|e)\s*(\d{1,4})\b/i.exec(n);
  if (m) return { episode: Number(m[1]) };
  // "001 - Cat Crazy - Pawesome Sauce": a number first, then the show, then the episode's own title
  m = /^\s*(\d{1,4})\s+-\s+\S.*?\s+-\s+\S/.exec(name);
  return m ? { episode: Number(m[1]) } : {};
}

type Item = { folder?: string; name: string };

/** Watching order: folder by folder (numbers as numbers), then by the season and episode a name gives, then by name. */
export function episodeOrder(a: Item, b: Item): number {
  const fa = (a.folder ?? "").split("/").filter(Boolean), fb = (b.folder ?? "").split("/").filter(Boolean);
  for (let i = 0; i < Math.min(fa.length, fb.length); i++) {
    const c = natural(fa[i], fb[i]);
    if (c) return c;
  }
  // a folder's own videos before the ones in folders inside it
  if (fa.length !== fb.length) return fa.length - fb.length;
  const ea = episodeOf(a.name), eb = episodeOf(b.name);
  if (ea.season !== undefined && eb.season !== undefined && ea.season !== eb.season) return ea.season - eb.season;
  if (ea.episode !== undefined && eb.episode !== undefined && ea.episode !== eb.episode) return ea.episode - eb.episode;
  return natural(a.name, b.name);
}

/** What's in one folder of a shelf: the folders inside it (with how many videos each holds, all the way down) and
 *  the videos right there, each in watching order. */
export function inFolder<T extends Item>(videos: T[], rel: string): { folders: { name: string; rel: string; videos: T[] }[]; here: T[] } {
  const prefix = rel ? `${rel}/` : "";
  const folders = new Map<string, T[]>();
  const here: T[] = [];
  for (const v of videos) {
    const f = v.folder ?? "";
    if (f === rel) here.push(v);
    else if (!rel || f.startsWith(prefix)) {
      const name = f.slice(prefix.length).split("/")[0];
      if (!folders.has(name)) folders.set(name, []);
      folders.get(name)!.push(v);
    }
  }
  return {
    folders: [...folders.entries()].map(([name, vs]) => ({ name, rel: prefix + name, videos: vs.sort(episodeOrder) })).sort((a, b) => natural(a.name, b.name)),
    here: here.sort(episodeOrder),
  };
}

/** Everything under a folder (it and the folders inside it), in watching order: what plays on from an episode. */
export const underFolder = <T extends Item>(videos: T[], rel: string) =>
  videos.filter((v) => !rel || v.folder === rel || (v.folder ?? "").startsWith(`${rel}/`)).sort(episodeOrder);
