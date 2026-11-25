// Scripts placed at the top of every app and game page served on the app origin.

/** Lets the desktop read what's on screen and keeps desktop shortcuts working while a game has focus. */
export function helperScript() {
  return `(${helper.toString()})();`;
}

function helper() {
  if (window.__pddHelper) return;
  window.__pddHelper = true;
  // An app's warnings and errors go to the desktop too: a game that refuses a move often says why only there
  // ("rejected place: word must connect"), and a character who sent it needs to hear it.
  ["warn", "error"].forEach((level) => {
    const original = console[level];
    console[level] = function (...args) {
      try {
        const text = args.map((a) => (typeof a === "string" ? a : (() => { try { return JSON.stringify(a); } catch (err) { return String(a); } })())).join(" ");
        window.parent.postMessage({ __pdd: "console", level, text: text.slice(0, 400) }, "*");
      } catch (err) {
        /* nothing to tell */
      }
      return original.apply(this, args);
    };
  });
  window.addEventListener("message", async (e) => {
    if (e.source !== window.parent || !e.data || e.data.__pdd !== "screen") return;
    // a game's adapter (public/game-adapters/<app>.js, in characters' seats): its view of the game comes first
    let seen = "";
    const ad = window.__pddAdapter;
    if (ad) {
      try {
        const acts = Object.entries(ad.actions || {}).map(([k, v]) => `[action] "${k}": ${v.help || ""}`);
        acts.push(`[action] "steps": several of these in a row, in one call, separated by ";" (e.g. "turn north; walk forward 3; dig")`);
        seen = `${await ad.describe()}\n\nActions here (game_seat_act with do "use", the action as target, and its details as text):\n${acts.join("\n")}\n\n`;
      } catch (err) {
        seen = `(The game's adapter couldn't read the game: ${err && err.message ? err.message : err})\n\n`;
      }
    }
    let text = "";
    try {
      text = (document.body && document.body.innerText) || "";
    } catch (err) {
      text = "";
    }
    // A board made of cells that know their place (data-row and data-col): its text alone loses where each piece
    // is, so draw it as rows first, with the column numbers on top. "." is an empty cell.
    let grid = "";
    try {
      const cells = document.querySelectorAll("[data-row][data-col]");
      if (cells.length >= 4) {
        const at = new Map();
        let rows = 0;
        let cols = 0;
        // what a cell holds: its first word ("O" from a tile "O 1", "TW" from a bonus square), shown or not
        const label = (el) => {
          const shown = String(el.innerText || "").trim().split(/\s+/)[0] || "";
          if (shown) return shown;
          const raw = String(el.textContent || "").trim();
          return (/^[^\d\s]+/.exec(raw) || [""])[0];
        };
        cells.forEach((el) => {
          rows = Math.max(rows, parseInt(el.getAttribute("data-row"), 10) + 1 || 0);
          cols = Math.max(cols, parseInt(el.getAttribute("data-col"), 10) + 1 || 0);
        });
        // a filled cell often loses its coordinates (it's drawn as a piece instead); when the board's container holds
        // exactly rows × cols children, place every child by its order instead
        const box = cells[0].parentElement;
        const kids = box ? Array.from(box.children) : [];
        const byOrder = rows > 0 && cols > 0 && rows < 100 && cols < 100 && kids.length === rows * cols;
        (byOrder ? kids : Array.from(cells)).forEach((el, i) => {
          const r = byOrder ? Math.floor(i / cols) : parseInt(el.getAttribute("data-row"), 10);
          const c = byOrder ? i % cols : parseInt(el.getAttribute("data-col"), 10);
          if (!(r >= 0 && c >= 0 && r < 100 && c < 100)) return;
          const first = label(el);
          if (!at.has(r * 100 + c) || first) at.set(r * 100 + c, first.slice(0, 2));
        });
        const pad = (s) => (s + "   ").slice(0, 3);
        const lines = [`   ${Array.from({ length: cols }, (_, c) => pad(String(c))).join("")}`];
        for (let r = 0; r < rows; r++) lines.push(pad(String(r)) + Array.from({ length: cols }, (_, c) => pad(at.get(r * 100 + c) || ".")).join(""));
        grid = `The board, row by row (rows down the side, columns along the top, both from 0; "." is empty):\n${lines.join("\n")}\n\n`;
      }
    } catch (err) {
      grid = "";
    }
    let controls = "";
    try {
      const many = repeated();
      const list = usable().slice(0, 60).map((el) => describe(el, many)).filter(Boolean);
      if (list.length) controls = `\n\nControls on this screen (a player in their own seat can use them with game_seat_act):\n${list.join("\n")}`;
    } catch (err) {
      controls = "";
    }
    window.parent.postMessage({ __pdd: "screen-reply", rid: e.data.rid, text: (seen + (grid + text).slice(0, Math.max(0, 6000 - controls.length - seen.length))).slice(0, 8000) + controls, title: document.title }, "*");
  });

  // ---- a seat's own controls: what a player can type, click or choose on their own screen ----
  // (sent only by the desktop that holds this frame, for a character's own seat: what she does here is as private as
  // what a person does on their own screen; only what the game itself sends out reaches anyone else)
  const shown = (el) => {
    try {
      return !el.disabled && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
    } catch (err) {
      return false;
    }
  };
  const FIELDS = "input:not([type=hidden]):not([type=button]):not([type=submit]):not([type=reset]):not([type=checkbox]):not([type=radio]), textarea, [contenteditable=true]";
  // (a folding section's heading, <summary>, counts too: what's inside it shows once it's clicked open)
  const usable = () => Array.from(document.querySelectorAll(`${FIELDS}, select, button, [role=button], input[type=button], input[type=submit], input[type=checkbox], input[type=radio], a[href], summary`)).filter(shown);
  const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
  const labelOf = (el) => {
    const byFor = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
    const wrap = el.closest && el.closest("label");
    const own = el.matches("button, [role=button], a, summary") ? el.innerText : el.matches("input[type=button], input[type=submit]") ? el.value : "";
    // (a label folded away has no visible text: its words still name the control)
    return clean(el.getAttribute("aria-label") || (byFor && (byFor.innerText || byFor.textContent)) || own || (wrap && (wrap.innerText || wrap.textContent)) || el.getAttribute("placeholder") || el.getAttribute("title") || el.getAttribute("name") || el.id);
  };
  // Many controls with the same label (a "Get" on every course, a "Delete" on every row) can't be told apart by it,
  // so each of those is named with what it belongs to: the nearest heading or title around it ("Get (AlphaGo)"),
  // as a person sees which card a button sits on.
  const ownerOf = (el) => {
    let node = el.parentElement;
    for (let i = 0; node && i < 8; i++, node = node.parentElement) {
      const h = Array.from(node.querySelectorAll("h1,h2,h3,h4,h5,h6,[role=heading],legend,caption,strong,b,.title,.name")).find((x) => !x.contains(el) && !el.contains(x) && clean(x.innerText));
      if (h) return clean(h.innerText).slice(0, 48);
    }
    return "";
  };
  const repeated = () => {
    const seen = new Map();
    for (const el of usable()) {
      const k = labelOf(el).toLowerCase();
      if (k) seen.set(k, (seen.get(k) || 0) + 1);
    }
    return seen;
  };
  const nameOf = (el, many) => {
    const name = labelOf(el);
    if (!name || ((many || repeated()).get(name.toLowerCase()) || 0) < 2) return name;
    const owner = ownerOf(el);
    return owner && owner.toLowerCase() !== name.toLowerCase() ? `${name} (${owner})` : name;
  };
  const describe = (el, many) => {
    const name = nameOf(el, many || repeated()).slice(0, 80);
    if (!name && !el.matches("select, " + FIELDS)) return "";
    if (el.matches("select")) return `[choice] "${name}": ${Array.from(el.options).map((o) => clean(o.text)).slice(0, 12).join(" | ")} (now: ${clean(el.options[el.selectedIndex] && el.options[el.selectedIndex].text)})`;
    if (el.matches("input[type=checkbox], input[type=radio]")) return `[${el.type}] "${name}" (${el.checked ? "on" : "off"})`;
    if (el.matches(FIELDS)) {
      const v = el.matches("[contenteditable=true]") ? el.innerText : el.value;
      return `[field] "${name}"${el.type === "password" ? "" : v ? ` (now: "${clean(v).slice(0, 40)}")` : " (empty)"}`;
    }
    if (el.matches("summary")) return `[section] "${name}" (${el.parentElement && el.parentElement.open ? "open" : "closed: click it to show what's inside"})`;
    return `[button] "${name}"`;
  };
  /** The control a player means: by id, by its exact label, then by a label that contains the words; a board cell as
   *  "row,col" (from the board drawn above it). */
  const find = (target, kind) => {
    const t = clean(target).toLowerCase();
    const cell = /^(?:cell\s*)?(\d+)\s*[, ]\s*(\d+)$/i.exec(clean(target));
    if (cell) return document.querySelector(`[data-row="${cell[1]}"][data-col="${cell[2]}"]`);
    const all = usable().filter((el) => (kind === "type" ? el.matches(FIELDS) : kind === "choose" ? el.matches("select") : true));
    // by its full name first ("Get (AlphaGo)", or "Get AlphaGo" without the brackets), so a repeated label reaches
    // the one meant
    const many = repeated();
    const flat = (s) => clean(String(s).replace(/[()]/g, " ")).toLowerCase();
    const named = all.map((el) => [el, nameOf(el, many).toLowerCase()]);
    const hit = (pred) => (named.find(([el, n]) => pred(el, n)) || [])[0];
    return (
      all.find((el) => el.id && el.id.toLowerCase() === t) ||
      hit((el, n) => n === t || flat(n) === flat(t)) ||
      all.find((el) => labelOf(el).toLowerCase() === t) ||
      hit((el, n) => flat(n).includes(flat(t))) ||
      all.find((el) => labelOf(el).toLowerCase().includes(t)) ||
      (kind === "type" && !t && all.length === 1 ? all[0] : null)
    );
  };
  window.addEventListener("message", (e) => {
    if (e.source !== window.parent || !e.data || e.data.__pdd !== "act") return;
    const a = e.data.act || {};
    const reply = (ok, said) => window.parent.postMessage({ __pdd: "act-reply", rid: e.data.rid, ok, said }, "*");
    try {
      const kind = String(a.do || "click");
      if (kind === "use") {
        const ad = window.__pddAdapter;
        // several actions in one call ("turn north; walk forward 3; dig"): a world takes many small moves, and each
        // tool call is one of a turn's few steps
        if (ad && String(a.target || "").toLowerCase() === "steps") {
          const said = [];
          const list = String(a.text || "").split(/;|\n/).map((t) => t.trim()).filter(Boolean).slice(0, 12);
          return void (async () => {
            for (const step of list) {
              const [name, ...rest] = step.split(/\s+/);
              const act = Object.entries(ad.actions || {}).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];
              if (!act) {
                said.push(`${step}: no such action`);
                break;
              }
              try {
                said.push(`${step}: ${await act.run(rest.join(" "))}`);
              } catch (err) {
                said.push(`${step}: didn't work (${err && err.message ? err.message : err})`);
                break;
              }
            }
            reply(true, said.join("\n") || 'No steps given: put them in text, separated by ";", like text "turn north; walk forward 3; look down; dig".');
          })();
        }
        const act = ad && ad.actions && (ad.actions[a.target] || Object.entries(ad.actions).find(([k]) => k.toLowerCase() === String(a.target || "").toLowerCase())?.[1]);
        if (!act) return reply(false, ad ? `No action "${a.target}" here. The actions: ${Object.keys(ad.actions || {}).join(", ")}.` : "This game has no actions for characters (no adapter); use type, click or choose.");
        return void Promise.resolve(act.run(String(a.text ?? ""))).then((said) => reply(true, String(said ?? "Done.")), (err) => reply(false, `That didn't work: ${err && err.message ? err.message : err}`));
      }
      const el = find(a.target || "", kind);
      if (!el) return reply(false, `No ${kind === "type" ? "field" : kind === "choose" ? "choice" : "control"} called "${a.target || ""}" on your screen. game_screen lists the controls.`);
      if (kind === "type") {
        el.focus();
        if (el.matches("[contenteditable=true]")) el.innerText = String(a.text ?? "");
        else {
          const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(proto, "value").set.call(el, String(a.text ?? ""));
        }
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        if (a.enter) {
          ["keydown", "keypress", "keyup"].forEach((type) => el.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true })));
          if (el.form && el.form.requestSubmit) el.form.requestSubmit();
        }
        return reply(true, `Typed into "${labelOf(el) || a.target}"${a.enter ? " and pressed Enter" : ""}.`);
      }
      if (kind === "choose") {
        const want = clean(a.text).toLowerCase();
        const opt = Array.from(el.options).find((o) => clean(o.text).toLowerCase() === want || o.value.toLowerCase() === want) || Array.from(el.options).find((o) => clean(o.text).toLowerCase().includes(want));
        if (!opt) return reply(false, `"${labelOf(el)}" has no choice "${a.text}". It offers: ${Array.from(el.options).map((o) => clean(o.text)).join(" | ")}.`);
        el.value = opt.value;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return reply(true, `Chose "${clean(opt.text)}" in "${labelOf(el)}".`);
      }
      ["pointerdown", "mousedown", "pointerup", "mouseup"].forEach((type) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window })));
      el.click();
      return reply(true, `Clicked "${nameOf(el) || a.target}".`);
    } catch (err) {
      return reply(false, `That didn't work: ${err && err.message ? err.message : err}`);
    }
  });
  // A websim game's picture maker (websim.imageGen), answered by the desktop's own picture engine: the game asks, the
  // desktop makes or edits the picture and hands it back as a data: URL. Only imageGen: websim's rooms and users
  // aren't here, and a game that finds them missing keeps to this device.
  if (!window.websim) {
    const waiting = new Map();
    let seq = 0;
    window.addEventListener("message", (e) => {
      if (e.source !== window.parent || !e.data || e.data.__pdd !== "websim-reply") return;
      const w = waiting.get(e.data.rid);
      if (!w) return;
      waiting.delete(e.data.rid);
      if (e.data.error) w.no(new Error(e.data.error));
      else w.ok(e.data.value);
    });
    window.websim = {
      __pdd: true,
      imageGen(opts) {
        return new Promise((ok, no) => {
          const rid = ++seq;
          waiting.set(rid, { ok, no });
          window.parent.postMessage({ __pdd: "websim", rid, op: "imageGen", opts: JSON.parse(JSON.stringify(opts || {})) }, "*");
          setTimeout(() => {
            if (waiting.delete(rid)) no(new Error("The picture took too long. Try again?"));
          }, 600000);
        });
      },
    };
  }
  // Sound from games follows the desktop's app volume (audio and video elements, and Web Audio).
  let volume = 1;
  const apply = (el) => {
    try {
      el.volume = Math.min(1, (el.__pddBase ?? (el.__pddBase = el.volume)) * volume);
    } catch (err) {
      /* not a media element */
    }
  };
  const all = () => document.querySelectorAll("audio, video").forEach(apply);
  const NativeAudio = window.Audio;
  if (NativeAudio) {
    window.Audio = function (src) {
      const a = new NativeAudio(src);
      a.__pddBase = 1;
      a.volume = volume;
      return a;
    };
    window.Audio.prototype = NativeAudio.prototype;
  }
  const gains = [];
  const proto = window.BaseAudioContext ? window.BaseAudioContext.prototype : window.AudioContext && window.AudioContext.prototype;
  const realDest = proto && Object.getOwnPropertyDescriptor(proto, "destination");
  if (realDest && realDest.get) {
    // Everything a game plays through Web Audio passes one gain node per context.
    Object.defineProperty(proto, "destination", {
      configurable: true,
      get() {
        if (!this.__pddGain) {
          const real = realDest.get.call(this);
          const g = this.createGain();
          g.gain.value = volume;
          g.connect(real);
          g.__pddReal = real;
          this.__pddGain = g;
          gains.push(g);
        }
        return this.__pddGain;
      },
    });
  }
  new MutationObserver(all).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("message", (e) => {
    if (e.source !== window.parent || !e.data || e.data.__pdd !== "volume") return;
    volume = Math.max(0, Math.min(1, Number(e.data.volume)));
    all();
    gains.forEach((g) => (g.gain.value = volume));
  });
  window.parent.postMessage({ __pdd: "volume-ready" }, "*");
  window.addEventListener(
    "keydown",
    (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
        window.parent.postMessage({ __pdd: "key", key: e.key, code: e.code, ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey, alt: e.altKey }, "*");
      }
    },
    true,
  );
}

