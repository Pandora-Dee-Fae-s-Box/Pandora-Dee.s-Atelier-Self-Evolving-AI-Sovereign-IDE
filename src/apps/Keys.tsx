import { useState } from "react";
import { Trash2 } from "lucide-react";
import { desk, useDesk } from "../lib/store.ts";
import { Sensitive } from "../ui/common.tsx";
import { useResidentKeys } from "../lib/residentKeys.ts";

/** The desktop's environment: named keys whose values are never shown again. */
export function KeysApp() {
  const s = useDesk();
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const isKeyholder = s.role() === "keyholder";
  const names = Object.keys(s.env).sort();
  const save = (k: string, v: string) => desk().set({ env: { ...desk().env, [k]: v } });

  if (!isKeyholder) return <div className="empty">Only accounts with full access can see or change keys.</div>;

  return (
    <div className="section">
      <h2>
        Keys <Sensitive />
      </h2>
      <p className="lead small">
        API keys and bridge tokens, like environment variables. Characters and connections ask for a key by name; values are never shown once saved, never put in character backups, and never sent anywhere except to the service they belong to. They're stored in this browser on this computer, not encrypted.
      </p>
      {names.map((k) => (
        <div key={k} className="kv">
          <span className="mono small">{k}</span>
          {editing === k ? (
            <input className="input mono" type="password" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (save(k, draft), setEditing(null))} placeholder="Paste the value" />
          ) : (
            <span className={s.env[k] ? "small" : "small faint"} style={{ color: s.env[k] ? "var(--good)" : undefined }}>
              {s.env[k] ? "Set" : "Empty"}
            </span>
          )}
          <div className="row" style={{ gap: 4 }}>
            {editing === k ? (
              <>
                <button className="btn small primary" onClick={() => (save(k, draft), setEditing(null))}>
                  Save
                </button>
                <button className="btn small" onClick={() => setEditing(null)}>
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button className="btn small" onClick={() => (setEditing(k), setDraft(""))}>
                  {s.env[k] ? "Replace" : "Set"}
                </button>
                {s.env[k] ? (
                  <button className="btn small" onClick={() => save(k, "")}>
                    Clear
                  </button>
                ) : null}
                <button
                  className="icon-btn"
                  aria-label={`Remove ${k}`}
                  onClick={() => {
                    const env = { ...desk().env };
                    delete env[k];
                    desk().set({ env });
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </>
            )}
          </div>
        </div>
      ))}
      <div className="divider" />
      <h4>Add a key</h4>
      <div className="row">
        <input className="input mono" style={{ maxWidth: 220 }} placeholder="NAME_LIKE_THIS" value={name} onChange={(e) => setName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"))} />
        <input className="input mono grow" type="password" placeholder="Value" value={value} onChange={(e) => setValue(e.target.value)} />
        <button
          className="btn primary"
          disabled={!name}
          onClick={() => {
            save(name, value);
            setName("");
            setValue("");
          }}
        >
          Add
        </button>
      </div>
      <p className="small faint" style={{ marginTop: 10 }}>
        Characters can use a key inside a web request by writing {"{{NAME}}"}; they never see the value itself.
      </p>
      <KeyHosts household={names} />
    </div>
  );
}

/** Where each key may go: a key tied to hosts is only ever sent there by a character's requests (lib/netGuard.ts).
 *  By name, so it covers the household's keys and the characters' own of the same name. */
function KeyHosts({ household }: { household: string[] }) {
  const net = useDesk((s) => s.net);
  const { names: theirs } = useResidentKeys();
  const all = [...new Set([...household, ...Object.values(theirs).flat()])].sort();
  const set = (k: string, v: string) => {
    const keyHosts = { ...(desk().net.keyHosts ?? {}) };
    if (v.trim()) keyHosts[k] = v;
    else delete keyHosts[k];
    desk().set({ net: { ...desk().net, keyHosts } });
  };
  if (!all.length) return null;
  return (
    <>
      <div className="divider" />
      <h4>Where each key may go</h4>
      <p className="small muted">
        A key tied to hosts is only ever sent there when a character makes a request, so a page she reads can't talk her into sending it anywhere else. Empty: any
        public site. Use *.example.com for a site and everything under it.
      </p>
      {all.map((k) => (
        <div key={k} className="kv">
          <span className="mono small">{k}</span>
          <input className="input mono grow" placeholder="any public site" value={net.keyHosts?.[k] ?? ""} onChange={(e) => set(k, e.target.value)} aria-label={`Hosts ${k} may be sent to`} />
        </div>
      ))}
    </>
  );
}
