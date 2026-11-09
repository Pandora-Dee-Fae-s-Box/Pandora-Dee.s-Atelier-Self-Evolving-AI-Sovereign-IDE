// A real terminal under a separate account: an SSH login to this computer as another (low-privilege) user, shaped like
// a local shell so server/terminal.mjs treats it the same. That account can't unseal any character's vault (the vault's
// master key is guarded for the desktop's own account: DPAPI, the login Keychain, or an owner-only file), so shells
// started this way are kept apart from the characters' keys.
//
// SEASIDE makes its own key pair for the login (data/terminal/separate_ed25519); the person adds the public half to the
// separate account once. This computer's host key is pinned on first use and must match after that.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import ssh2 from "ssh2";

const { Client, utils } = ssh2;

/** SEASIDE's own key pair for the separate account's login, made once. Returns the public half (OpenSSH format). */
export function ensureKey(dir) {
  const priv = path.join(dir, "separate_ed25519");
  const pub = `${priv}.pub`;
  if (!fs.existsSync(priv) || !fs.existsSync(pub)) {
    fs.mkdirSync(dir, { recursive: true });
    const k = utils.generateKeyPairSync("ed25519", { comment: "pda-seaside-terminal" });
    fs.writeFileSync(priv, k.private, { mode: 0o600 });
    fs.writeFileSync(pub, `${k.public}\n`);
  }
  return { privateKey: fs.readFileSync(priv, "utf8"), publicKey: fs.readFileSync(pub, "utf8").trim() };
}

const fingerprintOf = (key) => `SHA256:${crypto.createHash("sha256").update(key).digest("base64").replace(/=+$/, "")}`;

/**
 * A pty-like shell over SSH: { onData, onExit, write, resize, kill }, usable at once (what's typed before the login
 * finishes waits for it). `pin` holds the host key's fingerprint; `remember(fp)` is called on first use.
 */
export function sshShell({ host = "127.0.0.1", port = 22, user, privateKey, pin, remember, cols = 100, rows = 30, connectImpl }) {
  let onData = () => {};
  let onExit = () => {};
  let stream = null;
  let ended = false;
  const waiting = [];
  const conn = connectImpl ? connectImpl() : new Client();
  const say = (t) => onData(`\r\n\x1b[2m${t}\x1b[0m\r\n`);
  const end = (code) => {
    if (ended) return;
    ended = true;
    onExit({ exitCode: code });
    try {
      conn.end();
    } catch {
      /* already closed */
    }
  };
  conn.on("ready", () => {
    conn.shell({ term: "xterm-256color", cols, rows }, (err, s) => {
      if (err) return say(`The separate account's shell wouldn't open: ${err.message}`), end(1);
      stream = s;
      s.on("data", (d) => onData(d.toString("utf8")));
      s.stderr?.on("data", (d) => onData(d.toString("utf8")));
      s.on("close", () => end(0));
      for (const w of waiting.splice(0)) s.write(w);
    });
  });
  conn.on("error", (e) => {
    say(
      e.level === "client-authentication"
        ? `The separate account "${user}" didn't accept SEASIDE's key. Add the public key shown in Terminal → Separate account to its authorized_keys.`
        : `Couldn't reach the separate account over SSH on port ${port}: ${e.message}. Is the SSH server running on this computer?`,
    );
    end(1);
  });
  conn.on("close", () => end(0));
  conn.connect({
    host,
    port,
    username: user,
    privateKey,
    readyTimeout: 8000,
    hostVerifier: (key) => {
      const fp = fingerprintOf(key);
      if (!pin) return remember?.(fp), true;
      if (fp === pin) return true;
      say(`This computer's SSH host key changed (expected ${pin}, got ${fp}). Nothing was connected. If its SSH server was reinstalled, forget the old key in Terminal → Separate account.`);
      return false;
    },
  });
  return {
    onData: (f) => void (onData = f),
    onExit: (f) => void (onExit = f),
    write: (d) => (stream ? stream.write(d) : waiting.push(d)),
    resize: (c, r) => stream?.setWindow(r, c, 0, 0),
    kill: () => {
      try {
        stream?.close();
      } catch {
        /* gone */
      }
      end(0);
    },
  };
}
