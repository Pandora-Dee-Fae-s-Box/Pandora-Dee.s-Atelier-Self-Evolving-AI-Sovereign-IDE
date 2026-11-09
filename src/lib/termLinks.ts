/** Addresses on this computer itself. The full browser's engine refuses these (server/engine.mjs `forbidden`), so a
 *  link to one opens in a normal new tab instead. Kept in step with the engine's rule. */
export function isLocalAddress(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return h === "localhost" || h.endsWith(".localhost") || h === "::1" || h === "0.0.0.0" || /^127\./.test(h);
}

/** The web-links addon's own address pattern (@xterm/addon-web-links 0.12.0, MIT), so both ways of finding a link
 *  agree on where one starts and ends. */
const URL_RE = /(https?|HTTPS?):[/]{2}[^\s"'!*(){}|\\^<>`]*[^\s"':,.!?{}|\\^~\[\]`()<>]/g;

/** The web address in `text` that covers character `at`, if any. */
export function urlAt(text: string, at: number): string | undefined {
  for (const m of text.matchAll(URL_RE)) {
    const start = m.index ?? 0;
    if (at < start) break;
    if (at >= start + m[0].length) continue;
    try {
      new URL(m[0]);
      return m[0];
    } catch {
      return undefined;
    }
  }
  return undefined;
}
