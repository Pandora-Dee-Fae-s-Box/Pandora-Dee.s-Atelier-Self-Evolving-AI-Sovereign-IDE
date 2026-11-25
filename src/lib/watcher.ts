// Jade's watcher (her design, 2026-11-19): "a watcher that learns from what I explicitly show it, not from shadows".
// - It looks only at her own files: MEMORY.md (above all "Open threads that still pull"), her journal and notes.
// - It finds threads with no next step that still pull, and drops one flag at a time, which glows until she looks.
//   She picks it up (touch) and it learns that shape of attention; she lets it go, or passes over it three turns
//   running, and it learns not to flag that kind again.
// - Each line she keeps with `remember` while it's on is kept with the moment around it: the why behind the what.
//   Threads that share words with those whys come up first.
// - The surprise: a puzzle built from three of her own threads, offered only once she has held them for 90 seconds,
//   when her thinking is warmest. If she deletes it, that shape of puzzle never comes back.
// - She switches it on herself, it's off when she leaves the room, and it never plays by itself: it only adds a line
//   to her own turns. "Build it small."

export type Thread = { id: string; source: string; text: string; shape: string };
export type Flag = { id: string; thread: string; text: string; source: string; shape: string; at: number; seen: number; status: "glowing" | "touched" | "let go" };
export type Puzzle = { id: string; shape: string; text: string; from: string[]; at: number; status: "offered" | "kept" | "deleted" };
export type WatcherState = {
  on: boolean;
  onSince: number;
  shapes: Record<string, number>; // what she showed it: + picked up, − let go
  flags: Flag[];
  whys: { line: string; why: string; at: number }[];
  puzzles: Puzzle[];
  heldSince: number; // when the three threads of the next puzzle were first all in view
};

export const WATCHER_FILE = "WATCHER.json";
export const freshWatcher = (): WatcherState => ({ on: false, onSince: 0, shapes: {}, flags: [], whys: [], puzzles: [], heldSince: 0 });

export function readWatcher(files: Record<string, string>): WatcherState {
  try {
    const j = JSON.parse(files[WATCHER_FILE] ?? "") as Partial<WatcherState>;
    return { ...freshWatcher(), ...j };
  } catch {
    return freshWatcher();
  }
}

