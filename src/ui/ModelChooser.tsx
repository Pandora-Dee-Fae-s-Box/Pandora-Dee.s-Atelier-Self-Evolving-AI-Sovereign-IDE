import { useEffect, useRef, useState } from "react";
import { Download, ExternalLink, Library, RefreshCw } from "lucide-react";
import { catalogFor, type CatalogKind } from "../lib/modelCatalog.ts";

export type Downloader = {
  start: (id: string) => Promise<{ state: string; got?: number; total?: number; error?: string }>;
  status: (id: string) => Promise<{ state: string; got?: number; total?: number; error?: string }>;
};

const gb = (n: number) => `${(n / 1e9).toFixed(1)} GB`;

/**
 * A model setting the way the AI connections have it: Scan asks the engine what it has, then you pick from the
 * list (or type a name it didn't list). "Well-known models" shows a short list of good ones, grouped by how much
 * memory they need (marked when the engine says how much it has); ones the engine can fetch have Download, the
 * rest a link to where they come from.
 */
export function ModelChooser({
  value,
  onChange,
  scan,
  placeholder,
  label = "Model",
  kind,
  memory,
  downloader,
  howToGet,
  autoFetch,
}: {
  value: string;
  onChange: (v: string) => void;
  scan: () => Promise<string[]>;
  placeholder: string;
  label?: string;
  /** Which well-known models to offer (none: no catalog). */
  kind?: CatalogKind;
  /** The engine's memory in GB, when it can say. */
  memory?: () => Promise<number | undefined>;
  /** Set when the engine can download a model itself. */
  downloader?: Downloader;
  /** For engines that can't download: what to do with the file (e.g. "Put it in ComfyUI's models/checkpoints"). */
  howToGet?: string;
  /** The engine downloads a model by itself the first time it's used (MLX Audio's server). */
  autoFetch?: boolean;
}) {
  const [list, setList] = useState<string[] | null>(null);
  const [note, setNote] = useState("");
  const [typing, setTyping] = useState(false);
  const [busy, setBusy] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [mem, setMem] = useState<number | undefined>();
  const [dl, setDl] = useState<Record<string, string>>({});
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((t) => window.clearInterval(t)), []);

  const run = async () => {
    setBusy(true);
    setNote("");
    try {
      const got = await scan();
      setList(got);
      setTyping(false);
      setNote(got.length ? `${got.length} on the engine.` : "It answered, but listed none.");
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const browse = () => {
    const open = !browsing;
    setBrowsing(open);
    if (open) {
      if (list === null) void run();
      if (memory) void memory().then(setMem, () => undefined);
    }
  };

  const fetchIt = async (id: string) => {
    if (!downloader) return;
    setDl((d) => ({ ...d, [id]: "Starting…" }));
    try {
      await downloader.start(id);
    } catch (e) {
      return setDl((d) => ({ ...d, [id]: e instanceof Error ? e.message : String(e) }));
    }
    const t = window.setInterval(async () => {
      try {
        const s = await downloader.status(id);
        if (s.state === "done") {
          window.clearInterval(t);
          setDl((d) => ({ ...d, [id]: "Downloaded." }));
          setList((l) => (l && !l.includes(id) ? [...l, id] : l));
        } else if (s.state === "error") {
          window.clearInterval(t);
          setDl((d) => ({ ...d, [id]: s.error || "The download failed." }));
        } else setDl((d) => ({ ...d, [id]: `Downloading… ${gb(s.got ?? 0)}${s.total ? ` of ${gb(s.total)}` : ""}` }));
      } catch {
        /* asked again next time */
      }
    }, 2000);
    timers.current.push(t);
  };

  const groups = kind ? catalogFor(kind, mem) : [];
  const known = groups.flatMap((g) => g.models.map((m) => m.id));
  const showList = list !== null && !typing && list.length > 0;
  return (
    <div className="mini-field grow">
      <span>{label}</span>
      <div className="row" style={{ gap: 6 }}>
        {showList ? (
          <select className="select grow mono" value={value} onChange={(e) => (e.target.value === "\u0000type" ? setTyping(true) : onChange(e.target.value))} aria-label={label}>
            {!list!.includes(value) ? <option value={value}>{value || "The engine's default"}</option> : null}
            {list!.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
            <option value={"\u0000type"}>Type another name…</option>
          </select>
        ) : (
          <input className="input mono grow" value={value} onChange={(e) => onChange(e.target.value.trim())} aria-label={label} placeholder={placeholder} />
        )}
        <button className="btn small" disabled={busy} onClick={() => void run()} data-tip="Ask the engine which models it has">
          <RefreshCw size={13} /> {busy ? "Scanning…" : "Scan"}
        </button>
        {kind ? (
          <button className={`btn small${browsing ? " on" : ""}`} onClick={browse} data-tip="Well-known models, by the memory they need">
            <Library size={13} /> Well-known
          </button>
        ) : null}
      </div>
      {note ? <span className="small muted">{note}</span> : null}
      {browsing && kind ? (
        <div className="model-catalog small">
          <div className="muted">
            {mem ? `The engine's computer has ${mem} GB of memory; ones marked “too big” likely won't fit alongside anything else.` : "How much memory each needs to run comfortably (a Mac's memory, or a PC graphics card's)."}
            {!downloader && howToGet ? ` ${howToGet}` : ""}
          </div>
          {groups.map((g) => (
            <div key={g.label}>
              <b>{g.label}</b>
              {g.models.map((m) => {
                const have = list?.includes(m.id);
                return (
                  <div key={m.id} className={`model-row${m.fits === false ? " faint" : ""}`}>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="mono ellipsis" title={m.id}>
                        {m.id}
                        {m.id === value ? " · in use" : have ? " · on the engine" : ""}
                      </div>
                      <div className="muted">
                        {m.note} · {m.size} GB download · needs about {m.needs} GB{m.fits === false ? " · too big for it" : ""}
                        {m.licence ? ` · ${m.licence}` : ""}
                      </div>
                      {dl[m.id] ? <div>{dl[m.id]}</div> : null}
                    </div>
                    <button className="btn small" disabled={m.id === value} onClick={() => onChange(m.id)} data-tip={have || (!downloader && !autoFetch) ? "Use this one" : "Use this one (it downloads the first time it's used)"}>
                      Use
                    </button>
                    {downloader && !have ? (
                      <button className="btn small" disabled={/^Downloading|^Starting/.test(dl[m.id] ?? "")} onClick={() => void fetchIt(m.id)}>
                        <Download size={12} /> Download
                      </button>
                    ) : !downloader && !autoFetch ? (
                      <a className="btn small" href={m.link} target="_blank" rel="noopener noreferrer">
                        <ExternalLink size={12} /> Get it
                      </a>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))}
          {known.length ? <div className="faint">Sizes from Hugging Face. More models work too: type any name the engine knows.</div> : null}
        </div>
      ) : null}
    </div>
  );
}
