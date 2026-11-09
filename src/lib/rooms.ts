// Rooms: the Home room every desk has, plus rooms of their own that any device can open (a phone's own chat, with its
// own characters) and any other device can join, like a server on Discord or a community on Vector. Each device is in
// one room at a time and keeps the rooms it goes to as tabs; switching is a click. Two devices in the same room see
// the same conversation live (lib/deskSections.ts merges what they both say). A room's conversation is a branch like
// any other (lib/chats.ts saves it in the vault as it goes), so deleting a room keeps what was said in it.

import { desk, uid, type RoomMeta } from "./store.ts";
import { adopt, dropSection, flush } from "./deskSync.ts";
import { isRunning } from "./agent.ts";
import { deviceName } from "./devshare.ts";
import { saveOpenChat } from "./chats.ts";
import { MODE } from "./deskBoot.ts";
import { ROOM_KEYS } from "./deskSections.ts";

export const HOME = "";
/** Rooms need the shared desk (a device keeping its own desk has just its own conversation). */
export const roomsOn = () => {
  try {
    return localStorage.getItem(MODE) !== "legacy";
  } catch {
    return false;
  }
};
export const roomName = (id: string) => (id ? (desk().rooms.find((r) => r.id === id)?.name ?? "A room") : "Home");

type RoomParts = { messages: unknown[]; members: string[]; chatId: string; gone: string[] };
const sectionsOf = (id: string) => (id ? [`room:${id}`] : [...ROOM_KEYS]);

/** A room's conversation as the server has it now (Home's from its own sections). */
async function fetchRoom(id: string): Promise<{ parts: RoomParts | null; revs: Record<string, { rev: number; value: unknown }> }> {
  const revs: Record<string, { rev: number; value: unknown }> = {};
  for (const name of sectionsOf(id)) {
    const r = await fetch(`/api/desk/section?name=${encodeURIComponent(name)}`);
    if (!r.ok) throw new Error("The desktop isn't answering; try again in a moment.");
    revs[name] = (await r.json()) as { rev: number; value: unknown };
  }
  const v = id ? (revs[`room:${id}`]?.value as Partial<RoomParts> | null) : Object.fromEntries(ROOM_KEYS.map((k) => [k, revs[k]?.value])) as Partial<RoomParts>;
  if (!v || (!id ? false : !Array.isArray(v.messages))) return { parts: null, revs };
  return {
    parts: { messages: Array.isArray(v.messages) ? v.messages : [], members: Array.isArray(v.members) ? v.members : [], chatId: typeof v.chatId === "string" ? v.chatId : uid(), gone: Array.isArray(v.gone) ? v.gone : [] },
    revs,
  };
}

/** Who's in another room (to bring someone over from it). */
export async function membersOf(id: string): Promise<string[]> {
  if (id === desk().roomId) return desk().members;
  return (await fetchRoom(id)).parts?.members ?? [];
}

/** Go to a room. Returns why not, or "". */
export async function switchRoom(id: string, fresh?: RoomParts): Promise<string> {
  const s = desk();
  if (id === s.roomId) return "";
  if (isRunning()) return "The characters are still answering. Wait for them, or press Stop first.";
  try {
    // what was said here is kept (as its branch, and on the server) before leaving
    if (s.messages.length) await saveOpenChat().catch(() => undefined);
    await flush();
    let parts = fresh ?? null;
    if (!parts) {
      const got = await fetchRoom(id);
      parts = got.parts;
      // known as the server has it, so going there doesn't send it straight back (or count as a clash)
      if (parts) for (const [name, x] of Object.entries(got.revs)) if (x.rev) adopt(name, x.rev, x.value);
    }
    if (!parts) {
      if (id) return "That room isn't there any more.";
      parts = { messages: [], members: [], chatId: uid(), gone: [] };
    }
    const members = parts.members.length ? parts.members : [s.focus || "dee"];
    desk().set({
      roomId: id,
      roomTabs: id && !s.roomTabs.includes(id) ? [...s.roomTabs, id] : s.roomTabs,
      messages: parts.messages as typeof s.messages,
      members,
      chatId: parts.chatId,
      gone: parts.gone,
      // talking to someone who's in this room
      ...(members.includes(s.focus) ? {} : { focus: members[0] }),
    });
    return "";
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** A room of this device's own (named after it unless given a name), with whoever this device is talking to. */
export async function newRoom(name = ""): Promise<string> {
  const id = uid();
  const meta: RoomMeta = { id, name: name.trim().slice(0, 60) || `${deviceName()}'s room`, device: deviceName(), made: Date.now() };
  desk().set({ rooms: [...desk().rooms, meta] });
  return switchRoom(id, { messages: [], members: [desk().focus || "dee"], chatId: uid(), gone: [] });
}

export function renameRoom(id: string, name: string) {
  const n = name.trim().slice(0, 60);
  if (id && n) desk().set({ rooms: desk().rooms.map((r) => (r.id === id ? { ...r, name: n } : r)) });
}

/** Stop keeping a room as a tab here (it's still there for everyone). */
export async function closeTab(id: string): Promise<string> {
  if (id === desk().roomId) {
    const why = await switchRoom(HOME);
    if (why) return why;
  }
  desk().set({ roomTabs: desk().roomTabs.filter((x) => x !== id) });
  return "";
}

/** Delete a room for everyone. What was said in it stays, as a branch (Room › its branches). */
export async function deleteRoom(id: string): Promise<string> {
  if (!id) return "The Home room stays.";
  if (id === desk().roomId) {
    const why = await switchRoom(HOME);
    if (why) return why;
  }
  await dropSection(`room:${id}`).catch(() => undefined);
  desk().set({ rooms: desk().rooms.filter((r) => r.id !== id), roomTabs: desk().roomTabs.filter((x) => x !== id) });
  return "";
}
