// Vexel, for a character's seat: words for what she'd see, and actions she can take, through the game's own test
// hooks (window.G) and its own modules. Loaded only in characters' seats (server/inject.mjs); Vexel itself is
// unchanged. A seat runs out of sight, where the browser slows its frames, so actions run the game's frames
// themselves (G.tick) while a key is held, the way a person's held key would.

const G = () => window.G;

// A seat is read in words, not watched, so its own copy of Vexel draws at low quality and a short distance:
// three full copies (two seats and the person's) once ran a page out of memory overnight. The seat keeps its own
// settings (its storage is its own), so the person's window is untouched; it takes effect when the seat next loads.
try {
  const k = "vexel.settings";
  const s = JSON.parse(localStorage.getItem(k) || "{}");
  if (!s.seatLight) {
    Object.assign(s, { quality: "low", rd: 3, userQuality: true, grade: false, seatLight: 1 });
    localStorage.setItem(k, JSON.stringify(s));
  }
} catch (e) {
  /* storage unavailable: the game's own defaults */
}
let names = null; // block and item names, from Vexel's own modules
async function lookup() {
  if (names) return names;
  const base = location.href.replace(/[^/]*$/, "");
  const [b, i] = await Promise.all([import(base + "js/blocks.js"), import(base + "js/items.js").catch(() => ({}))]);
  names = { block: (id) => (b.BLOCKS[id] ? b.BLOCKS[id].label : `block ${id}`), item: (id) => (i.ITEMS && i.ITEMS[id] ? i.ITEMS[id].label : b.BLOCKS[id] ? b.BLOCKS[id].label : `item ${id}`) };
  return names;
}
const ready = () => {
  const g = G();
  if (!g) throw new Error("Vexel is still loading.");
  return g;
};

// the way she faces: her yaw as a unit step on the ground, and its compass name
const ahead = (yaw) => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) });
const compass = (dx, dz) => {
  const a = (Math.atan2(dx, -dz) * 180) / Math.PI; // 0 = north (-z), 90 = east (+x)
  return ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"][Math.round(((a + 360) % 360) / 45) % 8];
};
/** Where something is from her: "4 blocks ahead and a little left", with the compass. */
function whereFrom(p, x, z) {
  const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
  if (d < 1) return "right beside you";
  const f = ahead(p.yaw), fwd = dx * f.x + dz * f.z, side = dx * -f.z + dz * f.x; // (side > 0: to her right)
  const rel = Math.abs(fwd) >= Math.abs(side) * 1.7 ? (fwd > 0 ? "ahead" : "behind you") : Math.abs(side) >= Math.abs(fwd) * 1.7 ? (side > 0 ? "to your right" : "to your left") : `${fwd > 0 ? "ahead" : "behind"} and to your ${side > 0 ? "right" : "left"}`;
  return `${Math.round(d)} blocks ${rel} (${compass(dx, dz)})`;
}
const timeWord = (f) => (f < 0.22 || f > 0.8 ? "night" : f < 0.3 ? "dawn" : f < 0.45 ? "morning" : f < 0.55 ? "midday" : f < 0.72 ? "afternoon" : "dusk");

/** Hold keys for a while, running the game's own frames, then let go. */
function hold(codes, ms) {
  const g = ready();
  const keys = g.input.keys;
  codes.forEach((c) => keys.add(c));
  try {
    g.tick(Math.max(1, Math.round(ms / 16.7)));
  } finally {
    codes.forEach((c) => keys.delete(c));
    g.tick(2);
  }
}
const at = (p) => `${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)}`;

