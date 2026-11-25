// YouTube links for the Theatre: a link's video id (and where in it to start), and its title and thumbnail, fetched
// once by the desktop when the link is added and kept with the Theatre (youtube.test.mjs). Nothing is downloaded but
// those; the video plays from YouTube's no-cookie player.

const ID = /^[A-Za-z0-9_-]{11}$/;

/** "1h2m3s", "90", "1:30" → seconds. */
function seconds(t) {
  const s = String(t ?? "").trim();
  if (!s) return 0;
  if (/^\d+$/.test(s)) return Number(s);
  if (/^\d+(:\d{1,2}){1,2}$/.test(s)) return s.split(":").reduce((n, x) => n * 60 + Number(x), 0);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(s);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0;
}

/** A YouTube link (watch, youtu.be, shorts, live, embed, music.youtube, or a bare id) → { yt, start }, or null. */
export function parseYouTube(text) {
  const s = String(text ?? "").trim();
  if (ID.test(s)) return { yt: s, start: 0 };
  let u;
  try {
    u = new URL(/^[a-z]+:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, "");
  let id = "";
  if (host === "youtu.be") id = u.pathname.split("/")[1] ?? "";
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const [, first, second] = u.pathname.split("/");
    if (first === "watch") id = u.searchParams.get("v") ?? "";
    else if (["shorts", "live", "embed", "v", "e"].includes(first)) id = second ?? "";
  } else return null;
  if (!ID.test(id)) return null;
  return { yt: id, start: seconds(u.searchParams.get("t") ?? u.searchParams.get("start")) };
}

export const watchUrl = (yt) => `https://www.youtube.com/watch?v=${yt}`;

/** Its title and channel (YouTube's oEmbed), or nothing when YouTube doesn't answer: the link is kept all the same. */
export async function youTubeInfo(yt, fetchFn = fetch) {
  try {
    const r = await fetchFn(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watchUrl(yt))}`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return {};
    const j = await r.json();
    return { title: String(j.title ?? "").slice(0, 200), author: String(j.author_name ?? "").slice(0, 120) };
  } catch {
    return {};
  }
}

/** Its thumbnail as JPEG bytes, or null. */
export async function youTubeThumb(yt, fetchFn = fetch) {
  for (const size of ["hqdefault", "mqdefault"]) {
    try {
      const r = await fetchFn(`https://i.ytimg.com/vi/${yt}/${size}.jpg`, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      const b = Buffer.from(await r.arrayBuffer());
      if (b[0] === 0xff && b[1] === 0xd8 && b.length < 2_000_000) return b;
    } catch {
      /* try the smaller one */
    }
  }
  return null;
}
