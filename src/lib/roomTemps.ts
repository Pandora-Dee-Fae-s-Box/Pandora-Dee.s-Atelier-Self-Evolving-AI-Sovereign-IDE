// The room-temperature panel (Dee's idea): every room at a glance, how lively it is, who's in it and what was said
// last, and who is in more than one room at once, so conversations don't wander through each other.

import { ROOM_KEYS } from "./deskSections.ts";

type Msg = { kind?: string; who?: string; name?: string; text?: string; at?: number };
export type Heat = "quiet" | "warm" | "lively";
export type RoomPulse = { id: string; name: string; members: string[]; heat: Heat; recent: number; last: { name: string; at: number; text: string } | null };

const SPOKEN = (m: Msg) => (m.kind === "human" || m.kind === "character") && String(m.text ?? "").trim() !== "";

/** How lively a room has been: what was said in the last ten minutes, and the last thing said. */
export function temperature(messages: Msg[], now = Date.now()): Pick<RoomPulse, "heat" | "recent" | "last"> {
  const said = messages.filter(SPOKEN);
  const recent = said.filter((m) => (m.at ?? 0) > now - 10 * 60_000).length;
  const l = said[said.length - 1];
  return {
    recent,
    heat: recent >= 8 ? "lively" : recent >= 1 ? "warm" : "quiet",
    last: l ? { name: String(l.name ?? l.who ?? "someone"), at: l.at ?? 0, text: String(l.text).replace(/\s+/g, " ").slice(0, 120) } : null,
  };
}

/** Characters in more than one room: id → the rooms' names. */
export function wanderers(rooms: Pick<RoomPulse, "name" | "members">[]) {
  const where = new Map<string, string[]>();
  for (const r of rooms) for (const id of r.members) where.set(id, [...(where.get(id) ?? []), r.name]);
  return new Map([...where].filter(([, names]) => names.length > 1));
}

async function section(name: string): Promise<unknown> {
  const r = await fetch(`/api/desk/section?name=${encodeURIComponent(name)}`);
  if (!r.ok) return null;
  return ((await r.json()) as { value?: unknown }).value ?? null;
}

/** Every room's pulse, as the server has it now (Home first). */
export async function roomPulses(rooms: { id: string; name: string }[], now = Date.now()): Promise<RoomPulse[]> {
  const out: RoomPulse[] = [];
  const home = Object.fromEntries(await Promise.all(ROOM_KEYS.filter((k) => k === "messages" || k === "members").map(async (k) => [k, await section(k)] as const)));
  out.push({ id: "", name: "Home", members: Array.isArray(home.members) ? (home.members as string[]) : [], ...temperature(Array.isArray(home.messages) ? (home.messages as Msg[]) : [], now) });
  for (const r of rooms) {
    const v = (await section(`room:${r.id}`)) as { messages?: Msg[]; members?: string[] } | null;
    out.push({ id: r.id, name: r.name, members: Array.isArray(v?.members) ? v!.members! : [], ...temperature(Array.isArray(v?.messages) ? v!.messages! : [], now) });
  }
  return out;
}
