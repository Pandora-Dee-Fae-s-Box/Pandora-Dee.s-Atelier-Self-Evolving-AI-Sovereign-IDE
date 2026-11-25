// Gapless: the next song is loaded beside the one playing and starts the moment this one ends (or, once its last
// stretch is only silence, then), so an album that runs track into track plays as one. The decisions are here, with
// no DOM (gapless.test.ts); music.ts does the playing.

/** The song that plays when this one ends on its own, as Next would choose it: this one again on repeat-one, the
 *  next, the first again on repeat-all, or none (-1). */
export function upcoming(length: number, index: number, repeat: "off" | "all" | "one"): number {
  if (!length || index < 0) return -1;
  if (repeat === "one") return index;
  if (index + 1 < length) return index + 1;
  return repeat === "all" ? 0 : -1;
}

/** How long before the end to start the next song: a little early, since starting takes a moment. */
export const LEAD = 0.12;
/** Below this a stretch counts as silence (peak level, 0..1), and this long of it in a song's last seconds ends it. */
export const QUIET = 0.004;
export const QUIET_FOR = 1.2;
export const TAIL = 20;

/** Whether the song can end now: in its last `TAIL` seconds, after `QUIET_FOR` seconds of nothing but silence. */
export function quietEnding(left: number, quietSince: number | null, now: number): boolean {
  return left > 0 && left <= TAIL && quietSince !== null && now - quietSince >= QUIET_FOR;
}

/** The loudest sample in a stretch of the analyser's waveform (bytes centred on 128). */
export function peakOf(wave: Uint8Array): number {
  let p = 0;
  for (const v of wave) p = Math.max(p, Math.abs(v - 128));
  return p / 128;
}
