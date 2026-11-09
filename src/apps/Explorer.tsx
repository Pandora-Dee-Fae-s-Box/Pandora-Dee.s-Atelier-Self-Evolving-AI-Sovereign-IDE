import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft, ChevronLeft, ChevronRight, Copy, Download, ExternalLink, File as FileIcon, FileText, Folder, FolderPlus, FolderUp, Gamepad2, HardDrive, Image as ImageIcon,
  LayoutGrid, LayoutList, Link2, Link2Off, Monitor, RefreshCw, Music2, Network, PackageOpen, RotateCcw, Share2, Smartphone, Trash2, Upload, Video,
} from "lucide-react";
import { desk } from "../lib/store.ts";
import { Markdown } from "../ui/common.tsx";
import { openMenu, openMenuAt, type MenuItem } from "../ui/ContextMenu.tsx";
import { useWidth } from "../ui/hooks.ts";
import { canShareFolder, deviceName, shareFiles, shareFolder, stopSharing, useMyShares } from "../lib/devshare.ts";
import {
  answerPick, baseName, dirName, downloadToDevice, fileApi, kindOf, openXdcInGames, pickInExplorer, rawUrl, showOnDevice, sizeOf, usePickRequest,
  type Entry, type Listing, type Overview, type PickOptions, type Trashed,
} from "../lib/explorer.ts";
import { copyText } from "../lib/clipboard.ts";
import { askText } from "../ui/Ask.tsx";

const ICON: Record<string, (s: number) => React.ReactNode> = {
  folder: (s) => <Folder size={s} />,
  image: (s) => <ImageIcon size={s} />,
  audio: (s) => <Music2 size={s} />,
  video: (s) => <Video size={s} />,
  pdf: (s) => <FileText size={s} />,
  text: (s) => <FileText size={s} />,
  xdc: (s) => <Gamepad2 size={s} />,
  file: (s) => <FileIcon size={s} />,
};
const when = (t: number) => (t ? new Date(t).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "");
const fail = (e: unknown) => desk().say(e instanceof Error ? e.message : String(e));

/** The desktop's file explorer. */
export function ExplorerApp() {
  const [go, setGo] = useState<{ path: string; at: number } | null>(() => {
    try {
      return JSON.parse(sessionStorage.getItem("pdd-explorer-go") || "null");
    } catch {
      return null;
    }
  });
  useEffect(() => {
    const on = (e: Event) => setGo((e as CustomEvent<{ path: string; at: number }>).detail);
    window.addEventListener("pdd-explorer", on);
    return () => window.removeEventListener("pdd-explorer", on);
  }, []);
  return <FileBrowser mode="browse" go={go} />;
}

/** Explorer as a dialog: for Vector's file pickers and "save as" (and anything else that asks). */
export function PickerHost() {
  const req = usePickRequest();
  if (!req) return null;
  const title = req.title || (req.mode === "folder" ? "Choose a folder" : req.mode === "save" ? "Save as" : req.multiple ? "Choose files" : "Choose a file");
  return createPortal(
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && answerPick(null)}>
      <div className="dialog explorer-picker" role="dialog" aria-modal="true" aria-label={title}>
        <h3 style={{ margin: "0 0 8px" }}>{title}</h3>
        <FileBrowser key={req.id} mode={req.mode} pick={req} />
      </div>
    </div>,
    document.body,
  );
}

type Mode = "browse" | PickOptions["mode"];

