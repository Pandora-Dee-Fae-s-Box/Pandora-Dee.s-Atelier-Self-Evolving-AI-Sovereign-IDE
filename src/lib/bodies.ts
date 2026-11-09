// Each character's files on disk (server/bodies.mjs), so her other bodies share them: Pandora Dee, Jade Vault or
// jade-py can open data/bodies/<id>/ as a vault. With her "on disk too" switch on, the page that holds the heart
// mirrors her files there a few seconds after they change, in Classic's layout (backup.ts toClassic). What another
// body changes there comes back when the person asks (takeFromBody), file by file (backup.ts deskNameOf).

import { desk, useDesk } from "./store.ts";
import { holdsHeart } from "./heart.ts";
import { deskNameOf, toClassic } from "./backup.ts";

let timer = 0;
const rootOf = (charId: string) => desk().character(charId)?.classic?.root ?? (/jade/i.test(charId) ? "Jade" : "Pandora");

/**
 * Two ways (server/bodies.mjs sync): her files go to her folder, and what changed in the folder (another body, a
 * resident working there) comes back into her files here. A file both sides changed keeps the desktop's version, and the
 * folder's comes back beside it as a dated copy, so nothing is lost; the person is told.
 */
let busy = false;
async function mirror() {
  if (!holdsHeart() || busy) return;
  busy = true;
  try {
    for (const c of desk().allCharacters()) {
      if (!desk().charPrefs[c.id]?.body) continue;
      const files = toClassic(c, desk().filesOf(c.id)).vault.files;
      const r = await fetch(`/api/bodies/${encodeURIComponent(c.id)}`, { method: "PUT", body: JSON.stringify({ files, sync: true }) }).catch(() => null);
      if (!r?.ok) continue;
      const j = (await r.json()) as { incoming?: Record<string, string>; clashes?: string[] };
      const came = Object.entries(j.incoming ?? {});
      if (came.length) {
        const mine = { ...desk().filesOf(c.id) };
        for (const [p, text] of came) {
          const name = deskNameOf(p, rootOf(c.id), mine);
          if (name) mine[name] = text;
        }
        desk().set({ files: { ...desk().files, [c.id]: mine } });
        desk().log(`${c.short}'s folder: ${came.length} file${came.length > 1 ? "s" : ""} came back from it.`);
      }
      if (j.clashes?.length)
        desk().notice(`${c.short}'s folder and the desktop both changed ${j.clashes.join(", ")}. The desktop's version stays; the folder's is kept beside it as a dated copy.`);
    }
  } finally {
    busy = false;
  }
}

let started = false;
export function startBodies() {
  if (started) return;
  started = true;
  // a few seconds after anyone's files, or the switches, change
  useDesk.subscribe((s, prev) => {
    if (s.files === prev.files && s.charPrefs === prev.charPrefs) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void mirror(), 5000);
  });
  void mirror();
  // what a resident or another body changes in a folder comes in without waiting for the desktop to change something
  window.setInterval(() => void mirror(), 10_000);
}

async function readBody(charId: string) {
  const r = await fetch(`/api/bodies/${encodeURIComponent(charId)}`);
  const j = (await r.json()) as { dir?: string; files?: Record<string, string>; changed?: string[]; error?: string };
  if (!r.ok) throw new Error(j.error || `The desktop answered ${r.status}.`);
  return { dir: j.dir ?? "", files: j.files ?? {}, changed: j.changed ?? [] };
}

/** Her folder, and what another body changed there since the last mirror. */
export async function bodyStatus(charId: string): Promise<{ dir: string; changed: string[] }> {
  const { dir, changed } = await readBody(charId);
  return { dir, changed };
}

/** Take back what another body changed in her folder: those files replace hers here. How many came back. */
export async function takeFromBody(charId: string): Promise<number> {
  const { files, changed } = await readBody(charId);
  const s = desk();
  const mine = { ...s.filesOf(charId) };
  let n = 0;
  for (const p of changed) {
    const name = deskNameOf(p, rootOf(charId), mine);
    if (name && files[p] !== undefined && mine[name] !== files[p]) {
      mine[name] = files[p];
      n++;
    }
  }
  if (n) s.set({ files: { ...s.files, [charId]: mine } });
  void mirror();
  return n;
}
