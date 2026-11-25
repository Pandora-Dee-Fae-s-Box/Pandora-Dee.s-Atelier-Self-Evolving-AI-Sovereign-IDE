// A Mini App may only reach its own address (XDC_CSP). A few apps are made to fetch something specific from the web,
// and say so in the open: the Lilith Learning Lab downloads courses (a catalog.json and course .json files) from a
// GitHub repository's courses/ folder. For those apps alone, this fetches exactly those files on the app's behalf,
// from the apps' own address (/app-net/fetch?url=…), and nothing else: any other app or any other address is refused.
// Pure apart from `fetchFor` (appNet.test.mjs).

const COURSE_FILE = /^https:\/\/raw\.githubusercontent\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/main\/courses\/[A-Za-z0-9_.-]+\.json$/;

/** What each app may fetch, by its app key (the manifest's id). */
export const APP_NET = {
  "lilith-learning-lab": [COURSE_FILE],
};

export const MAX_BYTES = 40_000_000;

/** Whether this app may fetch this address. */
export function allowed(appKey, url) {
  const rules = APP_NET[String(appKey || "")];
  if (!rules) return false;
  let u;
  try {
    u = new URL(String(url));
  } catch {
    return false;
  }
  if (u.search || u.hash || u.username || u.password) return false;
  return rules.some((re) => re.test(u.href));
}

/** The package id of the app whose page asked: from its Referer, "/run/<id>/…" on the apps' address. */
export function askingPkg(referer) {
  try {
    return /^\/run\/([^/]+)\//.exec(new URL(String(referer || "")).pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Fetch it, for an app allowed to: the text, or why not. */
export async function fetchFor(appKey, url, fetchFn = fetch) {
  if (!allowed(appKey, url)) return { status: 403, text: "This app may not fetch that address." };
  const res = await fetchFn(url, { redirect: "error", signal: AbortSignal.timeout(60_000) });
  if (!res.ok) return { status: res.status, text: `HTTP ${res.status}` };
  const len = Number(res.headers.get("content-length") || 0);
  if (len > MAX_BYTES) return { status: 413, text: "That file is too big." };
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) return { status: 413, text: "That file is too big." };
  return { status: 200, text: new TextDecoder().decode(buf) };
}
