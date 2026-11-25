import type { Row } from "./xdc.ts";

/** Updates for a character, a page at a time: the latest ones (since 0), or the next ones after a serial, with a
 *  line saying what was left out and how to read it. */
export function pageRows(rows: Row[], since: number, limit = 30) {
  if (!rows.length) return { shown: rows, note: "" };
  const shown = since > 0 ? rows.slice(0, limit) : rows.slice(-limit);
  if (shown.length === rows.length) return { shown, note: "" };
  const first = shown[0].serial, last = shown[shown.length - 1].serial;
  const before = since > 0 ? "" : ` Earlier ones: call again with since: ${Math.max(0, first - limit - 1)}.`;
  const after = since > 0 && last < rows[rows.length - 1].serial ? ` Later ones: call again with since: ${last}.` : "";
  return { shown, note: `Showing #${first} to #${last} of ${rows.length} updates.${before}${after}` };
}

const SQ = /^[a-h][1-8][a-h][1-8][qrbn]?$/i;
type Board = Record<string, string>;

function startBoard(): Board {
  const b: Board = {};
  const back = "rnbqkbnr";
  for (let i = 0; i < 8; i++) {
    const f = "abcdefgh"[i];
    b[`${f}1`] = back[i].toUpperCase();
    b[`${f}2`] = "P";
    b[`${f}7`] = "p";
    b[`${f}8`] = back[i];
  }
  return b;
}

const fileOf = (s: string) => s.charCodeAt(0) - 97;
const rankOf = (s: string) => Number(s[1]) - 1;
const at = (f: number, r: number) => `${String.fromCharCode(97 + f)}${r + 1}`;

/** Whether the squares strictly between two squares on a line are empty. */
function pathClear(b: Board, from: string, to: string) {
  const df = Math.sign(fileOf(to) - fileOf(from)), dr = Math.sign(rankOf(to) - rankOf(from));
  let f = fileOf(from) + df, r = rankOf(from) + dr;
  while (at(f, r) !== to) {
    if (b[at(f, r)]) return false;
    f += df;
    r += dr;
  }
  return true;
}

/** A light check that a move could be legal here: the side to move's own piece, moving its own way, not onto its own
 *  side, with nothing in the way. (Not check or pins: just enough to tell a real move from a refused one.) */
function plausible(b: Board, mv: string, white: boolean) {
  const from = mv.slice(0, 2), to = mv.slice(2, 4);
  const p = b[from];
  if (!p || (p === p.toUpperCase()) !== white) return false;
  const target = b[to];
  if (target && (target === target.toUpperCase()) === white) return false;
  const df = fileOf(to) - fileOf(from), dr = rankOf(to) - rankOf(from);
  const adf = Math.abs(df), adr = Math.abs(dr);
  switch (p.toLowerCase()) {
    case "n":
      return (adf === 1 && adr === 2) || (adf === 2 && adr === 1);
    case "b":
      return adf === adr && adf > 0 && pathClear(b, from, to);
    case "r":
      return (adf === 0) !== (adr === 0) && pathClear(b, from, to);
    case "q":
      return (adf === adr || adf === 0 || adr === 0) && (adf || adr) > 0 && pathClear(b, from, to);
    case "k":
      if (adf <= 1 && adr <= 1) return adf + adr > 0;
      // castling: two squares along the home rank, with every square between king and rook empty
      if (adr === 0 && adf === 2 && rankOf(from) === (white ? 0 : 7) && fileOf(from) === 4) {
        const rook = at(df > 0 ? 7 : 0, rankOf(from));
        return b[rook]?.toLowerCase() === "r" && pathClear(b, from, rook);
      }
      return false;
    case "p": {
      const dir = white ? 1 : -1;
      if (df === 0) return (dr === dir && !target) || (dr === 2 * dir && rankOf(from) === (white ? 1 : 6) && !target && !b[at(fileOf(from), rankOf(from) + dir)]);
      return adf === 1 && dr === dir; // a capture (or en passant)
    }
  }
  return false;
}

