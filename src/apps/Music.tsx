import { toCss } from "../lib/zoom.ts";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, FileDown, FileUp, FolderInput, ListPlus, Pencil, Plus, X, AudioWaveform, ChevronUp, ChevronsRight, Disc3, Folder, FolderOpen, FolderPlus, Globe2, ListMusic, Maximize2, Mic2, MonitorSmartphone, Pause, Play, Radio, Repeat, Repeat1, Search, Shuffle, SkipBack, Sparkles, SkipForward, Star, Trash2, Upload, Users, Volume2 } from "lucide-react";
import { desk, useDesk } from "../lib/store.ts";
import {
  addFiles,
  coverOf,
  current,
  enqueue,
  findStations,
  forgetStation,
  loadLibrary,
  next,
  playList,
  previous,
  saveStation,
  scan,
  searchLibrary,
  seek,
  toggle,
  useMusic,
  type Item,
  type MusicPlaylist,
  type Station,
  type Track,
  shuffled,
  albumOrder,
  skipBy,
} from "../lib/music.ts";
import { Num } from "../ui/Num.tsx";
import { copyToServer, shareMusicFiles, shareMusicFolder, thisDevice, useServerName, useSharedLibraries, AUDIO } from "../lib/musicShare.ts";
import { canShareFolder, stopSharing, useMyShares } from "../lib/devshare.ts";
import { openMenu, openMenuAt, type MenuItem } from "../ui/ContextMenu.tsx";
import { useWidth } from "../ui/hooks.ts";
import { Visualizer, importPresets, milkdropPresets } from "./Visualizer.tsx";
import { WorldRadio } from "./WorldRadio.tsx";
import { SongMaker } from "./SongMaker.tsx";
import { openSongInfo, SongInfoHost } from "../ui/SongInfo.tsx";
import { copyText } from "../lib/clipboard.ts";
import { askText, askUser } from "../ui/Ask.tsx";
import { baseName, pickInExplorer, rawUrl } from "../lib/explorer.ts";
import { matchEntries, nameFromFile, parsePlaylist, readDeviceFile, saveTextToDevice, saveToVault, writeM3u } from "../lib/playlistFile.ts";

const PAGE = 400;

type View = "songs" | "make" | "albums" | "artists" | "world" | "radio" | "find" | "folders" | "shared" | "playlist";
const time = (s: number) => (Number.isFinite(s) && s > 0 ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "–:––");
const setPrefs = (p: Partial<ReturnType<typeof desk>["music"]>) => desk().set({ music: { ...desk().music, ...p } });
const asItems = (ts: Track[]): Item[] => ts.map((t) => ({ kind: "track", ...t }));
/** Past the rest of this album, or this artist, in the queue (playing by artist or album, or albums shuffled). */
const skip = (by: "album" | "artist") => {
  const said = skipBy(by);
  if (said) desk().say(said);
};
const skipMenu = (): MenuItem[] => [
  { label: "Skip to the next album", run: () => skip("album") },
  { label: "Skip to the next artist", run: () => skip("artist") },
];

