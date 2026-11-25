// Whose turn it is in a game, as the game itself says: webxdc's `notify` (a map from a player's address to a line meant
// only for them, "*" for everyone). A character keeps her eyes closed until the game names her: in a game of hidden
// things (a secret word, a hand of cards) she isn't woken while someone else is choosing, and she plays only when
// it's hers to play.

import type { Row } from "./xdc.ts";

export type Turn =
  /** the game hasn't said whose turn it is: everyone plays as before */
  | { kind: "open" }
  /** these characters' turn (id → the game's own line for them) */
  | { kind: "theirs"; mine: Map<string, string> }
  /** someone else's turn (a person, or a character not playing here): the characters wait, eyes closed */
  | { kind: "waiting"; for: string[] };

const notifyOf = (r: Row) => {
  const n = (r.update as { notify?: unknown }).notify;
  return n && typeof n === "object" && !Array.isArray(n) ? (n as Record<string, unknown>) : null;
};

/** The turn the latest `notify` gave, unless every player it named has already answered since. */
export function turnNow(rows: Row[], players: string[], addrOf: (id: string) => string = (id) => `ai:${id}`): Turn {
  let at = -1;
  for (let i = rows.length - 1; i >= 0; i--) if (notifyOf(rows[i])) (at = i), (i = -1);
  if (at < 0) return { kind: "open" };
  const notify = notifyOf(rows[at])!;
  const named = Object.keys(notify);
  const answered = new Set(rows.slice(at + 1).map((r) => r.from));
  const still = named.filter((a) => a === "*" || !answered.has(a));
  if (!still.length) return { kind: "open" };
  const mine = new Map<string, string>();
  for (const id of players) {
    const line = notify[addrOf(id)] ?? notify["*"];
    if (line !== undefined && (still.includes(addrOf(id)) || still.includes("*"))) mine.set(id, String(line));
  }
  if (mine.size) return { kind: "theirs", mine };
  return { kind: "waiting", for: still.filter((a) => a !== rows[at].from) };
}

/** Whether an update names a character playing here, so she wakes, whoever sent it: even her own move, when the
 *  game says it's her turn again ("everyone has spoken, act now", sent by the last one to speak). */
export function wakes(row: Row, players: string[], addrOf: (id: string) => string = (id) => `ai:${id}`) {
  const n = notifyOf(row);
  if (!n) return false;
  return players.some((id) => addrOf(id) in n) || ("*" in n && players.length > 0);
}
