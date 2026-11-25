#!/usr/bin/env python3
"""
A song engine for PDA SEASIDE on an Apple Silicon Mac, using MLX Audio's music models
(MiniMax Music 3 and others under mlx_audio.music).

MLX Audio's own server does speech, not songs. This small server answers the way mlx-serve's music endpoint
does, so the desktop's "mlx-serve" song engine works with it unchanged:

    POST /v1/audio/music-generations   {"model", "prompt", "lyrics", "duration_seconds", "seed", "steps"}  -> WAV
    GET  /v1/models                    the music models found in the Hugging Face cache

and, so a long song can't be lost to a connection that gave up waiting (a three-minute song can take a quarter
of an hour), as a job:

    POST /v1/audio/music-generations   {..., "async": true}  -> 202 {"id"}
    GET  /v1/jobs/<id>                 {"state": "queued" | "working" | "done" | "error", "elapsed", "error",
                                        "said": the engine's own latest progress line, "percent": from it, if it gave one}
    GET  /v1/jobs/<id>/audio           the WAV, once done
    GET  /v1/songs                     the songs kept in the keep folder; GET /v1/songs/<name>.wav (or .txt), with
                                       Range, so a player can stream and seek it straight from here
    DELETE /v1/songs/<name>            delete a kept song (its .wav, .txt and .eval.json)
    GET  /v1/songs/<name>/check        a sound check: peak, clipping, loudness, dynamics, silence, how it ends
    POST /v1/songs/<name>/eval         {"verdict": "good" | "bad" | "", "why": "..."}: kept beside the song

Run it in the same Python that has mlx-audio installed:

    python mlx-music-bridge.py                       # all addresses, port 11235
    python mlx-music-bridge.py --model mlx-community/MiniMax-Music3-mxfp8 --port 11235 --key SECRET

Then in the desktop: Music -> Make a song -> engines -> mlx-serve, address http://<the Mac>:11235.
Only the standard library is used besides mlx-audio (and numpy, which comes with it). One song at a time; the
model stays loaded between songs. Every song is also kept here, in songs/ next to this script (--keep to choose
another folder, --keep "" to keep none), with its words and settings beside it, so none is lost. Listening on all addresses lets your other devices reach it (use it on your
own network or Tailscale; --key makes requests carry "Authorization: Bearer SECRET").
"""

import argparse
import io
import json
import os
import re
import sys
import threading
import time
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

MUSIC = re.compile(r"music|ace-?step|yue|song", re.I)

args = None
lock = threading.Lock()
loaded = {"name": None, "model": None}


def cached_models():
    """Music models already downloaded to the Hugging Face cache (models--owner--name folders)."""
    hub = Path(os.environ.get("HF_HUB_CACHE") or Path(os.environ.get("HF_HOME", Path.home() / ".cache" / "huggingface")) / "hub")
    names = []
    if hub.is_dir():
        for d in hub.iterdir():
            if d.name.startswith("models--"):
                name = d.name[len("models--"):].replace("--", "/")
                if MUSIC.search(name):
                    names.append(name)
    if args.model and args.model not in names:
        names.insert(0, args.model)
    return sorted(set(names), key=lambda n: (n != args.model, n.lower()))


def model_for(name):
    from mlx_audio.music import load  # imported here so --help works without mlx-audio

    name = name or args.model
    if not name:
        raise ValueError("No music model given: pass --model when starting the bridge, or put its name in the desktop's engine.")
    if loaded["name"] != name:
        loaded["model"] = None  # let the old one go before loading the next
        free_memory()
        print(f"Loading {name} ...", flush=True)
        t = time.time()
        loaded["model"] = load(name)
        loaded["name"] = name
        print(f"Loaded {name} in {time.time() - t:.0f} s", flush=True)
    return loaded["model"]


