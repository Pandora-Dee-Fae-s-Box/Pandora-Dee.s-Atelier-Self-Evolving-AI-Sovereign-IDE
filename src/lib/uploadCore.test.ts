// sendPieces against a stand-in desktop that keeps what arrived, like server/theater.mjs's uploadPiece.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sendPieces, type SendOpts } from "./uploadCore.ts";

const PIECE = 1000;

function desk() {
  let have = 0, size = 0, down = 0;
  const f: typeof fetch = async (input, init) => {
    const u = new URL(String(input), "http://desk");
    if (down > 0) {
      down--;
      throw new TypeError("NetworkError when attempting to fetch resource.");
    }
    size = Number(u.searchParams.get("size"));
    if (!init || init.method !== "POST") return new Response(JSON.stringify({ have }));
    const at = Number(u.searchParams.get("offset"));
    const n = (init.body as ArrayBuffer).byteLength;
    if (at === have) have += n;
    return new Response(JSON.stringify({ have, done: have >= size, path: have >= size ? "Videos/x.mp4" : null }));
  };
  return { fetch: f, get have() { return have; }, drop(n: number) { down = n; } };
}

function opts(d: ReturnType<typeof desk>, file: SendOpts["file"], extra: Partial<SendOpts> = {}): SendOpts {
  return { file, url: (o) => `/up?size=${file.size}${o === undefined ? "" : `&offset=${o}`}`, fetch: d.fetch, sha256: async () => "", alive: () => true, progress: () => {}, pause: async () => {}, piece: PIECE, ...extra };
}

const blob = (n: number, name = "v.mp4") => Object.assign(new Blob([new Uint8Array(n)]), { name });

/** a file that stops being readable after `ok` pieces, the way a phone's chosen file does */
function flaky(n: number, ok: number) {
  const b = blob(n);
  let reads = 0;
  return {
    name: "v.mp4",
    size: n,
    slice: (a: number, e: number) => (++reads > ok ? { arrayBuffer: () => Promise.reject(new DOMException("gone", "NotReadableError")) } : b.slice(a, e)),
  } as unknown as SendOpts["file"];
}

test("sends every piece and finishes", async () => {
  const d = desk();
  const end = await sendPieces(opts(d, blob(3500)));
  assert.deepEqual(end, { state: "done", path: "Videos/x.mp4" });
  assert.equal(d.have, 3500);
});

test("a dropped connection waits and carries on from what arrived", async () => {
  const d = desk();
  const notes: string[] = [];
  let n = 0;
  const end = await sendPieces(opts(d, blob(3500), { pause: async () => void (++n === 1 && d.drop(0)), progress: (_s, note) => void (note && notes.push(note)), alive: () => (n === 0 && d.have === 2000 && d.drop(3), true) }));
  assert.equal(end.state, "done");
  assert.equal(d.have, 3500);
  assert.ok(notes.length >= 1 && /Can't reach the desktop; trying again \(1\) from 57%/.test(notes[0]), notes.join(" | "));
});

test("a file the device stops letting the page read fails at once, asking for it again, not retrying 30 times", async () => {
  const d = desk();
  let pauses = 0;
  const end = await sendPieces(opts(d, flaky(3500, 2), { pause: async () => void pauses++ }));
  assert.equal(end.state, "failed");
  assert.equal(end.state === "failed" && end.reread, true);
  assert.match(end.state === "failed" ? end.error : "", /Choose it again and it carries on from 57%/);
  assert.equal(pauses, 0);
  assert.equal(d.have, 2000);
  // chosen again: it carries on from what arrived, not from the start
  const sent: number[] = [];
  const again = await sendPieces(opts(d, blob(3500), { progress: (s) => void sent.push(s) }));
  assert.equal(again.state, "done");
  assert.equal(sent[0], 2000);
  assert.equal(d.have, 3500);
});

test("damaged pieces are sent again, but not forever", async () => {
  const d = desk();
  let posts = 0;
  const bad: typeof fetch = async (input, init) => (init?.method === "POST" ? (posts++, new Response("{}", { status: 422 })) : d.fetch(input, init));
  const end = await sendPieces(opts(d, blob(3500), { fetch: bad }));
  assert.equal(end.state, "failed");
  assert.equal(posts, 6);
});

test("cancelling stops it", async () => {
  const d = desk();
  let k = 0;
  const end = await sendPieces(opts(d, blob(3500), { alive: () => ++k < 3 }));
  assert.equal(end.state, "cancelled");
  assert.ok(d.have < 3500);
});

test("a device that won't hand over pieces sends the whole file in one go instead", async () => {
  const d = desk();
  const notes: string[] = [];
  let wholeUrl = "";
  const end = await sendPieces(
    opts(d, flaky(3500, 0), {
      progress: (_s, note) => void (note && notes.push(note)),
      whole: async (url, file, progress) => ((wholeUrl = url), progress(file.size), { status: 200, json: { have: 3500, done: true, path: "Videos/w.mp4" } }),
    }),
  );
  assert.deepEqual(end, { state: "done", path: "Videos/w.mp4" });
  assert.match(wholeUrl, /&whole=1$/);
  assert.ok(notes.some((n) => /in one go.*100%/.test(n)), notes.join(" | "));
});

test("the one-go fallback failing says so, and can be tried again", async () => {
  const d = desk();
  const end = await sendPieces(opts(d, flaky(3500, 0), { whole: async () => ({ status: 0, json: {} }) }));
  assert.equal(end.state, "failed");
  assert.equal(end.state === "failed" && end.reread, undefined);
  assert.match(end.state === "failed" ? end.error : "", /dropped while it went in one go/);
});