function FileBrowser({ mode, go, pick }: { mode: Mode; go?: { path: string; at: number } | null; pick?: PickOptions }) {
  const [ov, setOv] = useState<Overview | null>(null);
  const [cwd, setCwd] = useState<string>(() => pick?.start || localStorage.getItem("pdd-explorer-cwd") || "");
  const [listing, setListing] = useState<Listing | null>(null);
  const [trashView, setTrashView] = useState(false);
  const [trashed, setTrashed] = useState<Trashed[]>([]);
  const [sel, setSel] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [view, setView] = useState<"list" | "grid">(() => (localStorage.getItem("pdd-explorer-view") === "grid" ? "grid" : "list"));
  const [saveName, setSaveName] = useState(pick?.defaultName ?? "");
  const [dropping, setDropping] = useState(false);
  // pictures: only them (and folders) in the list, and one at a time across the whole window
  const [picsOnly, setPicsOnly] = useState(() => localStorage.getItem("pdd-explorer-pics") === "1");
  const [viewing, setViewing] = useState<string | null>(null);
  const history = useRef<string[]>([]);
  const uploader = useRef<HTMLInputElement>(null);
  const [ref, width] = useWidth<HTMLDivElement>();
  const narrow = width > 0 && width < 640;
  const picking = mode !== "browse";

  const loadOverview = useCallback(() => fileApi.overview().then(setOv, fail), []);
  // folders linked for the characters to read (library/<name>/… in their files)
  const [links, setLinks] = useState<{ name: string; path?: string; for: string[]; serve?: boolean }[]>([]);
  const loadLinks = useCallback(() => fileApi.links().then((j) => setLinks(j.links), () => {}), []);
  useEffect(() => void loadLinks(), [loadLinks]);
  const linkOf = (p: string) => links.find((l) => l.path?.toLowerCase() === p.toLowerCase());
  // (asked just after the folder's menu closes, beside the folder)
  const linkFor = (e: Entry) => {
    const chars = desk().allCharacters();
    const go = async (whom: string[]) => {
      const name = (await askText("Name it for the characters", e.name, { body: `They'll find it as library/<name>/ in their files, read-only, read from where it is (nothing is copied). ${whom.length ? `For ${chars.find((c) => c.id === whom[0])?.short ?? whom[0]} only.` : "For every character."}`, yes: "Link it" }))?.trim();
      if (!name) return;
      try {
        const r = await fileApi.link(e.path, name, whom);
        await loadLinks();
        desk().say(`Linked: the characters find "${e.name}" as library/${r.name}/ in their files.`);
      } catch (err) {
        fail(err);
      }
    };
    openMenuAt(document.querySelector(".explorer-row.on, .explorer-tile.on") ?? document.body, [{ heading: "Who can read it?" }, { label: "Every character", run: () => void go([]) }, { sep: true }, ...chars.map((c): MenuItem => ({ label: c.name, run: () => void go([c.id]) }))]);
  };
  const myShares = useMyShares();
  const sharePicker = useRef<HTMLInputElement>(null);
  // other devices' shares come and go with their pages: look again now and then, and when this one's change
  useEffect(() => {
    void loadOverview();
    const t = window.setInterval(() => void fileApi.overview().then(setOv, () => {}), 15_000);
    return () => window.clearInterval(t);
  }, [loadOverview, myShares]);
  const shareMenu = (ev: React.MouseEvent) =>
    openMenu(ev, [
      { heading: `Share from ${deviceName()}` },
      ...(canShareFolder()
        ? [{ label: "Share a folder…", icon: <Folder size={14} />, hint: "while this page is open", run: () => void shareFolder().then((s) => s && desk().say(`"${s.name}" is shared with your other devices while this page stays open.`), fail) }]
        : []),
      { label: "Share files…", icon: <FileIcon size={14} />, hint: "while this page is open", run: () => sharePicker.current?.click() },
      ...(myShares.length ? [{ sep: true } as MenuItem, ...myShares.map((s) => ({ label: `Stop sharing "${s.name}"`, icon: <Trash2 size={14} />, run: () => stopSharing(s.id) }))] : []),
    ]);

  const open = useCallback(
    async (p: string, selectName?: string, remember = true) => {
      try {
        const l = await fileApi.list(p);
        if (remember && cwd && cwd !== l.path) history.current.push(cwd);
        setListing(l);
        setCwd(l.path);
        setTrashView(false);
        setError("");
        setSel(selectName ? [l.entries.find((e) => e.name === selectName)?.path ?? ""].filter(Boolean) : []);
        if (!picking) localStorage.setItem("pdd-explorer-cwd", l.path);
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return false;
      }
    },
    [cwd, picking],
  );
  const refresh = () => (trashView ? fileApi.trashList().then(setTrashed, fail) : cwd ? open(cwd, undefined, false) : undefined);

  // first folder: where we were sent, or the last one, or the vault
  useEffect(() => {
    if (!ov || listing) return;
    // (a remembered folder that's gone since: the vault instead, not an error)
    void open(cwd || ov.places[0]?.path || "", undefined, false).then((ok) => {
      if (!ok && ov.places[0]) void open(ov.places[0].path, undefined, false);
    });
  }, [ov]); // eslint-disable-line react-hooks/exhaustive-deps
  // "show in file explorer": the file's folder, with the file selected (or the folder itself)
  useEffect(() => {
    if (!go) return;
    void fileApi.stat(go.path).then(
      (st) => (st.dir ? open(st.path) : open(dirName(st.path), st.name)),
      (e) => fail(e),
    );
  }, [go?.at]); // eslint-disable-line react-hooks/exhaustive-deps

  const filterExts = useMemo(() => {
    const exts = (pick?.filters ?? []).flatMap((f) => f.extensions).map((x) => x.toLowerCase());
    return exts.length && !exts.includes("*") ? new Set(exts) : null;
  }, [pick]);
  const entries = useMemo(
    () => (listing?.entries ?? []).filter((e) => (mode === "folder" ? e.dir : e.dir || ((!filterExts || filterExts.has(e.ext)) && (!picsOnly || picking || kindOf(e) === "image")))),
    [listing, mode, filterExts, picsOnly, picking],
  );
  const selected = entries.filter((e) => sel.includes(e.path));
  const one = selected.length === 1 ? selected[0] : null;

  const activate = (e: Entry) => {
    if (e.dir) return void open(e.path);
    if (mode === "open") return answerPick([e.path]);
    if (mode === "save") return setSaveName(e.name);
    if (kindOf(e) === "image") return setViewing(e.path);
    if (kindOf(e) === "xdc") return void openXdcInGames(e.path).then((r) => desk().say(r.added ? `${r.name} is in Games & Apps now.` : `Opened ${r.name}.`), fail);
    setSel([e.path]);
  };
  const click = (ev: React.MouseEvent, e: Entry) => {
    if ((ev.ctrlKey || ev.metaKey) && (mode === "browse" || pick?.multiple)) setSel((s) => (s.includes(e.path) ? s.filter((x) => x !== e.path) : [...s, e.path]));
    else setSel([e.path]);
    if (mode === "save" && !e.dir) setSaveName(e.name);
  };

  // names are edited in place (a browser prompt would pause the music and the animations); "" is a new folder
  const [editing, setEditing] = useState<{ path: string; value: string } | null>(null);
  const rename = (e: Entry) => setEditing({ path: e.path, value: e.name });
  const commitEdit = async (value: string) => {
    const ed = editing;
    setEditing(null);
    const name = value.trim();
    if (!ed || !name) return;
    try {
      if (!ed.path) {
        const r = await fileApi.mkdir(cwd, name);
        await open(cwd, baseName(r.path), false);
      } else if (name !== baseName(ed.path)) {
        const r = await fileApi.rename(ed.path, name);
        await open(cwd, baseName(r.path), false);
      }
    } catch (err) {
      fail(err);
    }
  };
  const nameBox = (value: string) => (
    <input
      className="input explorer-edit"
      defaultValue={value}
      aria-label="Name"
      ref={(el) => {
        if (!el || el.dataset.ready) return;
        el.dataset.ready = "1";
        el.focus();
        const dot = el.value.lastIndexOf(".");
        el.setSelectionRange(0, dot > 0 ? dot : el.value.length); // the name, ready to type over; the extension stays
      }}
      onKeyDown={(ev) => {
        ev.stopPropagation();
        if (ev.key === "Enter") void commitEdit(ev.currentTarget.value);
        if (ev.key === "Escape") setEditing(null);
      }}
      onBlur={(ev) => void commitEdit(ev.currentTarget.value)}
      onClick={(ev) => ev.stopPropagation()}
    />
  );
  const moveTo = async (list: Entry[]) => {
    const into = await pickFolderHere();
    if (!into) return;
    try {
      for (const e of list) await fileApi.moveInto(e.path, into);
      desk().say(`Moved ${list.length === 1 ? list[0].name : `${list.length} items`}.`);
      await refresh();
    } catch (err) {
      fail(err);
    }
  };
  const toTrash = async (list: Entry[]) => {
    try {
      for (const e of list) await fileApi.trash(e.path);
      desk().say(`${list.length === 1 ? list[0].name : `${list.length} items`} went to the trash (Trash, in the sidebar, puts things back).`);
      await refresh();
    } catch (err) {
      fail(err);
    }
  };
  const unpack = async (e: Entry) => {
    try {
      desk().say(`Unpacking ${e.name}…`);
      const r = await fileApi.unzip(e.path);
      await open(cwd, baseName(r.path), false);
      desk().say(`${e.name} unpacked: ${r.files} file${r.files === 1 ? "" : "s"} in ${baseName(r.path)}.`);
    } catch (err) {
      fail(err);
    }
  };
  const openNetworkPlace = async () => {
    const B = "\\\\"; // the two backslashes a network address starts with
    const a = (await askText("Open a network place", B, { body: `A computer on your network (${B}computer) shows what it shares; a share (${B}computer\\share) opens it. If it needs a sign-in, open it once in Windows' File Explorer first.`, placeholder: `${B}computer\\share`, yes: "Open" }))?.trim();
    if (!a || a === B) return;
    await open(a.startsWith(B) || a.startsWith("//") ? a : `${B}${a}`);
    void loadOverview();
  };
  const newFolder = () => setEditing({ path: "", value: "New folder" });
  const upload = async (files: File[]) => {
    if (!files.length || !cwd) return;
    try {
      let last = "";
      for (const f of files) last = await fileApi.upload(cwd, f);
      await open(cwd, baseName(last), false);
      desk().say(`${files.length === 1 ? files[0].name : `${files.length} files`} uploaded here.`);
    } catch (err) {
      fail(err);
    }
  };

  const menuFor = (e: Entry): MenuItem[] => {
    const list = selected.length > 1 && sel.includes(e.path) ? selected : [e];
    const many = list.length > 1;
    const k = kindOf(e);
    return [
      ...(!many ? [{ label: e.dir ? "Open" : k === "xdc" ? "Open in Games & Apps" : "Preview", run: () => (k === "xdc" || e.dir ? activate(e) : setSel([e.path])) }] : []),
      ...(!many && !e.dir ? [{ label: "Download to this device", icon: <Download size={14} />, run: () => downloadToDevice(e.path) }] : []),
      ...(!many && e.ext === "zip" && !e.path.startsWith("device:") ? [{ label: "Unpack here", icon: <PackageOpen size={14} />, hint: "into a new folder", run: () => void unpack(e) }] : []),
      { sep: true },
      ...(!many
        ? [
            {
              label: "Show in device file explorer",
              icon: <Monitor size={14} />,
              disabled: !ov?.deviceExplorer,
              hint: ov?.deviceExplorer ? undefined : "on the computer only",
              run: () => void showOnDevice(e.path),
            },
            { label: "Copy path", icon: <Copy size={14} />, run: () => void copyText(e.path) },
          ]
        : []),
      ...(!many && e.dir && ov?.wholePc.local && !e.path.startsWith("device:")
        ? [
            linkOf(e.path)
              ? { label: "Stop linking for the characters", icon: <Link2Off size={14} />, hint: `library/${linkOf(e.path)!.name}`, run: () => void fileApi.unlink(e.path).then(() => (loadLinks(), desk().say(`${e.name} isn't linked for the characters any more.`)), fail) }
              : { label: "Link for the characters to read…", icon: <Link2 size={14} />, hint: "read-only, not copied", run: () => window.setTimeout(() => linkFor(e), 0) },
            // the fserve: the characters it's linked for may hand its files out on Vector and Discord
            ...(linkOf(e.path)
              ? [
                  {
                    label: "They may hand it out (Vector, Discord)",
                    icon: <Share2 size={14} />,
                    checked: Boolean(linkOf(e.path)!.serve),
                    hint: "!list, @find, !get",
                    run: () =>
                      void fileApi.serve(e.path, !linkOf(e.path)!.serve).then(
                        () => (loadLinks(), desk().say(linkOf(e.path)!.serve ? `${e.name} isn't handed out any more.` : `${e.name} is on their shelves: they can hand its files out on Vector and Discord (once Privacy allows it).`)),
                        fail,
                      ),
                  } as MenuItem,
                ]
              : []),
          ]
        : []),
      ...(!many && e.dir && ov?.sharing.canChange
        ? [{ label: isShared(e.path) ? "Stop sharing on the network" : "Share on the network", icon: <Share2 size={14} />, hint: isShared(e.path) ? "shared" : "with your other devices", run: () => void fileApi.share(e.path, !isShared(e.path)).then((o) => (setOv(o), desk().say(isShared(e.path) ? `${e.name} isn't shared any more.` : `${e.name} is shared with your other devices on this network.`)), fail) }]
        : []),
      { sep: true },
      ...(!many ? [{ label: "Rename…", run: () => void rename(e) }] : []),
      { label: many ? `Move ${list.length} items to…` : "Move to…", run: () => void moveTo(list) },
      { label: many ? `Delete ${list.length} items` : "Delete", hint: "to the trash", danger: true, icon: <Trash2 size={14} />, run: () => void toTrash(list) },
    ];
  };
  const backgroundMenu = (): MenuItem[] => [
    { label: "New folder…", icon: <FolderPlus size={14} />, run: () => void newFolder() },
    { label: "Upload from this device…", icon: <Upload size={14} />, run: () => uploader.current?.click() },
    { sep: true },
    { label: "Show in device file explorer", icon: <Monitor size={14} />, disabled: !ov?.deviceExplorer, hint: ov?.deviceExplorer ? undefined : "on the computer only", run: () => void showOnDevice(cwd) },
    { label: "Copy path", icon: <Copy size={14} />, run: () => void copyText(cwd) },
  ];

  // a folder chosen from inside this browser (for "Move to…"): the picker over this window
  const pickFolderHere = async () => (await pickInExplorer({ mode: "folder", title: "Move to which folder?" }))?.[0] ?? null;

  const onKey = (ev: React.KeyboardEvent) => {
    if ((ev.target as HTMLElement).closest("input, textarea")) return;
    if (ev.key === "Backspace" && listing?.parent) (ev.preventDefault(), void open(listing.parent));
    else if (ev.key === "Enter" && one) activate(one);
    else if (ev.key === "Delete" && selected.length && !picking) void toTrash(selected);
    else if (ev.key === "F2" && one && !picking) void rename(one);
  };

  const crumbs = useMemo(() => {
    if (!cwd || !ov) return [];
    const place = [...ov.places, ...ov.wholePc.drives, ...(ov.devices ?? []), ...(ov.network ?? [])].filter((p) => cwd.toLowerCase().startsWith(p.path.toLowerCase())).sort((a, b) => b.path.length - a.path.length)[0];
    if (!place) return [{ name: cwd, path: cwd }];
    const rest = cwd.slice(place.path.length).split(/[\\/]/).filter(Boolean);
    const sep = cwd.includes("\\") ? "\\" : "/";
    const out = [{ name: place.name, path: place.path }];
    let acc = place.path.replace(/[\\/]$/, "");
    for (const r of rest) out.push({ name: r, path: (acc = `${acc}${sep}${r}`) });
    return out;
  }, [cwd, ov]);

  const places = ov ? [...ov.places, ...ov.wholePc.drives] : [];
  const fromDevices = ov?.devices ?? [];
  const network = ov?.network ?? [];
  const shared = ov?.sharing.folders ?? [];
  const isShared = (p: string) => shared.some((s) => s.path.toLowerCase() === p.toLowerCase());
  const sidebar = (
    <nav className="side explorer-side">
      <div className="list">
        <div className="folder">Places</div>
        {places.map((p) => (
          <button key={p.id} className={`item${!trashView && cwd.toLowerCase().startsWith(p.path.toLowerCase()) ? " on" : ""}`} onClick={() => void open(p.path)} title={p.path}>
            {p.kind === "drive" ? <HardDrive size={15} /> : p.kind === "music" ? <Music2 size={15} /> : <Folder size={15} />} {p.name}
          </button>
        ))}
        {shared.length ? <div className="folder">Shared from this computer</div> : null}
        {shared.map((p) => (
          <button key={p.id} className={`item${!trashView && cwd.toLowerCase().startsWith(p.path.toLowerCase()) ? " on" : ""}`} onClick={() => void open(p.path)} title={p.path}>
            <Share2 size={15} /> {p.name}
          </button>
        ))}
        {ov?.wholePc.local || network.length ? <div className="folder">Network</div> : null}
        {network.map((p) => (
          <button key={p.id} className={`item${!trashView && cwd.toLowerCase().startsWith(p.path.toLowerCase()) ? " on" : ""}`} onClick={() => void open(p.path)} title={p.path}>
            <Network size={15} /> {p.name}
          </button>
        ))}
        {ov?.wholePc.local ? <Computers cwd={cwd} known={network.map((p) => p.path)} onOpen={(p) => void open(p)} /> : null}
        {ov?.wholePc.local ? (
          <button className="item faint" onClick={() => void openNetworkPlace()} title="A computer or share on your network: \\computer\share">
            <Network size={15} /> Open a network place…
          </button>
        ) : null}
        {fromDevices.length ? <div className="folder">Shared by your devices</div> : null}
        {fromDevices.map((p) => (
          <button key={p.id} className={`item${!trashView && cwd.startsWith(p.path) ? " on" : ""}`} onClick={() => void open(p.path)} title="Open while that device's page stays open">
            <Smartphone size={15} /> {p.name}
          </button>
        ))}
        {!picking ? (
          <button className={`item${trashView ? " on" : ""}`} onClick={() => (setTrashView(true), setSel([]), void fileApi.trashList().then(setTrashed, fail))}>
            <Trash2 size={15} /> Trash
          </button>
        ) : null}
      </div>
      {ov?.wholePc.local && !picking ? (
        <label className="explorer-pc small">
          <input type="checkbox" checked={ov.wholePc.on} onChange={(e) => void fileApi.setWholePc(e.target.checked).then(setOv, fail)} />
          <span>
            The rest of this computer
            <span className="faint"> (only here, never from phones or the network)</span>
          </span>
        </label>
      ) : null}
      {ov?.sharing.canChange && !picking ? (
        <label className="explorer-pc small">
          <input type="checkbox" checked={ov.sharing.wholePc} onChange={(e) => void fileApi.shareWholePc(e.target.checked).then(setOv, fail)} />
          <span>
            Share the whole computer with your other devices
            <span className="faint"> (on this network they can open, add and change files; folders can be shared one at a time from their menu)</span>
          </span>
        </label>
      ) : null}
    </nav>
  );

  const preview = one && !picking ? <Preview e={one} deviceExplorer={Boolean(ov?.deviceExplorer)} onClose={() => setSel([])} /> : null;

  const body = trashView ? (
    <div className="explorer-list">
      {trashed.length ? null : <p className="muted" style={{ padding: 12 }}>The trash is empty.</p>}
      {trashed.map((t) => (
        <div key={t.id} className="explorer-row">
          <span className="explorer-name">
            <Trash2 size={15} /> {t.name}
          </span>
          <span className="faint small explorer-meta">{dirName(t.from)}</span>
          <span className="faint small explorer-meta">{when(t.at)}</span>
          <button className="btn small" onClick={() => void fileApi.restore(t.id).then((r) => (desk().say(`Put back: ${r.path}`), fileApi.trashList().then(setTrashed)), fail)}>
            <RotateCcw size={13} /> Put back
          </button>
        </div>
      ))}
    </div>
  ) : (
    <div
      className={`explorer-list${view === "grid" ? " grid" : ""}${dropping ? " dropping" : ""}`}
      onContextMenu={(ev) => !picking && (ev.target as HTMLElement).closest(".explorer-row, .explorer-tile") === null && openMenu(ev, backgroundMenu())}
      onDragOver={(ev) => [...ev.dataTransfer.types].includes("Files") && (ev.preventDefault(), setDropping(true))}
      onDragLeave={(ev) => ev.currentTarget === ev.target && setDropping(false)}
      onDrop={(ev) => {
        ev.preventDefault();
        setDropping(false);
        void upload([...ev.dataTransfer.files]);
      }}
    >
      {error ? <p className="danger-text" style={{ padding: 12 }}>{error}</p> : null}
      {!error && !entries.length ? <p className="muted" style={{ padding: 12 }}>Nothing here{filterExts ? " of the kinds asked for" : ""}. Drop files here to upload them.</p> : null}
      {editing && !editing.path ? (
        <div className={view === "grid" ? "explorer-tile on" : "explorer-row on"}>
          {view === "grid" ? <span className="explorer-tile-icon">{ICON.folder(34)}</span> : null}
          <span className="explorer-name">
            {view === "grid" ? null : ICON.folder(15)} {nameBox(editing.value)}
          </span>
        </div>
      ) : null}
      {entries.map((e) =>
        editing?.path === e.path ? (
          <div key={e.path} className={view === "grid" ? "explorer-tile on" : "explorer-row on"}>
            {view === "grid" ? <span className="explorer-tile-icon">{ICON[kindOf(e)](34)}</span> : null}
            <span className="explorer-name">
              {view === "grid" ? null : ICON[kindOf(e)](15)} {nameBox(editing.value)}
            </span>
          </div>
        ) : view === "grid" ? (
          <button
            key={e.path}
            className={`explorer-tile${sel.includes(e.path) ? " on" : ""}`}
            onClick={(ev) => click(ev, e)}
            onDoubleClick={() => activate(e)}
            onContextMenu={(ev) => !picking && (sel.includes(e.path) || setSel([e.path]), openMenu(ev, menuFor(e)))}
            title={e.name}
          >
            {kindOf(e) === "image" ? <img src={rawUrl(e.path)} alt="" loading="lazy" /> : <span className="explorer-tile-icon">{ICON[kindOf(e)](34)}</span>}
            <span className="explorer-tile-name">{e.name}</span>
          </button>
        ) : (
          <button
            key={e.path}
            className={`explorer-row${sel.includes(e.path) ? " on" : ""}`}
            onClick={(ev) => click(ev, e)}
            onDoubleClick={() => activate(e)}
            onContextMenu={(ev) => !picking && (sel.includes(e.path) || setSel([e.path]), openMenu(ev, menuFor(e)))}
          >
            <span className="explorer-name">
              {ICON[kindOf(e)](15)} {e.name}
            </span>
            {!narrow ? <span className="faint small explorer-meta">{e.dir ? "" : sizeOf(e.size)}</span> : null}
            {!narrow ? <span className="faint small explorer-meta">{when(e.mtime)}</span> : null}
          </button>
        ),
      )}
    </div>
  );

  // what the picker hands back
  const choose = () => {
    if (mode === "folder") return answerPick([one?.dir ? one.path : cwd]);
    if (mode === "save") {
      const name = saveName.trim();
      if (!name) return;
      const sep = cwd.includes("\\") ? "\\" : "/";
      return answerPick([`${cwd.replace(/[\\/]$/, "")}${sep}${name}`]);
    }
    const files = selected.filter((e) => !e.dir).map((e) => e.path);
    if (files.length) answerPick(pick?.multiple ? files : [files[0]]);
  };

  return (
    <div ref={ref} className={`explorer${narrow ? " narrow" : ""}${picking ? " picking" : ""}`} tabIndex={-1} onKeyDown={onKey}>
      <div className="explorer-bar">
        <button className="icon-btn" aria-label="Back" disabled={!history.current.length} onClick={() => void open(history.current.pop()!, undefined, false)}>
          <ArrowLeft size={15} />
        </button>
        <button className="icon-btn" aria-label="Up a folder" disabled={!listing?.parent || trashView} onClick={() => listing?.parent && void open(listing.parent)}>
          <FolderUp size={15} />
        </button>
        {narrow ? (
          <select className="select explorer-places" value="" onChange={(e) => e.target.value && void open(e.target.value)} aria-label="Places">
            <option value="">Places…</option>
            {[...places, ...shared, ...network, ...fromDevices].map((p) => (
              <option key={p.id} value={p.path}>
                {p.name}
              </option>
            ))}
          </select>
        ) : null}
        <div className="explorer-crumbs">
          {trashView ? (
            <span>Trash</span>
          ) : (
            crumbs.map((c, i) => (
              <span key={c.path}>
                {i ? <span className="faint"> › </span> : null}
                <button className="link-btn" onClick={() => void open(c.path)}>
                  {c.name}
                </button>
              </span>
            ))
          )}
        </div>
        {!trashView ? (
          <>
            <button className="icon-btn" aria-label="New folder" data-tip="New folder" onClick={() => void newFolder()}>
              <FolderPlus size={15} />
            </button>
            <button className="icon-btn" aria-label="Upload from this device" data-tip="Upload from this device" onClick={() => uploader.current?.click()}>
              <Upload size={15} />
            </button>
            {!picking ? (
              <button className={`icon-btn${myShares.length ? " on" : ""}`} aria-label="Share from this device" data-tip={myShares.length ? `Sharing ${myShares.length} from this device` : "Share files or a folder from this device"} onClick={shareMenu}>
                <Smartphone size={15} />
              </button>
            ) : null}
            {!picking ? (
              <button
                className={`icon-btn${picsOnly ? " on" : ""}`}
                aria-pressed={picsOnly}
                aria-label="Pictures only"
                data-tip={picsOnly ? "Showing pictures only" : "Pictures only"}
                onClick={() => {
                  const on = !picsOnly;
                  setPicsOnly(on);
                  localStorage.setItem("pdd-explorer-pics", on ? "1" : "0");
                  if (on && view !== "grid") (setView("grid"), localStorage.setItem("pdd-explorer-view", "grid"));
                }}
              >
                <ImageIcon size={15} />
              </button>
            ) : null}
            <button
              className="icon-btn"
              aria-label={view === "grid" ? "List view" : "Tile view"}
              onClick={() => {
                const v = view === "grid" ? "list" : "grid";
                setView(v);
                localStorage.setItem("pdd-explorer-view", v);
              }}
            >
              {view === "grid" ? <LayoutList size={15} /> : <LayoutGrid size={15} />}
            </button>
          </>
        ) : null}
      </div>
      <div className="explorer-body">
        {!narrow ? sidebar : null}
        {body}
        {preview}
      </div>
      {viewing ? <PictureViewer pictures={entries.filter((x) => kindOf(x) === "image")} at={viewing} onAt={setViewing} onClose={() => setViewing(null)} /> : null}
      {picking ? (
        <div className="explorer-pick">
          {mode === "save" ? <input className="input" value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="File name" aria-label="File name" autoFocus /> : null}
          <span className="faint small explorer-pick-note">
            {mode === "folder" ? (one?.dir ? `“${one.name}”` : `This folder`) : mode === "open" ? (selected.filter((e) => !e.dir).length ? `${selected.filter((e) => !e.dir).length} chosen` : "Choose a file, or upload one from this device") : ""}
          </span>
          <button className="btn" onClick={() => answerPick(null)}>
            Cancel
          </button>
          <button className="btn primary" onClick={choose} disabled={mode === "open" ? !selected.some((e) => !e.dir) : mode === "save" ? !saveName.trim() : !cwd}>
            {mode === "save" ? "Save here" : mode === "folder" ? "Choose this folder" : "Choose"}
          </button>
        </div>
      ) : null}
      <input
        ref={uploader}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const list = [...(e.target.files ?? [])];
          e.target.value = "";
          void upload(list);
        }}
      />
      <input
        ref={sharePicker}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const list = [...(e.target.files ?? [])];
          e.target.value = "";
          void shareFiles(list).then((s) => s && desk().say(`"${s.name}" is shared with your other devices while this page stays open.`), fail);
        }}
      />
    </div>
  );
}