def to_wav(audio, rate):
    """A float array (channels x samples or samples x channels, or mono) as 16-bit PCM WAV bytes."""
    import numpy as np

    a = np.array(audio, dtype=np.float32)
    if a.ndim == 1:
        a = a[:, None]
    elif a.ndim == 2 and a.shape[0] in (1, 2) and a.shape[1] > a.shape[0]:
        a = a.T  # channels first -> samples first
    elif a.ndim > 2:
        a = a.reshape(-1, a.shape[-1]) if a.shape[-1] in (1, 2) else a.reshape(a.shape[-2], -1).T
    peak = float(np.max(np.abs(a))) if a.size else 0.0
    if peak > 0.999:
        # the model went past full scale: turn the whole song down instead of clipping its peaks (clipping is the
        # harsh, "redlined" sound)
        print(f"The song peaked at {peak:.2f} (over full scale); turned down to fit instead of clipping.", flush=True)
        a = a * (0.98 / peak)
    a = np.clip(a, -1.0, 1.0)
    pcm = (a * 32767.0).astype("<i2")
    out = io.BytesIO()
    with wave.open(out, "wb") as w:
        w.setnchannels(pcm.shape[1])
        w.setsampwidth(2)
        w.setframerate(int(rate))
        w.writeframes(pcm.tobytes())
    return out.getvalue()


def make_song(req):
    style = str(req.get("prompt") or req.get("caption") or "").strip()
    lyrics = str(req.get("lyrics") or "").strip()
    # MiniMax Music 3 always wants lyrics: an instrumental is written as [instrumental]
    if not lyrics or lyrics.lower() == "[instrumental]":
        lyrics = "[instrumental]"
    seconds = max(5, min(360, int(float(req.get("duration_seconds") or req.get("duration") or 60))))
    seed = req.get("seed")
    steps = int(req.get("steps") or args.steps)
    model = model_for(str(req.get("model") or ""))
    kwargs = dict(text=style, lyrics=lyrics, duration=seconds, steps=steps)
    if seed is not None and int(seed) >= 0:
        kwargs["seed"] = int(seed)
    t = time.time()
    result = next(model.generate(**kwargs))
    print(f"Made a {seconds} s song in {time.time() - t:.0f} s: {style[:60]!r}", flush=True)
    wav = to_wav(result.audio, getattr(result, "sample_rate", 44100))
    kept = keep(wav, req, style, lyrics, seconds, kwargs.get("seed"), loaded["name"])
    return wav, kept


def keep(wav, req, style, lyrics, seconds, seed, model):
    """A copy of the song (and what made it) in the keep folder, so it survives whatever happens to the desktop."""
    if not args.keep:
        return
    try:
        folder = Path(args.keep).expanduser()
        folder.mkdir(parents=True, exist_ok=True)
        title = str(req.get("title") or "").strip() or (style.split(",")[0] if style else "song")
        name = time.strftime("%Y-%m-%d %H.%M.%S ") + re.sub(r"[^\w .,'-]+", " ", title)[:60].strip()
        (folder / f"{name}.wav").write_bytes(wav)
        (folder / f"{name}.txt").write_text(f"Title: {title}\nStyle: {style}\nLength asked: {seconds} s\nSeed: {seed}\nModel: {model}\n\n{lyrics}\n", encoding="utf-8")
        print(f"Kept a copy: {folder / (name + '.wav')}", flush=True)
        return name
    except Exception as e:
        print(f"Couldn't keep a copy of the song: {e}", flush=True)
        return None


class Heard:
    """What the music model prints while it works (progress bars, stages), passed on as usual and remembered, so a
    job's status can say where it is in the engine's own words. One song at a time, so one line is enough."""

    def __init__(self, stream):
        self.stream = stream
        self.line = ""
        self.at = 0.0
        self.buf = ""

    def write(self, text):
        try:
            # (a terminal's colour and clear-line codes count as line breaks)
            self.buf = (self.buf + re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "\n", str(text)))[-2000:]
            parts = [p.strip() for p in re.split(r"[\r\n]+", self.buf) if p.strip()]
            if parts:
                self.line = parts[-1][:200]
                self.at = time.time()
        except Exception:
            pass
        return self.stream.write(text)

    def flush(self):
        return self.stream.flush()

    def __getattr__(self, name):
        return getattr(self.stream, name)


