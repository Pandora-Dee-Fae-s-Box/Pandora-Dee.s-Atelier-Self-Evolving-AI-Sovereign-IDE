import test from "node:test";
import assert from "node:assert/strict";
import { parseYouTube, youTubeInfo, youTubeThumb } from "./youtube.mjs";

test("every kind of YouTube link gives its video, and where to start", () => {
  const id = "dQw4w9WgXcQ";
  for (const s of [
    `https://www.youtube.com/watch?v=${id}`,
    `youtube.com/watch?v=${id}&list=PL123`,
    `https://youtu.be/${id}`,
    `https://m.youtube.com/watch?v=${id}`,
    `https://music.youtube.com/watch?v=${id}`,
    `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube.com/live/${id}?si=abc`,
    `https://www.youtube-nocookie.com/embed/${id}`,
    id,
  ])
    assert.deepEqual(parseYouTube(s), { yt: id, start: 0 }, s);
  assert.equal(parseYouTube(`https://youtu.be/${id}?t=90`).start, 90);
  assert.equal(parseYouTube(`https://www.youtube.com/watch?v=${id}&t=1m30s`).start, 90);
  assert.equal(parseYouTube(`https://www.youtube.com/watch?v=${id}&t=1h2m3s`).start, 3723);
});

test("anything else isn't one", () => {
  for (const s of ["", "hello", "https://vimeo.com/123", "https://www.youtube.com/watch?v=short", "https://www.youtube.com/channel/UC123", "https://evil.example/watch?v=dQw4w9WgXcQ", "javascript:alert(1)"])
    assert.equal(parseYouTube(s), null, s);
});

test("title and thumbnail are asked once; a silent YouTube leaves the link as it is", async () => {
  const ok = async (u) => (/oembed/.test(u) ? { ok: true, json: async () => ({ title: "A song", author_name: "A channel" }) } : { ok: true, arrayBuffer: async () => new Uint8Array([0xff, 0xd8, 1, 2]).buffer });
  assert.deepEqual(await youTubeInfo("dQw4w9WgXcQ", ok), { title: "A song", author: "A channel" });
  assert.deepEqual([...(await youTubeThumb("dQw4w9WgXcQ", ok))], [0xff, 0xd8, 1, 2]);
  const down = async () => {
    throw new Error("offline");
  };
  assert.deepEqual(await youTubeInfo("dQw4w9WgXcQ", down), {});
  assert.equal(await youTubeThumb("dQw4w9WgXcQ", down), null);
});
