// Before SEASIDE's store loads: this device takes up the shared desk (server/deskState.mjs) into the browser copy the
// store reads, keeping only its own layout (lib/deskSections.ts says which is which). Nothing here imports the store.
//
// A device that already had a desk of its own here, from before the desk was shared, isn't overwritten without a word:
// its old desk is set aside in this browser (and a copy, keys left out, kept on the server) and SEASIDE asks what to do
// with it once it's open. A device switched to "keep its own desk" (legacy mode) never takes up the shared one.

import { PER_DEVICE, applySections, extraIn, hasOwnStuff, KEY } from "./deskSections.ts";

export const LEGACY = "pdd-desk-legacy"; // this device's old desk, set aside
export const MODE = "pdd-desk-mode"; // "legacy": this device keeps its own desk
export const ASK = "pdd-desk-ask"; // SEASIDE should ask what to do with the old desk
export const JOINED = "pdd-desk-joined";
export const FOUND = "pdd-desk-found"; // this device starts the shared desk (the desktop's own computer, first time)
export const REV = "pdd-desk-rev";

const deviceLabel = () => {
  const ua = navigator.userAgent;
  return /Android/.test(ua) ? (/Mobile/.test(ua) ? "Android phone" : "Android tablet") : /iPhone|iPad/.test(ua) ? "iPhone or iPad" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows PC" : "device";
};

export async function bootDesk() {
  try {
    if (localStorage.getItem(MODE) === "legacy") return;
    const r = await fetch("/api/desk");
    if (!r.ok) return; // an older server: the page starts as it always has
    const j = (await r.json()) as { empty: boolean; here: boolean; rev: number; sections: Record<string, { rev: number; value: unknown }> };
    const blob = localStorage.getItem(KEY);
    const local = blob ? (JSON.parse(blob) as { state?: Record<string, unknown>; version?: number }) : null;
    if (j.empty) {
      // nobody has started the shared desk yet: the desktop's own computer does, from what it has
      // (it's joined from the start: its desk is the shared desk, never an "old" one)
      if (j.here) localStorage.setItem(FOUND, "1"), localStorage.setItem(JOINED, "1");
      return;
    }
    const shared = Object.fromEntries(Object.entries(j.sections).map(([k, s]) => [k, s.value]));
    if (!localStorage.getItem(JOINED) && local?.state && hasOwnStuff(local.state) && extraIn(local.state, shared) > 0) {
      // this device had a desk of its own: set it aside, keep a copy on the server, and ask once SEASIDE is open
      if (!localStorage.getItem(LEGACY)) localStorage.setItem(LEGACY, blob!);
      localStorage.setItem(ASK, "1");
      const env = (local.state.env ?? {}) as Record<string, string>;
      const safe = JSON.stringify({ ...local, state: { ...local.state, env: Object.fromEntries(Object.keys(env).map((k) => [k, ""])) } });
      void fetch("/api/desk/legacy", { method: "POST", body: JSON.stringify({ device: deviceLabel(), blob: safe }) }).catch(() => undefined);
    }
    // the shared desk, with this device's own layout kept
    const mine: Record<string, unknown> = {};
    for (const k of PER_DEVICE) if (local?.state && k in local.state) mine[k] = local.state[k];
    const state = applySections(mine, Object.fromEntries(Object.entries(j.sections).map(([k, s]) => [k, s.value])));
    localStorage.setItem(KEY, JSON.stringify({ state, version: local?.version ?? 1 }));
    localStorage.setItem(JOINED, "1");
    localStorage.setItem(REV, String(j.rev));
  } catch {
    // no shared desk on this server: the page starts as it always has
  }
}