heard = Heard(sys.stderr)


def percent_of(line):
    """45% from a progress bar ("45%|####"), or 14 of 30 ("14/30"), or None."""
    m = re.search(r"(\d{1,3})%", line)
    if m:
        return min(100, int(m.group(1)))
    m = re.search(r"\b(\d+)\s*/\s*(\d+)\b", line)
    if m and int(m.group(2)) > 0 and int(m.group(1)) <= int(m.group(2)):
        return round(100 * int(m.group(1)) / int(m.group(2)))
    return None


# songs being made as jobs (the newest few are remembered, with their audio until it's fetched or replaced)
jobs = {}
jobs_lock = threading.Lock()


def run_job(job_id, req):
    with jobs_lock:
        jobs[job_id]["state"] = "queued"
    with lock:  # one song at a time
        with jobs_lock:
            jobs[job_id].update(state="working", started=time.time())
        try:
            wav, kept = make_song(req)
            with jobs_lock:
                jobs[job_id].update(state="done", wav=wav, kept=kept, finished=time.time())
        except Exception as e:
            print(f"Couldn't make the song: {e}", flush=True)
            with jobs_lock:
                jobs[job_id].update(state="error", error=f"{type(e).__name__}: {e}", finished=time.time())
    with jobs_lock:  # remember the last 12
        for old in sorted(jobs, key=lambda k: jobs[k]["created"])[:-12]:
            del jobs[old]


def free_memory():
    """Give the old model's memory back before a bigger one loads (Python's and MLX's caches)."""
    import gc

    gc.collect()
    try:
        import mlx.core as mx

        (getattr(mx, "clear_cache", None) or mx.metal.clear_cache)()
    except Exception:
        pass