/** The webxdc API, storage kept per app, plus the helper. */
export function webxdcScript({ scope, addr, name, lan, app = "" }) {
  const cfg = JSON.stringify({ scope, addr, name, lan: Boolean(lan), app }).replace(/</g, "\\u003c");
  const native = NATIVE[app] ? `(${NATIVE[app].toString()})(${cfg});` : "";
  return `(${helper.toString()})();(${webxdc.toString()})(${cfg});${native}`;
}

// Apps made with a native bridge of their own (the Android app they also ship as), given that bridge here, so what
// the app does through it works in SEASIDE too, without changing the app. Only for the apps named.
const NATIVE = {
  // The Lilith Learning Lab (Lucky's): voice, course downloads (server/appNet.mjs), copy and share. Its AI calls
  // (httpStart) aren't bridged yet, so its Teacher stays off until SEASIDE's models are bridged to it.
  "lilith-learning-lab": function lilithBridge(cfg) {
    if (window.AndroidTTS) return;
    const seat = /^ai:/.test(cfg.addr);
    const synth = window.speechSynthesis;
    const ev = (id, type, code) => {
      try {
        if (window.__ttsEvent) window.__ttsEvent(id, type, code);
      } catch (e) {}
    };
    let keep = null;
    let engineOff = false, gen = 0, playing = null; // (SEASIDE's voices: off after a failure; the line playing)
    const quiet = () => {
      if (keep) clearInterval(keep);
      keep = null;
    };
    window.AndroidTTS = {
      speak(text, rate, id) {
        const words = String(text || "").split(/\s+/).filter(Boolean).length;
        // a character's seat is out of sight and out of hearing: the words are on her screen, so the voice is silent,
        // taking about as long as reading them aloud would
        if (seat || !synth || !window.SpeechSynthesisUtterance) {
          setTimeout(() => ev(id, "start"), 0);
          setTimeout(() => ev(id, "done"), Math.min(8000, 120 + (words * 300) / (Number(rate) || 1)));
          return;
        }
        // SEASIDE's own voices first (server/omargVoices.mjs, the voice chosen for her); if they can't speak, the
        // browser's voice for the rest of this session, so a lecture never goes quiet
        if (!engineOff) {
          const my = ++gen;
          fetch("/app-voice/speak", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: String(text), rate: Number(rate) || 1 }) })
            .then((r) => (r.ok ? r.blob() : Promise.reject(new Error("HTTP " + r.status))))
            .then((b) => {
              if (my !== gen) return; // (stopped meanwhile)
              const a = new Audio(URL.createObjectURL(b));
              playing = a;
              a.onplay = () => ev(id, "start");
              a.onended = () => {
                URL.revokeObjectURL(a.src);
                if (playing === a) playing = null;
                ev(id, "done");
              };
              a.onerror = () => ev(id, "error", "audio");
              return a.play();
            })
            .catch(() => {
              if (my !== gen) return;
              engineOff = true;
              window.AndroidTTS.speak(text, rate, id);
            });
          return;
        }
        const u = new SpeechSynthesisUtterance(String(text));
        u.rate = Number(rate) || 1;
        // Lilith is a woman: a female English voice, the more natural ones first (a browser's default is often a
        // man's, Windows' "David")
        const voices = synth.getVoices();
        for (const re of [/aria/i, /jenny/i, /natural.*female|female.*natural/i, /zira/i, /hazel/i, /susan/i, /samantha/i, /female/i]) {
          const v = voices.find((x) => re.test(x.name) && /^en/i.test(x.lang));
          if (v) {
            u.voice = v;
            break;
          }
        }
        u.onstart = () => ev(id, "start");
        u.onboundary = () => ev(id, "range");
        u.onend = () => {
          quiet();
          ev(id, "done");
        };
        u.onerror = (e) => {
          quiet();
          ev(id, "error", e && e.error);
        };
        synth.speak(u);
        // (Chrome stops long speech after about 15 s unless it's nudged)
        quiet();
        keep = setInterval(() => {
          if (!synth.speaking) return quiet();
          synth.pause();
          synth.resume();
        }, 10000);
      },
      stop() {
        quiet();
        gen++;
        if (playing) {
          try {
            playing.pause();
          } catch (e) {}
          playing = null;
        }
        try {
          if (synth) synth.cancel();
        } catch (e) {}
      },
      restartEngine() {
        this.stop();
      },
      fetchUrl(url, id) {
        const done = (ok, text) => {
          try {
            if (window.__netDone) window.__netDone(id, ok, text);
          } catch (e) {}
        };
        fetch("/app-net/fetch?url=" + encodeURIComponent(String(url))).then(
          (r) => r.text().then((t) => done(r.ok, r.ok ? t : t || "HTTP " + r.status)),
          (e) => done(false, String((e && e.message) || e)),
        );
      },
      copy(t) {
        try {
          navigator.clipboard.writeText(String(t));
        } catch (e) {}
      },
      share(title, t) {
        this.copy(t);
      },
    };
  },
};

