// The adventure log: what a character met in the browser, what she did, and how it went. It records, it doesn't
// judge; nothing here tells her what to do. Kept as plain lines in her own files (adventures/<year-month>.md).

export type Trail = {
  /** The site she's on, and a human check (CAPTCHA or similar) that's showing there, with what she's done since. */
  host?: string;
  check?: { host: string; at: number; steps: string[] };
};

export type Seen = { host: string; humanCheck: boolean };

export function hostOf(url: string): string {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u.host.replace(/^www\./, "") : ""; // the browser's own pages aren't places
  } catch {
    return "";
  }
}

const listSteps = (steps: string[]) => (steps.length ? `: ${steps.slice(0, 12).join(", ")}${steps.length > 12 ? `, … (${steps.length - 12} more)` : ""}` : "");

/** A step she took (already described in words), remembered while a check is showing. */
export function noteStep(t: Trail, step: string): Trail {
  return t.check ? { ...t, check: { ...t.check, steps: [...t.check.steps, step] } } : t;
}

/** What the page looks like after a step: returns the trail and any lines for the log. */
export function noteSeen(t: Trail, seen: Seen, now: number): { trail: Trail; lines: string[] } {
  const lines: string[] = [];
  let check = t.check;
  if (check) {
    const n = check.steps.length;
    const after = `after ${n} step${n === 1 ? "" : "s"}${listSteps(check.steps)}`;
    if (seen.host === check.host && !seen.humanCheck) {
      lines.push(`The check on ${check.host} was gone ${after}.`);
      check = undefined;
    } else if (seen.host !== check.host) {
      lines.push(`Moved on from the check on ${check.host} to ${seen.host || "a blank page"} ${after}.`);
      check = undefined;
    }
  }
  if (seen.host && seen.host !== t.host) lines.push(`Went to ${seen.host}.`);
  if (seen.humanCheck && !check) {
    check = { host: seen.host, at: now, steps: [] };
    lines.push(`Met a human check (CAPTCHA or similar) on ${seen.host}.`);
  }
  return { trail: { host: seen.host || t.host, check }, lines };
}

/** One line of the log: UTC time, the model she was thinking with, what happened. */
export function logLine(now: number, model: string | undefined, text: string): string {
  const d = new Date(now).toISOString();
  return `- ${d.slice(0, 10)} ${d.slice(11, 16)}Z${model ? ` · ${model}` : ""} · ${text}`;
}

export const logPath = (now: number) => `adventures/${new Date(now).toISOString().slice(0, 7)}.md`;
export const LOG_HEADER = "# Adventure log\n\nWhat I met out there, what I did, and how it went.\n\n";

/** A macro's name as a file name: macros/<name>.json in her files. */
export const macroPath = (name: string) => `macros/${name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "macro"}.json`;
