import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listFolders, netShare, parseNetView } from "./music.mjs";

test("network addresses: a computer, a share, a folder in it", () => {
  assert.deepEqual(netShare(String.raw`\\MEDIA-PC`), { host: "MEDIA-PC", share: "" });
  assert.deepEqual(netShare(String.raw`\\MEDIA-PC\Films\Films`), { host: "MEDIA-PC", share: "Films" });
  assert.deepEqual(netShare("//nas/media"), { host: "nas", share: "media" });
  assert.equal(netShare(String.raw`C:\Music`), null);
});

test("a computer's shared folders read from net view", () => {
  const out = [
    String.raw`Shared resources at \\NAS`,
    "",
    "Share name  Type  Used as  Comment",
    "-------------------------------------------------------------------------------",
    "files       Disk           Everyone's files",
    "media       Disk  M:",
    "printer     Print          The printer",
    "The command completed successfully.",
  ].join("\r\n");
  assert.deepEqual(parseNetView(out), ["files", "media"]);
});

test("another device can't make the computer reach a new network address", async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "places-")), "network-places.json");
  await assert.rejects(listFolders(String.raw`\\somewhere-new\share`, file, { newPlaces: false }), /desktop's own computer/);
  await assert.rejects(listFolders(String.raw`\\somewhere-new`, file, { newPlaces: false }), /desktop's own computer/);
});

test("a zip unpacks beside itself, and its names can't climb out", async () => {
  const { createFiles, safeZipPath } = await import("./files.mjs");
  const { zipSync, strToU8 } = await import("fflate");
  assert.equal(safeZipPath("../../evil.txt"), "evil.txt");
  assert.equal(safeZipPath("C:/Windows/x.dll"), null);
  assert.equal(safeZipPath("texts/liber-al.json"), "texts/liber-al.json");
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "unzip-"));
  const F = createFiles({ dataDir: () => data, musicFolders: () => [], getWholePc: () => false, setWholePc: () => {} });
  F.overview(true); // makes the vault
  const zip = path.join(data, "vault", "readings.zip");
  fs.writeFileSync(zip, zipSync({ "texts/liber-al.json": strToU8('{"title":"x"}'), "../escape.txt": strToU8("no"), "notes/": new Uint8Array() }));
  const r = F.unzip(zip, false);
  assert.equal(r.files, 2);
  assert.equal(fs.readFileSync(path.join(data, "vault", "readings", "texts", "liber-al.json"), "utf8"), '{"title":"x"}');
  assert.ok(fs.existsSync(path.join(data, "vault", "readings", "escape.txt")), "a name that climbs is kept inside");
  assert.ok(!fs.existsSync(path.join(data, "escape.txt")));
  assert.equal(path.basename(F.unzip(zip, false).path), "readings (2)", "a second unpack doesn't overwrite the first");
});

test("a phone reaches the network places this computer opened, and that computer's other shares, never C$", async () => {
  const { createFiles } = await import("./files.mjs");
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "pdd-netp-"));
  fs.writeFileSync(path.join(d, "network-places.json"), JSON.stringify([String.raw`\\MEDIA-PC\music`]));
  const F = createFiles({ dataDir: () => d, musicFolders: () => [], getWholePc: () => false, setWholePc: () => {} });
  const ok = (p) => {
    try {
      F.allowed(p, false);
      return true;
    } catch {
      return false;
    }
  };
  assert.equal(ok(String.raw`\\MEDIA-PC\music\Album`), true);
  assert.equal(ok(String.raw`\\MEDIA-PC\movies`), true, "another share on a computer it already goes to");
  assert.equal(ok(String.raw`\\MEDIA-PC\C$`), false, "never a hidden admin share");
  assert.equal(ok(String.raw`\\ELSEWHERE\music`), false, "a computer it hasn't opened");
});
