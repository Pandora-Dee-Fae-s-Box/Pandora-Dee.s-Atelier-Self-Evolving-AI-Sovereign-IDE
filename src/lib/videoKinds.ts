// What kind of video each one is (a movie, an episode of a series, a screen recording, or unknown), worked out from
// its folders, its file name and its shelf's name, and where it sits in that kind's own folders: movies by the
// folders around them (Movies › Pixar › Ice Age → Pixar › Ice Age), episodes by show and season. Pure, so it's
// tested on its own (videoKinds.test.ts).

import { episodeOf } from "./episodes.ts";

export type Kind = "movie" | "series" | "recording" | "unknown";
export const KINDS: { id: Kind; label: string }[] = [
  { id: "movie", label: "Movies" },
  { id: "series", label: "Series" },
  { id: "recording", label: "Screen recordings" },
  { id: "unknown", label: "Unknown" },
];

type V = { name: string; shelf: string; folder?: string; seconds?: number };

// (a phone camera's VID_20261101 or a "bday-clip" is a video like any other, not a recording of the screen)
const RECORDING = /screen[\s._-]*(record|cap|shot)|screencast|screenrecord|^(rec|record)[_-]?\d{8}|game\s*(dvr|clips?)|bildschirmaufnahme|grabaci[oó]n de pantalla/i;
const RECORDING_FOLDER = /^(captures?|clips|game clips|recordings|screen recordings?)$/i;
const MOVIE_WORD = /^(movies?|films?|cinema|feature films?|kids'? movies|disney|pixar|dreamworks)$/i;
const MOVIES_FOLDER = /^(movies?|films?|cinema|feature films?)$/i;
const SERIES_WORD = /^(tv|tv shows?|shows?|series|cartoons?|episodes?)$/i;
const SEASON = /^(season|series|staffel|saison|temporada|s)\s*0*(\d{1,3})$|^0*(\d{1,3})(st|nd|rd|th)? season$/i;
const YEAR = /(^|[\s.(\[_-])(19[2-9]\d|20[0-4]\d)([\s.)\]_-]|$)/;

const segs = (v: V) => (v.folder ?? "").split("/").filter(Boolean);
const seasonNo = (seg: string) => {
  const m = SEASON.exec(seg.trim());
  return m ? Number(m[2] ?? m[3]) : undefined;
};

/** Movie, series episode, screen recording, or unknown. */
export function kindOf(v: V): Kind {
  const all = [v.shelf, ...segs(v)];
  if (RECORDING.test(v.name) || all.some((s) => RECORDING.test(s) || RECORDING_FOLDER.test(s))) return "recording";
  const ep = episodeOf(v.name);
  if (ep.season !== undefined || all.some((s) => seasonNo(s) !== undefined)) return "series";
  if (all.some((s) => MOVIE_WORD.test(s))) return "movie";
  if (ep.episode !== undefined || all.some((s) => SERIES_WORD.test(s))) return "series";
  // a year in the name ("Ice Age (2002)") or feature length
  if (YEAR.test(v.name) || (v.seconds ?? 0) >= 65 * 60) return "movie";
  return "unknown";
}

/** A show's name from a file name: what comes before S01E02 / 1x02 / "Episode 3". */
function showFromName(name: string): string {
  // "001 - Cat Crazy - Pawesome Sauce" → Cat Crazy
  const numbered = /^\s*\d{1,4}\s+-\s+(.+?)\s+-\s+\S/.exec(name);
  if (numbered) return numbered[1].trim();
  const n = name.replace(/[._]/g, " ");
  const m = /^(.*?)[\s-]*(\bs\d{1,3}\s*-?\s*e\d{1,4}|\b\d{1,2}x\d{1,3}\b|\bseason\s*\d|\b(episode|ep)\s*\d)/i.exec(n);
  return (m?.[1] ?? "").replace(/[\s-]+$/, "").trim();
}
const same = (a: string, b: string) => {
  const k = (s: string) => s.toLowerCase().replace(/\(.*?\)|\[.*?\]|[^a-z0-9]+/g, "");
  // (the same name, give or take a year and quality tags: "Ice Age (2002)" for "Ice Age", not "Ice Age" for "Ice Age 2")
  const strip = (s: string) => k(s.replace(YEAR, " ").replace(/\b(1080p|720p|2160p|4k|bluray|web-?dl|hdrip|x26[45])\b.*$/i, ""));
  return strip(a) !== "" && strip(a) === strip(b);
};

/** Where a video goes in its kind's folders: "Show/Season 2" for an episode, "Pixar/Ice Age" for a movie (its own
 *  folder, and words like "Movies", left out), the shelf and folders for the rest. */
export function placeIn(v: V, kind: Kind = kindOf(v)): string {
  const s = segs(v);
  if (kind === "series") {
    const at = s.findIndex((x) => seasonNo(x) !== undefined);
    const ep = episodeOf(v.name);
    const season = at >= 0 ? seasonNo(s[at]) : ep.season;
    // the show: the folder above the season folder, or the folder it's in, or the start of the file's name
    const above = (at >= 0 ? s.slice(0, at) : s).filter((x) => !SERIES_WORD.test(x));
    const show = above.at(-1) || showFromName(v.name) || (SERIES_WORD.test(v.shelf) ? "" : v.shelf) || "Other shows";
    return season !== undefined ? `${show}/Season ${season}` : show;
  }
  if (kind === "movie") {
    const keep = s.filter((x) => !MOVIES_FOLDER.test(x));
    // a movie in a folder of its own name ("Ice Age (2002)/Ice Age.mkv") sits with its series of movies instead
    if (keep.length && same(keep.at(-1)!, v.name)) keep.pop();
    return keep.join("/");
  }
  return [v.shelf || "Videos", ...s].join("/");
}