/** Pictures one at a time, filling the window: arrows or a swipe for the next and the one before, Esc to go back. */
function PictureViewer({ pictures, at, onAt, onClose }: { pictures: Entry[]; at: string; onAt: (p: string) => void; onClose: () => void }) {
  const i = Math.max(0, pictures.findIndex((p) => p.path === at));
  const pic = pictures[i];
  const go = (d: number) => pictures.length && onAt(pictures[(i + d + pictures.length) % pictures.length].path);
  const startX = useRef<number | null>(null);
  useEffect(() => {
    const key = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") (ev.stopPropagation(), onClose());
      else if (ev.key === "ArrowRight" || ev.key === " ") (ev.preventDefault(), go(1));
      else if (ev.key === "ArrowLeft") (ev.preventDefault(), go(-1));
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  });
  // the next one is fetched ahead, so stepping through is quick even from a network share or a phone
  useEffect(() => {
    const next = pictures[(i + 1) % pictures.length];
    if (next) new Image().src = rawUrl(next.path);
  }, [i, pictures]);
  if (!pic) return null;
  return (
    <div
      className="picture-viewer"
      role="dialog"
      aria-label={pic.name}
      onPointerDown={(ev) => (startX.current = ev.clientX)}
      onPointerUp={(ev) => {
        const dx = startX.current === null ? 0 : ev.clientX - startX.current;
        startX.current = null;
        if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
      }}
    >
      <div className="picture-viewer-bar">
        <span className="ellipsis" title={pic.path}>
          {pic.name} <span className="faint small">· {i + 1} of {pictures.length}</span>
        </span>
        <button className="icon-btn" aria-label="Download to this device" data-tip="Download to this device" onClick={() => downloadToDevice(pic.path)}>
          <Download size={16} />
        </button>
        <button className="icon-btn" aria-label="Back to the folder" onClick={onClose}>
          ✕
        </button>
      </div>
      <img key={pic.path} src={rawUrl(pic.path)} alt={pic.name} draggable={false} />
      {pictures.length > 1 ? (
        <>
          <button className="picture-viewer-step prev" aria-label="The one before" onClick={() => go(-1)}>
            <ChevronLeft size={28} />
          </button>
          <button className="picture-viewer-step next" aria-label="The next one" onClick={() => go(1)}>
            <ChevronRight size={28} />
          </button>
        </>
      ) : null}
    </div>
  );
}

