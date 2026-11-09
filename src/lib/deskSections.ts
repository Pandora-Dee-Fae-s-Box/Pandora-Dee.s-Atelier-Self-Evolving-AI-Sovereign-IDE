// Which parts of SEASIDE's state are the shared desk and which belong to one device, and how the shared part is cut
// into sections (each character's files a section of its own, so two devices editing different characters never meet).
// Pure: no store, no page; used before the store loads (deskBoot.ts) and by the live sync (deskSync.ts).
//
// Rooms: the conversation (its messages, who's in it, which branch is open; who each device talks to stays its own) is the Home room's, in the
// sections "messages", "members", "chatId" and "gone", as it always was. A device can open a room of its
// own, or join another device's: then those same parts of its state are that room's, in one section "room:<id>". Which
// room a device is in is its own business (roomId), so each device can be in a different one.

export const KEY = "pandora-dee-desktop";

/** How this device looks and is used: never shared. */
export const PER_DEVICE = [
  "wins", "zTop", "menuBar", "bar", "clock", "wallpaper", "fontSize", "uiScale", "firstRun", "focus", "hangout", "dock",
  "touch", "memory", "libView", "libSort", "libSection", "appPrefs", "studioPkg", "toddler", "roomId", "roomTabs",
] as const;
/** What only this page holds, for as long as it's open: who's signed in, an unlocked adult shelf, the sign-in check
 *  passed, who's typing, a game, a toast. Never saved, never shared (one device unlocking the adult shelf mustn't
 *  unlock it on the children's). */
export const MEMORY_ONLY = ["session", "adultOpen", "sensorPass", "busy", "game", "toast"] as const;
const DEVICE = new Set<string>([...PER_DEVICE, ...MEMORY_ONLY]);
/** A room's own parts (the Home room's are top-level sections; another room's are one "room:<id>" section). */
export const ROOM_KEYS = ["messages", "members", "chatId", "gone"] as const;
const ROOM = new Set<string>(ROOM_KEYS);
/** Sections a device never removes just by not holding them (rooms it isn't in right now). */
export const keepsWhenAbsent = (k: string) => k.startsWith("room:") || ROOM.has(k);

const roomOf = (state: Record<string, unknown>) => (typeof state.roomId === "string" ? state.roomId : "");

/** The shared desk as sections: every shared key its own, and files split per character ("files:<id>"). */
export function toSections(state: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const roomId = roomOf(state);
  const room: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(state)) {
    if (ROOM.has(k)) {
      if (typeof v === "function" || v === undefined) continue;
      if (roomId) room[k] = v;
      else out[k] = v;
      continue;
    }
    if (DEVICE.has(k) || typeof v === "function" || v === undefined) continue;
    if (k === "files" && v && typeof v === "object") for (const [id, files] of Object.entries(v as Record<string, unknown>)) out[`files:${id}`] = files;
    else out[k] = v;
  }
  if (roomId) out[`room:${roomId}`] = room;
  return out;
}

type Msg = { id: string; at: number; v?: number };

/**
 * Two copies of one conversation made into one: every message either has (a message both have: the one changed more
 * often, so a reply still being written isn't set back), in the order they were said, leaving out the ones removed on
 * either side (`gone`). Two devices talking in the same room at once both keep what they said.
 */
export function mergeMessages<T extends Msg>(local: T[] | undefined, remote: T[] | undefined, gone: string[] = []): T[] {
  const r = Array.isArray(remote) ? remote : [];
  const l = Array.isArray(local) ? local : [];
  if (!l.length) return r;
  const removed = new Set(gone);
  const mine = new Map(l.map((m) => [m.id, m]));
  const out = r.filter((m) => !removed.has(m.id)).map((m) => {
    const x = mine.get(m.id);
    return x && (x.v ?? 0) > (m.v ?? 0) ? x : m;
  });
  const have = new Set(r.map((m) => m.id));
  for (const m of l) if (!have.has(m.id) && !removed.has(m.id)) out.push(m);
  return out.map((m, i) => [m, i] as const).sort((a, b) => a[0].at - b[0].at || a[1] - b[1]).map(([m]) => m);
}

/** Removed messages remembered from both sides (the newest few hundred). */
const unionGone = (a: unknown, b: unknown) => [...new Set([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])].map(String))].slice(-300);

/** One room's parts laid over a state: a conversation on the same branch is merged, another branch taken whole. */
function layRoom(state: Record<string, unknown>, next: Record<string, unknown>, value: Record<string, unknown>) {
  const sameBranch = (value.chatId ?? state.chatId) === state.chatId;
  const gone = unionGone(state.gone, value.gone);
  for (const k of ROOM_KEYS) {
    if (!(k in value)) continue;
    if (k === "messages") next.messages = sameBranch ? mergeMessages(state.messages as Msg[], value.messages as Msg[], gone) : value.messages;
    else if (k === "gone") next.gone = sameBranch ? gone : value.gone;
    else next[k] = value[k];
  }
}

/** Sections laid back into a state (over what's given: this device's own parts, or the current state). */
export function applySections(state: Record<string, unknown>, sections: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...state };
  let files = { ...((state.files as Record<string, unknown>) ?? {}) };
  const roomId = roomOf(state);
  const home: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(sections)) {
    if (k.startsWith("files:")) {
      const id = k.slice(6);
      if (v === null) {
        const { [id]: _gone, ...rest } = files;
        void _gone;
        files = rest;
      } else files[id] = v;
    } else if (k.startsWith("room:")) {
      // only the room this device is in; the others wait until it goes there
      if (roomId && k === `room:${roomId}` && v && typeof v === "object") layRoom(state, next, v as Record<string, unknown>);
    } else if (ROOM.has(k)) {
      if (!roomId) home[k] = v;
    } else if (!DEVICE.has(k)) next[k] = v;
  }
  if (Object.keys(home).length) layRoom(state, next, home);
  next.files = files;
  return next;
}


/** How many things an old desk has that the shared desk's sections don't (characters, chats, files, keys): worth asking
 *  about only when this is more than nothing. */
export function extraIn(state: Record<string, unknown>, sections: Record<string, unknown>): number {
  const ids = (v: unknown) => new Set(Array.isArray(v) ? v.map((x) => (x as { id?: string })?.id) : []);
  const theirChars = ids(sections.custom);
  const theirChats = ids(sections.chats);
  let n = 0;
  for (const c of (state.custom as { id?: string }[]) ?? []) if (!theirChars.has(c?.id)) n++;
  for (const c of (state.chats as { id?: string }[]) ?? []) if (!theirChats.has(c?.id)) n++;
  const theirEnv = (sections.env as Record<string, unknown>) ?? {};
  for (const k of Object.keys((state.env as object) ?? {})) if (!(k in theirEnv)) n++;
  for (const [id, files] of Object.entries((state.files as Record<string, Record<string, string>>) ?? {})) {
    const theirs = (sections[`files:${id}`] as Record<string, string>) ?? {};
    for (const [p, t] of Object.entries(files ?? {})) if (theirs[p] !== t) n++;
  }
  return n;
}

/** Whether a desk holds anything a person made (worth asking about before it's set aside). */
export function hasOwnStuff(state: Record<string, unknown>): boolean {
  const n = (v: unknown) => (Array.isArray(v) ? v.length : 0);
  return n(state.custom) > 0 || n(state.chats) > 0 || n(state.messages) > 0 || n(state.accounts) > 0 || Object.keys((state.env as object) ?? {}).length > 0;
}
