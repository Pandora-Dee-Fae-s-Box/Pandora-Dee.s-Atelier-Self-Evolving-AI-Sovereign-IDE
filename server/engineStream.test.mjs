import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createEngineStream } from "./engineStream.mjs";

const song = Buffer.from("RIFF" + "x".repeat(996));

function listen(handler) {
  const s = http.createServer(handler);
  return new Promise((ok) => s.listen(0, "127.0.0.1", () => ok({ s, url: `http://127.0.0.1:${s.address().port}` })));
}

test("a song plays through its link, with ranges and the engine's key passed on", async () => {
  let auth = "";
  const engine = await listen((req, res) => {
    auth = req.headers.authorization ?? "";
    const m = /bytes=(\d+)-(\d+)/.exec(req.headers.range ?? "");
    if (m) {
      const [a, b] = [Number(m[1]), Number(m[2])];
      res.writeHead(206, { "Content-Type": "audio/wav", "Content-Range": `bytes ${a}-${b}/${song.length}`, "Accept-Ranges": "bytes", "Content-Length": b - a + 1 });
      return res.end(song.subarray(a, b + 1));
    }
    res.writeHead(200, { "Content-Type": "audio/wav", "Accept-Ranges": "bytes", "Content-Length": song.length });
    res.end(song);
  });
  const E = createEngineStream();
  const id = E.link({ url: `${engine.url}/v1/songs/A.wav`, headers: { Authorization: "Bearer k" } });
  assert.equal(E.link({ url: `${engine.url}/v1/songs/A.wav` }), id, "the same song keeps its link");
  const desk = await listen((req, res) => void E.serve(req, res, id));
  try {
    const part = await fetch(desk.url, { headers: { Range: "bytes=0-3" } });
    assert.equal(part.status, 206);
    assert.equal(part.headers.get("content-range"), `bytes 0-3/${song.length}`);
    assert.equal(await part.text(), "RIFF");
    assert.equal(auth, "Bearer k", "the key goes to the engine, never in the link");
    const whole = await fetch(desk.url);
    assert.equal(whole.headers.get("accept-ranges"), "bytes");
    assert.equal((await whole.arrayBuffer()).byteLength, song.length);
  } finally {
    engine.s.close();
    desk.s.close();
  }
});

test("an unknown or expired link says so", async () => {
  let t = 0;
  const E = createEngineStream({ now: () => t, ttl: 1000 });
  const old = E.link({ url: "http://127.0.0.1:1/a.wav" });
  t = 5000;
  E.link({ url: "http://127.0.0.1:1/b.wav" }); // (old links are cleared as new ones are made)
  const desk = await listen((req, res) => void E.serve(req, res, old));
  try {
    const r = await fetch(desk.url);
    assert.equal(r.status, 404);
  } finally {
    desk.s.close();
  }
});

test("only web addresses", () => {
  assert.throws(() => createEngineStream().link({ url: "file:///etc/passwd" }), /Only http/);
});
