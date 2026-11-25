import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createSongFetch } from "./songFetch.mjs";

const until = async (f) => {
  for (let i = 0; i < 200; i++) {
    const v = f();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("timed out");
};

function engine(handler) {
  const s = http.createServer(handler);
  return new Promise((ok) => s.listen(0, "127.0.0.1", () => ok({ s, url: `http://127.0.0.1:${s.address().port}` })));
}

test("a song is fetched straight into the music folder, named by its title and type", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "songfetch-"));
  const bytes = Buffer.alloc(300_000, 7);
  const { s, url } = await engine((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      assert.equal(req.method, "POST");
      assert.equal(JSON.parse(body).prompt, "lo-fi");
      res.writeHead(200, { "Content-Type": "audio/wav", "Content-Length": bytes.length });
      res.end(bytes);
    });
  });
  try {
    const F = createSongFetch({ dir: () => dir });
    fs.writeFileSync(path.join(dir, "Rain.wav"), "older");
    const id = F.start({ url: `${url}/v1/audio/music-generations`, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: "lo-fi" }), title: "Rain" });
    const st = await until(() => (F.status(id).state === "done" || F.status(id).state === "error" ? F.status(id) : null));
    assert.equal(st.error, "");
    assert.equal(st.name, "Rain 2.wav", "the older one keeps its name");
    assert.equal(st.got, bytes.length);
    assert.equal(st.total, bytes.length);
    assert.equal(fs.statSync(path.join(dir, "Rain 2.wav")).size, bytes.length);
    assert.ok(!fs.readdirSync(dir).some((n) => n.endsWith(".part")));
  } finally {
    s.close();
  }
});

test("an engine's error comes back as the job's error, and no file is left", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "songfetch-"));
  const { s, url } = await engine((req, res) => (res.writeHead(500, { "Content-Type": "text/plain" }), res.end("out of memory")));
  try {
    const F = createSongFetch({ dir: () => dir });
    const id = F.start({ url, title: "X" });
    const st = await until(() => (F.status(id).state === "error" ? F.status(id) : null));
    assert.match(st.error, /500: out of memory/);
    assert.deepEqual(fs.readdirSync(dir), []);
  } finally {
    s.close();
  }
});

test("a JSON answer with the song in base64 is kept as a WAV", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "songfetch-"));
  const { s, url } = await engine((req, res) => (res.writeHead(200, { "Content-Type": "application/json" }), res.end(JSON.stringify({ data: [{ b64_json: Buffer.from("RIFFsong").toString("base64") }] }))));
  try {
    const F = createSongFetch({ dir: () => dir });
    const id = F.start({ url, title: "B" });
    const st = await until(() => (F.status(id).state === "done" ? F.status(id) : null));
    assert.equal(fs.readFileSync(path.join(dir, st.name), "utf8"), "RIFFsong");
  } finally {
    s.close();
  }
});

test("only web addresses", () => {
  const F = createSongFetch({ dir: () => os.tmpdir() });
  assert.throws(() => F.start({ url: "file:///etc/passwd" }), /Only http/);
});
