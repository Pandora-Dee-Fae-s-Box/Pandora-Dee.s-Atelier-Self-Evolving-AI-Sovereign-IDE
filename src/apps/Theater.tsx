import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronLeft, ChevronRight, Clapperboard, FileDown, FileUp, HardDrive, MonitorPlay, MonitorSmartphone, Library, Network, PanelLeft, Smartphone, Tv, Download, Film, Folder, FolderInput, FolderOpen, FolderPlus, ListMusic, ListPlus, MoreHorizontal, Pencil, Play, Plus, RefreshCw, Repeat, Search, Shuffle, Star, Trash2, Upload, X } from "lucide-react";
import { desk, useDesk } from "../lib/store.ts";
import { baseName, downloadToDevice, fileApi, pickInExplorer, rawUrl } from "../lib/explorer.ts";
import { KINDS, kindOf, placeIn, type Kind } from "../lib/videoKinds.ts";
import { matchEntries, nameFromFile, parsePlaylist, readDeviceFile, saveTextToDevice, saveToVault, writeM3u } from "../lib/playlistFile.ts";
import {
  backUp,
  cancelJob,
  changeCollection,
  changePlaylist,
  deletePlaylist,
  clearFinished,
  leftOff,
  lengthText,
  makeThumbs,
  patchVideo,
  refreshLibrary,
  rememberPosition,
  retryJob,
  sizeText,
  theaterApi,
  thumbUrl,
  useJobs,
  useLibrary,
  videoUrl,
  type Collection,
  type Playlist,
  type Video,
} from "../lib/theater.ts";
import { openMenu, openMenuAt, type MenuItem } from "../ui/ContextMenu.tsx";
import { askText, askUser } from "../ui/Ask.tsx";
import { inFolder, underFolder } from "../lib/episodes.ts";
import { useWidth } from "../ui/hooks.ts";

const ALL = "\u0000all", FAVS = "\u0000favs", LIST = "\u0000list:", DEV = "\u0000device:", COL = "\u0000col:", KIND = "\u0000kind:", SHARED = "\u0000shared";
const KIND_ICON: Record<Kind, React.ReactNode> = { movie: <Clapperboard size={14} />, series: <Tv size={14} />, recording: <MonitorPlay size={14} />, unknown: <Film size={14} /> };
const OPEN_KEY = "pdd-theater-open";
/** Which of the sidebar's sections are open (each device remembers its own). */
const savedOpen = (): Set<string> => {
  try {
    const j = JSON.parse(localStorage.getItem(OPEN_KEY) ?? "null");
    if (Array.isArray(j)) return new Set(j.map(String));
  } catch {
    /* the usual ones, then */
  }
  return new Set(["kinds", "collections", "playlists", "shelves", "local", "network", "devices"]);
};
const fileSafe = (n: string) => n.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim() || "Playlist";

/** "Add to playlist" lines for a video's menus: each playlist (ticked where it already is), and a new one. */
/** A video's file renamed where it is (its kind kept: .mp4 stays .mp4). Its id stays (size and date), so favourites,
 *  playlists and where it was left off all follow. Returns the new path. */
async function renameVideo(p: string, current: string): Promise<string | null> {
  const name = (await askText("Rename", current, { yes: "Rename" }))?.trim();
  if (!name || name === current) return null;
  const ext = p.match(/\.[^.\\/]+$/)?.[0] ?? "";
  try {
    const r = await fileApi.rename(p, name.toLowerCase().endsWith(ext.toLowerCase()) ? name : `${name}${ext}`);
    await refreshLibrary();
    desk().say(`Renamed to ${name}.`);
    return r.path;
  } catch (e) {
    desk().say(e instanceof Error ? e.message : String(e));
    return null;
  }
}

function addToPlaylistItems(v: Video, playlists: Playlist[]): MenuItem[] {
  const fail = (e: unknown) => desk().say(e instanceof Error ? e.message : String(e));
  return [
    { heading: "Add to playlist" },
    ...playlists.map(
      (p): MenuItem => ({
        label: p.name,
        checked: p.items.includes(v.id),
        icon: <ListMusic size={14} />,
        run: () =>
          void changePlaylist({ id: p.id, items: p.items.includes(v.id) ? p.items.filter((x) => x !== v.id) : [...p.items, v.id] }).then(
            () => desk().say(p.items.includes(v.id) ? `Taken off ${p.name}.` : `Added to ${p.name}.`),
            fail,
          ),
      }),
    ),
    {
      label: "New playlist…",
      icon: <ListPlus size={14} />,
      run: () =>
        void askText("A new playlist", "", { placeholder: "Saturday cartoons", yes: "Make it" }).then((name) => {
          if (name?.trim()) void changePlaylist({ name: name.trim(), items: [v.id] }).then((p) => desk().say(`${p.name}: made, with ${v.name} in it.`), fail);
        }),
    },
  ];
}
const SHELF_KEY = "pdd-theater-shelf";
/** The shelf this device backs up to (each phone remembers its own). */
const savedShelf = () => {
  try {
    return localStorage.getItem(SHELF_KEY) ?? "";
  } catch {
    return "";
  }
};
const month = (t: number) => new Date(t).toLocaleDateString(undefined, { month: "long", year: "numeric" });