/** The selected file: shown in the window, with what can be done with it. */
function Preview({ e, deviceExplorer, onClose }: { e: Entry; deviceExplorer: boolean; onClose: () => void }) {
  const k = kindOf(e);
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    setText(null);
    if (k !== "text") return;
    const ctl = new AbortController();
    fetch(rawUrl(e.path), { signal: ctl.signal, headers: { Range: "bytes=0-399999" } })
      .then((r) => r.text())
      .then(setText, () => undefined);
    return () => ctl.abort();
  }, [e.path, k]);
  return (
    <aside className="explorer-preview">
      <div className="row" style={{ gap: 6, alignItems: "center" }}>
        <strong className="explorer-preview-name" title={e.name}>
          {e.name}
        </strong>
        <button className="icon-btn" aria-label="Close preview" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="explorer-preview-body">
        {k === "image" ? <img src={rawUrl(e.path)} alt={e.name} /> : null}
        {k === "audio" ? <audio src={rawUrl(e.path)} controls /> : null}
        {k === "video" ? <video src={rawUrl(e.path)} controls /> : null}
        {k === "pdf" ? <iframe src={rawUrl(e.path)} title={e.name} /> : null}
        {k === "text" ? (text === null ? <p className="faint">…</p> : e.ext === "md" || e.ext === "markdown" ? <Markdown text={text} /> : <pre className="small">{text}</pre>) : null}
        {k === "xdc" ? (
          <button className="btn primary" onClick={() => void openXdcInGames(e.path).then((r) => desk().say(r.added ? `${r.name} is in Games & Apps now.` : `Opened ${r.name}.`), fail)}>
            <Gamepad2 size={14} /> Open in Games & Apps
          </button>
        ) : null}
        {k === "file" || k === "folder" ? <p className="faint small">No preview for this kind of file.</p> : null}
      </div>
      <p className="faint small" style={{ margin: "6px 0" }}>
        {e.dir ? "Folder" : sizeOf(e.size)} · {when(e.mtime)}
        <br />
        <span style={{ wordBreak: "break-all" }}>{e.path}</span>
      </p>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        {!e.dir ? (
          <button className="btn small" onClick={() => downloadToDevice(e.path)}>
            <Download size={13} /> Download to this device
          </button>
        ) : null}
        <button className="btn small" disabled={!deviceExplorer} title={deviceExplorer ? "" : "Only on the computer running the desktop"} onClick={() => void showOnDevice(e.path)}>
          <ExternalLink size={13} /> Show in device file explorer
        </button>
      </div>
    </aside>
  );
}

