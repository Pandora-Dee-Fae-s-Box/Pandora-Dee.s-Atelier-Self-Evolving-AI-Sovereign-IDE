// "Make for this app" in XDC Studio: a picture (from a picture engine), music (from a song engine) or a sound effect
// (made right here, lib/sfx.ts), saved straight into the app's files, with the line of code that uses it.

import { useEffect, useRef, useState } from "react";
import { desk, useDesk } from "../lib/store.ts";
import { library } from "../lib/xdc.ts";
import { audioOf, makePictures, makeSong, writeSong } from "../lib/media.ts";
import { KINDS, KIND_NAMES, RATE, render, sfxOf, wav, type SfxKind } from "../lib/sfx.ts";
import { Seg } from "../ui/common.tsx";

type What = "picture" | "music" | "sound";
export const slugOf = (s: string, fallback: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").split("-").slice(0, 5).join("-") || fallback;

const SIZES = [
  { id: "512x512", label: "Sprite or tile (512×512)" },
  { id: "1024x1024", label: "Square (1024×1024)" },
  { id: "1024x576", label: "Wide background (1024×576)" },
  { id: "576x1024", label: "Tall background (576×1024)" },
];

/** Play samples once, through this page's speakers, at the desktop's volume for games and apps. */
export function playSamples(samples: Float32Array, rate = RATE) {
  const volume = desk().voice.appVolume ?? 0.8;
  if (volume <= 0) return;
  const ctx = new AudioContext();
  const buf = ctx.createBuffer(1, samples.length, rate);
  buf.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const gain = ctx.createGain();
  gain.gain.value = volume;
  src.connect(gain);
  gain.connect(ctx.destination);
  src.onended = () => void ctx.close();
  src.start();
}

export function StudioMake({ pkgId, onSaved, onClose }: { pkgId: string; onSaved: (path: string, use: string) => void; onClose: () => void }) {
  const media = useDesk((s) => s.media);
  const images = media.images.filter((e) => e.enabled);
  const songs = media.songs.filter((e) => e.enabled);
  const [what, setWhat] = useState<What>("sound");
  const [busy, setBusy] = useState("");
  const stop = useRef<AbortController | null>(null);
  useEffect(() => () => stop.current?.abort(), []);

  // picture
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState("512x512");
  const [picEngine, setPicEngine] = useState(images[0]?.id ?? "");
  const [icon, setIcon] = useState(false);
  // music
  const [style, setStyle] = useState("");
  const [seconds, setSeconds] = useState(30);
  const [words, setWords] = useState(false);
  const [songEngine, setSongEngine] = useState(songs[0]?.id ?? "");
  // sound
  const [kind, setKind] = useState<SfxKind>("coin");
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e9));
  const [name, setName] = useState("");

  const sound = () => render(sfxOf(kind, seed), seed);
  const fail = (e: unknown) => (e instanceof DOMException && e.name === "AbortError" ? undefined : desk().say(e instanceof Error ? e.message : String(e)));

  const save = async (path: string, body: Blob, use: string) => {
    await library.write(pkgId, path, body);
    onSaved(path, use);
  };

  const makePicture = async () => {
    const engine = images.find((e) => e.id === picEngine);
    if (!engine || !prompt.trim()) return;
    const [w, h] = size.split("x").map(Number);
    stop.current = new AbortController();
    setBusy("Making the picture…");
    try {
      const [pic] = await makePictures(engine, { prompt: prompt.trim(), width: w, height: h, count: 1 }, setBusy, stop.current.signal);
      if (!pic) throw new Error(`${engine.name} gave back no picture.`);
      const ext = /jpeg/.test(pic.type) ? "jpg" : /webp/.test(pic.type) ? "webp" : "png";
      const p = `art/${slugOf(name || prompt, "picture")}.${ext}`;
      if (icon && ext !== "webp") await library.write(pkgId, `icon.${ext}`, pic);
      await save(p, pic, `<img src="${p}" alt="">  or in a canvas game:  const img = new Image(); img.src = "${p}";`);
    } catch (e) {
      fail(e);
    } finally {
      setBusy("");
    }
  };

  const makeMusic = async () => {
    const engine = songs.find((e) => e.id === songEngine);
    if (!engine || !style.trim()) return;
    stop.current = new AbortController();
    try {
      let lyrics = "[Instrumental]";
      let title = name.trim() || style.trim();
      if (words) {
        setBusy("Writing the words…");
        const w = await writeSong(desk().focus, style.trim(), false);
        lyrics = w.lyrics;
        title = name.trim() || w.title;
      }
      setBusy("Making the music (this can take a few minutes)…");
      const made = await makeSong(engine, { title, style: style.trim(), lyrics, seconds, instrumental: !words }, setBusy, stop.current.signal);
      const p = `music/${slugOf(name || title, "music")}.${made.ext}`;
      await save(p, audioOf(made), `const music = new Audio("${p}"); music.loop = true; music.play();`);
    } catch (e) {
      fail(e);
    } finally {
      setBusy("");
    }
  };

  const keepSound = async () => {
    const p = `sfx/${slugOf(name || KIND_NAMES[kind], "sound")}.wav`;
    try {
      await save(p, new Blob([wav(sound()) as Uint8Array<ArrayBuffer>], { type: "audio/wav" }), `new Audio("${p}").play();`);
    } catch (e) {
      fail(e);
    }
  };

  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="dialog studio-make" role="dialog" aria-modal="true" aria-label="Make for this app">
        <h2>Make for this app</h2>
        <Seg<What> value={what} onChange={setWhat} options={[{ id: "sound", label: "Sound effect" }, { id: "picture", label: "Picture" }, { id: "music", label: "Music" }]} />

        {what === "sound" ? (
          <div className="col" style={{ gap: 8, marginTop: 10 }}>
            <div className="row wrap" style={{ gap: 6 }}>
              {KINDS.map((k) => (
                <button key={k} className={`btn small${k === kind ? " primary" : ""}`} onClick={() => {
                    const s = Math.floor(Math.random() * 1e9);
                    setKind(k);
                    setSeed(s);
                    playSamples(render(sfxOf(k, s), s));
                  }}>
                  {KIND_NAMES[k]}
                </button>
              ))}
            </div>
            <div className="row" style={{ gap: 6 }}>
              <button className="btn small" onClick={() => playSamples(sound())}>
                Play
              </button>
              <button
                className="btn small"
                onClick={() => {
                  const s = Math.floor(Math.random() * 1e9);
                  setSeed(s);
                  playSamples(render(sfxOf(kind, s), s));
                }}
              >
                Another one
              </button>
            </div>
            <p className="small faint">Each press of Another one is a different {KIND_NAMES[kind].toLowerCase()}. Made right here: nothing to set up.</p>
          </div>
        ) : null}

        {what === "picture" ? (
          images.length ? (
            <div className="col" style={{ gap: 8, marginTop: 10 }}>
              <textarea className="input" rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="A cheerful pixel-art cat, side view, plain background" />
              <select className="input" value={size} onChange={(e) => setSize(e.target.value)} aria-label="Size">
                {SIZES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
              {images.length > 1 ? (
                <select className="input" value={picEngine} onChange={(e) => setPicEngine(e.target.value)} aria-label="Picture engine">
                  {images.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              ) : null}
              <label className="row small" style={{ gap: 6 }}>
                <input type="checkbox" checked={icon} onChange={(e) => setIcon(e.target.checked)} /> Make it the app's icon too
              </label>
            </div>
          ) : (
            <p className="muted" style={{ marginTop: 10 }}>No picture engine is set up yet. Add one in Create (ComfyUI, Draw Things, Automatic1111 or an OpenAI-style service), then come back.</p>
          )
        ) : null}

        {what === "music" ? (
          songs.length ? (
            <div className="col" style={{ gap: 8, marginTop: 10 }}>
              <textarea className="input" rows={2} value={style} onChange={(e) => setStyle(e.target.value)} placeholder="Upbeat chiptune loop, bouncy bass, 140 bpm" />
              <div className="row" style={{ gap: 8 }}>
                <select className="input" value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} aria-label="Length">
                  {[15, 30, 60, 120].map((n) => (
                    <option key={n} value={n}>
                      {n < 60 ? `${n} seconds` : `${n / 60} minute${n > 60 ? "s" : ""}`}
                    </option>
                  ))}
                </select>
                {songs.length > 1 ? (
                  <select className="input" value={songEngine} onChange={(e) => setSongEngine(e.target.value)} aria-label="Song engine">
                    {songs.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
              <label className="row small" style={{ gap: 6 }}>
                <input type="checkbox" checked={words} onChange={(e) => setWords(e.target.checked)} /> With words (the character you're with writes them)
              </label>
            </div>
          ) : (
            <p className="muted" style={{ marginTop: 10 }}>No song engine is set up yet. Add one in the Song Maker (mlx-serve, ACE-Step or ComfyUI with YuE2), then come back.</p>
          )
        ) : null}

        <label className="col small" style={{ gap: 4, marginTop: 10 }}>
          <span className="faint">File name (optional)</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={what === "sound" ? KIND_NAMES[kind].toLowerCase() : what === "picture" ? "cat" : "theme"} />
        </label>
        {busy ? <p className="small">{busy}</p> : null}
        <div className="actions">
          <button className="btn" onClick={() => (busy ? stop.current?.abort() : onClose())}>
            {busy ? "Stop" : "Close"}
          </button>
          <button
            className="btn primary"
            disabled={Boolean(busy) || (what === "picture" ? !images.length || !prompt.trim() : what === "music" ? !songs.length || !style.trim() : false)}
            onClick={() => void (what === "sound" ? keepSound() : what === "picture" ? makePicture() : makeMusic())}
          >
            {what === "sound" ? "Put it in the app" : "Make it"}
          </button>
        </div>
      </div>
    </div>
  );
}
