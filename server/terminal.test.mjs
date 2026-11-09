import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTerminals, defaultShell, workspaceName } from "./terminal.mjs";

// a stand-in for node-pty: records what it was given, echoes what's typed
function fakeSpawn(log) {
  return (file, args, opts) => {
    let onData = () => {};
    let onExit = () => {};
    const pty = {
      write: (d) => (log.push(["write", d]), onData(`echo:${d}`)),
      resize: (c, r) => log.push(["resize", c, r]),
      kill: () => (log.push(["kill"]), onExit({ exitCode: 0 })),
      onData: (f) => (onData = f),
      onExit: (f) => (onExit = f),
    };
    log.push(["spawn", file, args, opts.cwd, opts.env.TERM]);
    setTimeout(() => onData("PS> "), 0);
    return pty;
  };
}
const fakeConn = () => {
  const got = [];
  return { got, open: true, sendText: (s) => got.push(["text", s]), sendBinary: (b) => got.push(["bin", b.toString("utf8")]), close() { this.open = false; this.onclose?.(); } };
};
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "pdd-term-"));

test("shells and workspace names", () => {
  assert.equal(defaultShell("win32").file, "powershell.exe");
  assert.equal(defaultShell("darwin", {}).file, "/bin/zsh");
  assert.equal(defaultShell("linux", { SHELL: "/usr/bin/fish" }).file, "/usr/bin/fish");
  assert.equal(workspaceName("Claude's Desk"), "claude-s-desk");
  assert.equal(workspaceName("../../etc"), "etc");
  assert.equal(workspaceName(""), "main");
});

test("off until switched on; on, a shell starts in its workspace", async () => {
  const log = [];
  const data = tmp();
  const t = createTerminals({ dataDir: data, spawn: fakeSpawn(log), shell: { file: "sh", args: [] } });
  assert.throws(() => t.open({ workspace: "claude" }), /off/);
  t.setOn(true);
  const s = t.open({ workspace: "Claude" });
  assert.equal(s.folder, path.join(data, "workspaces", "claude"));
  assert.ok(fs.existsSync(s.folder));
  assert.deepEqual(log[0], ["spawn", "sh", [], s.folder, "xterm-256color"]);
  assert.deepEqual(t.workspaces(), ["claude"]);
  await new Promise((r) => setTimeout(r, 5));

  // a window attaches: it gets what was said so far, its keys and size go in, the echo comes back
  const c = fakeConn();
  t.attach(s.id, c);
  assert.deepEqual(c.got[0], ["bin", "PS> "]);
  c.onmessage(Buffer.from("ls\r"));
  c.onmessage(JSON.stringify({ type: "resize", cols: 120, rows: 40 }));
  assert.deepEqual(log.slice(1), [["write", "ls\r"], ["resize", 120, 40]]);
  assert.deepEqual(c.got.at(-1), ["bin", "echo:ls\r"]);
  assert.equal(t.list()[0].viewers, 1);

  // closing the window keeps the shell; switching the feature off ends it
  c.close();
  assert.equal(t.list()[0].viewers, 0);
  assert.equal(t.list()[0].alive, true);
  t.setOn(false);
  assert.deepEqual(t.list(), []);
  assert.deepEqual(log.at(-1), ["kill"]);
});