export function TheaterApp() {
  const { lib, error } = useLibrary();
  const toddler = useDesk((s) => s.toddler);
  const jobs = useJobs();
  const [shelf, setShelf] = useState(ALL);
  const [q, setQ] = useState("");
  const [playing, setPlaying] = useState<string | null>(null);
  // a playlist played shuffled keeps its shuffled order until it's played again; repeat starts it over at the end
  const [order, setOrder] = useState<string[] | null>(null);
  const [repeat, setRepeat] = useState(false);
  const playlists = lib?.playlists ?? [];
  const playlist = shelf.startsWith(LIST) ? (playlists.find((p) => p.id === shelf.slice(LIST.length)) ?? null) : null;
  const [target, setTarget] = useState(savedShelf);
  const pick = useRef<HTMLInputElement>(null);
  const [ref, width] = useWidth<HTMLDivElement>();
  const narrow = width < 560;
  // under this the sidebar folds away behind a button, and opens over the videos
  const slim = width < 720;

  useEffect(() => {
    void refreshLibrary();
  }, []);

  // other devices' shared folders (Explorer's "Share from this device"), each a shelf while its page is open
  const [devices, setDevices] = useState<{ id: string; name: string; path: string }[]>([]);
  useEffect(() => {
    const look = () => void fileApi.overview().then((o) => setDevices(o.devices ?? []), () => {});
    look();
    const t = window.setInterval(look, 15_000);
    return () => window.clearInterval(t);
  }, []);
  const [devVideos, setDevVideos] = useState<{ path: string; videos: Video[]; busy: boolean; error: string } | null>(null);
  const onDevice = shelf.startsWith(DEV) ? shelf.slice(DEV.length) : "";
  useEffect(() => {
    if (!onDevice) return setDevVideos(null);
    setDevVideos({ path: onDevice, videos: [], busy: true, error: "" });
    theaterApi.deviceVideos(onDevice).then(
      (j) => setDevVideos({ path: onDevice, videos: j.videos, busy: false, error: "" }),
      (e) => setDevVideos({ path: onDevice, videos: [], busy: false, error: e instanceof Error ? e.message : String(e) }),
    );
  }, [onDevice]);
  const watched = (lib?.folders ?? []).find((f) => f.name === shelf);
  // collections ("Kids"): shows from any shelf, in an order of one's own
  const collections = lib?.collections ?? [];
  const collection = shelf.startsWith(COL) ? (collections.find((c) => c.id === shelf.slice(COL.length)) ?? null) : null;
  // a shelf is browsed show by show, season by season: where in it we are (and the collection we came from, if any)
  const [loc, setLoc] = useState({ shelf: "", where: "" });
  const where = loc.shelf === shelf ? loc.where : "";
  const [via, setVia] = useState<Collection | null>(null);
  const [viaRoot, setViaRoot] = useState("");
  // toddler mode: only the collections marked for it, and only inside their shows
  const kidsCols = collections.filter((c) => c.kids);
  const hideAll = toddler && !kidsCols.length;
  const kidsOk = !toddler || (collection ? Boolean(collection.kids) : Boolean(via?.kids) && shelf === loc.shelf && (!viaRoot || where === viaRoot || where.startsWith(`${viaRoot}/`)));
  useEffect(() => {
    if (toddler && !kidsOk) {
      setVia(null);
      setShelf(kidsCols[0] ? COL + kidsCols[0].id : ALL);
    }
  }, [toddler, kidsOk, kidsCols[0]?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const browsing = !q && !playlist && !onDevice && !collection && shelf !== ALL && shelf !== FAVS;
  const open = (s: string, rel: string, from: Collection | null = via) => (from !== via && setViaRoot(rel), setVia(from), setShelf(s), setLoc({ shelf: s, where: rel }), setOrder(null));
  const videosOf = (s: string) => (lib?.videos ?? []).filter((v) => v.shelf === s);
  // shelves a backup or a move can go to: the vault's own (not watched folders, not From devices)
  const watchedNames = new Set((lib?.folders ?? []).map((f) => f.name));
  const shelves = (lib?.shelves ?? []).filter((s) => s !== "From devices" && !watchedNames.has(s));
  const from = lib?.from ?? {};
  // every video sorted by kind (movies, series, screen recordings, unknown), each placed in its kind's own folders
  // (Pixar › Ice Age, SpongeBob › Season 2), and what came from devices, by device
  const sorted = useMemo(() => {
    const by: Record<Kind, Video[]> = { movie: [], series: [], recording: [], unknown: [] };
    const shared: Video[] = [];
    const f = lib?.from ?? {};
    for (const v of lib?.videos ?? []) {
      const k = kindOf(v);
      by[k].push({ ...v, folder: placeIn(v, k) });
      // from a device: its shelf, or a folder added to another shelf since (Kids/Elsa stuff, still from her phone)
      const top = (v.folder ?? "").split("/")[0];
      const dev = f[v.shelf] ?? (top ? f[`${v.shelf}/${top}`] : undefined);
      if (v.shelf === "From devices" || dev)
        shared.push({ ...v, folder: [dev || "Shared from a phone", v.shelf === "From devices" ? "" : v.shelf, v.folder ?? ""].filter(Boolean).join("/") });
    }
    return { by, shared };
  }, [lib]);
  const kindShown = shelf.startsWith(KIND) ? (shelf.slice(KIND.length) as Kind) : null;
  const virtual = Boolean(kindShown) || shelf === SHARED;
  const labelOf = (id: string) => (kindShown ? (KINDS.find((k) => k.id === kindShown)?.label ?? "") : id === SHARED ? "Shared to the server" : id);
  const fail = (e: unknown) => desk().say(e instanceof Error ? e.message : String(e));
  const go = (id: string, rel = "") => {
    setShelf(id);
    setOrder(null);
    setVia(null);
    setLoc({ shelf: id, where: rel });
    setSideOpen(false);
  };
  const [openSecs, setOpenSecs] = useState(savedOpen);
  const toggleSec = (k: string) =>
    setOpenSecs((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      try {
        localStorage.setItem(OPEN_KEY, JSON.stringify([...n]));
      } catch {
        /* it just won't remember */
      }
      return n;
    });
  const [sideOpen, setSideOpen] = useState(false);

  /** "Add to shelf" for a shelf or a show folder on one: moved onto another shelf, as a folder of its own there. */
  const addToShelfItems = (s: string, rel: string): MenuItem[] => {
    if (watchedNames.has(s) || (!rel && (s === "" || s === "From devices"))) return [];
    const name = rel.split("/").pop() || s;
    const put = async (to: string) => {
      try {
        const r = await theaterApi.addToShelf(s, rel, to);
        await refreshLibrary();
        desk().say(to ? `${name} is on ${to} now.` : `${name} is a shelf of its own now.`);
        if (shelf === s && (!rel || where.startsWith(rel))) go(r.shelf, r.folder);
      } catch (e) {
        fail(e);
      }
    };
    return [
      { sep: true },
      { heading: "Add to shelf" },
      ...shelves.filter((x) => x !== s).map((x): MenuItem => ({ label: x, icon: <FolderInput size={14} />, run: () => void put(x) })),
      {
        label: "New shelf…",
        icon: <FolderPlus size={14} />,
        run: () =>
          void askText(`A new shelf for ${name}`, "", { placeholder: "Kids", yes: "Make it" }).then(async (n) => {
            if (!n?.trim()) return;
            try {
              await put((await theaterApi.shelf(n.trim())).shelf);
            } catch (e) {
              fail(e);
            }
          }),
      },
      ...(rel ? [{ label: "A shelf of its own", icon: <Folder size={14} />, run: () => void put("") } as MenuItem] : []),
    ];
  };
  /** "Add to shelf" for one video (moved there). */
  const videoShelfItems = (v: Video): MenuItem[] =>
    toddler || v.watched || v.device
      ? []
      : [
          { sep: true },
          { label: "Rename…", icon: <Pencil size={14} />, run: () => void renameVideo(v.path, v.name) },
          { sep: true },
          { heading: "Add to shelf" },
          ...["", ...shelves]
            .filter((x) => x !== v.shelf)
            .map(
              (x): MenuItem => ({
                label: x || "Videos (no shelf)",
                icon: <FolderInput size={14} />,
                run: () => void theaterApi.move(v.path, x).then(() => (desk().say(`${v.name} is on ${x || "Videos"} now.`), refreshLibrary()), fail),
              }),
            ),
        ];

  // ---- playlist files (M3U / M3U8 / PLS) ----
  const openPlaylistFile = async (src: "device" | "desk") => {
    let got: { name: string; text: string } | null = null;
    if (src === "device") got = await readDeviceFile();
    else {
      const p = (await pickInExplorer({ mode: "open", title: "Which playlist file? (.m3u, .m3u8, .pls)", filters: [{ name: "Playlists", extensions: ["m3u", "m3u8", "pls"] }] }))?.[0];
      if (!p) return;
      const r = await fetch(rawUrl(p));
      got = r.ok ? { name: baseName(p), text: await r.text() } : null;
    }
    if (!got) return;
    const entries = parsePlaylist(got.text);
    const { found, missing } = matchEntries(entries, lib?.videos ?? [], (v) => v.path);
    if (!found.length) return desk().say(`None of the ${entries.length} in ${got.name} are in the Theater.`);
    try {
      const p = await changePlaylist({ name: nameFromFile(got.name), items: found.map((v) => v.id) });
      go(LIST + p.id);
      desk().say(`${p.name}: ${found.length} video${found.length === 1 ? "" : "s"}${missing.length ? `; ${missing.length} not found here` : ""}.`);
    } catch (e) {
      fail(e);
    }
  };
  const savePlaylistFile = (p: Playlist, to: "device" | "vault") => {
    const byId = new Map((lib?.videos ?? []).map((v) => [v.id, v]));
    const text = writeM3u(p.items.map((id) => byId.get(id)).filter((v): v is Video => Boolean(v)).map((v) => ({ path: v.path, title: v.name, seconds: v.seconds })));
    const name = `${fileSafe(p.name)}.m3u8`;
    if (to === "device") saveTextToDevice(name, text);
    else void saveToVault(name, text).then((at) => desk().say(`Saved as ${at}.`), fail);
  };
  /** Play a show from an episode on: through its seasons, in order. */
  const playOn = (list: Video[], from?: Video) => {
    if (!list.length) return;
    setOrder(list.map((v) => v.id));
    setPlaying((from ?? list[0]).id);
  };
  const showMenu = (s: string, rel: string, inCollection?: { c: Collection; i: number }): MenuItem[] => {
    const key = rel ? `${s}/${rel}` : s;
    const fail = (e: unknown) => desk().say(e instanceof Error ? e.message : String(e));
    const items: MenuItem[] = [{ label: "Play from the start", icon: <Play size={14} />, run: () => playOn(underFolder(videosOf(s), rel)) }];
    if (toddler) return items;
    if (inCollection) {
      const { c, i } = inCollection;
      const move = (to: number) => {
        const ids = c.items.filter((x) => x !== key);
        ids.splice(Math.max(0, Math.min(ids.length, i + to)), 0, key);
        void changeCollection({ id: c.id, items: ids }).catch(fail);
      };
      items.push(
        { sep: true },
        { label: "Earlier", icon: <ArrowUp size={14} />, disabled: i === 0, run: () => move(-1) },
        { label: "Later", icon: <ArrowDown size={14} />, disabled: i === c.items.length - 1, run: () => move(1) },
        { label: `Take out of ${c.name}`, icon: <X size={14} />, run: () => void changeCollection({ id: c.id, items: c.items.filter((x) => x !== key) }).catch(fail) },
      );
    }
    items.push(
      { sep: true },
      { heading: "In collections" },
      ...collections.map(
        (c): MenuItem => ({
          label: c.name,
          checked: c.items.includes(key),
          run: () => void changeCollection({ id: c.id, items: c.items.includes(key) ? c.items.filter((x) => x !== key) : [...c.items, key] }).catch(fail),
        }),
      ),
      {
        label: "New collection…",
        icon: <Plus size={14} />,
        run: () =>
          void askText("A new collection", "", { body: "Shows from any shelf, gathered under a name, in an order of your own.", placeholder: "Kids", yes: "Make it" }).then(
            (name) => name?.trim() && void changeCollection({ name: name.trim(), items: [key] }).then((c) => desk().say(`${c.name}: made, with ${rel.split("/").pop() || s} in it.`), fail),
          ),
      },
      ...addToShelfItems(s, rel),
    );
    // a show or season folder on a vault shelf (a whole shelf is renamed from its own menu in the sidebar)
    if (rel && !watchedNames.has(s))
      items.push({ sep: true }, {
        label: "Rename folder…",
        icon: <Pencil size={14} />,
        run: () =>
          void askText("Rename the folder", rel.split("/").pop() ?? "", { yes: "Rename" }).then((n) => {
            if (!n?.trim() || n.trim() === rel.split("/").pop()) return;
            void theaterApi.renameFolder(s, rel, n.trim()).then(async (r) => {
              await refreshLibrary();
              if (shelf === s && where.startsWith(rel)) open(s, r.folder + where.slice(rel.length));
              desk().say(`Renamed to ${n.trim()}.`);
            }, fail);
          }),
      });
    return items;
  };
  /** A shelf's own menu (in the sidebar): play it, gather it, add it to another shelf, rename it, or stop watching. */
  const shelfMenu = (s: string): MenuItem[] => {
    const items = showMenu(s, "");
    if (toddler) return items;
    const w = (lib?.folders ?? []).find((f) => f.name === s);
    if (w && lib?.canAddFolders)
      items.push({ sep: true }, {
        label: "Stop showing it",
        icon: <X size={14} />,
        run: () =>
          void askUser(`Stop showing ${s}?`, "The folder and its videos stay where they are; it just isn't a shelf here any more.", "Stop showing it", "Keep it").then(
            (yes) => yes && void theaterApi.dropFolder(w.path).then(() => (go(ALL), refreshLibrary())),
          ),
      });
    if (shelves.includes(s))
      items.push({ sep: true }, {
        label: "Rename shelf…",
        icon: <Pencil size={14} />,
        run: () =>
          void askText("Rename the shelf", s, { yes: "Rename" }).then(
            (n) => n?.trim() && n.trim() !== s && void theaterApi.renameShelf(s, n.trim()).then((r) => (refreshLibrary(), shelf === s && go(r.shelf)), fail),
          ),
      });
    return items;
  };
  const addFolder = async () => {
    const dir = (await pickInExplorer({ mode: "folder", title: "Which folder of videos? (Network places are in the sidebar)" }))?.[0];
    if (!dir) return;
    try {
      const f = await theaterApi.addFolder(dir);
      await refreshLibrary();
      setShelf(f.name);
      desk().say(`${f.name} is a shelf now, played from where it is (nothing is copied).`);
    } catch (e) {
      desk().say(e instanceof Error ? e.message : String(e));
    }
  };

  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const match = (v: Video) => words.every((w) => `${v.name} ${v.shelf}`.toLowerCase().includes(w));
    if (onDevice) return (devVideos?.videos ?? []).filter(match);
    // a kind (Movies, Series…) or what came from devices: in that one's own folders
    if (kindShown) return sorted.by[kindShown].filter(match);
    if (shelf === SHARED) return sorted.shared.filter(match);
    // a collection's shows can come from any shelf: everything stays in reach of the player
    if (collection) return (lib?.videos ?? []).filter(match);
    // a playlist shows its videos in its own order (those still here)
    if (playlist) {
      const byId = new Map((lib?.videos ?? []).map((v) => [v.id, v]));
      return playlist.items.map((id) => byId.get(id)).filter((v): v is Video => Boolean(v) && match(v!));
    }
    return (lib?.videos ?? []).filter((v) => (shelf === ALL || (shelf === FAVS ? v.fav : v.shelf === shelf)) && match(v));
  }, [lib, shelf, q, playlist, onDevice, devVideos, collection, kindShown, sorted]);
  const here = useMemo(() => (browsing ? inFolder(shown, where) : null), [browsing, shown, where]);
  // what the player steps through: the shuffled order while one is playing shuffled, otherwise what's shown
  const queue = useMemo(() => {
    if (!order) return shown;
    const byId = new Map(shown.map((v) => [v.id, v]));
    return order.map((id) => byId.get(id)).filter((v): v is Video => Boolean(v));
  }, [order, shown]);

  // thumbnails for the ones still without, a few at a time as the list changes
  useEffect(() => {
    // (not a device's: those come over that device's connection, and are watched there)
    if (shown.some((v) => v.thumb === 0 && !v.device)) void makeThumbs(shown.filter((v) => !v.device).slice(0, 200));
  }, [shown]);

  const groups = useMemo(() => {
    const out: { label: string; videos: Video[] }[] = [];
    if (playlist) return shown.length ? [{ label: `${playlist.name} · ${shown.length} video${shown.length === 1 ? "" : "s"}`, videos: shown }] : out;
    for (const v of shown) {
      const label = month(v.mtime);
      if (out.at(-1)?.label === label) out.at(-1)!.videos.push(v);
      else out.push({ label, videos: [v] });
    }
    return out;
  }, [shown]);

  const chooseTarget = async (value: string) => {
    let s = value;
    if (value === "\u0000new") {
      const name = await askText("A new shelf", "", { body: "A shelf is a folder in Vault › Videos, such as someone's name or a project.", placeholder: "Kai's films", yes: "Make it" });
      if (!name?.trim()) return;
      try {
        s = (await theaterApi.shelf(name)).shelf;
        await refreshLibrary();
      } catch (e) {
        return desk().say(e instanceof Error ? e.message : String(e));
      }
    }
    setTarget(s);
    try {
      localStorage.setItem(SHELF_KEY, s);
    } catch {
      /* it just won't remember */
    }
  };

  const take = async (files: File[]) => {
    const n = await backUp(files, target);
    if (!n) desk().say("Those aren't videos the Theater keeps (mp4, mov, webm, mkv…).");
  };

  const current = playing ? (lib?.videos.find((v) => v.id === playing) ?? devVideos?.videos.find((v) => v.id === playing) ?? null) : null;

  // ---- the sidebar: kinds, collections, playlists, shelves (by the device they came from), folders, devices ----
  const counts = new Map<string, number>();
  for (const v of lib?.videos ?? []) counts.set(v.shelf, (counts.get(v.shelf) ?? 0) + 1);
  const ownShelves = (lib?.shelves ?? []).filter((s) => !watchedNames.has(s));
  const byDevice = new Map<string, string[]>();
  for (const s of ownShelves) if (from[s]) byDevice.set(from[s], [...(byDevice.get(from[s]) ?? []), s]);
  const plainShelves = ownShelves.filter((s) => !from[s]);
  const localFolders = (lib?.folders ?? []).filter((f) => !f.path.startsWith("\\\\"));
  const netFolders = (lib?.folders ?? []).filter((f) => f.path.startsWith("\\\\"));
  const newPlaylist = () =>
    void askText("A new playlist", "", { body: "Then add videos to it from their menus (right-click, or hold).", placeholder: "Saturday cartoons", yes: "Make it" }).then(
      (name) => name?.trim() && void changePlaylist({ name: name.trim(), items: [] }).then((p) => go(LIST + p.id), fail),
    );
  const newCollection = () =>
    void askText("A new collection", "", { body: "Shows from any shelf, gathered under a name, in an order of your own. Add shows from their menus.", placeholder: "Kids", yes: "Make it" }).then(
      (name) => name?.trim() && void changeCollection({ name: name.trim(), items: [] }).then((c) => go(COL + c.id), fail),
    );
  const side = (
    <SideCtx.Provider value={{ shelf, where, virtual, go, openSecs, toggleSec }}>
    <nav className="side theater-side" aria-label="Shelves">
      <Item id={ALL} label="All videos" icon={<Film size={14} />} n={lib?.videos.length} />
      <Item id={FAVS} label="Favourites" icon={<Star size={14} />} n={(lib?.videos ?? []).filter((v) => v.fav).length} />
      <Sec k="kinds" title="Kinds">
        {KINDS.map(({ id, label }) => {
          const vs = sorted.by[id];
          if (!vs.length && id !== "unknown") return null;
          const top = id === "movie" || id === "series" ? inFolder(vs, "").folders : [];
          return top.length ? (
            <Sec key={id} k={`kind:${id}`} title={`${label} · ${vs.length}`} icon={KIND_ICON[id]} depth={1}>
              <Item id={KIND + id} label={`All ${label.toLowerCase()}`} depth={2} n={vs.length} />
              {top.slice(0, 300).map((f) => (
                <Item key={f.rel} id={KIND + id} rel={f.rel} label={f.name} depth={2} n={f.videos.length} />
              ))}
            </Sec>
          ) : (
            <Item key={id} id={KIND + id} label={label} icon={KIND_ICON[id]} n={vs.length} depth={1} />
          );
        })}
        {sorted.shared.length ? (
          <Sec k="kind:shared" title={`Shared to the server · ${sorted.shared.length}`} icon={<MonitorSmartphone size={14} />} depth={1}>
            <Item id={SHARED} label="Everything shared" depth={2} n={sorted.shared.length} />
            {inFolder(sorted.shared, "").folders.map((f) => (
              <Item key={f.rel} id={SHARED} rel={f.rel} label={f.name} depth={2} n={f.videos.length} />
            ))}
          </Sec>
        ) : null}
      </Sec>
      <Sec k="collections" title="Collections" add={{ label: "A new collection", run: newCollection }}>
        {collections.map((c) => (
          <Item key={c.id} id={COL + c.id} label={`${c.kids ? "🧸 " : ""}${c.name}`} icon={<Library size={14} />} n={c.items.length} depth={1} />
        ))}
        {collections.length ? null : <p className="faint small theater-side-note">Shows gathered under a name, like Kids.</p>}
      </Sec>
      <Sec
        k="playlists"
        title="Playlists"
        add={{
          label: "A new playlist, or one from a file",
          run: (e) =>
            openMenu(e, [
              { label: "New playlist…", icon: <ListPlus size={14} />, run: newPlaylist },
              { sep: true },
              { heading: "Open a playlist file (.m3u, .m3u8, .pls)" },
              { label: "From this device…", icon: <FileUp size={14} />, run: () => void openPlaylistFile("device") },
              { label: "From the desktop's files…", icon: <FolderOpen size={14} />, run: () => void openPlaylistFile("desk") },
            ]),
        }}
      >
        {playlists.map((p) => (
          <Item key={p.id} id={LIST + p.id} label={p.name} icon={<ListMusic size={14} />} n={p.items.length} depth={1} />
        ))}
      </Sec>
      <Sec
        k="shelves"
        title="Shelves"
        add={{ label: "A new shelf", run: () => void chooseTarget("\u0000new").then(() => void 0) }}
      >
        {plainShelves.map((s) => (
          <Item key={s} id={s} label={s} icon={<Folder size={14} />} n={counts.get(s)} depth={1} menu={() => shelfMenu(s)} />
        ))}
        {[...byDevice.entries()].map(([d, ss]) => (
          <Sec key={d} k={`dev:${d}`} title={d} icon={<Smartphone size={14} />} depth={1}>
            {ss.map((s) => (
              <Item key={s} id={s} label={s} icon={<Folder size={14} />} n={counts.get(s)} depth={2} menu={() => shelfMenu(s)} title={`${s} · from ${d}`} />
            ))}
          </Sec>
        ))}
      </Sec>
      {localFolders.length || lib?.canAddFolders ? (
        <Sec k="local" title="On this computer" icon={<HardDrive size={14} />} add={lib?.canAddFolders ? { label: "Add a folder of videos", run: () => void addFolder() } : undefined}>
          {localFolders.map((f) => (
            <Item key={f.path} id={f.name} label={f.name} icon={<Folder size={14} />} n={counts.get(f.name)} depth={1} menu={() => shelfMenu(f.name)} title={f.path} />
          ))}
        </Sec>
      ) : null}
      {netFolders.length || lib?.canAddFolders ? (
        <Sec k="network" title="Network" icon={<Network size={14} />} add={lib?.canAddFolders ? { label: "Add a network folder (Network places are in the picker's sidebar)", run: () => void addFolder() } : undefined}>
          {netFolders.map((f) => (
            <Item key={f.path} id={f.name} label={f.name} icon={<Folder size={14} />} n={counts.get(f.name)} depth={1} menu={() => shelfMenu(f.name)} title={f.path} />
          ))}
          {netFolders.length ? null : <p className="faint small theater-side-note">A share like \\ALICEMOVIES\movies, played from where it is.</p>}
        </Sec>
      ) : null}
      {devices.length ? (
        <Sec k="devices" title="Other devices" icon={<MonitorSmartphone size={14} />}>
          {devices.map((d) => (
            <Item key={d.path} id={DEV + d.path} label={d.name} icon={<Smartphone size={14} />} depth={1} />
          ))}
        </Sec>
      ) : null}
    </nav>
    </SideCtx.Provider>
  );

  return (
    <div
      ref={ref}
      className={`theater${narrow ? " narrow" : ""}${slim ? " slim" : ""}`}
      onDragOver={(e) => e.dataTransfer.types.includes("Files") && e.preventDefault()}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        void take([...e.dataTransfer.files]);
      }}
    >
      {toddler ? null : (
      <div className="theater-top">
        {slim ? (
          <button className={`btn small${sideOpen ? " on" : " ghost"}`} onClick={() => setSideOpen(!sideOpen)} aria-expanded={sideOpen} title="Shelves, kinds and playlists">
            <PanelLeft size={15} /> <span className="theater-here">{shelf === ALL ? "All" : shelf === FAVS ? "Favourites" : (collection?.name ?? playlist?.name ?? (onDevice ? devices.find((d) => d.path === onDevice)?.name : labelOf(shelf)))}</span>
          </button>
        ) : null}
        <div className="theater-search">
          <Search size={15} />
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a video" aria-label="Find a video" />
        </div>
        <button className="btn primary" onClick={() => pick.current?.click()} title="Copies videos from this device onto the desktop, checked piece by piece">
          <Upload size={15} /> {narrow ? "Back up" : "Back up videos"}
        </button>
        <label className="theater-to small">
          <span className="faint">to</span>
          <select className="input" value={target} onChange={(e) => void chooseTarget(e.target.value)} aria-label="Shelf to back up to">
            <option value="">Videos</option>
            {shelves.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
            {target && !shelves.includes(target) ? <option value={target}>{target}</option> : null}
            <option value={"\u0000new"}>New shelf…</option>
          </select>
        </label>
        <button className="btn small ghost" onClick={() => void refreshLibrary(true)} title="Look again" aria-label="Look again">
          <RefreshCw size={14} />
        </button>
        <input
          ref={pick}
          type="file"
          accept="video/*"
          multiple
          hidden
          onChange={(e) => {
            const f = [...(e.target.files ?? [])];
            e.target.value = "";
            if (f.length) void take(f);
          }}
        />
      </div>
      )}

      {toddler ? (
        // toddler mode: only the collections chosen for it, as big chips (no sidebar)
        <div className="theater-shelves" role="tablist" aria-label="Shelves">
          {kidsCols.map((c) => (
            <button key={c.id} role="tab" aria-selected={shelf === COL + c.id} className={`chip${shelf === COL + c.id ? " focus" : ""}`} onClick={() => go(COL + c.id)}>
              ▦ {c.name}
            </button>
          ))}
        </div>
      ) : null}

      <div className="theater-body">
      {toddler || (slim && !sideOpen) ? null : side}
      <div className="theater-main">

      {playlist ? (
        <div className="theater-playlist-bar">
          <button className="btn small primary" disabled={!shown.length} onClick={() => (setOrder(null), setPlaying(shown[0]?.id ?? null))}>
            <Play size={13} /> Play all
          </button>
          <button
            className="btn small"
            disabled={!shown.length}
            onClick={() => {
              const ids = shown.map((v) => v.id).sort(() => Math.random() - 0.5);
              setOrder(ids);
              setPlaying(ids[0] ?? null);
            }}
          >
            <Shuffle size={13} /> Shuffle
          </button>
          <button className={`btn small ghost${repeat ? " on" : ""}`} aria-pressed={repeat} onClick={() => setRepeat(!repeat)} title="Start over at the end">
            <Repeat size={13} /> Repeat
          </button>
          <span style={{ flex: 1 }} />
          {toddler ? null : (
            <>
              <button
                className="btn small ghost"
                disabled={!playlist.items.length}
                title="As an .m3u8 file, which VLC, Kodi, Windows Media Player and the Xbox can play"
                onClick={(e) =>
                  openMenu(e, [
                    { heading: "Save as a playlist file (.m3u8)" },
                    { label: "To this device", icon: <FileDown size={14} />, run: () => savePlaylistFile(playlist, "device") },
                    { label: "In Vault › Playlists", icon: <FolderInput size={14} />, run: () => savePlaylistFile(playlist, "vault") },
                  ])
                }
              >
                <FileDown size={13} /> Save as a file
              </button>
              <button
                className="btn small ghost"
                onClick={() => void askText("Rename the playlist", playlist.name, { yes: "Rename" }).then((name) => name?.trim() && void changePlaylist({ id: playlist.id, name: name.trim() }))}
              >
                <Pencil size={13} /> Rename
              </button>
              <button
                className="btn small ghost"
                onClick={() =>
                  void askUser(`Delete ${playlist.name}?`, "Only the list goes; the videos stay where they are.", "Delete it", "Keep it").then(
                    (yes) => yes && void deletePlaylist(playlist.id).then(() => setShelf(ALL)),
                  )
                }
              >
                <Trash2 size={13} /> Delete
              </button>
            </>
          )}
        </div>
      ) : null}

      {collection && !toddler ? (
        <div className="theater-playlist-bar">
          <span className="small muted grow">Shows gathered from any shelf, in your order. Add one from a show's menu (right-click, or hold).</span>
          <button
            className={`btn small${collection.kids ? " on" : " ghost"}`}
            aria-pressed={Boolean(collection.kids)}
            onClick={() => void changeCollection({ id: collection.id, kids: !collection.kids }).then((c) => desk().say(c.kids ? `Toddler mode's Theater shows ${c.name}.` : `${c.name} isn't in toddler mode's Theater any more.`))}
            title="In toddler mode, the Theater shows only the collections marked for it"
          >
            🧸 {collection.kids ? "In toddler mode" : "Show in toddler mode"}
          </button>
          {(() => {
            const i = collections.findIndex((c) => c.id === collection.id);
            return (
              <>
                <button className="btn small ghost" disabled={i <= 0} onClick={() => void changeCollection({ id: collection.id, at: i - 1 })} title="Earlier among the collections">
                  <ArrowUp size={13} />
                </button>
                <button className="btn small ghost" disabled={i >= collections.length - 1} onClick={() => void changeCollection({ id: collection.id, at: i + 1 })} title="Later among the collections">
                  <ArrowDown size={13} />
                </button>
              </>
            );
          })()}
          <button className="btn small ghost" onClick={() => void askText("Rename the collection", collection.name, { yes: "Rename" }).then((name) => name?.trim() && void changeCollection({ id: collection.id, name: name.trim() }))}>
            <Pencil size={13} /> Rename
          </button>
          <button
            className="btn small ghost"
            onClick={() =>
              void askUser(`Delete ${collection.name}?`, "Only the collection goes; the shows and their videos stay where they are.", "Delete it", "Keep it").then(
                (yes) => yes && void theaterApi.dropCollection(collection.id).then(() => (setShelf(ALL), refreshLibrary())),
              )
            }
          >
            <Trash2 size={13} /> Delete
          </button>
        </div>
      ) : null}
      {browsing && (where || via) ? (
        <div className="theater-crumbs small">
          {via ? (
            <>
              <button className="link-btn" onClick={() => (setShelf(COL + via.id), setVia(null))}>
                ‹ {via.name}
              </button>
              <span className="faint"> · </span>
            </>
          ) : null}
          {toddler ? null : (
            <button className="link-btn" onClick={() => open(shelf, "")}>
              {labelOf(shelf)}
            </button>
          )}
          {where
            .split("/")
            .filter(Boolean)
            .map((seg, i, all) =>
              // (in toddler mode, nothing above the show the collection holds)
              toddler && all.slice(0, i + 1).join("/").length < viaRoot.length ? null : (
              <span key={i}>
                {toddler && all.slice(0, i + 1).join("/") === viaRoot ? null : <span className="faint"> › </span>}
                <button className="link-btn" onClick={() => open(shelf, all.slice(0, i + 1).join("/"))}>
                  {seg}
                </button>
              </span>
            ))}
        </div>
      ) : null}
      {watched ? (
        <div className="theater-playlist-bar small">
          <span className="muted grow" title={watched.path}>
            {lib?.scanning?.includes(watched.name) ? "Looking through " : "Played from "}
            <span className="mono">{watched.path}</span>
            {lib?.scanning?.includes(watched.name) ? "…" : ", where it stays."}
          </span>
          {lib?.canAddFolders && !toddler ? (
            <button
              className="btn small ghost"
              onClick={() =>
                void askUser(`Stop showing ${watched.name}?`, "The folder and its videos stay where they are; it just isn't a shelf here any more.", "Stop showing it", "Keep it").then(
                  (yes) => yes && void theaterApi.dropFolder(watched.path).then(() => (setShelf(ALL), refreshLibrary())),
                )
              }
            >
              <X size={13} /> Stop showing it
            </button>
          ) : null}
        </div>
      ) : null}
      {onDevice ? (
        <p className="small muted" style={{ margin: "4px 12px" }}>
          {devVideos?.busy ? "Asking that device what it shares…" : devVideos?.error ? devVideos.error : `Played from that device while its page stays open${devVideos?.videos.length ? "" : ": no videos in what it shares"}.`}
        </p>
      ) : null}

      {jobs.length ? <Uploads /> : null}

      <div className="theater-list">
        {toddler && !kidsCols.length ? (
          <div className="theater-empty">
            <Film size={42} />
            <p className="small muted">Nothing is chosen for toddler mode yet. A grown-up can choose a collection in the Theater: open it, then press 🧸 Show in toddler mode.</p>
          </div>
        ) : null}
        {error ? <p className="small bad-text">{error}</p> : null}
        {lib && !lib.videos.length ? (
          <div className="theater-empty">
            <Film size={42} />
            <p>
              <b>No videos here yet.</b>
            </p>
            <p className="small muted">
              On a phone, open the desktop's address and press <b>Back up videos</b>: they're copied here in checked pieces, and once each one says
              <b> Safe on the desktop</b>, the phone can let go of it. On this computer you can drop videos here, or put them in Vault › Videos.
            </p>
          </div>
        ) : null}
        {lib && lib.videos.length && !shown.length ? (
          <p className="small muted">
            {playlist ? (q ? "Nothing in this playlist matches." : "This playlist is empty. Add videos from their menus: right-click one (or hold it), then Add to playlist.") : `Nothing on this shelf${q ? " matches" : " yet"}.`}
          </p>
        ) : null}
        {hideAll ? null : collection ? (
          collection.items.length ? (
            <div className="theater-grid">
              {collection.items.map((key, i) => {
                const [s, ...rest] = key.split("/");
                const rel = rest.join("/");
                const vs = underFolder(videosOf(s), rel);
                return (
                  <FolderTile
                    key={key}
                    name={rest.at(-1) || s}
                    hint={rel ? s : undefined}
                    videos={vs}
                    onOpen={() => open(s, rel, collection)}
                    menu={() => showMenu(s, rel, { c: collection, i })}
                  />
                );
              })}
            </div>
          ) : (
            <p className="small muted">Nothing in {collection.name} yet. Open a shelf, then add shows from their menus (right-click a show, or hold it).</p>
          )
        ) : null}
        {!hideAll && here ? (
          <>
            {here.folders.length ? (
              <div className="theater-grid">
                {here.folders.map((f) => (
                  <FolderTile key={f.rel} name={f.name} videos={f.videos} onOpen={() => open(shelf, f.rel)} menu={() => (virtual ? [{ label: "Play from the start", icon: <Play size={14} />, run: () => playOn(underFolder(shown, f.rel)) }] : showMenu(shelf, f.rel))} />
                ))}
              </div>
            ) : null}
            {here.here.length ? (
              <div className="theater-grid" style={{ marginTop: 10 }}>
                {here.here.map((v) => (
                  <Card
                    key={v.id}
                    v={v}
                    // on from this one: through the rest of the show (its seasons in order), or what's loose here
                    onPlay={() => playOn(where ? underFolder(shown, where.split("/")[0]) : here.here, v)}
                    menu={() => (toddler ? [] : [...addToPlaylistItems(v, playlists), ...videoShelfItems(v)])}
                  />
                ))}
              </div>
            ) : null}
          </>
        ) : null}
        {hideAll || here || collection ? null : groups.map((g) => (
          <section key={g.label}>
            <h3 className="theater-month">{g.label}</h3>
            <div className="theater-grid">
              {g.videos.map((v, i) => (
                <Card
                  key={v.id}
                  v={v}
                  onPlay={() => (setOrder(null), setPlaying(v.id))}
                  menu={() => {
                    if (toddler) return [];
                    const items = [...addToPlaylistItems(v, playlists), ...videoShelfItems(v)];
                    if (!playlist || q) return items;
                    // inside a playlist: its order, and leaving it
                    const move = (to: number) => {
                      const ids = playlist.items.filter((id) => id !== v.id);
                      const at = playlist.items.indexOf(v.id) + to;
                      ids.splice(Math.max(0, Math.min(ids.length, at)), 0, v.id);
                      void changePlaylist({ id: playlist.id, items: ids });
                    };
                    return [
                      { label: "Earlier in the playlist", icon: <ArrowUp size={14} />, disabled: i === 0, run: () => move(-1) },
                      { label: "Later in the playlist", icon: <ArrowDown size={14} />, disabled: i === g.videos.length - 1, run: () => move(1) },
                      { label: `Take off ${playlist.name}`, icon: <X size={14} />, run: () => void changePlaylist({ id: playlist.id, items: playlist.items.filter((id) => id !== v.id) }) },
                      { sep: true },
                      ...items,
                    ];
                  }}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
      </div>
      </div>

      {current ? (
        <Player
          v={current}
          list={queue}
          repeat={Boolean(playlist) && repeat}
          playlists={playlists}
          toddler={toddler}
          shelves={shelves}
          onPick={(id) => setPlaying(id)}
          onClose={() => setPlaying(null)}
        />
      ) : null}
    </div>
  );
}

type Side = { shelf: string; where: string; virtual: boolean; go: (id: string, rel?: string) => void; openSecs: Set<string>; toggleSec: (k: string) => void };
const SideCtx = createContext<Side>({ shelf: "", where: "", virtual: false, go: () => {}, openSecs: new Set(), toggleSec: () => {} });

function Item({ id, rel = "", label, icon, n, depth = 0, menu, title }: { id: string; rel?: string; label: string; icon?: React.ReactNode; n?: number; depth?: number; menu?: () => MenuItem[]; title?: string }) {
  const { shelf, where, virtual, go } = useContext(SideCtx);
return (
  <button
    className={`item${shelf === id && (rel ? where === rel : !where || !virtual) ? " on" : ""}`}
    style={depth ? { paddingLeft: 8 + depth * 14 } : undefined}
    onClick={() => go(id, rel)}
    onContextMenu={menu ? (e) => openMenu(e, menu()) : undefined}
    title={title ?? label}
  >
    {icon} <span className="grow theater-side-name">{label}</span>
    {n ? <span className="faint small">{n}</span> : null}
  </button>
);
}
function Sec({ k, title, icon, add, children, depth = 0 }: { k: string; title: string; icon?: React.ReactNode; add?: { label: string; run: (e: React.MouseEvent) => void }; children: React.ReactNode; depth?: number }) {
  const { openSecs, toggleSec } = useContext(SideCtx);
return (
  <>
    <div className="theater-sec" style={depth ? { paddingLeft: 4 + depth * 14 } : undefined}>
      <button className="theater-sec-head" onClick={() => toggleSec(k)} aria-expanded={openSecs.has(k)}>
        {openSecs.has(k) ? <ChevronDown size={13} /> : <ChevronRight size={13} />} {icon} <span className="theater-side-name">{title}</span>
      </button>
      {add ? (
        <button className="icon-btn" onClick={add.run} title={add.label} aria-label={add.label}>
          <Plus size={13} />
        </button>
      ) : null}
    </div>
    {openSecs.has(k) ? children : null}
  </>
);
}

/** A show or a season: a folder of videos, with a picture from the first that has one, and how many it holds. */
function FolderTile({ name, hint, videos, onOpen, menu }: { name: string; hint?: string; videos: Video[]; onOpen: () => void; menu: () => MenuItem[] }) {
  const sample = videos.find((v) => v.thumb === 1);
  return (
    <button
      className="theater-card theater-folder"
      onClick={onOpen}
      onContextMenu={(e) => {
        const items = menu();
        if (items.length) openMenu(e, items);
      }}
      title={`${name}${hint ? ` · ${hint}` : ""} · ${videos.length} video${videos.length === 1 ? "" : "s"}`}
    >
      <span className="theater-thumb">
        {sample ? <img src={thumbUrl(sample.id)} alt="" loading="lazy" /> : <FolderOpen size={30} />}
        <span className="theater-len">
          {videos.length} video{videos.length === 1 ? "" : "s"}
        </span>
      </span>
      <span className="theater-name">
        <Folder size={12} /> {name}
        {hint ? <span className="faint small"> · {hint}</span> : null}
      </span>
    </button>
  );
}

function Card({ v, onPlay, menu }: { v: Video; onPlay: () => void; menu: () => MenuItem[] }) {
  const at = leftOff(v.id);
  return (
    <button
      className="theater-card"
      onClick={onPlay}
      onContextMenu={(e) => {
        const items = menu();
        if (items.length) openMenu(e, items);
      }}
      title={`${v.name} · ${sizeText(v.size)}${v.shelf ? ` · ${v.shelf}` : ""}`}>
      <span className="theater-thumb">
        {v.thumb === 1 ? <img src={thumbUrl(v.id)} alt="" loading="lazy" /> : <Film size={30} />}
        {v.seconds ? <span className="theater-len">{lengthText(v.seconds)}</span> : null}
        {v.fav ? <Star className="theater-fav" size={15} fill="currentColor" /> : null}
        {at && v.seconds ? <span className="theater-progress" style={{ width: `${Math.min(100, (at / v.seconds) * 100)}%` }} /> : null}
      </span>
      <span className="theater-name">{v.name}</span>
    </button>
  );
}

function Player({
  v,
  list,
  repeat,
  playlists,
  toddler,
  shelves,
  onPick,
  onClose,
}: {
  v: Video;
  list: Video[];
  repeat: boolean;
  playlists: Playlist[];
  toddler: boolean;
  shelves: string[];
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const vid = useRef<HTMLVideoElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const i = list.findIndex((x) => x.id === v.id);
  const prev = i > 0 ? list[i - 1] : null;
  // at the end of a playlist on repeat, back to its first
  const next = i >= 0 && i < list.length - 1 ? list[i + 1] : repeat && list.length > 1 ? list[0] : null;

  // carry on from where it was left on this device, and remember as it plays
  useEffect(() => {
    const el = vid.current;
    if (!el) return;
    const from = leftOff(v.id);
    const start = () => {
      if (from && el.duration && from < el.duration - 8) el.currentTime = from;
      void el.play().catch(() => {});
    };
    el.addEventListener("loadedmetadata", start, { once: true });
    const save = () => rememberPosition(v.id, el.currentTime, el.duration || v.seconds);
    const t = setInterval(save, 4000);
    return () => {
      clearInterval(t);
      save();
      el.removeEventListener("loadedmetadata", start);
    };
  }, [v.id, v.seconds]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.fullscreenElement) onClose();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  const fav = async () => {
    try {
      patchVideo(v.id, { fav: (await theaterApi.fav(v.id, !v.fav)).fav });
    } catch (e) {
      desk().say(e instanceof Error ? e.message : String(e));
    }
  };

  const menu = (): MenuItem[] => {
    const items: MenuItem[] = [{ label: "Save a copy to this device", icon: <Download size={14} />, run: () => downloadToDevice(v.path) }];
    if (toddler || v.device) return items;
    // a watched folder's video stays as it is there: no renaming, moving or deleting from here
    if (v.watched) return [...items, ...addToPlaylistItems(v, playlists)];
    const act = (fn: () => Promise<unknown>, said: string) => async () => {
      try {
        await fn();
        desk().say(said);
        await refreshLibrary();
      } catch (e) {
        desk().say(e instanceof Error ? e.message : String(e));
      }
    };
    return [
      ...items,
      ...addToPlaylistItems(v, playlists),
      { sep: true },
      {
        label: "Rename…",
        icon: <Pencil size={14} />,
        run: async () => {
          const name = await askText("Rename", v.name, { yes: "Rename" });
          if (name?.trim() && name.trim() !== v.name) void act(() => fileApi.rename(v.path, `${name.trim()}.${v.ext}`), `Renamed to ${name.trim()}.`)();
        },
      },
      { heading: "Move to shelf" },
      ...["", ...shelves]
        .filter((s) => s !== v.shelf)
        .map((s): MenuItem => ({ label: s || "Videos (no shelf)", icon: <FolderInput size={14} />, run: () => void act(() => theaterApi.move(v.path, s), `Moved to ${s || "Videos"}.`)() })),
      { sep: true },
      {
        label: "Move to the trash",
        icon: <Trash2 size={14} />,
        danger: true,
        run: () => {
          onClose();
          void act(() => fileApi.trash(v.path), `${v.name} went to the trash (Explorer › Trash puts it back).`)();
        },
      },
    ];
  };

  return (
    <div className="theater-player" role="dialog" aria-label={v.name}>
      <div className="theater-bar">
        <button className="btn ghost" onClick={onClose} aria-label="Back to the videos" title="Back (Esc)">
          <X size={18} />
        </button>
        <span className="theater-title" title={v.name}>
          {v.name}
          {v.shelf ? <span className="faint small"> · {v.shelf}</span> : null}
        </span>
        <button className={`btn ghost${v.fav ? " on" : ""}`} hidden={v.device} onClick={() => void fav()} aria-pressed={v.fav} aria-label={v.fav ? "Not a favourite" : "Favourite"} title="Favourite">
          <Star size={18} fill={v.fav ? "currentColor" : "none"} />
        </button>
        <button ref={more} className="btn ghost" onClick={() => more.current && openMenuAt(more.current, menu())} aria-label="More" title="More">
          <MoreHorizontal size={18} />
        </button>
      </div>
      <video key={v.id} ref={vid} className="theater-video" src={videoUrl(v)} controls playsInline onEnded={() => next && onPick(next.id)} />
      <div className="theater-nav">
        <button className="btn ghost" disabled={!prev} onClick={() => prev && onPick(prev.id)} aria-label="Previous video">
          <ChevronLeft size={18} /> {prev ? <span className="theater-nav-name">{prev.name}</span> : null}
        </button>
        <span className="small faint">
          {i + 1} of {list.length} · {sizeText(v.size)}
        </span>
        <button className="btn ghost" disabled={!next} onClick={() => next && onPick(next.id)} aria-label="Next video">
          {next ? <span className="theater-nav-name">{next.name}</span> : null} <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}

/** What this device is backing up, and what's safe to let go of. */
function Uploads() {
  const jobs = useJobs();
  const toddler = useDesk((s) => s.toddler);
  const safe = jobs.filter((j) => j.state === "done" || j.state === "kept");
  const busy = jobs.filter((j) => !["done", "kept", "failed"].includes(j.state));
  const total = busy.reduce((n, j) => n + j.file.size, 0), sent = busy.reduce((n, j) => n + j.sent, 0);
  const [open, setOpen] = useState(true);
  return (
    <div className="theater-uploads">
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <b className="small">
          {busy.length ? `Backing up ${busy.length} video${busy.length === 1 ? "" : "s"} · ${sizeText(sent)} of ${sizeText(total)}` : "Backed up"}
        </b>
        {safe.length ? (
          <span className="small good-text">
            {safe.length} safe on the desktop{busy.length ? "" : ": this device can let go of them"}
          </span>
        ) : null}
        <span style={{ flex: 1 }} />
        <button className="btn small ghost" onClick={() => setOpen(!open)}>
          {open ? "Hide" : "Show"}
        </button>
        {safe.length && !busy.length ? (
          <button className="btn small" onClick={clearFinished}>
            Done
          </button>
        ) : null}
      </div>
      {busy.length ? <div className="theater-bar-total"><span style={{ width: `${total ? (sent / total) * 100 : 0}%` }} /></div> : null}
      {open ? (
        <>
          {busy.length ? <p className="small faint" style={{ margin: "4px 0" }}>Keep this page open until it's done. If the Wi-Fi drops, it carries on from where it got to.</p> : null}
          {safe.length && !busy.length ? (
            <p className="small muted" style={{ margin: "4px 0" }}>
              Each one arrived whole{crypto.subtle ? ", checked piece by piece" : ""}. To free the space, delete them in this phone's Gallery or Photos app (and
              empty its “Recently deleted”). You can watch them here any time.
            </p>
          ) : null}
          <ul className="theater-jobs">
            {jobs.map((j) => (
              <li key={j.key}>
                <span className="theater-job-name" title={j.file.name}>
                  {j.file.name}
                </span>
                <span className={`small ${j.state === "failed" ? "bad-text" : j.state === "done" || j.state === "kept" ? "good-text" : "faint"}`}>
                  {j.state === "checking"
                    ? "Checking…"
                    : j.state === "waiting"
                      ? `Waiting · ${sizeText(j.file.size)}`
                      : j.state === "sending"
                        ? j.error || `${Math.floor((j.sent / j.file.size) * 100)}% of ${sizeText(j.file.size)}`
                        : j.state === "done"
                          ? "✓ Safe on the desktop"
                          : j.state === "kept"
                            ? "✓ Already on the desktop"
                            : j.error}
                </span>
                {j.state === "failed" ? (
                  <button className="btn small" onClick={() => retryJob(j)}>
                    Try again
                  </button>
                ) : null}
                {(j.state === "done" || j.state === "kept") && j.path && !toddler ? (
                  <button
                    className="btn small ghost"
                    onClick={() => void renameVideo(j.path!, baseName(j.path!).replace(/\.[^.]+$/, "")).then((p) => p && (j.path = p))}
                    aria-label={`Rename ${j.file.name} on the desktop`}
                    title="Rename it on the desktop"
                  >
                    <Pencil size={13} />
                  </button>
                ) : null}
                {j.state !== "done" && j.state !== "kept" ? (
                  <button className="btn small ghost" onClick={() => cancelJob(j)} aria-label={`Stop backing up ${j.file.name}`}>
                    <X size={13} />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
