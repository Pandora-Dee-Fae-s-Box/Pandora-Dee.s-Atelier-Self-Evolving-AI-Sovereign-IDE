// The shared desk, live (server/deskState.mjs): what changes here goes to the server within a second or so, a section
// at a time, and what other devices change comes in every few seconds. If two devices changed the same section at
// once, the later one stands and this desk says so. A device keeping its own desk (legacy mode) doesn't take part.

import { desk, useDesk } from "./store.ts";
import { applySections, keepsWhenAbsent, MEMORY_ONLY, toSections } from "./deskSections.ts";
import { ASK, FOUND, LEGACY, MODE, REV } from "./deskBoot.ts";
import { deviceName } from "./devshare.ts";
import { deviceId } from "./pads.ts";

const me = () => `${deviceName()} · ${deviceId().slice(0, 4)}`;
let rev = Number(localStorage.getItem(REV) || 0);
const base: Record<string, number> = {};
const sent = new Map<string, string>(); // section → what this desk last agreed with the server on
let timer = 0;
let saving = false;

const sectionsNow = () => toSections(desk() as unknown as Record<string, unknown>);

async function save(founding = false) {
  if (saving) return;
  saving = true;
  try {
    const now = sectionsNow();
    const changes: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(now)) {
      const json = JSON.stringify(v);
      if (sent.get(k) !== json) changes[k] = v;
    }
    // a character removed: their files go too (a room this device just isn't in stays, of course)
    for (const k of sent.keys()) if (!(k in now) && !keepsWhenAbsent(k)) changes[k] = null;
    if (!Object.keys(changes).length) return;
    const r = await fetch("/api/desk/save", { method: "POST", body: JSON.stringify({ device: me(), base, changes, merge: Object.keys(changes).filter(keepsWhenAbsent) }) });
    if (!r.ok) return; // the server will hear the next change; nothing is lost here
    const j = (await r.json()) as { rev: number; clashes?: { section: string; with: string }[]; stale?: string[] };
    const stale = new Set(j.stale ?? []);
    for (const [k, v] of Object.entries(changes)) {
      if (stale.has(k)) continue;
      if (v === null) sent.delete(k);
      else sent.set(k, JSON.stringify(v));
    }
    // (the pull mark stays where it is: another device may have saved between this desk's last pull and this save, and
    // the next pull has to see that; this desk's own sections come back in it and are skipped as its own)
    void j.rev;
    if (founding) localStorage.removeItem(FOUND);
    // a room another device spoke in meanwhile: its copy taken in and merged with this one (sent on the next save)
    if (stale.size) await takeIn([...stale]);
    if (j.clashes?.length) desk().notice(`Another device changed ${j.clashes.map((c) => c.section.replace(/^files:/, "the files of ")).join(", ")} at the same time (${j.clashes[0].with}). This device's change stands.`);
  } catch {
    /* the server isn't answering: tried again on the next change */
  } finally {
    saving = false;
  }
}

/** The server's copies of these sections, laid into this desk (a room's conversation merged). */
async function takeIn(names: string[]) {
  const theirs: Record<string, unknown> = {};
  for (const k of names) {
    const r = await fetch(`/api/desk/section?name=${encodeURIComponent(k)}`);
    if (!r.ok) continue;
    const x = (await r.json()) as { rev: number; value: unknown };
    base[k] = x.rev;
    theirs[k] = x.value;
  }
  const s = desk() as unknown as Record<string, unknown>;
  desk().set(applySections({ files: s.files, roomId: s.roomId, chatId: s.chatId, messages: s.messages, gone: s.gone }, theirs) as never);
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void save(), 300);
}

/** What the other devices changed since this desk last looked. */
async function pull() {
  try {
    const r = await fetch(`/api/desk?since=${rev}`);
    if (!r.ok) return;
    const j = (await r.json()) as { rev: number; sections: Record<string, { rev: number; value: unknown; by: string }> };
    const theirs: Record<string, unknown> = {};
    for (const [k, s] of Object.entries(j.sections)) {
      base[k] = s.rev;
      if (s.by === me()) continue;
      const json = JSON.stringify(s.value);
      if (sent.get(k) === json) continue;
      sent.set(k, json);
      theirs[k] = s.value;
    }
    rev = Math.max(rev, j.rev);
    localStorage.setItem(REV, String(rev));
    if (Object.keys(theirs).length) {
      const s = desk() as unknown as Record<string, unknown>;
      // (with the room this device is in, so a conversation two devices share is merged, not overwritten)
      const next = applySections({ files: s.files, roomId: s.roomId, chatId: s.chatId, messages: s.messages, gone: s.gone }, theirs);
      desk().set(next as never);
    }
  } catch {
    /* tried again shortly */
  }
}

/** Save what's changed now (before going to another room). */
export async function flush() {
  for (let i = 0; i < 30 && saving; i++) await new Promise((r) => setTimeout(r, 100));
  await save();
}

/** A section this device is about to work in, as the server has it (going into a room): known, so it isn't sent back
 *  or taken for a clash. */
export function adopt(section: string, rev: number, value: unknown) {
  base[section] = rev;
  sent.set(section, JSON.stringify(value));
}
/** Removed for everyone (a room deleted). */
export async function dropSection(section: string) {
  await fetch("/api/desk/save", { method: "POST", body: JSON.stringify({ device: me(), base, changes: { [section]: null } }) });
  sent.delete(section);
}

