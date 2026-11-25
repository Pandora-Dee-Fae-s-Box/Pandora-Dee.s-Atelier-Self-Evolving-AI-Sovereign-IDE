// Games across linked SEASIDEs (server/gameLinks.mjs), on the desk: invitations and open links in the Games library,
// and "play this with another SEASIDE" in an open game's lantern. Linking the servers themselves is PADS › Servers.

import { useEffect, useState } from "react";
import { desk, useDesk } from "../lib/store.ts";

export type GameLink = {
  id: string;
  role: "host" | "guest";
  peerId: string;
  peerName: string;
  scope?: string;
  localScope: string;
  pkgId: string;
  appKey: string;
  name: string;
  version: string;
  until: number;
  by: string;
  status: "offered" | "invited" | "open" | "closed" | "declined";
  why?: string;
};
type Server = { id: string; name: string; url: string };

async function api<T>(body?: unknown): Promise<T> {
  const r = await fetch("/api/game-links", body ? { method: "POST", body: JSON.stringify(body) } : undefined);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? `The desktop answered ${r.status}.`);
  return j as T;
}

/** The links and linked servers, fetched every few seconds while shown. */
function useLinks(every = 5000) {
  const [state, setState] = useState<{ links: GameLink[]; servers: Server[] }>({ links: [], servers: [] });
  useEffect(() => {
    let live = true;
    const load = () => void api<{ links: GameLink[]; servers: Server[] }>().then((s) => live && setState(s)).catch(() => {});
    load();
    const t = window.setInterval(load, every);
    window.addEventListener("pdd-game-links", load);
    return () => {
      live = false;
      window.clearInterval(t);
      window.removeEventListener("pdd-game-links", load);
    };
  }, [every]);
  return state;
}
const changed = () => window.dispatchEvent(new Event("pdd-game-links"));
const until = (t: number) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** Open a linked game here: the guest's own copy, which mirrors the host's. */
export function openLinked(l: GameLink) {
  desk().set({ game: { kind: "xdc", slug: l.appKey, title: `${l.name} (with ${l.peerName})`, players: [], pkgId: l.pkgId, scope: l.localScope } });
}

/** In the Games library: invitations from linked SEASIDEs, and games being played with them. */
export function LinkedGames() {
  const { links } = useLinks();
  const [busy, setBusy] = useState("");
  const shown = links.filter((l) => l.status === "invited" || (l.status === "open" && l.role === "guest"));
  if (!shown.length) return null;
  const act = async (op: string, l: GameLink) => {
    setBusy(l.id);
    try {
      const done = await api<GameLink>({ op, id: l.id });
      changed();
      if (op === "accept") openLinked({ ...l, ...done, localScope: `link-${l.id}` });
    } catch (e) {
      desk().notice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };
  return (
    <div className="linked-games small">
      {shown.map((l) => (
        <div key={l.id} className="linked-game">
          {l.status === "invited" ? (
            <>
              <div>
                <b>{l.peerName}</b> invites you to play <b>{l.name}</b>
                {l.by ? ` (from ${l.by})` : ""}, until {until(l.until)}.
              </div>
              <div className="row">
                <button className="btn small primary" disabled={busy === l.id} onClick={() => void act("accept", l)}>
                  {busy === l.id ? "Joining…" : "Join"}
                </button>
                <button className="btn small" disabled={busy === l.id} onClick={() => void act("decline", l)}>
                  No thanks
                </button>
              </div>
            </>
          ) : (
            <>
              <div>
                Playing <b>{l.name}</b> with <b>{l.peerName}</b>, until {until(l.until)}.
              </div>
              <div className="row">
                <button className="btn small primary" onClick={() => openLinked(l)}>
                  Open
                </button>
                <button className="btn small" onClick={() => void act("close", l)}>
                  Close the link
                </button>
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

/** In an open game's lantern: play it with a linked SEASIDE (only what you name, for as long as you name it). */
export function LinkThisGame({ scope, pkgId }: { scope: string; pkgId?: string }) {
  const { links, servers } = useLinks(4000);
  const session = useDesk((s) => s.session);
  const [peer, setPeer] = useState("");
  const [hours, setHours] = useState(3);
  const [err, setErr] = useState("");
  const mine = links.filter((l) => l.localScope === scope && (l.status === "open" || l.status === "offered"));
  const guest = mine.find((l) => l.role === "guest");
  const close = async (l: GameLink) => {
    try {
      await api({ op: "close", id: l.id });
      changed();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  const offer = async () => {
    setErr("");
    try {
      await api({ op: "offer", peerId: peer || servers[0]?.id, scope, pkgId, hours, by: session ?? "" });
      changed();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="game-link">
      <b>Other SEASIDEs</b>
      {mine.map((l) => (
        <div key={l.id}>
          {l.role === "guest" ? `This game is ${l.peerName}'s, shared with you` : l.status === "offered" ? `Offered to ${l.peerName}, waiting for them` : `Shared with ${l.peerName}`} until {until(l.until)}.{" "}
          <button className="btn tiny" onClick={() => void close(l)}>
            Close
          </button>
        </div>
      ))}
      {!guest && pkgId ? (
        servers.length ? (
          <div className="row">
            <select className="input" value={peer || servers[0]?.id} onChange={(e) => setPeer(e.target.value)} aria-label="Which SEASIDE">
              {servers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <select className="input" value={hours} onChange={(e) => setHours(Number(e.target.value))} aria-label="For how long">
              {[1, 3, 8, 24].map((h) => (
                <option key={h} value={h}>
                  {h === 1 ? "for an hour" : `for ${h} hours`}
                </option>
              ))}
            </select>
            <button className="btn small" onClick={() => void offer()}>
              Play it together
            </button>
          </div>
        ) : (
          <div className="muted">Link another SEASIDE first (PADS › Servers), then you can play this with it.</div>
        )
      ) : null}
      {err ? <div className="warn">{err}</div> : null}
    </div>
  );
}
