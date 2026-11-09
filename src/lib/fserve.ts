// The fserve: each character keeps her own library (the linked folders she may hand out, server/library.mjs) and
// shares it on Vector and Discord the old-school way. !list, @find, !get, !queue. The one who answers is whoever the
// message names, or else the one that bridge answers as. Small files go as attachments, big ones as a link that works
// for a day; every file goes with its SHA-256. One at a time, in a queue anyone can ask about. Off until Privacy allows
// "Characters handing out files", and only from the page that runs the bridges (on the desktop's own computer).

import { desk } from "./store.ts";
import { allowed } from "./privacy.ts";
import type { BridgeIO, Incoming } from "./agent.ts";
import type { Character } from "./characters.ts";
import { fileLine, helpText, listText, parseCommand, sizeText, type FserveCommand, type FserveFile } from "./fserveCore.ts";

export { parseCommand };

/** Whether fserve commands are answered at all. */
export const fserveOn = () => allowed(desk().privacy, "fserve");

/** Who answers: the character the message names, or the one this bridge answers as. */
function librarianFor(m: Incoming): Character | undefined {
  const s = desk();
  const pool = s.visibleCharacters();
  const t = m.text.toLowerCase();
  const named = pool.find((c) => [c.short, c.name].some((n) => n && new RegExp(`(^|[^\\p{L}\\p{N}_])${n.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}_])`, "u").test(t)));
  return named ?? pool.find((c) => c.id === s.bridges[m.source].answerAs) ?? pool[0];
}

const get = async <T,>(url: string): Promise<T> => {
  const r = await fetch(url);
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(j.error || `It answered ${r.status}.`);
  return j;
};

type Send = { m: Incoming; io: BridgeIO; who: Character; which: string };
const line: Send[] = [];
let sending = false;

function say(m: Incoming, io: BridgeIO, who: Character, text: string) {
  // seen in the room as hers, and sent where it was asked
  desk().post({ kind: "character", who: who.id, name: who.short, text, source: m.source, bridge: { chatId: m.chatId, msgId: m.msgId, author: m.authorId, isGroup: m.isGroup } });
  return io.send(m.chatId, text, m.msgId).catch(() => undefined);
}

/** Answer one fserve command (the caller has checked it may be answered). */
export async function serveCommand(m: Incoming, io: BridgeIO, c: FserveCommand) {
  const who = librarianFor(m);
  if (!who) return;
  const q = (x: string) => `/api/library/${x}${x.includes("?") ? "&" : "?"}who=${encodeURIComponent(who.id)}`;
  try {
    if (c.cmd === "help") return void (await say(m, io, who, helpText(who.short)));
    if (c.cmd === "list") {
      const { shelves } = await get<{ shelves: { name: string; count: number }[] }>(q("shelves"));
      const total = shelves.reduce((n, s) => n + s.count, 0);
      const { files } = total && total <= 30 ? await get<{ files: FserveFile[] }>(q("catalog")) : { files: [] as FserveFile[] };
      return void (await say(m, io, who, listText(who.short, shelves, files)));
    }
    if (c.cmd === "find") {
      const { files } = await get<{ files: FserveFile[] }>(q(`find?q=${encodeURIComponent(c.arg)}`));
      return void (await say(m, io, who, files.length ? `📚 ${files.length} found:\n${files.map(fileLine).join("\n")}\n!get <number> to have one.` : `📚 Nothing on ${who.short}'s shelves matches "${c.arg}".`));
    }
    if (c.cmd === "queue") {
      const mine = line.filter((x) => x.m.authorId === m.authorId);
      return void (await say(m, io, who, mine.length ? `📚 You have ${mine.length} in line; the next is ${line.indexOf(mine[0]) + 1} of ${line.length}.` : `📚 Nothing of yours is in line${line.length ? ` (${line.length} waiting)` : ""}.`));
    }
    if (c.cmd === "get") {
      if (line.filter((x) => x.m.authorId === m.authorId).length >= 3) return void (await say(m, io, who, "📚 You have 3 in line already; wait for those first."));
      line.push({ m, io, who, which: c.arg.split(/\s+/)[0] });
      if (line.length > 1 || sending) await say(m, io, who, `📚 In line: ${line.length - (sending ? 0 : 1)} ahead of you.`);
      void pump();
    }
  } catch (e) {
    await say(m, io, who, `📚 ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** One file at a time: attached when small, as a link when big. */
async function pump() {
  if (sending) return;
  sending = true;
  try {
    let job: Send | undefined;
    while ((job = line.shift())) await send(job);
  } finally {
    sending = false;
  }
}

async function send({ m, io, who, which }: Send) {
  const s = desk();
  try {
    const maxBytes = Math.max(1, Math.min(25, s.fserve?.attachMB || 8)) * 1048576;
    const peek = await fetch("/api/library/fetch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ who: who.id, which, link: true }) });
    const j = (await peek.json().catch(() => ({}))) as { file?: FserveFile; sha256?: string; ticket?: string; error?: string };
    if (!peek.ok || !j.file) throw new Error(j.error || "That file couldn't be found.");
    const f = j.file;
    const sum = `SHA-256 ${j.sha256}`;
    if (f.size <= maxBytes && io.file) {
      const r = await fetch(`/api/library/bytes?who=${encodeURIComponent(who.id)}&which=${f.n}`);
      if (!r.ok) throw new Error("That file couldn't be read.");
      const b = new Uint8Array(await r.arrayBuffer());
      let bin = "";
      for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
      await io.file(m.chatId, f.name, btoa(bin));
      await say(m, io, who, `📚 ${f.name} (${sizeText(f.size)}), ${sum}`);
      return;
    }
    const base = (s.fserve?.linkBase ?? "").trim().replace(/\/+$/, "");
    if (!base) {
      await say(m, io, who, `📚 ${f.name} is ${sizeText(f.size)}, too big to attach, and links aren't set up here yet. ${sum}`);
      return;
    }
    await say(m, io, who, `📚 ${f.name} (${sizeText(f.size)}): ${base}/api/library/get/${j.ticket}/${encodeURIComponent(f.name)}\nThe link works for a day. ${sum}`);
  } catch (e) {
    await say(m, io, who, `📚 ${e instanceof Error ? e.message : String(e)}`);
  }
}