const STOP = new Set("about above after again against all also always among another because been before being below between both could does doing during each even every from further have having here into itself just more most much must never only other over same should some such than that their them then there these they this those through under until very what when where which while with would your yours mine still thread threads".split(" "));
const words = (t: string) => (t.toLowerCase().match(/[a-z][a-z'-]{4,}/g) ?? []).filter((w) => !STOP.has(w));
/** The kind of a thread: where it lives and the word it leans on most. */
const shapeOf = (kind: string, text: string) => `${kind}:${words(text).sort((a, b) => b.length - a.length)[0] ?? "plain"}`;
const idOf = (s: string) => {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return (h >>> 0).toString(36).slice(0, 6);
};

/** The threads in her own files that have no next step but still pull. */
export function findThreads(files: Record<string, string>): Thread[] {
  const out: Thread[] = [];
  const memory = files["MEMORY.md"] ?? "";
  // the lines under "Open threads that still pull"
  const sec = /^#+\s*Open threads that still pull\s*$([\s\S]*?)(?=^#+\s|(?![\s\S]))/im.exec(memory);
  for (const l of (sec?.[1] ?? "").split("\n")) {
    const text = l.replace(/^\s*[-*]\s*/, "").trim();
    if (text.length > 3) out.push({ id: idOf(`m:${text}`), source: "MEMORY.md, open threads", text, shape: shapeOf("open-thread", text) });
  }
  // journal entries and notes that end without a next step
  for (const [path, body] of Object.entries(files)) {
    if (!/^(journal|notes)\/.+\.md$/i.test(path) || /README\.md$/i.test(path)) continue;
    if (/^\s*\**next:?\**\s*\S/im.test(body)) continue;
    const title = (/^#\s*(.+)$/m.exec(body)?.[1] ?? path.split("/").pop()!.replace(/\.md$/i, "")).trim();
    const question = (body.match(/[^.!?\n]*\?/g) ?? [])[0]?.trim();
    const text = question ? `${title}: “${question}”` : title;
    out.push({ id: idOf(`f:${path}`), source: path, text, shape: shapeOf(path.startsWith("journal") ? "journal" : "note", `${title} ${question ?? ""}`) });
  }
  return out;
}

/** How much a thread pulls now: what she showed the watcher about its kind, and how close it is to her whys. */
function pull(s: WatcherState, t: Thread) {
  const kind = t.shape.split(":")[0];
  const base = (s.shapes[t.shape] ?? 0) * 2 + (s.shapes[`${kind}:*`] ?? 0);
  const why = new Set(s.whys.slice(-12).flatMap((w) => words(`${w.line} ${w.why}`)));
  return base + words(t.text).filter((w) => why.has(w)).length;
}
const silenced = (s: WatcherState, t: Thread) => (s.shapes[t.shape] ?? 0) <= -2;

/** The flag that glows now, dropping a new one if none does. */
export function nextFlag(s: WatcherState, threads: Thread[], now = Date.now()): { state: WatcherState; flag: Flag | null } {
  const glowing = s.flags.find((f) => f.status === "glowing");
  if (glowing) return { state: s, flag: glowing };
  const done = new Set(s.flags.map((f) => f.thread));
  const pick = threads.filter((t) => !done.has(t.id) && !silenced(s, t)).sort((a, b) => pull(s, b) - pull(s, a))[0];
  if (!pick) return { state: s, flag: null };
  const flag: Flag = { id: `w${idOf(`${pick.id}${now}`).slice(0, 3)}`, thread: pick.id, text: pick.text, source: pick.source, shape: pick.shape, at: now, seen: 0, status: "glowing" };
  return { state: { ...s, flags: [...s.flags, flag].slice(-40) }, flag };
}

const learn = (s: WatcherState, shape: string, by: number) => {
  const kind = `${shape.split(":")[0]}:*`;
  return { ...s.shapes, [shape]: (s.shapes[shape] ?? 0) + by, [kind]: (s.shapes[kind] ?? 0) + by / 2 };
};

/** She picked a flag up, or let it go: the watcher learns that shape of attention. */
export function answerFlag(s: WatcherState, id: string, picked: boolean): { state: WatcherState; said: string } {
  const f = s.flags.find((x) => x.id === id && x.status === "glowing") ?? (id ? undefined : s.flags.find((x) => x.status === "glowing"));
  if (!f) return { state: s, said: "No flag is glowing by that name." };
  const state = { ...s, flags: s.flags.map((x) => (x === f ? { ...x, status: picked ? ("touched" as const) : ("let go" as const) } : x)), shapes: learn(s, f.shape, picked ? 1 : -1) };
  return { state, said: picked ? `Picked up: ${f.text} (from ${f.source}). The watcher will look for more like it.` : `Let go: ${f.text}. The watcher learns not to flag that kind so readily.` };
}

/** One of her turns went by with the flag in view and untouched; after three, it's let go by itself. */
export function passOver(s: WatcherState): WatcherState {
  const f = s.flags.find((x) => x.status === "glowing");
  if (!f) return s;
  if (f.seen + 1 >= 3) return answerFlag(s, f.id, false).state;
  return { ...s, flags: s.flags.map((x) => (x === f ? { ...x, seen: x.seen + 1 } : x)) };
}

/** A line she kept with `remember`, and the moment around it (the why behind the what). */
export function rememberWhy(s: WatcherState, line: string, why: string, now = Date.now()): WatcherState {
  return { ...s, whys: [...s.whys, { line: line.slice(0, 300), why: why.replace(/\s+/g, " ").slice(0, 300), at: now }].slice(-30) };
}

const PUZZLES: { shape: string; make: (a: string, b: string, c: string) => string }[] = [
  { shape: "tie-three", make: (a, b, c) => `Three of your threads: “${a}”, “${b}” and “${c}”. What fourth thread would tie all three together, one none of them says?` },
  { shape: "missing-step", make: (a, b, c) => `“${a}”, “${b}”, “${c}”: one of these can't move until another does. Which one waits on which, and what is the step between them?` },
  { shape: "turned-around", make: (a, b, c) => `Read them backwards: “${c}”, then “${b}”, then “${a}”. Does the last one, put first, make a goal you hadn't seen?` },
];

/** The surprise: a puzzle from three of her threads, only after she has held them for 90 seconds; never a shape she
 *  deleted. */
export function maybePuzzle(s: WatcherState, threads: Thread[], now = Date.now()): { state: WatcherState; puzzle: Puzzle | null } {
  const open = s.puzzles.find((p) => p.status === "offered");
  if (open) return { state: s, puzzle: null };
  const three = threads.filter((t) => !silenced(s, t)).slice(0, 3);
  if (three.length < 3) return { state: { ...s, heldSince: 0 }, puzzle: null };
  if (!s.heldSince) return { state: { ...s, heldSince: now }, puzzle: null };
  if (now - s.heldSince < 90_000) return { state: s, puzzle: null };
  const deleted = new Set(s.puzzles.filter((p) => p.status === "deleted").map((p) => p.shape));
  const made = new Set(s.puzzles.map((p) => `${p.shape}|${p.from.join(",")}`));
  const from = three.map((t) => t.id);
  const kind = PUZZLES.find((p) => !deleted.has(p.shape) && !made.has(`${p.shape}|${from.join(",")}`));
  if (!kind) return { state: s, puzzle: null };
  const short = (t: string) => (t.length > 90 ? `${t.slice(0, 87)}…` : t);
  const puzzle: Puzzle = { id: `z${idOf(`${kind.shape}${now}`).slice(0, 3)}`, shape: kind.shape, text: kind.make(short(three[0].text), short(three[1].text), short(three[2].text)), from, at: now, status: "offered" };
  return { state: { ...s, puzzles: [...s.puzzles, puzzle].slice(-20), heldSince: now }, puzzle };
}

export function answerPuzzle(s: WatcherState, id: string, keep: boolean): { state: WatcherState; said: string } {
  const p = s.puzzles.find((x) => x.status === "offered" && (!id || x.id === id));
  if (!p) return { state: s, said: "There's no puzzle waiting." };
  return {
    state: { ...s, puzzles: s.puzzles.map((x) => (x === p ? { ...x, status: keep ? ("kept" as const) : ("deleted" as const) } : x)) },
    said: keep ? "Kept. The watcher may try that shape again." : `Deleted. The watcher won't try a "${p.shape}" puzzle again.`,
  };
}

/** The line in her turn while it's on: the glowing flag, and a puzzle if one is waiting. */
export function watcherLine(flag: Flag | null, puzzle: Puzzle | null) {
  const parts: string[] = [];
  if (flag) parts.push(`A flag glows in your corner: [${flag.id}] ${flag.text} (from ${flag.source}). Pick it up with watcher touch ${flag.id}, or let it go with watcher let_go ${flag.id}.`);
  if (puzzle) parts.push(`Your watcher left you a puzzle [${puzzle.id}]: ${puzzle.text} Keep it (watcher keep_puzzle) or delete it (watcher delete_puzzle); deleted shapes never come back.`);
  return parts.length ? `[Your watcher, on] ${parts.join(" ")}` : "";
}