export function MusicApp() {
  const m = useMusic();
  const prefs = useDesk((s) => s.music);
  const [view, setView] = useState<View>("songs");
  const [q, setQ] = useState("");
  const [album, setAlbum] = useState<string | null>(null);
  const [listId, setListId] = useState("");
  const openList = (p: MusicPlaylist) => (setView("playlist"), setListId(p.id));
  const [dropping, setDropping] = useState(false);
  const [ref, width] = useWidth<HTMLDivElement>();
  const files = useRef<HTMLInputElement>(null);
  const presetFiles = useRef<HTMLInputElement>(null);
  const vizBox = useRef<HTMLDivElement>(null);
  const narrow = width < 700;

  useEffect(() => {
    if (!m.loaded) void loadLibrary();
  }, [m.loaded]);

  const songs = useMemo(() => searchLibrary(q, Infinity), [q, m.tracks]); // eslint-disable-line react-hooks/exhaustive-deps
  // the songs list draws a few hundred at a time and adds more as you scroll near the end
  const [shown, setShown] = useState(PAGE);
  useEffect(() => setShown(PAGE), [q]);
  const more = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    const el = more.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && setShown((n) => n + PAGE), { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [shown, songs, view]);
  const albums = useMemo(() => {
    const map = new Map<string, Track[]>();
    for (const t of songs) {
      const k = `${t.album || "Singles"}\u0000${t.album ? t.artist : ""}`;
      map.set(k, [...(map.get(k) ?? []), t]);
    }
    return [...map.entries()].map(([k, ts]) => ({ key: k, name: k.split("\u0000")[0], artist: k.split("\u0000")[1] || ts[0]?.artist || "", tracks: ts.sort((a, b) => a.track - b.track), cover: ts.find((t) => t.cover) }));
  }, [songs]);
  const artists = useMemo(() => {
    const map = new Map<string, Track[]>();
    for (const t of songs) map.set(t.artist || "Unknown artist", [...(map.get(t.artist || "Unknown artist") ?? []), t]);
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [songs]);

  const cur = current();
  const trackMenu = (list: Track[], i: number): MenuItem[] => [
    { label: "Play", run: () => playList(asItems(list), i) },
    { label: "Play next", run: () => useMusic.setState((s) => ({ queue: [...s.queue.slice(0, s.index + 1), { kind: "track", ...list[i] }, ...s.queue.slice(s.index + 1)] })) },
    { label: "Add to the queue", run: () => enqueue(asItems([list[i]])) },
    { sep: true },
    { label: "Copy title and artist", run: () => void copyText(`${list[i].title}${list[i].artist ? ` · ${list[i].artist}` : ""}`) },
    ...(list[i].src ? [] : [{ sep: true } as MenuItem, { label: "Rename…", icon: <Pencil size={14} />, run: () => void renameSong(list[i]) } as MenuItem]),
    ...addToPlaylistItems(list[i], openList),
    { sep: true },
    { label: "Properties…", run: () => openSongInfo({ track: list[i], made: desk().media.made.find((s) => s.file.replace(/\.[^.]+$/, "") === list[i].title || s.title === list[i].title) }) },
  ];

  // the visualizer's choices: from the player's footer, and from the sidebar (where phones can reach them)
  const vizMenu = (e: React.MouseEvent): void =>
    openMenu(e, [
      { heading: "Visualizer" },
      ...(["bars", "scope", "milkdrop", "off"] as const).map((v) => ({
        label: { bars: "Bars", scope: "Scope", milkdrop: "Milkdrop", off: "No visualizer" }[v],
        checked: prefs.viz === v,
        run: () => setPrefs({ viz: v }),
      })),
      { sep: true },
      { label: "Open in its own window", run: () => desk().openApp("visualizer") },
      { label: "Full screen", run: () => void vizBox.current?.requestFullscreen?.() },
      { label: "As the desktop background", checked: prefs.vizBackground, run: () => setPrefs({ vizBackground: !prefs.vizBackground }) },
      { label: "Milkdrop: a new preset every 25 seconds", checked: prefs.cycle, run: () => setPrefs({ cycle: !prefs.cycle }) },
      { label: "Milkdrop: choose a preset…", run: () => void choosePreset() },
      { label: "Import Milkdrop presets (.json)…", run: () => presetFiles.current?.click() },
      { sep: true },
      { heading: "While characters talk" },
      { label: "Lower the music while one speaks", checked: prefs.duck, run: () => setPrefs({ duck: !prefs.duck }) },
      { label: "Let the one in focus comment on new songs (uses the AI)", checked: prefs.comment, run: () => setPrefs({ comment: !prefs.comment }) },
    ]);

  const side = (
    <nav className="side music-side">
      {(
        [
          ["songs", <ListMusic size={15} key="s" />, `Songs (${m.tracks.length})`],
          ["make", <Sparkles size={15} key="m" />, "Make a song"],
          ["albums", <Disc3 size={15} key="a" />, "Albums"],
          ["artists", <Users size={15} key="r" />, "Artists"],
          ["world", <Globe2 size={15} key="w" />, "Worldband"],
          ["radio", <Radio size={15} key="ra" />, `Radio (${prefs.stations.length})`],
          ["find", <Search size={15} key="f" />, "Find stations"],
          ["folders", <FolderPlus size={15} key="fo" />, "Folders"],
          ["shared", <MonitorSmartphone size={15} key="sh" />, "Other devices"],
        ] as [View, React.ReactNode, string][]
      ).map(([id, icon, text]) => (
        <button key={id} className={`item${view === id ? " on" : ""}`} onClick={() => (setView(id), setAlbum(null))}>
          {icon} {text}
        </button>
      ))}
      <button className="item" onClick={vizMenu} aria-haspopup="menu">
        <AudioWaveform size={15} /> Visualizer
      </button>
      <div className="music-side-head">
        <span className="folder grow">Playlists</span>
        <button className="icon-btn" title="A new playlist, or one from a file" aria-label="A new playlist, or one from a file" onClick={(e) => openMenu(e, playlistFileMenu(openList))}>
          <Plus size={13} />
        </button>
      </div>
      {(prefs.playlists ?? []).map((p) => (
        <button key={p.id} className={`item${view === "playlist" && listId === p.id ? " on" : ""}`} onClick={() => openList(p)} title={p.name}>
          <ListMusic size={15} /> {p.name}
        </button>
      ))}
    </nav>
  );

  return (
    <div
      ref={ref}
      className={`music${dropping ? " dropping" : ""}${narrow ? " narrow" : ""}`}
      onDragOver={(e) => [...e.dataTransfer.types].includes("Files") && (e.preventDefault(), setDropping(true))}
      onDragLeave={(e) => e.currentTarget === e.target && setDropping(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDropping(false);
        if (e.dataTransfer.files.length) void addFiles([...e.dataTransfer.files]).then((r) => desk().say(`${r.tracks} songs in your library.`));
      }}
    >
      <div className="music-body">
        {side}
        <section className="music-main">
          {prefs.viz !== "off" && view !== "make" ? (
            <>
              <div className="music-viz" ref={vizBox} style={{ height: prefs.vizHeight }} onDoubleClick={() => void vizBox.current?.requestFullscreen?.()}>
                <Visualizer big />
              </div>
              <div
                className="music-split"
                role="separator"
                aria-orientation="horizontal"
                aria-label="Visualizer height: drag, or use the arrow keys"
                aria-valuenow={prefs.vizHeight}
                tabIndex={0}
                data-tip="Drag to resize · double-click to fold away or back"
                onPointerDown={(e) => {
                  const start = e.clientY;
                  const from = prefs.vizHeight;
                  const box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  const move = (ev: PointerEvent) => setPrefs({ vizHeight: Math.round(Math.max(40, Math.min(toCss(box.height) - 90, from + toCss(ev.clientY - start)))) });
                  const up = () => (window.removeEventListener("pointermove", move), window.removeEventListener("pointerup", up));
                  window.addEventListener("pointermove", move);
                  window.addEventListener("pointerup", up);
                }}
                onDoubleClick={() => setPrefs({ vizHeight: prefs.vizHeight > 60 ? 40 : 180 })}
                onKeyDown={(e) => {
                  if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                    e.preventDefault();
                    setPrefs({ vizHeight: Math.max(40, prefs.vizHeight + (e.key === "ArrowDown" ? 20 : -20)) });
                  }
                }}
              />
            </>
          ) : null}
          {m.scanning ? <div className="note small" style={{ margin: 8 }}>{m.scanning}</div> : null}
          {m.error ? <div className="note small bad" style={{ margin: 8 }}>{m.error}</div> : null}

          {view === "songs" || view === "albums" || view === "artists" ? (
            <div className="toolbar">
              <Search size={15} className="faint" />
              <input className="input grow" style={{ maxWidth: 320 }} value={q} placeholder="Title, artist, album, genre, year" onChange={(e) => setQ(e.target.value)} aria-label="Search your music" />
              {album ? (
                <button className="btn small" onClick={() => setAlbum(null)}>
                  All albums
                </button>
              ) : null}
              <span className="grow" />
              <button
                className="btn small"
                disabled={!songs.length}
                data-tip={view === "albums" && !album ? "Albums in a random order, each played through" : view === "artists" ? "Artists in a random order, each one's albums in order" : "Every song, in a random order"}
                onClick={() => {
                  if (view === "albums" && !album) playList(asItems(shuffled(albums).flatMap((a) => a.tracks)), 0, true);
                  else if (view === "artists") playList(asItems(shuffled(artists).flatMap(([, ts]) => albumOrder(ts))), 0, true);
                  else playList(asItems(shuffled(album ? albums.find((x) => x.key === album)?.tracks ?? [] : songs)), 0, true);
                }}
              >
                <Shuffle size={13} /> {view === "albums" && !album ? "Shuffle albums" : view === "artists" ? "Shuffle artists" : "Shuffle all"}
              </button>
            </div>
          ) : null}

          <div className="music-list">
            {view === "songs" ? (
              songs.length ? (
                <table className="songs">
                  <tbody>
                    {songs.slice(0, shown).map((t, i) => (
                      <tr
                        key={t.id}
                        className={cur?.kind === "track" && cur.id === t.id ? "on" : ""}
                        onDoubleClick={() => playList(asItems(songs), i)}
                        onContextMenu={(e) => openMenu(e, trackMenu(songs, i))}
                      >
                        <td className="play-cell">
                          <button className="icon-btn" aria-label={`Play ${t.title}`} onClick={() => playList(asItems(songs), i)}>
                            {cur?.kind === "track" && cur.id === t.id && m.playing ? <Volume2 size={13} /> : <Play size={13} />}
                          </button>
                        </td>
                        <td className="t-title">{t.title}</td>
                        <td className="muted">{t.artist}</td>
                        {!narrow ? <td className="faint">{t.album}</td> : null}
                        <td className="faint num-cell">{time(t.duration)}</td>
                      </tr>
                    ))}
                    {shown < songs.length ? (
                      <tr ref={more}>
                        <td colSpan={5} className="faint small">
                          Loading more… ({shown} of {songs.length})
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              ) : (
                <Empty onFolders={() => setView("folders")} onFiles={() => files.current?.click()} loaded={m.loaded} searching={Boolean(q)} />
              )
            ) : null}

            {view === "albums" ? (
              album ? (
                (() => {
                  const a = albums.find((x) => x.key === album);
                  if (!a) return null;
                  return (
                    <div className="album-view">
                      <div className="album-head">
                        {a.cover ? <img src={`/api/music/cover?id=${a.cover.id}`} alt="" /> : <div className="no-cover"><Disc3 size={40} /></div>}
                        <div>
                          <h3 style={{ margin: 0 }}>{a.name}</h3>
                          <div className="muted">{a.artist}</div>
                          <button className="btn primary small" style={{ marginTop: 8 }} onClick={() => playList(asItems(a.tracks))}>
                            <Play size={13} /> Play
                          </button>
                        </div>
                      </div>
                      {a.tracks.map((t, i) => (
                        <div key={t.id} className={`album-track${cur?.kind === "track" && cur.id === t.id ? " on" : ""}`} onDoubleClick={() => playList(asItems(a.tracks), i)} onContextMenu={(e) => openMenu(e, trackMenu(a.tracks, i))}>
                          <span className="faint">{t.track || i + 1}</span> {t.title} <span className="grow" /> <span className="faint">{time(t.duration)}</span>
                        </div>
                      ))}
                    </div>
                  );
                })()
              ) : (
                <div className="albums">
                  {albums.map((a) => (
                    <button key={a.key} className="album" onClick={() => setAlbum(a.key)} onDoubleClick={() => playList(asItems(a.tracks))}>
                      {a.cover ? <img src={`/api/music/cover?id=${a.cover.id}`} alt="" loading="lazy" /> : <div className="no-cover"><Disc3 size={34} /></div>}
                      <b>{a.name}</b>
                      <span className="faint small">{a.artist}</span>
                    </button>
                  ))}
                </div>
              )
            ) : null}

            {view === "artists"
              ? artists.map(([name, ts]) => (
                  <div key={name} className="artist-row" onDoubleClick={() => playList(asItems(albumOrder(ts)), 0, true)}>
                    <Mic2 size={14} className="faint" /> <b>{name}</b> <span className="faint small">{ts.length} songs</span>
                    <span className="grow" />
                    <button className="btn small" onClick={() => playList(asItems(albumOrder(ts)), 0, true)}>
                      <Play size={12} /> Play
                    </button>
                  </div>
                ))
              : null}

            {view === "world" ? <WorldRadio /> : null}
            {view === "make" ? <SongMaker /> : null}
            {view === "radio" ? <Stations list={prefs.stations} saved /> : null}
            {view === "find" ? <FindStations /> : null}
            {view === "folders" ? <Folders onFiles={() => files.current?.click()} onShared={() => setView("shared")} /> : null}
            {view === "shared" ? <SharedLibraries /> : null}
            {view === "playlist" ? <PlaylistView id={listId} trackMenu={trackMenu} onGone={() => setView("songs")} /> : null}
          </div>
        </section>
      </div>

      <SongInfoHost />
      <footer className="now-playing">
        <div className="np-art">{cur && coverOf(cur) ? <img src={coverOf(cur)} alt="" /> : <Disc3 size={28} className="faint" />}</div>
        <div className="np-meta">
          <b>{cur ? (cur.kind === "track" ? cur.title : cur.name) : "Nothing playing"}</b>
          <span className="muted small">{cur ? (cur.kind === "track" ? [cur.artist, cur.album].filter(Boolean).join(" · ") : `Radio${cur.country ? ` · ${cur.country}` : ""}`) : "Pick a song, an album or a station"}</span>
        </div>
        <div className="np-controls">
          <button className={`icon-btn${prefs.shuffle ? " on" : ""}`} aria-pressed={prefs.shuffle} aria-label="Shuffle" data-tip-up="" data-tip="Shuffle" onClick={() => setPrefs({ shuffle: !prefs.shuffle })}>
            <Shuffle size={15} />
          </button>
          <button className="icon-btn" aria-label="Previous" onClick={previous}>
            <SkipBack size={16} />
          </button>
          <button className="icon-btn np-play" aria-label={m.playing ? "Pause" : "Play"} onClick={toggle}>
            {m.playing ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <button className="icon-btn" aria-label="Next" onClick={() => void next()} onContextMenu={(e) => (e.preventDefault(), openMenuAt(e.currentTarget, skipMenu()))}>
            <SkipForward size={16} />
          </button>
          <button
            className="icon-btn"
            aria-label="Skip the album or the artist"
            data-tip-up=""
            data-tip="Skip this album or artist"
            disabled={cur?.kind !== "track"}
            onClick={(e) => openMenuAt(e.currentTarget, skipMenu())}
          >
            <ChevronsRight size={16} />
          </button>
          <button
            className={`icon-btn${prefs.repeat !== "off" ? " on" : ""}`}
            aria-label={`Repeat: ${prefs.repeat}`}
            data-tip-up=""
            data-tip={prefs.repeat === "one" ? "Repeat this song" : prefs.repeat === "all" ? "Repeat the list" : "No repeat"}
            onClick={() => setPrefs({ repeat: prefs.repeat === "off" ? "all" : prefs.repeat === "all" ? "one" : "off" })}
          >
            {prefs.repeat === "one" ? <Repeat1 size={15} /> : <Repeat size={15} />}
          </button>
        </div>
        <div className="np-seek">
          <span className="faint small">{time(m.position)}</span>
          <input type="range" min={0} max={m.duration || 0} step={1} value={Math.min(m.position, m.duration || 0)} disabled={!m.duration} onChange={(e) => seek(Number(e.target.value))} aria-label="Position" />
          <span className="faint small">{cur?.kind === "radio" ? "live" : time(m.duration)}</span>
        </div>
        <div className="np-side">
          <Num min={0} max={1} step={0.05} value={prefs.volume} onChange={(volume) => setPrefs({ volume })} aria-label="Music volume" percent />
          <select className="select" value={prefs.viz} onChange={(e) => setPrefs({ viz: e.target.value as typeof prefs.viz })} aria-label="Visualizer">
            <option value="bars">Bars</option>
            <option value="scope">Scope</option>
            <option value="milkdrop">Milkdrop</option>
            <option value="off">No visualizer</option>
          </select>
          <button
            className="icon-btn"
            aria-label="Visualizer options"
            onClick={vizMenu}
          >
            <Maximize2 size={15} />
          </button>
        </div>
      </footer>
      <input
        ref={files}
        type="file"
        multiple
        hidden
        accept="audio/*,.flac,.opus,.m4a"
        onChange={(e) => {
          const list = [...(e.target.files ?? [])];
          e.target.value = "";
          if (list.length) void addFiles(list).then((r) => desk().say(`${r.tracks} songs in your library.`));
        }}
      />
      <input
        ref={presetFiles}
        type="file"
        multiple
        hidden
        accept=".json"
        onChange={(e) => {
          const list = [...(e.target.files ?? [])];
          e.target.value = "";
          void importPresets(list).then((n) => desk().say(n ? `Imported ${n} preset${n === 1 ? "" : "s"}; they're marked ★.` : "No Butterchurn (.json) presets in those files. Classic .milk files need converting first."));
        }}
      />
    </div>
  );
}

async function choosePreset() {
  const all = Object.keys(await milkdropPresets()).sort((a, b) => Number(!a.startsWith("★")) - Number(!b.startsWith("★")) || a.localeCompare(b));
  const name = await askText("Choose a preset", "", { body: `Type part of a preset's name (${all.length} presets).` });
  if (!name) return;
  const hit = all.find((x) => x.toLowerCase().includes(name.toLowerCase()));
  if (!hit) return desk().say("No preset has that in its name.");
  desk().set({ music: { ...desk().music, preset: hit, viz: "milkdrop", cycle: false } });
}

function Empty({ onFolders, onFiles, loaded, searching }: { onFolders: () => void; onFiles: () => void; loaded: boolean; searching: boolean }) {
  if (!loaded) return <div className="empty">Reading your music…</div>;
  if (searching) return <div className="empty">Nothing matches.</div>;
  return (
    <div className="empty">
      <p>No music yet.</p>
      <div className="row" style={{ justifyContent: "center", gap: 8 }}>
        <button className="btn primary" onClick={onFolders}>
          <FolderPlus size={14} /> Add a music folder
        </button>
        <button className="btn" onClick={onFiles}>
          <Upload size={14} /> Add files
        </button>
      </div>
      <p className="small faint">Or drop audio files here. Internet radio is under Find stations.</p>
    </div>
  );
}

function Stations({ list, saved }: { list: Station[]; saved?: boolean }) {
  const cur = current();
  if (!list.length) return <div className="empty">{saved ? "No saved stations yet: find some under Find stations." : "No stations found."}</div>;
  const items: Item[] = list.map((s) => ({ kind: "radio", ...s }));
  return (
    <div className="stations">
      {list.map((st, i) => (
        <div
          key={st.url}
          className={`station${cur?.kind === "radio" && cur.url === st.url ? " on" : ""}`}
          onDoubleClick={() => playList(items, i)}
          onContextMenu={(e) =>
            openMenu(e, [
              { label: "Play", run: () => playList(items, i) },
              saved ? { label: "Forget this station", danger: true, run: () => forgetStation(st.url) } : { label: "Save", run: () => saveStation(st) },
              ...(st.homepage ? [{ label: "Open its website", run: () => window.open(st.homepage, "_blank", "noopener") }] : []),
            ])
          }
        >
          {st.favicon ? <img src={st.favicon} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => (e.currentTarget.style.visibility = "hidden")} /> : <Radio size={18} className="faint" />}
          <div className="st-meta">
            <b>{st.name}</b>
            <span className="faint small">{[st.country, st.tags?.split(",").slice(0, 4).join(", "), st.codec && `${st.codec}${st.bitrate ? ` ${st.bitrate}k` : ""}`].filter(Boolean).join(" · ")}</span>
          </div>
          <button className="btn small" onClick={() => playList(items, i)}>
            <Play size={12} /> Play
          </button>
          {saved ? (
            <button className="icon-btn" aria-label={`Forget ${st.name}`} onClick={() => forgetStation(st.url)}>
              <Trash2 size={13} />
            </button>
          ) : (
            <button className="icon-btn" aria-label={`Save ${st.name}`} data-tip="Save" onClick={() => (saveStation(st), desk().say(`Saved ${st.name}.`))}>
              <Star size={13} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function FindStations() {
  const [q, setQ] = useState("");
  const [by, setBy] = useState<"name" | "tag" | "country">("tag");
  const [found, setFound] = useState<Station[] | null>(null);
  const [note, setNote] = useState("");
  const go = async () => {
    if (!q.trim()) return;
    setNote("Looking…");
    try {
      setFound(await findStations(q.trim(), by));
      setNote("");
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <>
      <form className="toolbar" onSubmit={(e) => (e.preventDefault(), void go())}>
        <select className="select" style={{ width: "auto" }} value={by} onChange={(e) => setBy(e.target.value as typeof by)} aria-label="Search by">
          <option value="tag">Style (jazz, lofi, ambient…)</option>
          <option value="name">Station name</option>
          <option value="country">Country</option>
        </select>
        <input className="input grow" value={q} placeholder={by === "tag" ? "lofi" : by === "country" ? "Japan" : "BBC Radio 6"} onChange={(e) => setQ(e.target.value)} aria-label="Find stations" />
        <button className="btn" type="submit">
          Search
        </button>
      </form>
      <p className="small faint" style={{ margin: "0 10px 6px" }}>
        From radio-browser.info, a free, open directory. Stations play through the desktop, so the visualizer works with them.
      </p>
      {note ? <div className="note small" style={{ margin: 8 }}>{note}</div> : null}
      {found ? <Stations list={found} /> : null}
    </>
  );
}

function Folders({ onFiles, onShared }: { onFiles: () => void; onShared: () => void }) {
  const server = useServerName();
  const own = useMusic((s) => s.own);
  // the server's list, shared by every device (this device's own copy is kept in step with it)
  const serverFolders = useMusic((s) => s.folders);
  const scanning = useMusic((s) => s.scanning);
  const [path, setPath] = useState("");
  const [browse, setBrowse] = useState(false);
  const addFolder = (f: string) => {
    const folders = [...new Set([...serverFolders, f])];
    desk().set({ music: { ...desk().music, folders } });
    void rescan(folders);
  };
  const rescan = async (folders?: string[]) => {
    const r = await scan(folders);
    desk().say(
      `${r.tracks} songs in your library, from ${r.walked ?? "?"} folders${r.failed ? ` (${r.failed} files couldn't be read)` : ""}.${r.unreadable?.length ? ` Couldn't open: ${r.unreadable.join(", ")}` : ""}`,
    );
  };
  return (
    <div style={{ padding: 10 }}>
      <h3 style={{ marginTop: 0 }}>Where your music is</h3>
      <p className="small muted">
        On <b>{server || "the server"}</b>, the computer running SEASIDE: folders there are read where they are (nothing is copied), folders inside them too, and every
        device sees this library. Music on this device, or on your other devices, is under{" "}
        <button className="linkish" onClick={onShared}>
          Other devices
        </button>
        .
      </p>
      {[own, ...serverFolders].filter(Boolean).map((f) => (
        <div key={f} className="kv" style={{ gridTemplateColumns: "1fr auto" }}>
          <span className="mono small">
            {f}
            {f === own ? <span className="faint"> (files you add here)</span> : null}
          </span>
          {f !== own ? (
            <button
              className="icon-btn"
              aria-label={`Remove ${f}`}
              onClick={() => {
                const folders = serverFolders.filter((x) => x !== f);
                desk().set({ music: { ...desk().music, folders } });
                void rescan(folders);
              }}
            >
              <Trash2 size={13} />
            </button>
          ) : (
            <span />
          )}
        </div>
      ))}
      <form
        className="row"
        style={{ marginTop: 10, gap: 6 }}
        onSubmit={(e) => {
          e.preventDefault();
          const f = path.trim().replace(/^"|"$/g, "");
          if (!f) return;
          const folders = [...new Set([...serverFolders, f])];
          desk().set({ music: { ...desk().music, folders } });
          setPath("");
          void rescan(folders);
        }}
      >
        <input className="input mono grow" value={path} placeholder="D:\Music,  \\computer\share  or  /home/you/Music" onChange={(e) => setPath(e.target.value)} aria-label="Folder to add" />
        <button className="btn" type="button" onClick={() => setBrowse(true)}>
          <FolderOpen size={14} /> Browse…
        </button>
        <button className="btn primary" type="submit" disabled={Boolean(scanning)}>
          <FolderPlus size={14} /> Add folder
        </button>
      </form>
      {browse ? <FolderPicker onPick={(f) => (setBrowse(false), addFolder(f))} onClose={() => setBrowse(false)} /> : null}
      <div className="row" style={{ marginTop: 8, gap: 6 }}>
        <button className="btn" onClick={onFiles} title={"Songs from this device, copied to " + (server || "the server")}>
          <Upload size={14} /> Copy songs from this device…
        </button>
        <button className="btn" disabled={Boolean(scanning)} onClick={() => void rescan()}>
          Read the folders again
        </button>
      </div>
    </div>
  );
}

type Place = { path: string; name: string };

/** Picking a folder on the computer running the desktop (a page can't see real folder paths on its own). */
function FolderPicker({ onPick, onClose }: { onPick: (path: string) => void; onClose: () => void }) {
  const [at, setAt] = useState<{ path: string; parent: string | null; folders: Place[]; audio: number } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [addr, setAddr] = useState("");
  const go = (p: string) => {
    setError("");
    setBusy(true);
    fetch(`/api/folders?path=${encodeURIComponent(p)}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || `Couldn't open ${p}.`);
        setAt(j);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };
  useEffect(() => go(""), []);
  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog folder-picker" role="dialog" aria-modal="true" aria-label="Choose a music folder">
        <h2>Choose a music folder</h2>
        <div className="row" style={{ gap: 6 }}>
          <button className="icon-btn" disabled={at?.parent == null} onClick={() => at?.parent != null && go(at.parent)} aria-label="Up one folder" data-tip="Up one folder">
            <ChevronUp size={15} />
          </button>
          <span className="mono small grow ellipsis" title={at?.path}>{at?.path || "This computer"}</span>
        </div>
        <form
          className="row"
          style={{ gap: 6 }}
          onSubmit={(e) => {
            e.preventDefault();
            const v = addr.trim();
            if (v) go(v.startsWith("\\\\") || v.startsWith("//") || /^[a-z]:/i.test(v) ? v : `\\\\${v}`);
          }}
        >
          <input className="input mono grow" value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="A network place: \\computer\share" aria-label="A folder or network place to open" />
          <button className="btn small" disabled={!addr.trim()}>
            Open
          </button>
        </form>
        {error ? <div className="small danger-text">{error}</div> : null}
        <div className="folder-list">
          {at?.folders.map((f) => (
            <button key={f.path} className="item" onClick={() => go(f.path)} onDoubleClick={() => onPick(f.path)} title={f.path}>
              <Folder size={14} className="faint" /> {f.name}
            </button>
          ))}
          {busy ? <div className="empty small faint">Looking…</div> : at && !at.folders.length ? <div className="empty small faint">No folders inside.</div> : null}
        </div>
        <div className="small muted">{at?.path ? `${at.audio} audio file${at.audio === 1 ? "" : "s"} right here; folders inside are read too.` : "Pick a drive or place, then the folder your music is in."}</div>
        <div className="actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!at?.path} onClick={() => at?.path && onPick(at.path)}>
            Use this folder
          </button>
        </div>
      </div>
    </div>
  );
}

/** Music on this device and the others: each device sharing its music is one more library, played from it (the files
 *  stay there), and any of it can be copied to the server's library. */
function SharedLibraries() {
  const libs = useSharedLibraries();
  const mine = useMyShares();
  const server = useServerName() || "the server";
  const cur = useMusic((st) => st.queue[st.index]);
  const [busy, setBusy] = useState("");
  const pick = useRef<HTMLInputElement>(null);
  const run = async (what: string, f: () => Promise<unknown>) => {
    setBusy(what);
    try {
      await f();
    } catch (e) {
      desk().say(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };
  const mineIds = new Set(mine.map((x) => x.id));
  const shareFolder = () =>
    run("Reading the folder…", async () => {
      const n = await shareMusicFolder();
      if (n !== null) desk().say(`Sharing ${n} songs from this device.`);
    });
  const copy = (lib: { tracks: Track[] }) =>
    run(`Copying ${lib.tracks.length} songs…`, async () => {
      const r = await copyToServer(lib.tracks);
      desk().say(`${r.tracks} songs in ${server}'s library.`);
    });
  const copyOne = (t: Track) =>
    run(`Copying ${t.title}…`, async () => {
      await copyToServer([t]);
      desk().say(`“${t.title}” is in ${server}'s library.`);
    });
  return (
    <div style={{ padding: 10 }}>
      <h3 style={{ marginTop: 0 }}>This device</h3>
      <p className="small muted">
        Share music from <b>{thisDevice()}</b>: the files stay here, and your other devices play them from here while this page is open. Or copy them to {server} so
        they're there for good.
      </p>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        {canShareFolder() ? (
          <button className="btn primary" disabled={Boolean(busy)} onClick={() => void shareFolder()}>
            <FolderOpen size={14} /> Share a music folder
          </button>
        ) : null}
        <button className="btn" disabled={Boolean(busy)} onClick={() => pick.current?.click()}>
          <MonitorSmartphone size={14} /> Share songs from this device…
        </button>
      </div>
      {mine.length ? (
        <div style={{ marginTop: 8 }}>
          {mine.map((x) => (
            <div key={x.id} className="row small" style={{ gap: 6, alignItems: "center" }}>
              <span>Sharing “{x.name}”</span>
              <button className="btn small" onClick={() => stopSharing(x.id)}>
                Stop
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {busy ? <p className="small muted">{busy}</p> : null}
      <input
        ref={pick}
        type="file"
        multiple
        hidden
        accept="audio/*,.flac,.opus,.m4a"
        onChange={(e) => {
          const list = [...(e.target.files ?? [])].filter((x) => AUDIO.test(x.name) || x.type.startsWith("audio/"));
          e.target.value = "";
          if (list.length) void run("Sharing…", async () => desk().say(`Sharing ${await shareMusicFiles(list)} songs from this device.`));
        }}
      />

      <h3>Your other devices</h3>
      {libs.length ? null : <p className="small muted">No device is sharing music right now. On a phone or another computer, open Music → Other devices there and share from it.</p>}
      {libs.map((lib) => (
        <div key={lib.id} style={{ marginBottom: 14 }}>
          <div className="row" style={{ gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <b>{lib.device}</b>
            <span className="muted small">
              · {lib.name} · {lib.tracks.length} songs{mineIds.has(lib.id) ? " · this device" : ""}
            </span>
            <span className="grow" />
            <button className="btn small" onClick={() => playList(asItems(lib.tracks), 0)}>
              <Play size={13} /> Play all
            </button>
            <button className="btn small" onClick={() => playList(asItems(shuffled(lib.tracks)), 0, true)}>
              <Shuffle size={13} /> Shuffle
            </button>
            {mineIds.has(lib.id) ? null : (
              <button className="btn small" disabled={Boolean(busy)} onClick={() => void copy(lib)}>
                <Upload size={13} /> Copy all to {server}
              </button>
            )}
          </div>
          <div style={{ marginTop: 4 }}>
            {lib.tracks.slice(0, 400).map((t, i) => (
              <div key={t.id} className={`row small${cur?.kind === "track" && cur.id === t.id ? " on" : ""}`} style={{ gap: 6, alignItems: "center", padding: "2px 0" }}>
                <button className="icon-btn" aria-label={`Play ${t.title}`} onClick={() => playList(asItems(lib.tracks), i)}>
                  <Play size={12} />
                </button>
                <span className="grow">
                  {t.title}
                  <span className="faint">{[t.artist, t.album].filter(Boolean).length ? ` · ${[t.artist, t.album].filter(Boolean).join(" · ")}` : ""}</span>
                </span>
                {mineIds.has(lib.id) ? null : (
                  <button className="icon-btn" aria-label={`Copy ${t.title} to ${server}`} title={`Copy to ${server}`} disabled={Boolean(busy)} onClick={() => void copyOne(t)}>
                    <Upload size={12} />
                  </button>
                )}
              </div>
            ))}
            {lib.tracks.length > 400 ? <p className="small faint">…and {lib.tracks.length - 400} more (Play all and Shuffle use them all).</p> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- playlists: made here, kept with the desk (every device has the same ones), read from and saved as M3U files ----

const playlistsNow = () => desk().music.playlists ?? [];
const setPlaylists = (playlists: MusicPlaylist[]) => setPrefs({ playlists });
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
/** The song's path on the desktop (its music folder, then where it is inside). */
const pathOf = (t: Track) => (t.rel ? `${t.folder}${t.folder.includes("\\") ? "\\" : "/"}${t.rel}` : (t.file ?? t.title));

/** A song's file renamed in its folder (from another device, songs added from a device). Playlists follow it. */
async function renameSong(t: Track) {
  const current = (t.file ?? t.title).replace(/\.[^.]+$/, "");
  const name = (await askText("Rename the song's file", current, { body: "Its title in the library follows when it was only ever the file's name.", yes: "Rename" }))?.trim();
  if (!name || name === current) return;
  try {
    const r = await fetch("/api/music/rename", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: t.id, name }) });
    const j = (await r.json().catch(() => ({}))) as { id?: string; file?: string; error?: string };
    if (!r.ok || !j.id) throw new Error(j.error || `It answered ${r.status}.`);
    if (j.id !== t.id) setPlaylists(playlistsNow().map((p) => (p.items.includes(t.id) ? { ...p, items: p.items.map((x) => (x === t.id ? j.id! : x)) } : p)));
    await loadLibrary();
    desk().say(`Renamed to ${j.file}.`);
  } catch (e) {
    desk().say(e instanceof Error ? e.message : String(e));
  }
}

function changePlaylist(id: string, patch: Partial<MusicPlaylist>) {
  setPlaylists(playlistsNow().map((p) => (p.id === id ? { ...p, ...patch } : p)));
}
function makePlaylist(name: string, items: string[]): MusicPlaylist {
  const p = { id: newId(), name: name.replace(/\s+/g, " ").trim().slice(0, 80) || "Playlist", items: [...new Set(items)] };
  setPlaylists([...playlistsNow(), p]);
  return p;
}

/** "Add to playlist" lines for a song's menu: each playlist (ticked where it's in already), and a new one. */
function addToPlaylistItems(t: Track, onMade?: (p: MusicPlaylist) => void): MenuItem[] {
  return [
    { sep: true },
    { heading: "Add to playlist" },
    ...playlistsNow().map(
      (p): MenuItem => ({
        label: p.name,
        checked: p.items.includes(t.id),
        run: () => changePlaylist(p.id, { items: p.items.includes(t.id) ? p.items.filter((x) => x !== t.id) : [...p.items, t.id] }),
      }),
    ),
    {
      label: "New playlist…",
      icon: <ListPlus size={14} />,
      run: () =>
        void askText("A new playlist", "", { placeholder: "Road trip", yes: "Make it" }).then((name) => {
          if (name?.trim()) onMade?.(makePlaylist(name, [t.id]));
        }),
    },
  ];
}

/** A playlist file (M3U, M3U8 or PLS) made into a playlist: from this device, or from the desktop's own files. */
async function openPlaylistFile(src: "device" | "desk"): Promise<MusicPlaylist | null> {
  let got: { name: string; text: string } | null = null;
  if (src === "device") got = await readDeviceFile();
  else {
    const p = (await pickInExplorer({ mode: "open", title: "Which playlist file? (.m3u, .m3u8, .pls)", filters: [{ name: "Playlists", extensions: ["m3u", "m3u8", "pls"] }] }))?.[0];
    if (!p) return null;
    const r = await fetch(rawUrl(p));
    got = r.ok ? { name: baseName(p), text: await r.text() } : null;
  }
  if (!got) return null;
  const entries = parsePlaylist(got.text);
  const { found, missing } = matchEntries(entries, useMusic.getState().tracks.filter((t) => !t.src), pathOf);
  if (!found.length) {
    desk().say(`None of the ${entries.length} in ${got.name} are in your music library.`);
    return null;
  }
  const p = makePlaylist(nameFromFile(got.name), found.map((t) => t.id));
  desk().say(`${p.name}: ${found.length} song${found.length === 1 ? "" : "s"}${missing.length ? `; ${missing.length} not found in your library` : ""}.`);
  return p;
}

function savePlaylistFile(p: MusicPlaylist, to: "device" | "vault") {
  const byId = new Map(useMusic.getState().tracks.map((t) => [t.id, t]));
  const text = writeM3u(
    p.items
      .map((id) => byId.get(id))
      .filter((t): t is Track => Boolean(t))
      .map((t) => ({ path: pathOf(t), title: t.artist ? `${t.artist} - ${t.title}` : t.title, seconds: t.duration })),
  );
  const name = `${p.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim() || "Playlist"}.m3u8`;
  if (to === "device") saveTextToDevice(name, text);
  else void saveToVault(name, text).then((at) => desk().say(`Saved as ${at}.`), (e) => desk().say(e instanceof Error ? e.message : String(e)));
}

const playlistFileMenu = (onMade: (p: MusicPlaylist) => void): MenuItem[] => [
  {
    label: "New playlist…",
    icon: <ListPlus size={14} />,
    run: () => void askText("A new playlist", "", { body: "Then add songs from their menus (right-click, or hold).", placeholder: "Road trip", yes: "Make it" }).then((n) => n?.trim() && onMade(makePlaylist(n, []))),
  },
  { sep: true },
  { heading: "Open a playlist file (.m3u, .m3u8, .pls)" },
  { label: "From this device…", icon: <FileUp size={14} />, run: () => void openPlaylistFile("device").then((p) => p && onMade(p)) },
  { label: "From the desktop's files…", icon: <FolderOpen size={14} />, run: () => void openPlaylistFile("desk").then((p) => p && onMade(p)) },
];

/** One playlist: its songs in order, played, shuffled, rearranged, renamed, saved as a file, or deleted. */
function PlaylistView({ id, trackMenu, onGone }: { id: string; trackMenu: (list: Track[], i: number) => MenuItem[]; onGone: () => void }) {
  const p = useDesk((s) => (s.music.playlists ?? []).find((x) => x.id === id));
  const m = useMusic();
  const cur = current();
  if (!p) return <p className="small muted" style={{ margin: 12 }}>That playlist isn't here any more.</p>;
  const byId = new Map(m.tracks.map((t) => [t.id, t]));
  const songs = p.items.map((x) => byId.get(x)).filter((t): t is Track => Boolean(t));
  const move = (i: number, by: number) => {
    const ids = songs.map((t) => t.id);
    const [x] = ids.splice(i, 1);
    ids.splice(Math.max(0, Math.min(ids.length, i + by)), 0, x);
    changePlaylist(p.id, { items: ids });
  };
  return (
    <div className="music-playlist">
      <div className="toolbar">
        <ListMusic size={16} className="faint" />
        <b className="grow">{p.name}</b>
        <span className="faint small">
          {songs.length} song{songs.length === 1 ? "" : "s"}
          {p.items.length > songs.length ? ` · ${p.items.length - songs.length} not in the library now` : ""}
        </span>
        <button className="btn small primary" disabled={!songs.length} onClick={() => playList(asItems(songs), 0, true)}>
          <Play size={13} /> Play
        </button>
        <button className="btn small" disabled={!songs.length} onClick={() => playList(asItems(shuffled(songs)), 0, true)}>
          <Shuffle size={13} /> Shuffle
        </button>
        <button
          className="btn small ghost"
          disabled={!songs.length}
          title="As an .m3u8 file, which VLC, foobar2000, Windows Media Player and the Xbox can play"
          onClick={(e) =>
            openMenu(e, [
              { heading: "Save as a playlist file (.m3u8)" },
              { label: "To this device", icon: <FileDown size={14} />, run: () => savePlaylistFile(p, "device") },
              { label: "In Vault › Playlists", icon: <FolderInput size={14} />, run: () => savePlaylistFile(p, "vault") },
            ])
          }
        >
          <FileDown size={13} /> Save as a file
        </button>
        <button className="btn small ghost" onClick={() => void askText("Rename the playlist", p.name, { yes: "Rename" }).then((n) => n?.trim() && changePlaylist(p.id, { name: n.trim() }))}>
          <Pencil size={13} /> Rename
        </button>
        <button
          className="btn small ghost"
          onClick={() =>
            void askUser(`Delete ${p.name}?`, "Only the list goes; the songs stay in your library.", "Delete it", "Keep it").then((yes) => {
              if (!yes) return;
              setPlaylists(playlistsNow().filter((x) => x.id !== p.id));
              onGone();
            })
          }
        >
          <Trash2 size={13} /> Delete
        </button>
      </div>
      {songs.length ? (
        <table className="songs">
          <tbody>
            {songs.map((t, i) => (
              <tr
                key={t.id}
                className={cur?.kind === "track" && cur.id === t.id ? "on" : ""}
                onDoubleClick={() => playList(asItems(songs), i, true)}
                onContextMenu={(e) =>
                  openMenu(e, [
                    { label: "Earlier in the playlist", icon: <ArrowUp size={14} />, disabled: i === 0, run: () => move(i, -1) },
                    { label: "Later in the playlist", icon: <ArrowDown size={14} />, disabled: i === songs.length - 1, run: () => move(i, 1) },
                    { label: `Take off ${p.name}`, icon: <X size={14} />, run: () => changePlaylist(p.id, { items: p.items.filter((x) => x !== t.id) }) },
                    { sep: true },
                    ...trackMenu(songs, i),
                  ])
                }
              >
                <td className="play-cell">
                  <button className="icon-btn" aria-label={`Play ${t.title}`} onClick={() => playList(asItems(songs), i, true)}>
                    {cur?.kind === "track" && cur.id === t.id && m.playing ? <Volume2 size={13} /> : <Play size={13} />}
                  </button>
                </td>
                <td className="faint num-cell">{i + 1}</td>
                <td className="t-title">{t.title}</td>
                <td className="muted">{t.artist}</td>
                <td className="faint num-cell">{time(t.duration)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="small muted" style={{ margin: 12 }}>
          Nothing in it yet. Add songs from their menus: right-click one (or hold it), then Add to playlist.
        </p>
      )}
    </div>
  );
}
