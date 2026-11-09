// The real terminal's client side (server/terminal.mjs). Privacy → "A real terminal on this computer" is the switch;
// the server keeps its own on/off too, so a shell can't be opened from a page that never asked. When the consent is
// taken back, every shell ends.

import { desk, useDesk } from "./store.ts";
import { allowed } from "./privacy.ts";

export type TermSession = { id: string; workspace: string; folder: string; title: string; started: number; alive: boolean; viewers: number };
export type TermState = {
  on: boolean;
  sessions: TermSession[];
  workspaces: string[];
  /** the separate account shells can run as (over SSH to this computer), and SEASIDE's key for its authorized_keys */
  separate?: { user: string; port: number; hostKey?: string };
  separatePublicKey?: string;
  /** this page is on the desktop's own computer (where the separate account is set up) */
  here?: boolean;
};

async function call<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`/api/terminal${path}`, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(j.error || `The desktop answered ${r.status}.`);
  return j;
}

export const termState = () => call<TermState>("");
export const termOpen = (workspace: string, cols: number, rows: number, as: "you" | "separate" = "you") => call<TermSession>("/open", { workspace, cols, rows, as });
export const termSeparate = (user: string, port: number) => call<TermState>("/separate", { user, port });
export const termForgetHostKey = () => call<TermState>("/forget-host-key", {});
export const termClose = (id: string) => call<{ ok: boolean }>("/close", { id });
export const termSocketUrl = (id: string) => `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/terminal/ws?id=${encodeURIComponent(id)}`;

export const terminalAllowed = () => allowed(desk().privacy, "terminal");
export const useTerminalAllowed = () => useDesk((s) => allowed(s.privacy, "terminal"));

/** Keeps the server's switch where Privacy says (switching on happens only from this computer, by the server's rule). */
export function startTerminalSync() {
  let last: boolean | null = null;
  const sync = () => {
    const want = terminalAllowed();
    if (want === last) return;
    last = want;
    void call("/on", { on: want }).catch(() => {
      // not this computer (switching on is refused elsewhere), or an older server: the Terminal window explains
    });
  };
  sync();
  useDesk.subscribe(sync);
  // the hours of a Conditional privacy setting can open or close it while nothing else changes
  window.setInterval(sync, 60_000);
}