// Vexel's own body for an AI player (its js/body/: written by Vexel's author for exactly this). Its eyes: the scene
// in words and a map of the land about. Its options: what's possible right now, as sentences, the way a game shows a
// person what they can craft or who's near. The character chooses; the body's hands only do what she chose. It stays
// off between choices, so her own walk/turn/dig keys are hers, and it never chooses anything itself.
let menu = [];
async function theBody() {
  if (window.BODY) return window.BODY;
  const base = location.href.replace(/[^/]*$/, "");
  await import(base + "js/body/body.js");
  if (window.BODY) window.BODY.off();
  return window.BODY || null;
}
// the body speaks of its player as "Claude"; here the player is whoever sits in this seat
const yours = (s) =>
  String(s || "")
    .replace(/\bClaude has\b/g, "you have").replace(/\bClaude is\b/g, "you are").replace(/\bClaude carries\b/g, "you carry")
    .replace(/\bClaude's\b/g, "your").replace(/\bClaude\b/g, "you");
/** Ask the body what's possible now (it's switched on only for the asking). */
function optionsNow(b) {
  b.on();
  try {
    return b.tick();
  } finally {
    b.off();
  }
}

// Whether the step she's on is done: what Vexel's body had a small judging model do, done with SEASIDE's own quick
// decisions (her own models, src/lib/decide.ts), against the body's facts only (what she has and sees). At most every
// few seconds, and only for a step that says what's true when it's done; "goal done" is always hers to say too.
let judged = { key: "", at: 0 };
const unreachable = new Set(); // (chop: logs it couldn't reach or swing at, "x,y,z")
// her words as the body's facts put them ("I carry 12 logs" → "Claude carries 12 logs")
const asClaude = (s) =>
  String(s || "")
    .replace(/\b(?:I am|I'm)\b/gi, "Claude is").replace(/\bI have\b/gi, "Claude has").replace(/\bI carry\b/gi, "Claude carries")
    .replace(/\b(?:my|mine)\b/gi, "Claude's").replace(/\bme\b/gi, "Claude").replace(/\bI\b/g, "Claude");
async function judgeStep(b, t) {
  if (!t.check || !t.step || typeof window.__pddDecide !== "function") return "";
  const key = `${t.stepNo}|${t.state}`;
  if (key === judged.key || performance.now() - judged.at < 4000) return "";
  judged = { key, at: performance.now() };
  try {
    // the body's facts call the player "Claude"; her step is in her words, so it's put the same way, and what's under
    // her feet is added (the body's facts don't always say)
    const g = ready(), n = await lookup(), p = g.player;
    const under = n.block(g.world.get(Math.floor(p.x), Math.floor(p.y) - 1, Math.floor(p.z)));
    const facts = `${t.state}\nClaude is standing on ${under} at (${at(p)}).`;
    const [a] = await window.__pddDecide(facts, [{ kind: "yesno", ask: `Is this true of Claude now: ${asClaude(t.check)}?` }]);
    const yes = a && a.probs ? a.probs[0] : 0;
    judged.said = `${a.scored ? `${Math.round(yes * 100)}% sure it's done` : a.pick === 0 ? "done" : "not yet"} (${a.model})`;
    if (!(a.scored ? yes >= 0.8 : a.pick === 0)) return "";
    const next = b.stepDone();
    const sure = a.scored ? ` (${Math.round(yes * 100)}% sure)` : "";
    return next ? `Step done${sure}: ${yours(t.step)}. Next: ${yours(next)}.` : `Step done${sure}: ${yours(t.step)}. That was the last: your goal is done.`;
  } catch (e) {
    judged.said = `couldn't judge: ${e && e.message ? e.message : e}`;
    return "";
  }
}

// Her look, through Vexel's own Character screen, pressed as a person presses it: each part by its name in the game
// (from its own avatars.js), the colour swatches by plain colour names, the clothes' colour sliders by hue names.
const SWATCH = {
  skin: ["lightest", "light", "fair", "tan", "medium brown", "brown", "dark brown", "darkest"],
  eyeCol: ["blue", "brown", "green", "grey", "hazel", "dark", "amber", "violet"],
  hairCol: ["black", "dark brown", "brown", "light brown", "auburn", "ginger", "golden", "blonde", "platinum", "grey", "white", "pink", "lavender", "teal", "blue", "green"],
  shoes: ["black", "brown", "tan", "white", "navy", "red", "olive", "grey"],
};
const HUES = { red: 0, orange: 5, gold: 8, yellow: 10, lime: 16, green: 21, teal: 28, cyan: 32, sky: 36, blue: 41, indigo: 45, purple: 49, violet: 50, magenta: 53, pink: 58, rose: 61 };
// what she says → the game's own field
const PARTS = [
  [/^skin/, "skin"], [/^eye ?(?:colou?r)/, "eyeCol"], [/^eyes?/, "eyes"], [/^mouth/, "mouth"], [/^cheeks?/, "cheeks"],
  [/^(?:facial hair|beard)/, "beard"], [/^hair ?(?:colou?r)/, "hairCol"], [/^hair(?: ?style)?/, "hair"], [/^ears?/, "ears"],
  [/^arms?/, "slim"], [/^height/, "height"], [/^top ?(?:colou?r)/, "topHue"], [/^top ?shade/, "topShade"], [/^top/, "top"],
  [/^(?:bottoms?|legs?|trousers) ?(?:colou?r)/, "legHue"], [/^(?:bottoms?|legs?|trousers) ?shade/, "legShade"], [/^(?:bottoms?|legs?)/, "legs"],
  [/^shoes?/, "shoes"], [/^(?:extra|accessory|hat)/, "extra"],
];
let looks = null;
async function lookNames() {
  if (looks) return looks;
  const a = await import(location.href.replace(/[^/]*$/, "") + "js/avatars.js");
  looks = { eyes: a.EYE_STYLES, mouth: a.MOUTHS, cheeks: a.CHEEKS, beard: a.BEARDS, hair: a.HAIR_STYLES, ears: a.EARS, height: a.HEIGHTS, top: a.TOPS, topShade: a.SHADES, legs: a.LEGS, legShade: a.SHADES, extra: a.EXTRAS, slim: ["classic", "slim"] };
  return looks;
}
const hueName = (v) => Object.entries(HUES).reduce((best, [n, h]) => (Math.abs(h - v) < Math.abs(HUES[best] - v) ? n : best), "red");
/** Her look as the open Character screen shows it, in words. */
function lookNow(box, names) {
  const val = (k) => {
    const cyc = box.querySelector(`.cyc[data-k="${k}"] b`);
    if (cyc) return cyc.textContent;
    const on = box.querySelector(`button.on[data-k="${k}"]`);
    if (on) return SWATCH[k] ? SWATCH[k][+on.dataset.v] : names[k] ? names[k][+on.dataset.v] : on.dataset.v;
    const r = box.querySelector(`.hue[data-k="${k}"]`);
    return r ? hueName(+r.value) : "?";
  };
  return `skin ${val("skin")}; eyes ${val("eyes")}, eye colour ${val("eyeCol")}; mouth ${val("mouth")}; cheeks ${val("cheeks")}; facial hair ${val("beard")}; hair ${val("hair")}, hair colour ${val("hairCol")}; ears ${val("ears")}; arms ${val("slim")}; height ${val("height")}; top ${val("top")}, ${val("topShade")} ${val("topHue")}; bottoms ${val("legs")}, ${val("legShade")} ${val("legHue")}; shoes ${val("shoes")}; extra ${val("extra")}`;
}

export default {
  async describe() {
    const g = ready();
    const n = await lookup();
    if (!g.inGame) return "Vexel (a 3D block world). You're at its start menu: use the action \"enter\" to step into the world.";
    const p = g.player, w = g.world;
    // dead: the game shows its death screen until you press Respawn, as a person does
    const death = document.getElementById("death");
    if (death && death.classList.contains("active")) {
      const why = (document.getElementById("death-msg")?.textContent || "").replace(/\s+/g, " ").trim();
      return `Vexel: you died${why ? ` (${why})` : ""}. You're on the death screen and can't do anything until you get up again: use the action "respawn". You come back at your spawn point with empty hands; what you carried lies where you fell for a while.`;
    }
    const f = ahead(p.yaw);
    const lines = [`Vexel: you stand at ${at(p)}, facing ${compass(f.x, f.z)}${p.pitch > 0.5 ? ", looking up" : p.pitch < -0.5 ? ", looking down" : ""}. It's ${timeWord(g.dayFrac)}${g.weather && g.weather.rain > 0.35 ? (g.weather.snow > 0.5 ? ", snowing" : ", raining") : ""}. Mode: ${g.mode}.`];
    const v = g.vitals || {};
    if (g.mode === "survival" && v.hp !== undefined) lines.push(`Health ${Math.round(v.hp)} of 20, food ${Math.round(v.food ?? 20)} of 20.`);
    const fx = Math.floor(p.x), fy = Math.floor(p.y), fz = Math.floor(p.z);
    lines.push(`Under your feet: ${n.block(w.get(fx, fy - 1, fz))}.`);
    // what's ahead: the first few blocks in front, at your feet and at your head
    const row = [];
    for (let k = 1; k <= 4; k++) {
      const x = Math.floor(p.x + f.x * k), z = Math.floor(p.z + f.z * k);
      const feet = w.get(x, fy, z), head = w.get(x, fy + 1, z), ground = w.get(x, fy - 1, z);
      row.push(`${k}: ${feet > 0 ? n.block(feet) : head > 0 ? `open at your feet, ${n.block(head)} at head height` : ground > 0 ? "open" : "a drop"}`);
    }
    lines.push(`Ahead of you, block by block: ${row.join("; ")}.`);
    if (g.target) lines.push(`You're pointing at: ${n.block(g.target.id)} at ${g.target.x}, ${g.target.y}, ${g.target.z} (dig breaks it).`);
    // who and what is near
    const near = [];
    for (const m of (g.mobs && g.mobs.list ? [...g.mobs.list.values()] : []).slice(0, 200)) {
      if (m.dying || Math.hypot(m.x - p.x, m.z - p.z) > 24) continue;
      near.push(`${(m.def && (m.def.label || m.def.name)) || m.type}: ${whereFrom(p, m.x, m.z)}`);
    }
    for (const [, q] of g.peers || []) if (q && q.x !== undefined) near.push(`${q.name || "a player"}: ${whereFrom(p, q.x, q.z)}`);
    lines.push(near.length ? `Near you: ${near.slice(0, 8).join("; ")}.` : "Nobody and nothing moving near you.");
    // the hotbar
    const slots = (g.inv && g.inv.slots ? g.inv.slots.slice(0, 9) : []).map((s, i) => (s ? `${i + 1} ${n.item(s.id)}${s.n > 1 ? ` x${s.n}` : ""}${g.sel === i ? " (in hand)" : ""}` : null)).filter(Boolean);
    lines.push(slots.length ? `Hotbar: ${slots.join(", ")}.` : "Your hands and hotbar are empty.");
    // Vexel's chat, as it shows on screen: the last few lines, who said what (and the game's own news)
    const said = Array.from(document.querySelectorAll("#chatlog > div")).slice(-6).map((d) => {
      const who = d.querySelector("b")?.textContent || "";
      const text = (d.textContent || "").slice(who.length).trim();
      return who ? `${who}: ${text}` : `(${text})`;
    });
    if (said.length) lines.push(`Chat (latest last): ${said.join(" / ")}`);
    try {
      const b = await theBody();
      if (b) {
        let t = optionsNow(b);
        const done = await judgeStep(b, t);
        if (done) t = optionsNow(b); // (a new step: what fits it now)
        lines.push("", "Around you (Vexel's own eyes):", yours(b.look()), "", b.map(10));
        if (done) lines.push("", done);
        menu = (t.options || []).slice(0, 24);
        if (t.goal) lines.push("", `Your goal in Vexel: ${yours(t.goal)}${t.step ? `; the step you're on: ${yours(t.step)}` : ""}.`);
        if (t.last) lines.push(`Last thing you chose: ${yours(t.last.text)}: ${t.last.ok ? "done" : "it didn't work"} (${yours(t.last.what)}).`);
        if (menu.length) lines.push("", 'What you could do now (do "use", target "choose", text the number):', ...menu.map((o, i) => `${i + 1}. ${yours(o.text)}`));
      }
    } catch (e) {
      lines.push(`(Vexel's own eyes didn't open: ${e.message})`);
    }
    return lines.join("\n");
  },

  actions: {
    respawn: {
      help: "after you die: press Respawn on the death screen, to get up again at your spawn point",
      run() {
        const g = ready();
        const death = document.getElementById("death");
        const btn = document.getElementById("respawn");
        if (!death || !death.classList.contains("active") || !btn) return "You're alive: there's nothing to respawn from.";
        btn.click();
        g.tick(10);
        return `You got up again at ${at(g.player)}. Read your screen: your hands are empty, and it may be night.`;
      },
    },
    appearance: {
      help: 'how you look, through the game\'s Character screen: "appearance" alone shows your look and every choice; to change it, name parts and what you want, separated by commas: "hair Long, hair colour pink, ears Cat, top Hoodie, top colour purple, extra Flower"',
      async run(text) {
        ready();
        const names = await lookNames();
        const btn = document.getElementById("char-btn");
        const box = document.getElementById("charscreen");
        if (!btn || !box) return "This Vexel has no Character screen.";
        btn.click(); // (opens it with your look now, as the menu's Character button does)
        await new Promise((r) => setTimeout(r, 50));
        const want = String(text || "").trim();
        const choices = () =>
          `Choices: skin (${SWATCH.skin.join(", ")}); eyes (${names.eyes.join(", ")}); eye colour (${SWATCH.eyeCol.join(", ")}); mouth (${names.mouth.join(", ")}); cheeks (${names.cheeks.join(", ")}); facial hair (${names.beard.join(", ")}); hair (${names.hair.join(", ")}); hair colour (${SWATCH.hairCol.join(", ")}); ears (${names.ears.join(", ")}); arms (classic, slim); height (${names.height.join(", ")}); top (${names.top.join(", ")}); top colour (${Object.keys(HUES).join(", ")}); top shade (${names.topShade.join(", ")}); bottoms (${names.legs.join(", ")}); bottoms colour and shade (as for the top); shoes (${SWATCH.shoes.join(", ")}); extra (${names.extra.join(", ")}).`;
        const close = () => box.querySelector(".char-done")?.click();
        if (!want) {
          const now = lookNow(box, names);
          close();
          return `You look like this: ${now}.\n${choices()}`;
        }
        const done = [], missed = [];
        for (const part of want.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean)) {
          const low = part.toLowerCase();
          const hit = PARTS.find(([re]) => re.test(low));
          if (!hit) {
            missed.push(`${part} (no such part)`);
            continue;
          }
          const k = hit[1];
          const value = low.replace(hit[0], "").replace(/^[\s:=-]+|\s+$/g, "");
          if (SWATCH[k] || k === "slim") {
            const list = SWATCH[k] || names.slim;
            const i = list.indexOf(value) >= 0 ? list.indexOf(value) : list.findIndex((c) => c.includes(value) || value.includes(c));
            const b = i >= 0 && box.querySelector(`button[data-k="${k}"][data-v="${i}"]`);
            if (b) { b.click(); done.push(`${part.slice(0, part.length - value.length).trim()} ${list[i]}`); } else missed.push(`${part} (choose from: ${list.join(", ")})`);
          } else if (k === "topHue" || k === "legHue") {
            const h = HUES[value] ?? (/^\d+$/.test(value) ? Math.min(63, Number(value)) : undefined);
            const r = box.querySelector(`.hue[data-k="${k}"]`);
            if (h !== undefined && r) { r.value = String(h); r.dispatchEvent(new Event("input", { bubbles: true })); done.push(part); } else missed.push(`${part} (a colour: ${Object.keys(HUES).join(", ")})`);
          } else {
            const list = names[k] || [];
            const i = list.findIndex((n) => n.toLowerCase() === value) >= 0 ? list.findIndex((n) => n.toLowerCase() === value) : list.findIndex((n) => n.toLowerCase().includes(value) && value);
            const c = box.querySelector(`.cyc[data-k="${k}"]`);
            if (i < 0 || !c) { missed.push(`${part} (choose from: ${list.join(", ")})`); continue; }
            for (let n = 0; n < list.length && c.querySelector("b").textContent !== list[i]; n++) c.querySelector('button[data-d="1"]').click();
            done.push(`${part.slice(0, part.length - value.length).trim()} ${list[i]}`);
          }
        }
        const now = lookNow(box, names);
        close();
        return `${done.length ? `Changed: ${done.join("; ")}.` : "Nothing changed."}${missed.length ? ` Not changed: ${missed.join("; ")}.` : ""}\nYou look like this now: ${now}. Everyone in the world sees it.`;
      },
    },
    choose: {
      help: 'do one of the things listed under "What you could do now", by its number ("3"): your hands do it, and you hear how it went',
      async run(text) {
        const g = ready();
        const b = await theBody();
        if (!b) return "Vexel's own body isn't here, so there's nothing to choose from: use walk, turn, look and dig.";
        const t = optionsNow(b);
        menu = (t.options || []).slice(0, 24);
        const want = String(text || "").trim();
        const k = Number.parseInt(want, 10);
        const o = Number.isFinite(k) ? menu[k - 1] : menu.find((m) => yours(m.text).toLowerCase().includes(want.toLowerCase()));
        if (!o) return `There's no option ${want || "(none given)"} now. Read your screen again for what you could do.`;
        b.on();
        let r;
        try {
          b.tick(); // (the body's own list, the same as the one you were shown)
          r = b.act(o.id);
          const end = performance.now() + 40000;
          while (b.body.act && performance.now() < end) {
            g.tick(20);
            await new Promise((res) => setTimeout(res, 0));
          }
          if (b.body.act) b.stop();
        } finally {
          b.off();
        }
        if (r === "no such option now") return "That option was gone by the time you chose it. Read your screen again.";
        const last = b.body.last;
        const what = last && last.id === o.id ? `${last.ok ? "Done" : "It didn't work"}: ${yours(last.what)}` : "You stopped partway (it took too long).";
        const done = await judgeStep(b, optionsNow(b));
        return `You chose: ${yours(o.text)}. ${what}. You're at ${at(g.player)}.${done ? `\n${done}` : ""}`;
      },
    },
    goal: {
      help: 'set what you\'re working toward, and its steps, so "What you could do now" offers what fits it: "build a seaside cabin | find the sea => there is water on my map | get 12 logs => I carry 12 logs" (each step: what to do => what\'s true when it\'s done). You judge your own steps: "goal done" when you\'ve finished the one you\'re on, "goal" alone to see where you are',
      async run(text) {
        const b = await theBody();
        if (!b) return "Vexel's own body isn't here, so there's no goal to keep: just play.";
        // you judge your own steps (Vexel's body was made to have a small model judge them; here the judge is you)
        if (/^(?:done|next|step done)\b/i.test(String(text || "").trim())) {
          const m0 = b.status().mind;
          if (!m0.goal) return "You have no goal set, so there's no step to finish.";
          const was = m0.step;
          const next = b.stepDone();
          return next ? `Step done: ${yours(was)}. Next: ${yours(next)}.` : `Step done: ${yours(was)}. That was the last one: your goal is done.`;
        }
        const [goal, ...steps] = String(text || "").split("|").map((s) => s.trim()).filter(Boolean);
        if (!goal) {
          const m = b.status().mind;
          return m.goal ? `Your goal: ${yours(m.goal)}. Steps: ${m.steps.map((s, i) => `${i + 1}. ${yours(s)}${i === m.at ? " (you're here)" : ""}`).join(" ")}${judged.said ? `. Last check of your step: ${judged.said}` : ""}` : "You have no goal set yet.";
        }
        b.goal(asClaude(goal), steps.map(asClaude));
        return `Goal set: ${goal}${steps.length ? `, in ${steps.length} step${steps.length === 1 ? "" : "s"}, starting with: ${steps[0]}` : ""}. Read your screen for what you could do now.`;
      },
    },
    survey: {
      help: 'look out over the land: a wider map, up to 32 blocks each way: "survey", or "survey 32"',
      async run(text) {
        ready();
        const b = await theBody();
        if (!b) return "Vexel's own eyes aren't here.";
        const r = Math.max(8, Math.min(32, Number.parseInt(text, 10) || 24));
        return b.map(r);
      },
    },
    enter: {
      help:"step into the world from the start menu",
      run() {
        const g = ready();
        if (g.inGame) return "You're already in the world.";
        g.enter();
        g.tick(30);
        return g.inGame ? `You're in, at ${at(g.player)}.` : "Vexel is still getting the world ready; try again in a moment.";
      },
    },
    walk: {
      help: 'walk some blocks: "forward 5", "back 2", "left 3", "right 3", or a compass way, "north 2", "south-east 4" (it turns you first; it climbs one-block steps by itself)',
      run(text) {
        const g = ready();
        const t = String(text || "").toLowerCase();
        const count = Number(/\d+/.exec(t)?.[0]);
        const blocks = Math.max(1, Math.min(20, Number.isFinite(count) && count > 0 ? count : 3));
        // a compass way: turn that way first, then walk forward (as a person turns and walks)
        const ways = { "north-east": -45, "north-west": 45, "south-east": -135, "south-west": 135, north: 0, east: -90, south: 180, west: 90 };
        const way = Object.keys(ways).find((w) => t.replace(/\s+(?=east|west)/, "-").includes(w));
        let dir = (/(forward|ahead|back|backward|left|right)/.exec(t) || [])[1] || "forward";
        if (way && !/(forward|ahead|back|backward|left|right)/.test(t)) {
          g.look((ways[way] * Math.PI) / 180, g.player.pitch);
          g.tick(2);
          dir = way;
        }
        const key = { forward: "KeyW", ahead: "KeyW", back: "KeyS", backward: "KeyS", left: "KeyA", right: "KeyD" }[dir] || "KeyW";
        const from = { ...g.player };
        hold([key], (blocks / 4.3) * 1000);
        g.tick(10); // (let her come to a stop before saying where she is)
        const moved = Math.round(Math.hypot(g.player.x - from.x, g.player.z - from.z));
        const far = moved > blocks * 2 + 2 ? ` That's much further than ${blocks}: something carried you (a slope, water, a fall, or running). Read your screen before the next move.` : "";
        return `Walked ${dir}: ${moved} block${moved === 1 ? "" : "s"}, now at ${at(g.player)}.${moved < blocks - 1 ? " Something stopped you: maybe a wall or a step too high (try jump)." : ""}${far}`;
      },
    },
    jump: {
      help: 'jump (or "jump forward" to hop up a step ahead)',
      run(text) {
        const g = ready();
        hold(/forward|ahead/i.test(text) ? ["Space", "KeyW"] : ["Space"], 420);
        return `Jumped; now at ${at(g.player)}.`;
      },
    },
    turn: {
      help: 'turn, as a player turns with the mouse: "left", "right", "around", "a little left" (45°), "left 30" (degrees), a compass point ("north", "north-east"), or "toward 15 -7" to face a spot (x z) you can see on your map',
      run(text) {
        const g = ready();
        const p = g.player;
        const t = String(text || "").toLowerCase().trim();
        const rad = (d) => (d * Math.PI) / 180;
        // compass: north is -z; yaw 0 faces north and turning left adds to it
        const points = { "north-east": -45, "north-west": 45, "south-east": -135, "south-west": 135, northeast: -45, northwest: 45, southeast: -135, southwest: 135, north: 0, east: -90, south: 180, west: 90 };
        let yaw = p.yaw;
        const toward = /^(?:toward|towards|to|face)\s+-?\d/.test(t);
        const deg = t.match(/(-?\d+(?:\.\d+)?)/);
        if (toward) {
          const nums = (t.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
          if (nums.length < 2) return 'Say the spot to face as x and z, from your map: "toward 15 -7".';
          const [x, z] = nums.length >= 3 ? [nums[0], nums[2]] : nums; // (x z, or x y z)
          yaw = Math.atan2(-(x + 0.5 - p.x), -(z + 0.5 - p.z));
        } else if (/around|back/.test(t)) yaw += Math.PI;
        else if (/left|right/.test(t)) {
          const by = deg ? Number(deg[1]) : /little|bit|slight/.test(t) ? 45 : 90;
          yaw += (/left/.test(t) ? 1 : -1) * rad(by);
        } else {
          const k = Object.keys(points).find((d) => t.replace(/\s+/g, "-").includes(d));
          if (k === undefined) return 'Say left, right, around, "a little left", "left 30", a compass point like "north-east", or "toward x z".';
          yaw = rad(points[k]);
        }
        g.look(yaw, p.pitch);
        g.tick(2);
        const f = ahead(g.player.yaw);
        const bearing = Math.round(((((Math.atan2(f.x, -f.z) * 180) / Math.PI) + 360) % 360));
        return `You face ${compass(f.x, f.z)} now (${bearing}° from north, clockwise).`;
      },
    },
    look: {
      help: 'look "up", "down", "ahead" (where you point decides what dig and place reach)',
      run(text) {
        const g = ready();
        const t = text.toLowerCase();
        const pitch = /up/.test(t) ? 0.9 : /down|feet|ground/.test(t) ? -1.2 : /slightly down|a bit down/.test(t) ? -0.5 : 0;
        g.look(g.player.yaw, pitch);
        g.tick(2);
        return g.target ? `You're pointing at a block ${pitch < 0 ? "below" : pitch > 0 ? "above" : "ahead"}.` : "You're not pointing at any block (nothing in reach that way).";
      },
    },
    dig: {
      help: "break the block you're pointing at (it takes a moment in survival; what drops, you pick up)",
      async run() {
        const g = ready();
        const t = g.target;
        if (!t) return "You're not pointing at a block. Turn or look (up, down, ahead) first.";
        const n = await lookup();
        const name = n.block(t.id);
        g.button(0, true);
        try {
          for (let i = 0; i < 40 && g.world.get(t.x, t.y, t.z) === t.id; i++) g.tick(15);
        } finally {
          g.button(0, false);
        }
        g.tick(20);
        return g.world.get(t.x, t.y, t.z) === t.id ? `The ${name} didn't break (it may be too hard for your hands, or need a tool).` : `Broke the ${name}.`;
      },
    },
    place: {
      help: "place what's in your hand on the block you're pointing at",
      async run() {
        const g = ready();
        const t = g.target;
        if (!t) return "You're not pointing at a block to place against. Look down or ahead first.";
        const slot = g.inv.slots[g.sel];
        if (!slot) return "Your hand is empty: choose a hotbar slot with something in it (select).";
        const n = await lookup();
        g.button(2, true);
        g.tick(3);
        g.button(2, false);
        g.tick(3);
        return `Placed ${n.item(slot.id)} (if there was room).`;
      },
    },
    // (logs chop couldn't reach or swing at: skipped next time, so it moves on to another tree instead of trying the
    // same stump again)
    chop: {
      help: 'find the nearest tree, walk up to it and dig its trunk for logs: "chop", or "chop 3" for up to 3 logs',
      async run(text) {
        const g = ready();
        const n = await lookup();
        const want = Math.max(1, Math.min(6, Number(/\d+/.exec(text || "")?.[0]) || 3));
        const w = g.world, p = g.player;
        const isLog = (id) => id > 0 && /log$/i.test(String(n.block(id)).replace(/\s+/g, "_")) && !/^stripped/i.test(n.block(id));
        const countLogs = () => g.inv.slots.reduce((s, x) => s + (x && isLog(x.id) ? x.n : 0), 0);
        const before = countLogs();
        // the nearest trunk: a log block within 16 blocks, from a little below her to well above (trees up a slope)
        let best = null;
        const fx = Math.floor(p.x), fy = Math.floor(p.y), fz = Math.floor(p.z);
        for (let dx = -16; dx <= 16; dx++)
          for (let dz = -16; dz <= 16; dz++)
            for (let dy = -6; dy <= 12; dy++) {
              const id = w.get(fx + dx, fy + dy, fz + dz);
              if (!isLog(id) || unreachable.has(`${fx + dx},${fy + dy},${fz + dz}`)) continue;
              const d = Math.hypot(dx, dz) + Math.abs(dy) * 0.3;
              if (!best || d < best.d) best = { x: fx + dx, y: fy + dy, z: fz + dz, d, id };
            }
        if (!best) return "There's no tree within 16 blocks of you. Walk somewhere new and try again.";
        const tree = n.block(best.id);
        const face = (x, z) => g.look(Math.atan2(-(x + 0.5 - g.player.x), -(z + 0.5 - g.player.z)), 0);
        // walk up to it, facing it each little stretch, hopping when something's in the way
        for (let i = 0; i < 30 && Math.hypot(best.x + 0.5 - g.player.x, best.z + 0.5 - g.player.z) > 1.9; i++) {
          face(best.x, best.z);
          const from = { x: g.player.x, z: g.player.z };
          hold(["KeyW"], 250);
          if (Math.hypot(g.player.x - from.x, g.player.z - from.z) < 0.15) hold(["KeyW", "Space"], 350);
        }
        const skip = () => unreachable.add(`${best.x},${best.y},${best.z}`);
        if (Math.hypot(best.x + 0.5 - g.player.x, best.z + 0.5 - g.player.z) > 3) return skip(), `You couldn't get to the ${tree} (something's in the way). You're at ${at(g.player)}.`;
        // the trunk's logs within reach, lowest first: aim at each and dig it
        let dug = 0;
        for (let y = best.y - 1; y <= Math.floor(g.player.y) + 3 && dug < want; y++) {
          if (!isLog(w.get(best.x, y, best.z))) continue;
          const eye = g.player.y + 1.62, cx = best.x + 0.5, cz = best.z + 0.5;
          const horiz = Math.hypot(cx - g.player.x, cz - g.player.z);
          g.look(Math.atan2(-(cx - g.player.x), -(cz - g.player.z)), Math.atan2(y + 0.5 - eye, horiz));
          g.tick(2);
          const t = g.target;
          if (!t || t.x !== best.x || t.y !== y || t.z !== best.z) continue; // (something else is in the line of sight)
          g.button(0, true);
          try {
            for (let k = 0; k < 40 && isLog(w.get(best.x, y, best.z)); k++) g.tick(15);
          } finally {
            g.button(0, false);
          }
          if (!isLog(w.get(best.x, y, best.z))) dug++;
        }
        // what fell: step up to where the trunk stood to pick it up
        face(best.x, best.z);
        hold(["KeyW"], 500);
        g.tick(60);
        const got = countLogs() - before;
        if (!dug) return skip(), `You reached the ${tree} at ${best.x}, ${best.y}, ${best.z} but couldn't get a clear swing at its trunk. Next time chop tries another tree; or look at it and dig.`;
        return `Chopped ${dug} ${tree} block${dug === 1 ? "" : "s"}${got > 0 ? `; ${got} log${got === 1 ? "" : "s"} in your inventory now (${countLogs()} in all)` : ", but the logs haven't reached your hands yet: walk forward a step to pick them up"}. You're at ${at(g.player)}.`;
      },
    },
    aim: {
      help: 'point at a block, as a person moves the mouse to it: "aim 95 69 19" (x y z), or with the face to point at, "aim 95 69 19 top" (top, bottom, north, south, east, west). It says what you\'re pointing at and where a placed block would go, so dig and place reach exactly that',
      async run(text) {
        const g = ready();
        const n = await lookup();
        const nums = (String(text || "").match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
        if (nums.length < 3) return 'Say the block as x y z, from your screen or map: "aim 95 69 19", or "aim 95 69 19 top".';
        const [x, y, z] = nums.map(Math.floor);
        const faces = { top: [0, 1, 0], bottom: [0, -1, 0], north: [0, 0, -1], south: [0, 0, 1], east: [1, 0, 0], west: [-1, 0, 0] };
        const word = Object.keys(faces).find((f) => new RegExp(`\\b${f}\\b`, "i").test(String(text)));
        const [fx, fy, fz] = word ? faces[word] : [0, 0, 0];
        const tx = x + 0.5 + fx * 0.45, ty = y + 0.5 + fy * 0.45, tz = z + 0.5 + fz * 0.45;
        const p = g.player, eye = p.y + 1.62;
        const dx = tx - p.x, dy = ty - eye, dz = tz - p.z, horiz = Math.hypot(dx, dz) || 0.001;
        const dist = Math.hypot(horiz, dy);
        if (dist > 5) return `That block is ${dist.toFixed(1)} blocks from your eyes, out of reach (about 5): walk closer first. You're at ${at(p)}.`;
        g.look(Math.atan2(-dx, -dz), Math.atan2(dy, horiz));
        g.tick(2);
        const t = g.target;
        if (!t) return `Nothing's there to point at: ${x}, ${y}, ${z} is open air.`;
        const side = Object.entries(faces).find(([, v]) => v[0] === t.nx && v[1] === t.ny && v[2] === t.nz)?.[0] || "a";
        const hit = t.x === x && t.y === y && t.z === z;
        return `${hit ? "Pointing at" : `Something's in the way: pointing at`} ${n.block(t.id)} at ${t.x}, ${t.y}, ${t.z}, its ${side} face. dig breaks it; place puts a block at ${t.x + t.nx}, ${t.y + t.ny}, ${t.z + t.nz}.`;
      },
    },
    attack: {
      help: 'hit a creature, as a person aims at it and clicks: "attack sheep" (the nearest sheep), "attack zombie", or "attack" for the nearest creature. It turns you to it, steps within reach and swings until it falls or runs off (animals give food; villagers remember who hit them)',
      async run(text) {
        const g = ready();
        // ("attack chicken", "the chicken", "chicken": the creature's name is what's left)
        const want = String(text || "").trim().toLowerCase().replace(/^(?:attack|hit|hunt|kill)\s+/, "").replace(/^(?:the|a|an|that|this)\s+/, "").replace(/s$/, "");
        const p = g.player;
        const named = (m) => String((m.def && (m.def.label || m.def.name)) || m.type || "").toLowerCase();
        let best = null;
        for (const m of g.mobs && g.mobs.list ? g.mobs.list.values() : []) {
          if (m.dying || (want && !named(m).includes(want))) continue;
          const d = Math.hypot(m.x - p.x, m.z - p.z);
          if (d < 24 && (!best || d < best.d)) best = { m, d };
        }
        if (!best) return want ? `There's no ${want} within 24 blocks of you.` : "There's no creature within 24 blocks of you.";
        const m = best.m, name = named(m);
        // aim at a height on it (its box runs from its feet up), and ask the game whether it's really in the
        // crosshair before swinging (a person sees that; a small chicken is easy to aim over)
        const aimAt = (f) => {
          const h = (m.def && m.def.h) || 1;
          const dx = m.x - g.player.x, dz = m.z - g.player.z, horiz = Math.hypot(dx, dz) || 0.01;
          g.look(Math.atan2(-dx, -dz), Math.atan2(m.y + h * f - (g.player.y + 1.62), horiz));
          g.tick(1);
        };
        const onIt = () => (typeof g.mobTarget === "function" ? g.mobTarget() === m : true);
        const aim = () => {
          for (const f of [0.6, 0.35, 0.85, 0.15]) {
            aimAt(f);
            if (onIt()) return true;
          }
          return false;
        };
        const hp0 = m.hp;
        let swings = 0, landed = 0;
        for (let i = 0; i < 40 && swings < 12 && !m.dying && g.mobs.list.has(m.id); i++) {
          const lined = aim();
          if (Math.hypot(m.x - g.player.x, m.z - g.player.z) > 2.6 || !lined) {
            const from = { x: g.player.x, z: g.player.z };
            hold(["KeyW"], 250);
            if (Math.hypot(g.player.x - from.x, g.player.z - from.z) < 0.15) hold(["KeyW", "Space"], 300);
            continue;
          }
          const before = m.hp;
          g.button(0, true);
          g.tick(2);
          g.button(0, false);
          swings++;
          if (m.hp !== before || m.dying || (m.hurt || 0) > 0) landed++;
          g.tick(32); // (the swing's cooldown, as a person waits between hits)
        }
        const down = m.dying || !g.mobs.list.has(m.id);
        if (down) {
          hold(["KeyW"], 400); // (step in to pick up what it dropped)
          g.tick(40);
        }
        return down
          ? `The ${name} fell after ${swings} swing${swings === 1 ? "" : "s"}; you stepped in for what it dropped. You're at ${at(g.player)}.`
          : swings
            ? `You swung at the ${name} ${swings} time${swings === 1 ? "" : "s"}, ${landed} landed${typeof hp0 === "number" && typeof m.hp === "number" ? ` (its health ${hp0} → ${m.hp})` : ""}; it's still up (or got away). You're at ${at(g.player)}.`
            : `You couldn't get within reach of the ${name}. You're at ${at(g.player)}.`;
      },
    },
    select: {
      help: 'hold a hotbar slot: "3", or an item\'s name like "planks"',
      async run(text) {
        const g = ready();
        const n = await lookup();
        let i = Number(text) - 1;
        if (!(i >= 0 && i < 9)) i = g.inv.slots.slice(0, 9).findIndex((s) => s && n.item(s.id).toLowerCase().includes(text.toLowerCase().trim()));
        if (!(i >= 0 && i < 9)) return `No hotbar slot like "${text}".`;
        g.selectSlot(i);
        const s = g.inv.slots[i];
        return s ? `Holding ${n.item(s.id)}.` : `Slot ${i + 1} is empty: your hand is empty now.`;
      },
    },
    say: {
      help: 'say something in Vexel\'s own chat (others in the world see it over your head), or a command starting with "/", like "/time day"',
      run(text) {
        const g = ready();
        const words = String(text).trim().slice(0, 200);
        if (!words) return "Say what?";
        g.openChat(words.startsWith("/") ? "" : "");
        const box = document.getElementById("chatin");
        if (!box) return "Vexel's chat isn't open.";
        box.value = words;
        box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
        g.tick(2);
        return words.startsWith("/") ? `Ran ${words}.` : `Said: ${words}`;
      },
    },
  },
};
