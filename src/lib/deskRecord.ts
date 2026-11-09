// The desk's record of what actually ran, beside what a character says she did. It's for any agent: she rereads her
// earlier replies with what really happened next to them, so she can correct her own context without losing it, and
// she's told plainly when a reply describes tool use that didn't happen. Facts only; what she makes of them is hers.

type Use = { note: string; ok: boolean; desk?: boolean; out?: string };

/** The start of what a tool gave back, on one line: enough to carry her evidence forward, not the whole page. */
const gist = (out?: string) => {
  const t = (out ?? "").replace(/\s+/g, " ").trim();
  return t ? ` → "${t.length > 160 ? `${t.slice(0, 160)}…` : t}"` : "";
};

// first-person accounts of using a tool: "I used my browser", "I searched", "I've opened…", "I navigated to…"
const CLAIM =
  /\b(?:I|I've|I have|I just)\s+(?:used|searched|opened|navigated|visited|browsed|looked (?:it |that |this )?up|fetched|clicked|went to|ran|called|loaded|pulled up|checked (?:the|my|your|its) (?:browser|page|site|web|repo|repository|search|results|vault|keys|files))\b/i;

export function claimsTool(text: string): boolean {
  return CLAIM.test(text);
}

/** The line added to one of her earlier replies when she rereads it: what ran, or that nothing did. */
export function recordLine(tools: Use[] | undefined, text: string): string {
  const real = (tools ?? []).filter((t) => !t.desk);
  const notes = (tools ?? []).filter((t) => t.desk).map((t) => t.note);
  const ran = real.length
    ? `${real.slice(0, 8).map((t) => `${t.note} ${t.ok ? "✓" : "✗"}${gist(t.out)}`).join("; ")}${real.length > 8 ? `; and ${real.length - 8} more` : ""}`
    : notes.length || claimsTool(text)
      ? "no tools ran in this reply"
      : "";
  if (!ran) return "";
  return `[desk record: ${ran}${notes.length ? ` · desk notes: ${notes.join("; ")}` : ""}]`;
}

/** Records she writes herself, imitating the desk's: removed from her reply. */
export const stripRecords = (text: string) => text.replace(/\n*\[desk (?:record|note)[^\]\n]*\]\s*/gi, "\n").replace(/\n{3,}/g, "\n\n");

export const CLAIM_NOTE = "[Desk note] No tool ran in this reply, so what you described didn't come from one.";
