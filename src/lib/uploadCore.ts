// Sending a big file to the desktop in pieces, carrying on after a dropped connection. No React or DOM here, so it
// can be tested with a stand-in server (uploadCore.test.ts); the Theatre's backups use it (theater.ts).

export const PIECE = 8 * 1024 * 1024;

/** How one send ended. `reread`: the device stopped letting the page read the file, so it has to be chosen again. */
export type SendEnd = { state: "done"; path?: string } | { state: "failed"; error: string; reread?: boolean } | { state: "cancelled" };

export type SendOpts = {
  file: Blob & { name: string; size: number };
  /** the upload's address on the desktop, without the offset */
  url: (offset?: number) => string;
  fetch: typeof fetch;
  sha256: (b: ArrayBuffer) => Promise<string>;
  /** false once cancelled */
  alive: () => boolean;
  /** what arrived so far, and a note while it's waiting to try again */
  progress: (sent: number, note?: string) => void;
  /** the wait between tries; it may end early when the connection comes back */
  pause: (ms: number) => Promise<void>;
  /** the whole file in one request, for a device that won't let the page read it in pieces (see wholeUpload) */
  whole?: (url: string, file: Blob, progress: (sent: number) => void) => Promise<{ status: number; json: { have?: number; done?: boolean; path?: string; error?: string } }>;
  piece?: number;
  maxTries?: number;
};

const pct = (at: number, size: number) => Math.floor((at / size) * 100);

export async function sendPieces(o: SendOpts): Promise<SendEnd> {
  const f = o.file, piece = o.piece ?? PIECE, maxTries = o.maxTries ?? 30;
  let tries = 0, damaged = 0, at = 0;
  for (;;) {
    if (!o.alive()) return { state: "cancelled" };
    try {
      const st = (await o.fetch(o.url()).then((r) => r.json())) as { have: number };
      at = st.have;
      o.progress(at);
      while (at < f.size) {
        if (!o.alive()) return { state: "cancelled" };
        let bytes: ArrayBuffer;
        try {
          bytes = await f.slice(at, Math.min(f.size, at + piece)).arrayBuffer();
        } catch {
          // Not the network: some phones won't let a page read a chosen file in pieces (or stop after a while in the
          // background), and every try after that fails the same way. Sending the whole file in one request still
          // works on those (it's how the Explorer uploads); it starts over, so it's the fallback, not the way.
          if (o.whole) {
            const note = "This device won't hand the video over in pieces, so it's going in one go (it starts over).";
            o.progress(0, note);
            try {
              const r = await o.whole(`${o.url()}&whole=1`, f, (n) => o.progress(n, `${note} ${pct(n, f.size)}%`));
              if (r.status >= 200 && r.status < 300 && r.json.done) return { state: "done", path: r.json.path };
              return { state: "failed", error: r.json.error || (r.status ? `The desktop answered ${r.status}.` : "The connection dropped while it went in one go. Try again.") };
            } catch (e) {
              return { state: "failed", error: (e as Error).message || "The connection dropped while it went in one go. Try again." };
            }
          }
          return { state: "failed", reread: true, error: `This device stopped letting the page read the video. Choose it again and it carries on from ${pct(at, f.size)}%.` };
        }
        const sum = await o.sha256(bytes);
        const r = await o.fetch(o.url(at), { method: "POST", headers: sum ? { "X-Sha256": sum } : {}, body: bytes });
        const res = (await r.json().catch(() => ({}))) as { have?: number; done?: boolean; path?: string; error?: string };
        if (r.status === 422) {
          // damaged on the way: the same piece again, but not forever
          if (++damaged > 5) return { state: "failed", error: "Pieces keep arriving damaged. Try again on a steadier connection." };
          continue;
        }
        if (!r.ok) {
          if (r.status < 500) return { state: "failed", error: res.error || `The desktop answered ${r.status}.` };
          throw new Error(res.error || `The desktop answered ${r.status}.`);
        }
        at = res.have ?? at;
        tries = damaged = 0;
        o.progress(at);
        if (res.done) return { state: "done", path: res.path };
      }
      return { state: "done" };
    } catch (e) {
      if (++tries > maxTries) return { state: "failed", error: (e as Error).message || "It stopped." };
      // Wi-Fi dropped or the desktop restarted: wait, then carry on from what arrived
      o.progress(at, `Can't reach the desktop; trying again (${tries}) from ${pct(at, f.size)}%…`);
      await o.pause(Math.min(20_000, 2000 * tries));
    }
  }
}

/** One request with the whole file, reporting how much has gone (fetch can't tell; XMLHttpRequest can). */
export function wholeUpload(url: string, file: Blob, progress: (sent: number) => void, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; json: { have?: number; done?: boolean; path?: string; error?: string } }>((ok) => {
    const x = new XMLHttpRequest();
    x.open("POST", url);
    for (const [k, v] of Object.entries(headers)) x.setRequestHeader(k, v);
    x.upload.onprogress = (e) => progress(e.loaded);
    const end = () => {
      let json = {};
      try {
        json = JSON.parse(x.responseText || "{}");
      } catch {
        /* not JSON */
      }
      ok({ status: x.status, json });
    };
    x.onload = end;
    x.onerror = end;
    x.onabort = end;
    x.send(file);
  });
}
