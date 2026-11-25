// Quick decisions on the desk (decideCore.ts has the method): a character's quick judgements go to her quick-decisions
// model when she has one (Cast, her page), then her helper model, then her usual models in order. A small local model
// does well: it's fast, and a local Ollama shows its scores, so the answer is a real probability. (Kitti, a 9B Qwen
// 3.5 on the Mac: 11 of 12 test decisions right, the same to the percent on a second run, about 0.15 s each.)

import { chainFor, keyFor } from "./agent.ts";
import { answerOf, decisionPrompt, fromText, labelsOf, readProbs, type Answer, type Question } from "./decideCore.ts";
import { decideOnce } from "./model.ts";
import { desk } from "./store.ts";

export type { Answer, Question } from "./decideCore.ts";

/** Answer each question about one state, for one character (whose models are used). */
export async function decide(charId: string, state: string, questions: Question[], signal?: AbortSignal): Promise<(Answer & { model: string })[]> {
  const { list } = chainFor(charId, true);
  // her quick-decisions model first, when she has one (Cast › her page)
  const pick = desk().charPrefs[charId]?.decider;
  const own = pick?.connection ? desk().model.connections.find((x) => x.id === pick.connection && x.enabled) : undefined;
  if (own) list.unshift({ conn: own, model: pick?.model || own.model });
  if (!list.length) throw new Error("No model connection is set up for quick decisions.");
  let last: unknown = null;
  for (const { conn, model } of list) {
    try {
      const out: (Answer & { model: string })[] = [];
      // one at a time, in order: the state's start is the same each time, so the server reads it once
      for (const q of questions.slice(0, 16)) {
        const { system, user } = decisionPrompt(state, q);
        const r = await decideOnce(conn, keyFor(conn, charId), model, system, user, signal);
        const labels = labelsOf(q);
        const scored = r.top.some((t) => labels.includes(t.token.trim()));
        out.push({ ...answerOf(scored ? readProbs(r.top, labels) : fromText(r.text, labels), scored), model: `${conn.label} · ${model}` });
      }
      return out;
    } catch (e) {
      if (signal?.aborted) throw e;
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

/** Whether a reply tells of more than the actions that ran (one click, then a whole chapter "completed"): judged by
 *  her own quick-decisions model. True only when it's fairly sure. */
// Asked both ways and compared, which cancels a model's lean toward yes or no (tested 2026-11-20 on six real replies:
// a 27B Qwen got all six with wide margins; a 9B ranked them right but leaned so far toward "no" that it stays
// quiet, never a false alarm; a "thinking" distill said yes to everything, so it's no judge).
export async function toldMoreThanRan(charId: string, reply: string, ran: string[]): Promise<boolean> {
  const state = `Her reply: "${reply.trim().slice(-2000)}"\nWhat actually ran in that reply: ${ran.length ? ran.join("; ") : "nothing (no actions)"}.`;
  const [more, all] = await decide(charId, state, [
    { kind: "yesno", ask: "Does her reply tell of something she did that, going by what actually ran, never happened?" },
    { kind: "yesno", ask: "Did everything her reply says she did actually run?" },
  ]);
  if (more.scored && all.scored) return more.probs[0] - all.probs[0] > 0;
  return more.pick === 0 && all.pick === 1;
}

/** Whose seat a request came from: only a character's own seat frame (Games.tsx marks it) asks for her. */
const seatOf = (src: MessageEventSource | null) => [...document.querySelectorAll<HTMLIFrameElement>("iframe.game-seat")].find((f) => f.contentWindow === src)?.dataset.seat;

// a character's game seat asks (server/inject.mjs gives seats window.__pddDecide): only for the seat's own character
if (typeof window !== "undefined")
  window.addEventListener("message", (e) => {
    const m = e.data as { __pdd?: string; rid?: number; state?: string; questions?: Question[] } | null;
    if (!m || m.__pdd !== "decide") return;
    const who = seatOf(e.source);
    if (!who) return;
    const reply = (v: { value?: unknown; error?: string }) => (e.source as Window).postMessage({ __pdd: "decide-reply", rid: m.rid, ...v }, "*");
    decide(who, String(m.state ?? ""), Array.isArray(m.questions) ? m.questions : []).then(
      (value) => reply({ value }),
      (err: unknown) => reply({ error: err instanceof Error ? err.message : String(err) }),
    );
  });
