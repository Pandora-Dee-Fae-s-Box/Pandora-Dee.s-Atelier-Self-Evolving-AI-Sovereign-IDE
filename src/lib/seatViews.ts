// What a character saw on her game seat earlier in a turn: once a newer view comes, the older ones shrink to their
// first lines. A person playing sees the screen as it is now, not every screen since the turn began, and a turn of a
// dozen full screens (maps and all) swamps a model's context until she loses track of the game.

const SEAT = new Set(["game_screen", "game_seat_act"]);
const KEEP = 280;
export const OLDER = "… (an older view: your newest one is further on)";

type Turn = { role: string; content?: unknown; name?: string };

/** Shrink earlier seat views in this turn's messages, in place, before a new one is added. */
export function shrinkOlderViews(turns: Turn[], from: number): void {
  for (let i = from; i < turns.length; i++) {
    const t = turns[i];
    if (t.role !== "tool" || !t.name || !SEAT.has(t.name) || typeof t.content !== "string") continue;
    if (t.content.length <= KEEP + OLDER.length || t.content.endsWith(OLDER)) continue;
    t.content = `${t.content.slice(0, KEEP).replace(/\s+\S*$/, "")} ${OLDER}`;
  }
}

export const isSeatView = (name: string) => SEAT.has(name);
