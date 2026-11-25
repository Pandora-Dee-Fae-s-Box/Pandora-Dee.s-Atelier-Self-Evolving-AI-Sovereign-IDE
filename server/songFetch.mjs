// Songs fetched by the desktop's own server, straight from the song engine into the music library: one hop (engine →
// server → file), not engine → server → page → server, so it's no slower when the page is on a phone or across the
// tailnet, and nothing big sits in the page's memory. It also works for an engine that answers the making request
// itself with the song (mlx-serve): then the server holds the wait, and a closed or reloaded page doesn't lose it.
// The page asks how it's going (bytes so far, of how many, how fast). (songFetch.test.mjs)

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { httpRequest } from "./httpGet.mjs";

const EXT = (type) => (/mpeg|mp3/i.test(type) ? "mp3" : /flac/i.test(type) ? "flac" : /ogg/i.test(type) ? "ogg" : /aac|mp4|m4a/i.test(type) ? "m4a" : "wav");

/** dir(): the music library's own folder; now(): the clock (tests). */
export function createSongFetch({ dir, now = Date.now, fetchFn = httpRequest }) {
  const jobs = new Map();

  /** A free name in the folder for this title and extension ("Song.wav", then "Song 2.wav"…). */
  function freePath(title, ext) {
    const folder = dir();
    fs.mkdirSync(folder, { recursive: true });
    const base = path.basename(String(title || "Untitled")).replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 80) || "Untitled";
    let target = path.join(folder, `${base}.${ext}`);
    for (let i = 2; fs.existsSync(target); i++) target = path.join(folder, `${base} ${i}.${ext}`);
    return target;
  }

  /** job: { url, method, headers, body (text), title, timeout (s) } → id. */
  function start(job) {
    let url;
    try {
      url = new URL(String(job.url));
    } catch {
      throw Object.assign(new Error("That isn't a web address."), { status: 400 });
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") throw Object.assign(new Error("Only http:// and https:// addresses."), { status: 400 });
    const id = randomUUID();
    const st = { id, state: "waiting", got: 0, total: 0, started: now(), firstByte: 0, finished: 0, name: "", error: "", ctl: new AbortController() };
    jobs.set(id, st);
    for (const [k, v] of jobs) if (v.finished && now() - v.finished > 3600_000) jobs.delete(k);
    const timer = setTimeout(() => st.ctl.abort(), Math.min(3600, Math.max(10, Number(job.timeout) || 3600)) * 1000);
    void (async () => {
      let part = "";
      try {
        const method = String(job.method || "GET").toUpperCase();
        const headers = Object.fromEntries(Object.entries(job.headers || {}).filter(([, v]) => typeof v === "string"));
        const r = await fetchFn(url, { method, headers: job.body && method !== "GET" ? { ...headers, "Content-Length": String(Buffer.byteLength(String(job.body))) } : headers, body: method === "GET" ? undefined : job.body, signal: st.ctl.signal });
        if (!r.ok) throw new Error(`The engine answered ${r.status}: ${(await r.text().catch(() => "")).replace(/<[^>]+>/g, " ").trim().slice(0, 300)}`);
        const type = r.headers.get("content-type") || "";
        st.firstByte = now();
        st.total = Number(r.headers.get("content-length")) || 0;
        st.state = "fetching";
        if (/json/i.test(type)) {
          // an OpenAI-style answer: the song in base64
          const j = await r.json();
          const b64 = j?.data?.[0]?.b64_json || j?.audio;
          if (!b64) throw new Error("The engine answered without a song.");
          const bytes = Buffer.from(String(b64).replace(/^data:[^,]+,/, ""), "base64");
          st.got = st.total = bytes.length;
          const target = freePath(job.title, "wav");
          fs.writeFileSync(target, bytes);
          st.name = path.basename(target);
        } else {
          const target = freePath(job.title, EXT(type));
          part = `${target}.part`;
          const out = fs.createWriteStream(part);
          for await (const value of r.body) {
            st.got += value.length;
            if (!out.write(value)) await new Promise((ok) => out.once("drain", ok));
          }
          if (st.total && st.got < st.total) throw new Error(`The engine stopped sending part-way (${st.got} of ${st.total} bytes).`);
          await new Promise((ok, no) => out.end((e) => (e ? no(e) : ok())));
          fs.renameSync(part, target);
          part = "";
          st.name = path.basename(target);
        }
        st.state = "done";
      } catch (e) {
        st.state = "error";
        st.error = st.ctl.signal.aborted ? "Stopped, or it took too long." : e?.cause?.code ? `Couldn't reach the engine (${e.cause.code}).` : e instanceof Error ? e.message : String(e);
        if (part) setTimeout(() => fs.rmSync(part, { force: true }), 200);
      } finally {
        clearTimeout(timer);
        st.finished = now();
      }
    })();
    return id;
  }

  /** How a fetch is going: state, bytes so far and of how many, seconds waiting for the engine, and the speed. */
  function status(id) {
    const st = jobs.get(id);
    if (!st) return null;
    const t = st.finished || now();
    const moving = st.firstByte ? Math.max(0.001, (t - st.firstByte) / 1000) : 0;
    return {
      id,
      state: st.state,
      got: st.got,
      total: st.total,
      waited: Math.round(((st.firstByte || t) - st.started) / 1000),
      bytesPerSecond: moving ? Math.round(st.got / moving) : 0,
      name: st.name,
      error: st.error,
    };
  }

  function stop(id) {
    jobs.get(id)?.ctl.abort();
  }

  return { start, status, stop };
}