def memory_gb():
    """This Mac's memory, so the desktop can say which models fit."""
    try:
        return round(os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES") / 1024**3)
    except Exception:
        return None


# models being downloaded from Hugging Face ahead of use (POST /v1/models/download), so a song doesn't wait on it
downloads = {}
MODEL_NAME = re.compile(r"[\w.-]+/[\w.-]+")


def hub_dir(name):
    hub = Path(os.environ.get("HF_HUB_CACHE") or Path(os.environ.get("HF_HOME", Path.home() / ".cache" / "huggingface")) / "hub")
    return hub / ("models--" + name.replace("/", "--"))


def fetched_bytes(name):
    blobs = hub_dir(name) / "blobs"
    try:
        return sum(f.stat().st_size for f in blobs.iterdir() if f.is_file())
    except Exception:
        return 0


def download(name):
    st = downloads[name]
    try:
        from huggingface_hub import HfApi, snapshot_download

        try:
            info = HfApi().model_info(name, files_metadata=True)
            st["total"] = sum((s.size or 0) for s in info.siblings or [])
        except Exception:
            pass
        print(f"Downloading {name} ...", flush=True)
        snapshot_download(name)
        st.update(state="done", finished=time.time())
        print(f"Downloaded {name}", flush=True)
    except Exception as e:
        st.update(state="error", error=f"{type(e).__name__}: {e}", finished=time.time())
        print(f"Couldn't download {name}: {e}", flush=True)


def download_status(name):
    st = downloads.get(name)
    if not st:
        return {"model": name, "state": "done" if name in cached_models() else "none"}
    return {"model": name, "state": st["state"], "got": fetched_bytes(name), "total": st.get("total", 0), "error": st.get("error")}


def sound_check(path):
    """What can be measured about a song without ears: how loud and how dynamic it is, whether it clips, and whether
    it ends cleanly or is cut off (an engine stops at its length, sometimes mid-phrase)."""
    import numpy as np

    with wave.open(str(path), "rb") as w:
        ch, width, rate, n = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
        raw = w.readframes(n)
    if width != 2:
        return {"error": "Only 16-bit WAV can be checked."}
    a = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    a = a.reshape(-1, ch) if ch > 1 else a[:, None]
    mono = a.mean(axis=1)
    seconds = len(mono) / rate if rate else 0
    peak = float(np.max(np.abs(a))) if a.size else 0.0
    rms = float(np.sqrt(np.mean(mono ** 2))) if mono.size else 0.0

    def db(x):
        return round(20 * float(np.log10(max(float(x), 1e-9))), 1)

    clipped = float(np.mean(np.abs(a) >= 0.999)) if a.size else 0.0
    # loudness over time in half-second blocks: how much it moves (dynamics) and where it goes quiet
    block = max(1, rate // 2)
    blocks = [float(np.sqrt(np.mean(mono[i:i + block] ** 2))) for i in range(0, len(mono) - block + 1, block)]
    loud = [b for b in blocks if b > 1e-4]
    spread = db(np.percentile(loud, 95)) - db(np.percentile(loud, 10)) if len(loud) > 4 else 0.0
    quiet_tail = 0.0
    for b in reversed(blocks):
        if b > 0.003:
            break
        quiet_tail += 0.5
    last = blocks[-1] if blocks else 0.0
    body = float(np.median(loud)) if loud else 0.0
    cut_off = bool(body and last > body * 0.5 and quiet_tail == 0)
    notes = []
    if clipped > 0.0005:
        notes.append(f"clips: {clipped * 100:.2f}% of samples at full scale (harsh, distorted peaks)")
    elif peak > 0.99:
        notes.append("peaks right at full scale (no headroom)")
    if db(rms) > -9:
        notes.append(f"very loud on average ({db(rms)} dBFS): likely squashed, little room to breathe")
    elif db(rms) < -26:
        notes.append(f"quiet on average ({db(rms)} dBFS)")
    if len(loud) > 4 and spread < 4:
        notes.append(f"flat dynamics ({spread:.1f} dB between quiet and loud parts): sounds compressed")
    if cut_off:
        notes.append("ends abruptly at full volume: probably cut off by the length (give it more time)")
    if quiet_tail > 20:
        notes.append(f"{quiet_tail:.0f} s of silence at the end: it finished early (a shorter length would do)")
    return {
        "seconds": round(seconds, 1), "peak_dbfs": db(peak), "loudness_dbfs": db(rms), "clipped_percent": round(clipped * 100, 3),
        "dynamics_db": round(spread, 1), "silent_end_seconds": quiet_tail, "cut_off": cut_off, "notes": notes,
    }


def kept_folder():
    return Path(args.keep).expanduser() if args.keep else None


class Handler(BaseHTTPRequestHandler):
    server_version = "PandoraMusicBridge/1"

    def _allowed(self):
        if not args.key:
            return True
        if self.headers.get("Authorization", "") == f"Bearer {args.key}":
            return True
        self._json(401, {"error": "This bridge needs its key (Authorization: Bearer ...)."})
        return False

    def _json(self, code, data):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if not self._allowed():
            return
        path = self.path.split("?")[0]
        if path in ("/v1/models", "/models"):
            now = int(time.time())
            return self._json(200, {"object": "list", "data": [{"id": n, "object": "model", "created": now, "owned_by": n.split("/")[0], "capabilities": ["music"]} for n in cached_models()]})
        if path in ("/", "/health"):
            return self._json(200, {"ok": True, "service": "Pandora Dee music bridge (MLX Audio)", "loaded": loaded["name"], "features": ["jobs", "songs", "download"], "memory_gb": memory_gb()})
        if path == "/v1/models/download":
            from urllib.parse import parse_qs, urlparse

            name = (parse_qs(urlparse(self.path).query).get("model") or [""])[0]
            if not MODEL_NAME.fullmatch(name):
                return self._json(400, {"error": "Which model? (?model=owner/name)"})
            return self._json(200, download_status(name))
        m = re.fullmatch(r"/v1/jobs/([\w-]+)(/audio)?", path)
        if m:
            with jobs_lock:
                job = dict(jobs.get(m.group(1)) or {})
            if not job:
                return self._json(404, {"error": "No such job (the bridge may have restarted; the song may be in /v1/songs)."})
            if m.group(2):
                if job.get("state") != "done":
                    return self._json(409, {"error": f"Not ready ({job.get('state')})."})
                return self._send(200, "audio/wav", job["wav"])
            start = job.get("started") or job["created"]
            said = heard.line if job["state"] == "working" and heard.at >= start else ""
            return self._json(200, {"id": m.group(1), "state": job["state"], "elapsed": round((job.get("finished") or time.time()) - start), "error": job.get("error"), "kept": job.get("kept"), "said": said, "percent": percent_of(said) if said else None})
        if path == "/v1/songs":
            folder = kept_folder()
            items = []
            if folder and folder.is_dir():
                for f in sorted(folder.glob("*.wav"), key=lambda x: x.stat().st_mtime, reverse=True):
                    ev = f.with_name(f.stem + ".eval.json")
                    try:
                        verdict = json.loads(ev.read_text(encoding="utf-8")) if ev.exists() else None
                    except Exception:
                        verdict = None
                    items.append({"name": f.stem, "size": f.stat().st_size, "made": int(f.stat().st_mtime), "about": (f.with_suffix(".txt").read_text(encoding="utf-8")[:2000] if f.with_suffix(".txt").exists() else ""), "eval": verdict})
            return self._json(200, {"object": "list", "data": items})
        m = re.fullmatch(r"/v1/songs/(.+)/check", path)
        if m:
            f = self._kept(m.group(1), "wav")
            if not f:
                return self._json(404, {"error": "No such song."})
            try:
                return self._json(200, sound_check(f))
            except Exception as e:
                return self._json(500, {"error": f"{type(e).__name__}: {e}"})
        m = re.fullmatch(r"/v1/songs/(.+)\.(wav|txt)", path)
        if m:
            f = self._kept(m.group(1), m.group(2))
            if not f:
                return self._json(404, {"error": "No such song."})
            if m.group(2) == "wav":
                return self._send_file(f, "audio/wav")
            return self._send(200, "text/plain; charset=utf-8", f.read_bytes())
        self._json(404, {"error": "Not found."})

    def _kept(self, quoted, ext):
        """A file in the keep folder itself (never outside it), or None."""
        from urllib.parse import unquote

        folder = kept_folder()
        if not folder:
            return None
        f = folder / f"{unquote(quoted)}.{ext}"
        if f.resolve().parent != folder.resolve() or not f.is_file():
            return None
        return f

    def _send_file(self, f, kind):
        """A file, all of it or the part a Range asks for (so a player can start at once and seek)."""
        size = f.stat().st_size
        start, end = 0, size - 1
        rng = re.fullmatch(r"bytes=(\d*)-(\d*)", self.headers.get("Range", "").strip())
        if rng and (rng.group(1) or rng.group(2)):
            if rng.group(1):
                start = int(rng.group(1))
                end = min(int(rng.group(2)), size - 1) if rng.group(2) else size - 1
            else:
                start = max(0, size - int(rng.group(2)))
            if start > end or start >= size:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.end_headers()
                return
            self.send_response(206)
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        else:
            self.send_response(200)
        self.send_header("Content-Type", kind)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        with open(f, "rb") as fh:
            fh.seek(start)
            left = end - start + 1
            while left > 0:
                chunk = fh.read(min(1 << 20, left))
                if not chunk:
                    break
                try:
                    self.wfile.write(chunk)
                except (BrokenPipeError, ConnectionResetError):
                    return  # the player moved on (a seek): fine
                left -= len(chunk)

    def do_DELETE(self):
        if not self._allowed():
            return
        m = re.fullmatch(r"/v1/songs/(.+)", self.path.split("?")[0])
        f = self._kept(m.group(1), "wav") if m else None
        if not f:
            return self._json(404, {"error": "No such song."})
        for g in (f, f.with_suffix(".txt"), f.with_name(f.stem + ".eval.json")):
            try:
                g.unlink()
            except FileNotFoundError:
                pass
        print(f"Deleted the kept song {f.stem}", flush=True)
        return self._json(200, {"ok": True})

    def _send(self, code, kind, body):
        self.send_response(code)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if not self._allowed():
            return
        path = self.path.split("?")[0]
        ev = re.fullmatch(r"/v1/songs/(.+)/eval", path)
        if path not in ("/v1/audio/music-generations", "/v1/models/download") and not ev:
            return self._json(404, {"error": "Not found."})
        try:
            n = int(self.headers.get("Content-Length") or 0)
            req = json.loads(self.rfile.read(min(n, 1_000_000)) or b"{}")
        except Exception:
            return self._json(400, {"error": "The request wasn't JSON."})
        if ev:
            # a verdict on a kept song, kept beside it: good, bad (or cleared), and why
            f = self._kept(ev.group(1), "wav")
            if not f:
                return self._json(404, {"error": "No such song."})
            verdict = str(req.get("verdict") or "")
            if verdict not in ("good", "bad", ""):
                return self._json(400, {"error": 'verdict is "good", "bad" or "".'})
            data = {"verdict": verdict, "why": str(req.get("why") or "")[:2000], "by": str(req.get("by") or "")[:80], "at": int(time.time())}
            f.with_name(f.stem + ".eval.json").write_text(json.dumps(data), encoding="utf-8")
            return self._json(200, data)
        if path == "/v1/models/download":
            # fetch a model from Hugging Face now, so the first song with it doesn't wait (it lands in the usual cache)
            name = str(req.get("model") or "")
            if not MODEL_NAME.fullmatch(name):
                return self._json(400, {"error": "A model name like mlx-community/MiniMax-Music3-6bit."})
            if downloads.get(name, {}).get("state") != "working":
                downloads[name] = {"state": "working", "started": time.time()}
                threading.Thread(target=download, args=(name,), daemon=True).start()
            return self._json(202, download_status(name))
        if req.get("async"):
            job_id = f"{int(time.time())}-{os.urandom(3).hex()}"
            with jobs_lock:
                jobs[job_id] = {"state": "queued", "created": time.time(), "title": str(req.get("title") or "")}
            threading.Thread(target=run_job, args=(job_id, req), daemon=True).start()
            return self._json(202, {"id": job_id, "state": "queued"})
        if not lock.acquire(timeout=1800):
            return self._json(503, {"error": "Still busy with another song."})
        try:
            wav, _ = make_song(req)
        except Exception as e:  # say what went wrong instead of dropping the connection
            print(f"Couldn't make the song: {e}", flush=True)
            return self._json(500, {"error": f"{type(e).__name__}: {e}"})
        finally:
            lock.release()
        self._send(200, "audio/wav", wav)

    def log_message(self, fmt, *a):
        print(f"{self.address_string()} {fmt % a}", flush=True)


def main():
    global args
    p = argparse.ArgumentParser(description="A song engine for PDA SEASIDE, using MLX Audio's music models.")
    p.add_argument("--host", default="0.0.0.0", help="address to listen on (default: all, so your other devices can reach it)")
    p.add_argument("--port", type=int, default=11235)
    p.add_argument("--model", default="", help="music model to use when a request names none, e.g. mlx-community/MiniMax-Music3-mxfp8")
    p.add_argument("--steps", type=int, default=30, help="diffusion steps (default 30)")
    p.add_argument("--key", default="", help="require Authorization: Bearer KEY on every request")
    p.add_argument("--preload", action="store_true", help="load the --model now instead of on the first song")
    p.add_argument("--keep", default=str(Path(__file__).resolve().parent / "songs"), help='folder that keeps a copy of every song (default: songs/ next to this script; "" keeps none)')
    args = p.parse_args()
    # the model's own progress output (tqdm bars and the like go to stderr) is remembered for the job's status
    sys.stderr = heard
    if args.preload and args.model:
        model_for(args.model)
    found = cached_models()
    print(f"Music bridge on http://{args.host}:{args.port}  (models: {', '.join(found) or 'none found yet; pass --model'})", flush=True)
    ThreadingHTTPServer((args.host, args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
