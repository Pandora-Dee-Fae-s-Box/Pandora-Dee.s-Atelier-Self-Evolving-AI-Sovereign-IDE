// Real terminals: a shell on this computer (PowerShell on Windows, your own shell on a Mac or Linux) in a pseudo-
// terminal, shown in the Terminal window. Each starts in a workspace folder of its own (data/workspaces/<name>), so
// a resident like Claude Code has a desk to work at. Off until switched on (Privacy → A real terminal), and only
// from this computer or the tailnet; sessions outlive the window, so closing it doesn't kill what's running.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

const KEEP = 256 * 1024; // scrollback kept for a window that reattaches

export function defaultShell(platform = process.platform, env = process.env) {
  if (platform === "win32") return { file: "powershell.exe", args: ["-NoLogo"] };
  return { file: env.SHELL || (platform === "darwin" ? "/bin/zsh" : "/bin/bash"), args: ["-l"] };
}

/** A workspace's folder name: letters, digits, - and _, nothing that climbs out. */
export function workspaceName(name) {
  const n = String(name || "main").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return n || "main";
}

/** separate(opts): a shell under the separate account (terminalSsh.mjs's sshShell, with SEASIDE's key filled in). */
export function createTerminals({ dataDir, spawn, shell = defaultShell(), separate = null, keyFor = null }) {
  const dir = () => path.join(typeof dataDir === "function" ? dataDir() : dataDir, "workspaces");
  const settingsFile = () => path.join(typeof dataDir === "function" ? dataDir() : dataDir, "terminal.json");
  const sessions = new Map();

  const settings = () => {
    try {
      return { on: false, ...JSON.parse(fs.readFileSync(settingsFile(), "utf8")) };
    } catch {
      return { on: false };
    }
  };
  const setOn = (on) => {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify({ ...settings(), on: Boolean(on) }, null, 1));
    if (!on) for (const id of [...sessions.keys()]) close(id);
    return settings();
  };

  /** The separate account shells can run as (over SSH to this computer): who, which port, the pinned host key. */
  const setSeparate = ({ user, port }) => {
    const u = String(user || "").trim();
    if (u && !/^[A-Za-z0-9._-]{1,64}$/.test(u)) throw Object.assign(new Error("That doesn't look like an account name."), { status: 400 });
    const prev = settings().separate ?? {};
    const next = u ? { user: u, port: Math.max(1, Math.min(65535, Number(port) || 22)), hostKey: prev.user === u ? prev.hostKey : undefined } : undefined;
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify({ ...settings(), separate: next }, null, 1));
    return settings();
  };
  const forgetHostKey = () => {
    const sep = settings().separate;
    if (sep) fs.writeFileSync(settingsFile(), JSON.stringify({ ...settings(), separate: { ...sep, hostKey: undefined } }, null, 1));
    return settings();
  };

  const info = (s) => ({ id: s.id, workspace: s.workspace, folder: s.folder, title: s.title, started: s.started, alive: s.alive, viewers: s.clients.size });

  function open({ workspace, cols = 100, rows = 30, as = "you" } = {}) {
    if (!settings().on) throw Object.assign(new Error("The real terminal is off (Settings → Privacy)."), { status: 403 });
    if (as === "separate") return openSeparate({ cols, rows });
    const name = workspaceName(workspace);
    const folder = path.join(dir(), name);
    fs.mkdirSync(folder, { recursive: true });
    const id = crypto.randomBytes(9).toString("base64url");
    const pty = spawn(shell.file, shell.args, {
      name: "xterm-256color",
      cols: Math.max(20, Math.min(400, cols | 0 || 100)),
      rows: Math.max(5, Math.min(200, rows | 0 || 30)),
      cwd: folder,
      env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor", PDA_SEASIDE_WORKSPACE: folder },
    });
    return track(id, pty, { workspace: name, folder, title: `${name} · ${path.basename(shell.file)}` });
  }

  function track(id, pty, { workspace, folder, title }) {
    const s = { id, workspace, folder, title, started: Date.now(), alive: true, pty, clients: new Set(), kept: "" };
    pty.onData((d) => {
      s.kept = (s.kept + d).slice(-KEEP);
      for (const c of s.clients) c.sendBinary(Buffer.from(d, "utf8"));
    });
    pty.onExit(({ exitCode }) => {
      s.alive = false;
      for (const c of s.clients) c.sendText(JSON.stringify({ type: "exit", code: exitCode }));
    });
    sessions.set(id, s);
    return info(s);
  }

  /** A shell under the separate account: it can't unseal the characters' vaults. */
  function openSeparate({ cols, rows }) {
    const sep = settings().separate;
    if (!sep?.user || !separate) throw Object.assign(new Error("Set up the separate account first (Terminal → Separate account)."), { status: 400 });
    const id = crypto.randomBytes(9).toString("base64url");
    const pty = separate({
      user: sep.user,
      port: sep.port,
      pin: sep.hostKey,
      remember: (fp) => fs.writeFileSync(settingsFile(), JSON.stringify({ ...settings(), separate: { ...settings().separate, hostKey: fp } }, null, 1)),
      cols: Math.max(20, Math.min(400, cols | 0 || 100)),
      rows: Math.max(5, Math.min(200, rows | 0 || 30)),
    });
    return track(id, pty, { workspace: "separate", folder: `${sep.user}'s home (separate account)`, title: `${sep.user} · separate account` });
  }

  function close(id) {
    const s = sessions.get(id);
    if (!s) return false;
    try {
      if (s.alive) s.pty.kill();
    } catch {
      /* already gone */
    }
    for (const c of s.clients) c.close();
    sessions.delete(id);
    return true;
  }

  /** A window watching one session: what's been said so far, then everything new; its keys and size go in. */
  function attach(id, conn) {
    const s = sessions.get(id);
    if (!s || !settings().on) return void conn.close();
    s.clients.add(conn);
    if (s.kept) conn.sendBinary(Buffer.from(s.kept, "utf8"));
    if (!s.alive) conn.sendText(JSON.stringify({ type: "exit" }));
    conn.onmessage = (data) => {
      if (!s.alive) return;
      // keys as binary (wsduplex hands binary over as a Buffer), sizes and the rest as JSON text
      if (Buffer.isBuffer(data)) return void s.pty.write(data.toString("utf8"));
      let m;
      try {
        m = JSON.parse(String(data));
      } catch {
        return;
      }
      if (m.type === "input" && typeof m.data === "string") s.pty.write(m.data);
      else if (m.type === "resize") s.pty.resize(Math.max(20, Math.min(400, m.cols | 0)), Math.max(5, Math.min(200, m.rows | 0)));
    };
    conn.onclose = () => s.clients.delete(conn);
  }

  return {
    settings: () => {
      const st = settings();
      // the separate account's public key, for its authorized_keys (made the first time it's asked for)
      return { ...st, separatePublicKey: st.separate && keyFor ? keyFor() : undefined };
    },
    setOn,
    setSeparate,
    forgetHostKey,
    open,
    close,
    attach,
    list: () => [...sessions.values()].map(info),
    workspaces: () => {
      try {
        return fs.readdirSync(dir(), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
      } catch {
        return [];
      }
    },
    stopAll: () => [...sessions.keys()].forEach(close),
    home: os.homedir(),
  };
}
