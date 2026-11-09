import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { openPrivacyAt, Sensitive } from "../ui/common.tsx";
import { isLocalAddress } from "../lib/termLinks.ts";
import { wireTermLinks } from "../lib/termLinksWire.ts";
import { openInFullBrowser } from "./FullBrowser.tsx";
import { termClose, termForgetHostKey, termOpen, termSeparate, termSocketUrl, termState, useTerminalAllowed, type TermSession, type TermState } from "../lib/terminal.ts";
import { Seg } from "../ui/common.tsx";
import { copyText } from "../lib/clipboard.ts";

/** A real shell on the computer running the desktop, in a workspace folder of its own (server/terminal.mjs). */
export function RealTerminal() {
  const allowedHere = useTerminalAllowed();
  const [sessions, setSessions] = useState<TermSession[]>([]);
  const [workspaces, setWorkspaces] = useState<string[]>([]);
  const [current, setCurrent] = useState<string>(() => sessionStorage.getItem("pdd-term") || "");
  const [space, setSpace] = useState("main");
  const [note, setNote] = useState("");
  const [serverOn, setServerOn] = useState(false);
  // shells as you, or as a separate account that can't open the characters' vaults (server/terminalSsh.mjs)
  const [as, setAs] = useState<"you" | "separate">(() => (localStorage.getItem("pdd-term-as") === "separate" ? "separate" : "you"));
  const [sep, setSep] = useState<Pick<TermState, "separate" | "separatePublicKey" | "here">>({});
  const [setup, setSetup] = useState(false);
  useEffect(() => {
    try {
      localStorage.setItem("pdd-term-as", as);
    } catch {
      /* kept for this visit only */
    }
  }, [as]);

  const refresh = async () => {
    try {
      const s = await termState();
      setServerOn(s.on);
      setSessions(s.sessions);
      setWorkspaces(s.workspaces);
      setSep({ separate: s.separate, separatePublicKey: s.separatePublicKey, here: s.here });
      // against the terminal shown now (this runs from a timer, so a remembered `current` would be an old one)
      setCurrent((c) => (c && !s.sessions.some((x) => x.id === c) ? "" : c));
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => {
    void refresh();
    const t = window.setInterval(() => void refresh(), 4000);
    return () => window.clearInterval(t);
  }, [allowedHere]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => sessionStorage.setItem("pdd-term", current), [current]);

  const start = async () => {
    setNote("");
    try {
      if (as === "separate" && !sep.separate?.user) return setSetup(true);
      const s = await termOpen(space, 100, 30, as);
      setCurrent(s.id);
      void refresh();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    }
  };

  if (!allowedHere)
    return (
      <div className="pad">
        <h3>
          A real terminal <Sensitive feature="terminal" />
        </h3>
        <p className="small muted">
          A real shell on the computer running the desktop (PowerShell on Windows, your own shell on a Mac or Linux), each in a workspace folder of its own: a desk for building things, and for
          residents like Claude Code. It's off until you turn it on in Privacy, after reading what it allows.
        </p>
        <button className="btn primary small" onClick={() => openPrivacyAt("terminal")}>
          Open Privacy
        </button>
      </div>
    );

  return (
    <div className="real-term">
      <div className="row real-term-bar">
        {sessions.map((s) => (
          <button key={s.id} className={`btn small${s.id === current ? " primary" : ""}`} onClick={() => setCurrent(s.id)} title={s.folder}>
            {s.title}
            {s.alive ? "" : " (ended)"}
          </button>
        ))}
        <span className="grow" />
        <span title="Run new shells as you, or as a separate account that can't open the characters' vaults (their keys)">
          <Seg value={as} onChange={setAs} options={[{ id: "you", label: "As you" }, { id: "separate", label: "Separate account" }]} />
        </span>
        {as === "separate" ? (
          <button className="btn small" onClick={() => setSetup((v) => !v)} title="Which account, and SEASIDE's key for it">
            {sep.separate?.user ? `${sep.separate.user} ⚙` : "Set up…"}
          </button>
        ) : null}
        <input className="input small" style={{ width: 130, display: as === "separate" ? "none" : undefined }} list="pdd-workspaces" value={space} onChange={(e) => setSpace(e.target.value)} aria-label="Workspace" title="Workspace folder" />
        <datalist id="pdd-workspaces">
          {workspaces.map((w) => (
            <option key={w} value={w} />
          ))}
        </datalist>
        <button className="btn small" onClick={() => void start()} disabled={!serverOn}>
          New terminal
        </button>
        {current ? (
          <button className="btn small" onClick={() => void termClose(current).then(() => (setCurrent(""), refresh()))} title="End this shell">
            End
          </button>
        ) : null}
      </div>
      {!serverOn ? (
        <div className="note warn small">The desktop's server hasn't switched the terminal on. Switching it on works from the desktop's own computer: open SEASIDE there once with Privacy allowing it.</div>
      ) : null}
      {note ? <div className="note small">{note}</div> : null}
      {as === "separate" && setup ? <SeparateSetup state={sep} onDone={() => (setSetup(false), void refresh())} /> : null}
      {current ? <TermView key={current} id={current} /> : <div className="pad small muted">{sessions.length ? "Pick a terminal above, or start a new one." : "No terminals yet: pick a workspace and press New terminal."}</div>}
    </div>
  );
}

function TermView({ id }: { id: string }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const css = getComputedStyle(document.documentElement);
    // web addresses the shell prints are links: they open in SEASIDE's own Browser window, except this computer's own
    // addresses, which its engine refuses, so those open in a normal new tab
    const openLink = (e: MouseEvent, uri: string) => {
      e.preventDefault();
      const tab = () => void window.open(uri, "_blank", "noopener");
      if (isLocalAddress(uri)) tab();
      else void openInFullBrowser(uri).catch(tab);
    };
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "ui-monospace, SFMono-Regular, Consolas, 'Cascadia Mono', monospace",
      fontSize: 13,
      scrollback: 5000,
      theme: { background: "#0b0912", foreground: css.getPropertyValue("--text").trim() || "#eee", cursor: css.getPropertyValue("--accent").trim() || "#c9a6ff" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    // plain addresses and hidden (OSC 8) links; Ctrl+click opens one even while a program has the mouse
    const unlink = wireTermLinks(term, openLink);
    const ws = new WebSocket(termSocketUrl(id));
    ws.binaryType = "arraybuffer";
    const size = () => {
      try {
        fit.fit();
      } catch {
        /* not laid out yet */
      }
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
    };
    ws.onopen = () => (size(), term.focus());
    ws.onmessage = (e) => {
      if (typeof e.data === "string") {
        try {
          const m = JSON.parse(e.data) as { type?: string; code?: number };
          if (m.type === "exit") term.write(`\r\n\x1b[2m[The shell ended${m.code !== undefined ? ` (${m.code})` : ""}.]\x1b[0m\r\n`);
        } catch {
          /* not ours */
        }
      } else term.write(new Uint8Array(e.data as ArrayBuffer));
    };
    ws.onclose = () => term.write("\r\n\x1b[2m[Disconnected. The shell keeps running; open it again from the bar.]\x1b[0m\r\n");
    const enc = new TextEncoder();
    const typed = term.onData((d) => ws.readyState === WebSocket.OPEN && ws.send(enc.encode(d)));
    const ro = new ResizeObserver(() => size());
    ro.observe(el);
    return () => {
      ro.disconnect();
      typed.dispose();
      ws.close();
      unlink();
      term.dispose();
    };
  }, [id]);
  return <div ref={box} className="real-term-view" />;
}

