// Soft commitments (Dee's idea): a plan left on the table in a shared game, "on my turn, if the frost reaches column 3,
// I'll cover the pumpkins", that everyone can see, revise or cancel. Shared memory that doesn't only live in chat, and
// not automation: nothing happens by itself; a plan is a promise in plain words.
// Kept in the vault (Games/plans/<game>.json), so every device on this SEASIDE sees the same table, and people and
// characters can read or tidy it like any other file.

export type Plan = { id: string; by: string; text: string; at: number; revisedAt?: number; revisedBy?: string; status: "open" | "done" | "cancelled"; closedBy?: string };
export type PlanAction =
  | { do: "add"; by: string; text: string; id?: string; at?: number }
  | { do: "revise"; id: string; by: string; text: string; at?: number }
  | { do: "done" | "cancel"; id: string; by: string; at?: number };

const MAX = 40;

/** The table after one action; a plan someone mentions by a few words of its text is found too. */
export function applyPlan(list: Plan[], a: PlanAction): { list: Plan[]; said: string } {
  const now = a.at ?? Date.now();
  if (a.do === "add") {
    const text = a.text.trim().slice(0, 400);
    if (!text) return { list, said: "Say what the plan is." };
    const id = a.id ?? `p${now.toString(36)}`;
    return { list: [...list, { id, by: a.by, text, at: now, status: "open" as const }].slice(-MAX), said: `Plan ${id} is on the table.` };
  }
  const p = findPlan(list, a.id);
  if (!p) return { list, said: `There's no open plan "${a.id}". The table: ${plansLine(list, now) || "empty"}` };
  if (a.do === "revise") {
    const text = a.text.trim().slice(0, 400);
    if (!text) return { list, said: "Say what the plan is now." };
    return { list: list.map((x) => (x === p ? { ...x, text, revisedAt: now, revisedBy: a.by } : x)), said: `Plan ${p.id} revised.` };
  }
  const status = a.do === "done" ? ("done" as const) : ("cancelled" as const);
  return { list: list.map((x) => (x === p ? { ...x, status, closedBy: a.by, revisedAt: now } : x)), said: `Plan ${p.id} ${a.do === "done" ? "kept" : "cancelled"}.` };
}

export function findPlan(list: Plan[], key: string) {
  const open = list.filter((p) => p.status === "open");
  const k = key.trim().toLowerCase();
  return open.find((p) => p.id.toLowerCase() === k) ?? open.find((p) => k.length >= 4 && p.text.toLowerCase().includes(k));
}

const ago = (ms: number) => (ms < 60_000 ? "just now" : ms < 3_600_000 ? `${Math.round(ms / 60_000)} min ago` : `${Math.round(ms / 3_600_000)} h ago`);

/** The open plans, one line each, for a character's turn. */
export function plansLine(list: Plan[], now = Date.now()) {
  return list
    .filter((p) => p.status === "open")
    .map((p) => `[${p.id}] ${p.by}: "${p.text}" (${ago(now - p.at)}${p.revisedBy ? `, revised by ${p.revisedBy}` : ""})`)
    .join("\n");
}

const fileOf = (scope: string) => `Games/plans/${scope.replace(/[^\w.@-]+/g, "-")}.json`;

export async function loadPlans(scope: string): Promise<Plan[]> {
  try {
    // (the folder's listing first: a game nobody has left a plan in has no file, and asking for it every few seconds
    // would fill the console with "not found")
    const path = fileOf(scope);
    const dir = await fetch(`/api/vault/list?path=${encodeURIComponent("Games/plans")}`);
    const names = dir.ok ? ((await dir.json()) as { name: string }[]).map((e) => e.name) : [];
    if (!names.includes(path.split("/").pop()!)) return [];
    const r = await fetch(`/api/vault/file?path=${encodeURIComponent(path)}`);
    if (!r.ok) return [];
    const j = (await r.json()) as unknown;
    return Array.isArray(j) ? (j as Plan[]) : [];
  } catch {
    return [];
  }
}

/** One action, read fresh from the vault and written back (so two devices adding plans don't lose each other's). */
export async function changePlans(scope: string, a: PlanAction) {
  const r = applyPlan(await loadPlans(scope), a);
  await fetch(`/api/vault/file?path=${encodeURIComponent(fileOf(scope))}`, { method: "PUT", body: JSON.stringify(r.list, null, 1) });
  window.dispatchEvent(new Event("pdd-plans"));
  return r;
}
