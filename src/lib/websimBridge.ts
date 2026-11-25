// The desk's side of a websim game's picture maker (server/inject.mjs gives games a websim.imageGen): a game asks for
// a picture, or for a change to one (Cat Club's AI Draw), and the desktop's own picture engine (Create › Imagine ›
// engines) makes it. The picture goes back to the game as a data: URL; nothing leaves the desktop except the request
// to the engine itself, which the privacy settings already govern.

import { desk } from "./store.ts";

type Ask = { prompt?: string; image_inputs?: { url?: string }[]; aspect_ratio?: string; width?: number; height?: number; transparent?: boolean };

/** A size for the picture: the asked width and height, or the aspect ratio (4:3, 16:9…) around 1024 px. */
export function sizeFor(a: Ask): [number, number] {
  if (a.width && a.height) return [Math.min(2048, a.width), Math.min(2048, a.height)];
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(String(a.aspect_ratio ?? ""));
  if (!m) return [1024, 1024];
  const r = Number(m[1]) / Number(m[2]);
  const round = (n: number) => Math.round(n / 64) * 64;
  return r >= 1 ? [1024, round(1024 / r)] : [round(1024 * r), 1024];
}

const asDataUrl = (b: Blob) =>
  new Promise<string>((ok, no) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => no(new Error("Couldn't read the picture."));
    r.readAsDataURL(b);
  });

async function imageGen(a: Ask): Promise<{ url: string; note?: string }> {
  const engine = desk().media.images.find((e) => e.enabled);
  if (!engine) throw new Error("No picture engine is set up in PDA SEASIDE yet (Create › Imagine › engines).");
  const media = await import("./media.ts");
  const [width, height] = sizeFor(a);
  const prompt = String(a.prompt ?? "").slice(0, 4000);
  if (!prompt.trim()) throw new Error("Say what to draw.");
  const source = a.image_inputs?.find((i) => i?.url)?.url;
  if (source) {
    const image = await (await fetch(source)).blob();
    const r = await media.editPicture(engine, { prompt, image, width, height, transparent: Boolean(a.transparent) }, () => undefined);
    return { url: await asDataUrl(r.picture), ...(r.note ? { note: r.note } : {}) };
  }
  const [picture] = await media.makePictures(engine, { prompt, width, height, count: 1 }, () => undefined);
  return { url: await asDataUrl(picture) };
}

/** Requests come only from frames inside this page (games and apps in their own iframes). */
const fromOwnFrame = (src: MessageEventSource | null) => [...document.querySelectorAll("iframe")].some((f) => f.contentWindow === src);

if (typeof window !== "undefined")
  window.addEventListener("message", (e) => {
    const m = e.data as { __pdd?: string; rid?: number; op?: string; opts?: Ask } | null;
    if (!m || m.__pdd !== "websim" || !fromOwnFrame(e.source)) return;
    const reply = (v: { value?: unknown; error?: string }) => (e.source as Window).postMessage({ __pdd: "websim-reply", rid: m.rid, ...v }, "*");
    if (m.op !== "imageGen") return reply({ error: "PDA SEASIDE only has websim's picture maker." });
    imageGen(m.opts ?? {}).then(
      (value) => reply({ value }),
      (err: unknown) => reply({ error: err instanceof Error ? err.message : String(err) }),
    );
  });