/** The separate account: which one, its SSH port, and SEASIDE's public key to add to its authorized_keys. */
function SeparateSetup({ state, onDone }: { state: Pick<TermState, "separate" | "separatePublicKey" | "here">; onDone: () => void }) {
  const [user, setUser] = useState(state.separate?.user ?? "seaside-shell");
  const [port, setPort] = useState(String(state.separate?.port ?? 22));
  const [note, setNote] = useState("");
  const save = async () => {
    try {
      await termSeparate(user.trim(), Number(port) || 22);
      setNote("Saved. Add SEASIDE's key below to that account, then press New terminal.");
      onDone();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="note small" style={{ margin: 8 }}>
      <b>Shells under a separate account</b>
      <p style={{ margin: "4px 0 8px" }}>
        Shells run as another account on this computer, reached over SSH, so they (and anything run in them, Claude Code
        included) can't open the characters' vaults: those are guarded for your own account. Setting the account up is
        done once, in the operating system; the steps are in the README (Troubleshooting → A separate account for shells).
      </p>
      {state.here ? (
        <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span>Account</span>
          <input className="input small" style={{ width: 160 }} value={user} onChange={(e) => setUser(e.target.value)} aria-label="Separate account name" />
          <span>SSH port</span>
          <input className="input small" style={{ width: 70 }} value={port} onChange={(e) => setPort(e.target.value)} aria-label="SSH port" />
          <button className="btn small primary" onClick={() => void save()}>
            Save
          </button>
          {state.separate?.hostKey ? (
            <button className="btn small" title={`Pinned: ${state.separate.hostKey}`} onClick={() => void termForgetHostKey().then(onDone)}>
              Forget its host key
            </button>
          ) : null}
        </div>
      ) : (
        <p className="muted">The separate account is set up on the desktop's own computer.</p>
      )}
      {state.separatePublicKey ? (
        <div style={{ marginTop: 8 }}>
          <span className="muted">SEASIDE's key, for that account's authorized_keys:</span>
          <div className="row" style={{ gap: 6, alignItems: "center", marginTop: 4 }}>
            <code className="mono" style={{ overflowWrap: "anywhere", flex: 1 }}>{state.separatePublicKey}</code>
            <button className="btn small" onClick={() => void copyText(state.separatePublicKey ?? "").then((ok) => setNote(ok ? "Copied." : "Couldn't copy."))}>
              Copy
            </button>
          </div>
        </div>
      ) : null}
      {note ? <div style={{ marginTop: 6 }}>{note}</div> : null}
    </div>
  );
}
