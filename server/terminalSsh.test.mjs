import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import ssh2 from "ssh2";
import { ensureKey, sshShell } from "./terminalSsh.mjs";

const { Server, utils } = ssh2;

/** A real SSH server for one account, which takes only the given public key and echoes what's typed in its shell. */
function startServer(acceptedPub) {
  const hostKey = utils.generateKeyPairSync("ecdsa", { bits: 256 }).private;
  const allowed = utils.parseKey(acceptedPub);
  const srv = new Server({ hostKeys: [hostKey] }, (client) => {
    client.on("error", () => {}); // a client that walks away mid-handshake (the refused host key) is fine
    client.on("authentication", (ctx) => {
      if (ctx.method === "publickey" && ctx.username === "seaside-shell" && ctx.key.algo === allowed.type && Buffer.compare(ctx.key.data, allowed.getPublicSSH()) === 0) {
        if (!ctx.signature) return ctx.accept();
        return allowed.verify(ctx.blob, ctx.signature, ctx.hashAlgo) ? ctx.accept() : ctx.reject();
      }
      ctx.reject(["publickey"]);
    });
    client.on("ready", () =>
      client.on("session", (accept) => {
        const session = accept();
        session.on("pty", (ok) => ok?.());
        session.on("window-change", (ok) => ok?.());
        session.on("shell", (ok) => {
          const st = ok();
          st.write("hello from the separate account\r\n");
          st.on("data", (d) => st.write(`echo:${d}`));
        });
      }),
    );
  });
  return new Promise((r) => srv.listen(0, "127.0.0.1", () => r({ srv, port: srv.address().port, hostKey })));
}

const run = (opts) =>
  new Promise((resolve) => {
    let out = "";
    const sh = sshShell(opts);
    sh.onData((d) => {
      out += d;
      if (/hello from/.test(out) && !out.includes("echo:")) sh.write("ls\r");
      if (out.includes("echo:ls")) sh.kill();
    });
    sh.onExit(() => resolve(out));
  });

test("a shell under the separate account, with SEASIDE's own key and the host key pinned", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pdd-sep-"));
  const { privateKey, publicKey } = ensureKey(dir);
  assert.match(publicKey, /^ssh-ed25519 \S+ pda-seaside-terminal$/);
  assert.equal(ensureKey(dir).publicKey, publicKey); // made once
  const { srv, port } = await startServer(publicKey);
  try {
    let pinned = "";
    const out = await run({ port, user: "seaside-shell", privateKey, remember: (fp) => (pinned = fp) });
    assert.match(out, /hello from the separate account/);
    assert.match(out, /echo:ls/);
    assert.match(pinned, /^SHA256:/);
    // with the pin, it connects again
    assert.match(await run({ port, user: "seaside-shell", privateKey, pin: pinned }), /echo:ls/);
    // a different host key behind the same address is refused
    assert.match(await run({ port, user: "seaside-shell", privateKey, pin: "SHA256:somethingelse" }), /host key changed/);
    // a key the account doesn't know is turned away, with a plain explanation
    const other = utils.generateKeyPairSync("ed25519").private;
    assert.match(await run({ port, user: "seaside-shell", privateKey: other, pin: pinned }), /didn't accept SEASIDE's key/);
  } finally {
    srv.close();
  }
  void crypto;
});
