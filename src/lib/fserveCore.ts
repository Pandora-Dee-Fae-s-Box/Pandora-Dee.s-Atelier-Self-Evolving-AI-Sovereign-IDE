// The fserve's commands, the old-school way, and how its answers read. Pure (no page, no store), so it's tested on its
// own (fserveCore.test.ts); lib/fserve.ts does the handing out.

export type FserveCommand = { cmd: "list" | "find" | "get" | "queue" | "help"; arg: string };

/** A line someone sent, as an fserve command, or null when it isn't one. */
export function parseCommand(text: string): FserveCommand | null {
  const t = text.trim();
  const m = /^(?:!(list|get|send|queue|fserve|files)|@(find|search))(?:\s+([\s\S]*))?$/i.exec(t);
  if (!m) return null;
  const word = (m[1] ?? m[2]).toLowerCase();
  const arg = (m[3] ?? "").trim().slice(0, 200);
  if (word === "find" || word === "search") return arg ? { cmd: "find", arg } : { cmd: "help", arg: "" };
  if (word === "get" || word === "send") return arg ? { cmd: "get", arg } : { cmd: "help", arg: "" };
  if (word === "queue") return { cmd: "queue", arg };
  if (word === "list") return { cmd: "list", arg };
  return { cmd: "help", arg: "" };
}

export const sizeText = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${Math.round(n / 1e3)} KB` : `${n} B`);

export type FserveFile = { n: number; shelf: string; rel: string; name: string; size: number };

/** One line per file: "#12 · Models/small/tiny.gguf · 4.1 GB". */
export const fileLine = (f: FserveFile) => `#${f.n} · ${f.shelf}/${f.rel} · ${sizeText(f.size)}`;

export function helpText(librarian: string) {
  return [
    `📚 ${librarian}'s library`,
    "!list: what's on the shelves",
    "@find <words>: files with those words in their name",
    "!get <number>: the file (small ones attached, big ones as a link), with its SHA-256",
    "!queue: where your files are in line",
  ].join("\n");
}

/** What !list says: the shelves, and every file when there are only a few. */
export function listText(librarian: string, shelves: { name: string; count: number }[], files: FserveFile[]) {
  if (!shelves.length) return `📚 ${librarian} isn't handing out any files right now.`;
  const total = shelves.reduce((n, s) => n + s.count, 0);
  const head = `📚 ${librarian}'s library: ${total} file${total === 1 ? "" : "s"} on ${shelves.map((s) => `${s.name} (${s.count})`).join(", ")}.`;
  if (files.length && files.length <= 30) return `${head}\n${files.map(fileLine).join("\n")}\n!get <number> to have one.`;
  return `${head}\n@find <words> to look for one, then !get <number>.`;
}