/** Computers on the local network that share folders (as this computer last saw them, server/lan.mjs), one click from
 *  their shares; "Look for computers" looks again. Shown on the desktop's own computer. */
function Computers({ cwd, known, onOpen }: { cwd: string; known: string[]; onOpen: (p: string) => void }) {
  const [list, setList] = useState<{ ip: string; name: string; label: string; sharing: boolean }[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void fetch("/api/lan").then((r) => (r.ok ? r.json().then((j: { devices: typeof list }) => setList(j.devices)) : null), () => null);
  }, []);
  const look = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/lan/scan", { method: "POST" });
      if (r.ok) setList(((await r.json()) as { devices: NonNullable<typeof list> }).devices);
    } finally {
      setBusy(false);
    }
  };
  const knownHosts = new Set(known.map((p) => p.replace(/^\\\\/, "").split("\\")[0].toLowerCase()));
  const sharing = (list ?? []).filter((d) => d.sharing && !knownHosts.has((d.name || d.ip).toLowerCase()));
  return (
    <>
      {sharing.map((d) => {
        const p = `\\\\${d.name || d.ip}`;
        return (
          <button key={d.ip} className={`item${cwd.toLowerCase() === p.toLowerCase() ? " on" : ""}`} onClick={() => onOpen(p)} title={`${p} · ${d.ip}`}>
            <Monitor size={15} /> {d.label || d.name || d.ip}
          </button>
        );
      })}
      <button className="item faint" disabled={busy} onClick={() => void look()} title="Which computers on your network share folders (from this computer's own list of devices it has heard from)">
        <RefreshCw size={15} /> {busy ? "Looking…" : "Look for computers"}
      </button>
    </>
  );
}