function webxdc(cfg) {
  if (window.webxdc && window.webxdc.__pdd) return;
  // Refuse to run beside the desktop itself: there, an app could read the desktop's keys.
  let sameOrigin = false;
  try {
    sameOrigin = Boolean(window.parent !== window && window.parent.document);
  } catch (e) {
    sameOrigin = false;
  }
  if (sameOrigin && !cfg.lan) {
    window.stop();
    document.documentElement.innerHTML = "<body style='font:15px sans-serif;padding:24px'>This app has to run on its own address. Open the desktop at http://localhost to use apps.</body>";
    throw new Error("webxdc app blocked: same origin as the desktop");
  }

  // ---- storage, kept separate for each app ----
  // (a character's seat keeps its own, apart from the person's on the same device: a secret word or a hand of cards
  // saved by one player's copy mustn't show up in another's; a person's own key stays as it always was)
  const prefix = "xdc:" + cfg.scope + ":" + (/^ai:/.test(cfg.addr) ? cfg.addr + ":" : "");
  function wrap(real) {
    const keys = () => {
      const out = [];
      for (let i = 0; i < real.length; i++) {
        const k = real.key(i);
        if (k && k.indexOf(prefix) === 0) out.push(k.slice(prefix.length));
      }
      return out;
    };
    const api = {
      getItem: (k) => real.getItem(prefix + k),
      setItem: (k, v) => real.setItem(prefix + k, String(v)),
      removeItem: (k) => real.removeItem(prefix + k),
      clear: () => keys().forEach((k) => real.removeItem(prefix + k)),
      key: (i) => keys()[i] ?? null,
      get length() {
        return keys().length;
      },
    };
    return new Proxy(api, {
      get: (t, p) => (p in t ? t[p] : typeof p === "string" ? t.getItem(p) : undefined),
      set: (t, p, v) => {
        t.setItem(p, v);
        return true;
      },
      deleteProperty: (t, p) => {
        t.removeItem(p);
        return true;
      },
      ownKeys: () => keys(),
      getOwnPropertyDescriptor: (t, p) => (t.getItem(p) !== null ? { value: t.getItem(p), enumerable: true, configurable: true } : undefined),
    });
  }
  try {
    const local = wrap(window.localStorage);
    const session = wrap(window.sessionStorage);
    Object.defineProperty(window, "localStorage", { value: local, configurable: true });
    Object.defineProperty(window, "sessionStorage", { value: session, configurable: true });
  } catch (e) {
    /* storage not available */
  }
  try {
    const open = indexedDB.open.bind(indexedDB);
    const del = indexedDB.deleteDatabase.bind(indexedDB);
    indexedDB.open = (n, v) => (v === undefined ? open(prefix + n) : open(prefix + n, v));
    indexedDB.deleteDatabase = (n) => del(prefix + n);
  } catch (e) {
    /* no IndexedDB */
  }

  // ---- the webxdc API, carried to the desktop by postMessage ----
  const parent = window.parent;
  let seq = 0;
  const waiting = new Map();
  let listener = null;
  let lastSerial = 0;
  let rtListener = null;
  const post = (msg) => parent.postMessage(Object.assign({ __pdd: "xdc" }, msg), "*");
  const ask = (msg) =>
    new Promise((resolve) => {
      const rid = ++seq;
      waiting.set(rid, resolve);
      post(Object.assign({ rid }, msg));
    });
  const deliver = (updates) => {
    for (const u of updates) {
      if (u.serial <= lastSerial) continue;
      lastSerial = u.serial;
      if (listener) {
        try {
          listener(u);
        } catch (e) {
          console.error(e);
        }
      }
    }
    // how far this copy has got, for the desktop's lantern (are all the copies of this game in step?)
    post({ type: "at", serial: lastSerial });
  };
  window.addEventListener("message", (e) => {
    if (e.source !== parent || !e.data || e.data.__pdd !== "xdc") return;
    const m = e.data;
    if (m.type === "updates") deliver(m.updates || []);
    if (m.type === "rt" && rtListener) rtListener(new Uint8Array(m.data));
    if (m.rid && waiting.has(m.rid)) {
      waiting.get(m.rid)(m.value);
      waiting.delete(m.rid);
    }
  });

  // a character's seat: the game's adapter, if SEASIDE has one for this app, gives her words for what she sees and
  // named actions (public/game-adapters/<app>.js); a person's own copy never loads it
  if (/^ai:/.test(cfg.addr) && cfg.app) {
    const adapter = `/game-adapters/${encodeURIComponent(cfg.app)}.js`;
    // (most apps have none: asked first, so only a real adapter that fails to load says so)
    fetch(adapter, { method: "HEAD" })
      .then((r) => (r.ok ? import(adapter) : null))
      .then((m) => {
        if (m) window.__pddAdapter = m.default;
      })
      .catch((err) => console.warn(`[seaside] the game's adapter didn't load: ${err && err.message ? err.message : err}`));
    // quick decisions for the adapter (src/lib/decide.ts): a state and questions, answered as probabilities by her
    // own models, for the judging a player does without thinking ("is that step done?")
    const asked = new Map();
    let n = 0;
    window.addEventListener("message", (e) => {
      if (e.source !== window.parent || !e.data || e.data.__pdd !== "decide-reply") return;
      const w = asked.get(e.data.rid);
      if (!w) return;
      asked.delete(e.data.rid);
      if (e.data.error) w.no(new Error(e.data.error));
      else w.ok(e.data.value);
    });
    window.__pddDecide = (state, questions) =>
      new Promise((ok, no) => {
        const rid = ++n;
        asked.set(rid, { ok, no });
        window.parent.postMessage({ __pdd: "decide", rid, state: String(state), questions: JSON.parse(JSON.stringify(questions || [])) }, "*");
        setTimeout(() => {
          if (asked.delete(rid)) no(new Error("The decision took too long."));
        }, 30000);
      });
  }
  window.webxdc = {
    __pdd: true,
    selfAddr: cfg.addr,
    selfName: cfg.name,
    sendUpdateInterval: 1000,
    sendUpdateMaxSize: 128000,
    sendUpdate(update, descr) {
      post({ type: "send", update: JSON.parse(JSON.stringify(update)), descr: descr || "" });
    },
    setUpdateListener(cb, serial) {
      listener = cb;
      lastSerial = serial || 0;
      return ask({ type: "listen", since: lastSerial }).then((updates) => {
        deliver(updates || []);
      });
    },
    getAllUpdates() {
      return ask({ type: "listen", since: 0 });
    },
    sendToChat(content) {
      const out = Object.assign({}, content);
      const file = out.file;
      if (file && file.blob) {
        return new Promise((resolve) => {
          const r = new FileReader();
          r.onload = () => {
            out.file = { name: file.name, dataUrl: r.result };
            ask({ type: "chat", content: out }).then(resolve);
          };
          r.readAsDataURL(file.blob);
        });
      }
      return ask({ type: "chat", content: out });
    },
    importFiles(filter) {
      return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.multiple = Boolean(filter && filter.multiple);
        const accept = [].concat((filter && filter.mimeTypes) || [], (filter && filter.extensions) || []);
        if (accept.length) input.accept = accept.join(",");
        input.onchange = () => resolve(Array.from(input.files || []));
        input.click();
      });
    },
    joinRealtimeChannel() {
      post({ type: "rt-join" });
      return {
        setListener(cb) {
          rtListener = cb;
        },
        send(data) {
          post({ type: "rt-send", data: Array.from(data) });
        },
        leave() {
          rtListener = null;
          post({ type: "rt-leave" });
        },
      };
    },
  };
  post({ type: "hello" });
}

