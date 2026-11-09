// A tool she meant to use but never called: some models (thinking distills especially) plan the call in their
// reasoning ("I need to use the web_search tool… let me proceed") and then answer without making it. The desk
// tells her plainly that it didn't run, once, the way a button that didn't click shows it. It doesn't tell her
// what to do next.

// her own intent, in the first person: "It claims to open a browser" is about something else
const INTENT = /\b(i'll|i will|i need to|i should|i'm going to|i am going to|i want to|let me|i'd better|i must)\b/i;
const NOT = /\b(if you|want me to|would you like|shall i|should i|i could|i can also|don't|do not|doesn't|no need|not needed|without|instead of|won't|shouldn't|can't|cannot|unavailable|isn't available)\b/i;

/** The first offered tool her thinking or answer says she'll use, if she made no call. */
export function missedTool(thinking: string, text: string, toolNames: string[]): string | null {
  const said = `${thinking}\n${text}`;
  if (!said.trim() || !toolNames.length) return null;
  const sentences = said.split(/(?<=[.!?])\s+|\n+/);
  for (const name of toolNames) {
    const spaced = name.replace(/_/g, " ");
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // the name as written (web_search, `web_search`) or spaced (web search), as a whole word
    const named = new RegExp(`(^|[^\\w])(${esc(name)}${spaced !== name ? `|${esc(spaced)}` : ""})(?![\\w])`, "i");
    for (const s of sentences) if (named.test(s) && INTENT.test(s) && !NOT.test(s)) return name;
  }
  return null;
}

export const missedNote = (name: string) =>
  `[Desk note] ${name} didn't run: tools only run when you call them. Call it if you meant to; otherwise answer as you are.`;