function play(b: Board, mv: string) {
  const from = mv.slice(0, 2), to = mv.slice(2, 4);
  const p = b[from];
  const white = p === p.toUpperCase();
  if (p.toLowerCase() === "k" && Math.abs(fileOf(to) - fileOf(from)) === 2) {
    const r = rankOf(from), kingside = fileOf(to) > fileOf(from);
    b[at(kingside ? 5 : 3, r)] = b[at(kingside ? 7 : 0, r)];
    delete b[at(kingside ? 7 : 0, r)];
  }
  // en passant: a pawn moving diagonally onto an empty square takes the pawn beside it
  if (p.toLowerCase() === "p" && fileOf(to) !== fileOf(from) && !b[to]) delete b[at(fileOf(to), rankOf(from))];
  delete b[from];
  const promo = mv[4];
  b[to] = promo ? (white ? promo.toUpperCase() : promo.toLowerCase()) : p.toLowerCase() === "p" && (rankOf(to) === 7 || rankOf(to) === 0) ? (white ? "Q" : "q") : p;
}

function drawBoard(b: Board) {
  const lines: string[] = [];
  for (let r = 7; r >= 0; r--) lines.push(`${r + 1} ${Array.from({ length: 8 }, (_, f) => b[at(f, r)] ?? ".").join(" ")}`);
  lines.push("  a b c d e f g h");
  return lines.join("\n");
}

type Game = { plies: Map<number, string[]>; last: number };

/** Board games that send moves (a `uci` or `move` field with a `ply`): every game's moves in order, in one line
 *  each, so a player knows the whole game even when the updates are too many to show. Chess games (moves as squares,
 *  "e2e4") are replayed: a move that couldn't have been played is skipped, so a corrected one sent for the same ply
 *  counts, and the game that moved last is drawn as a board. */
export function moveDigest(rows: Row[]) {
  const games = new Map<string, Game>();
  for (const r of rows) {
    const p = r.update.payload as Record<string, unknown> | null;
    if (!p || typeof p !== "object") continue;
    // { uci } or { move }, or { from, to, promo } (Aurum Chess); the ply as `ply`, or `n`
    const mv =
      typeof p.uci === "string" ? p.uci
      : typeof p.move === "string" ? p.move
      : typeof p.from === "string" && typeof p.to === "string" && /^[a-h][1-8]$/.test(p.from) ? `${p.from}${p.to}${typeof p.promo === "string" ? p.promo : ""}`
      : "";
    const ply = typeof p.ply === "number" ? p.ply : typeof p.n === "number" ? p.n : null;
    if (!mv || ply === null) continue;
    const id = String(p.gameId ?? p.game ?? "game");
    if (!games.has(id)) games.set(id, { plies: new Map(), last: 0 });
    const g = games.get(id)!;
    g.plies.set(ply, [...(g.plies.get(ply) ?? []), mv]);
    g.last = Math.max(g.last, r.serial);
  }
  let latest: { id: string; board: Board; skipped: string[] } | null = null;
  let latestAt = -1;
  const lines = [...games].map(([id, g]) => {
    const list = [...g.plies].sort((a, b) => a[0] - b[0]);
    const chess = list.length > 0 && list.every(([, ms]) => ms.every((m) => SQ.test(m))) && list[0][0] === 0;
    let shown: [number, string][];
    let board: Board | null = null;
    const skipped: string[] = [];
    if (chess) {
      board = startBoard();
      shown = [];
      for (const [n, ms] of list) {
        if (n !== shown.length) break; // a gap: the game can't be followed past it
        const ok = ms.find((m) => plausible(board!, m.toLowerCase(), n % 2 === 0));
        for (const m of ms) if (m !== ok) skipped.push(`${n}:${m}`);
        if (!ok) break;
        play(board, ok.toLowerCase());
        shown.push([n, ok]);
      }
    } else shown = list.map(([n, ms]) => [n, ms[0]]); // the first move sent for a ply is the one that counts
    const next = shown.length ? shown[shown.length - 1][0] + 1 : 0;
    if (board && g.last > latestAt) {
      latestAt = g.last;
      latest = { id, board, skipped };
    }
    const skip = skipped.length ? ` [skipped as impossible here: ${skipped.join(" ")}]` : "";
    return `${id}: ${shown.map(([n, m]) => `${n}:${m}`).join(" ")} (next is ply ${next}, ${next % 2 ? "black" : "white"} to move if it's chess)${skip}`;
  });
  const out = lines.join("\n");
  if (!latest) return out;
  const { id, board } = latest as { id: string; board: Board };
  return `${out}\n\nThe board in ${id} now (White in capitals, Black in lowercase; rank 8 at the top):\n${drawBoard(board)}`;
}