/** What only a page should hold (an unlocked adult shelf, who's signed in…), left on the server by an older version:
 *  cleared, so no device ever takes it in. */
async function clearStrays() {
  for (const k of MEMORY_ONLY) {
    try {
      const x = (await (await fetch(`/api/desk/section?name=${k}`)).json()) as { value: unknown };
      if (x.value !== null) await dropSection(k);
    } catch {
      /* tried again next time SEASIDE opens */
    }
  }
}

let started = false;
/** Joins the shared desk once SEASIDE is open (after deskBoot.ts took it up). */
export function startDeskSync() {
  if (started || localStorage.getItem(MODE) === "legacy") return;
  started = true;
  const founding = localStorage.getItem(FOUND) === "1";
  // what this desk holds now is what the server holds (deskBoot laid it in), unless this device is starting the desk
  if (!founding) for (const [k, v] of Object.entries(sectionsNow())) sent.set(k, JSON.stringify(v));
  void (founding ? save(true) : pull());
  void clearStrays();
  useDesk.subscribe(() => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void save(), 1200);
  });
  window.setInterval(() => void pull(), 3000);
  window.addEventListener("pagehide", () => void save());
}

// ── a device that had its own desk before ────────────────────────────────────────────────────────────────────────
type Old = { state?: Record<string, unknown> };
export const oldDesk = (): Old | null => {
  try {
    return JSON.parse(localStorage.getItem(LEGACY) || "null") as Old | null;
  } catch {
    return null;
  }
};
export const shouldAsk = () => localStorage.getItem(ASK) === "1" && Boolean(oldDesk());
export const doneAsking = () => localStorage.removeItem(ASK);

/** What the old desk has that the shared one doesn't (or has differently). */
export function whatItHas() {
  const old = oldDesk()?.state ?? {};
  const s = desk();
  const chars = ((old.custom as { id: string; name: string }[]) ?? []).filter((c) => !s.custom.some((x) => x.id === c.id));
  const oldFiles = (old.files as Record<string, Record<string, string>>) ?? {};
  const files = Object.entries(oldFiles).flatMap(([id, fs]) => Object.entries(fs).filter(([p, t]) => s.filesOf(id)[p] !== t).map(([p]) => `${id}/${p}`));
  const chats = ((old.chats as { id: string; title: string }[]) ?? []).filter((c) => !s.chats.some((x) => x.id === c.id));
  const conns = (((old.model as { connections?: { id: string; label: string }[] })?.connections) ?? []).filter((c) => !s.model.connections.some((x) => x.id === c.id));
  const keys = Object.keys((old.env as Record<string, string>) ?? {}).filter((k) => !(k in s.env));
  return { chars, files, chats, conns, keys };
}

/** Bring the chosen parts of the old desk into the shared one. A file both have differently comes in beside it. */
export function bringIn(pick: { chars: boolean; files: boolean; chats: boolean; conns: boolean; keys: boolean }) {
  const old = oldDesk()?.state ?? {};
  const s = desk();
  const has = whatItHas();
  const from = (navigator.userAgent.match(/Android|iPhone|iPad|Mac|Windows/)?.[0] ?? "device").replace("Windows", "PC");
  const patch: Record<string, unknown> = {};
  if (pick.chars && has.chars.length) patch.custom = [...s.custom, ...(has.chars as typeof s.custom)];
  if (pick.files) {
    const files = { ...s.files };
    for (const [id, fs] of Object.entries((old.files as Record<string, Record<string, string>>) ?? {})) {
      const mine = { ...(files[id] ?? {}) };
      for (const [p, t] of Object.entries(fs)) {
        if (mine[p] === undefined) mine[p] = t;
        else if (mine[p] !== t) mine[p.replace(/(\.[^./]+)?$/, ` (from the ${from})$1`)] = t;
      }
      files[id] = mine;
    }
    patch.files = files;
  }
  if (pick.chats && has.chats.length) patch.chats = [...s.chats, ...(has.chats as typeof s.chats)];
  if (pick.conns && has.conns.length) patch.model = { ...s.model, connections: [...s.model.connections, ...(has.conns as typeof s.model.connections)] };
  if (pick.keys && has.keys.length) patch.env = { ...s.env, ...Object.fromEntries(has.keys.map((k) => [k, String((old.env as Record<string, string>)[k] ?? "")])) };
  desk().set(patch as never);
  return Object.keys(patch).length;
}

/** This device keeps its own desk (legacy mode): its old desk comes back, and it stops taking part in the shared one. */
export function keepOwnDesk() {
  const blob = localStorage.getItem(LEGACY);
  if (blob) localStorage.setItem("pandora-dee-desktop", blob);
  localStorage.setItem(MODE, "legacy");
  localStorage.removeItem(ASK);
  location.reload();
}

/** Back to the shared desk after legacy mode (the old desk stays set aside, to bring things in from). */
export function joinSharedDesk() {
  const blob = localStorage.getItem("pandora-dee-desktop");
  if (blob && !localStorage.getItem(LEGACY)) localStorage.setItem(LEGACY, blob);
  localStorage.removeItem(MODE);
  localStorage.removeItem("pdd-desk-joined");
  location.reload();
}