/**
 * For the Classic pages: send their outside requests through the desktop's relay (no CORS problems),
 * unless Settings → Classic says to send them from the browser. The desktop page provides __pddRelay.
 */
export function classicRelayScript() {
  return `(${classicRelay.toString()})();`;
}

function classicRelay() {
  try {
    const P = window.parent;
    if (!P || P === window || !P.__pddRelay) return;
    const own = window.fetch.bind(window);
    window.fetch = function (input, init) {
      try {
        const url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url, location.href);
        const outside = (url.protocol === "http:" || url.protocol === "https:") && url.origin !== location.origin;
        if (outside && P.__pddRelay.via(url.href) !== "browser") return P.__pddRelay.fetch(url.href, input, init);
        // the browser route: if the server blocks the page (CORS), the desktop relay sends it instead, when the
        // desktop can tell that won't send it twice (older desktops without afterBlock just report the error)
        if (outside && P.__pddRelay.afterBlock)
          return own(input, init).catch((e) => {
            if (init?.signal?.aborted || (input && input.signal?.aborted)) throw e;
            return P.__pddRelay.afterBlock(url.href, input, init);
          });
      } catch {
        /* fall through to the browser */
      }
      return own(input, init);
    };
  } catch {
    /* not inside the desktop */
  }
}
