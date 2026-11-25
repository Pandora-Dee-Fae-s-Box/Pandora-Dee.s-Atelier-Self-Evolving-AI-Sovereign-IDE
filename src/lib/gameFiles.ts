// "Imagine a game": what a character is asked to write, and her answer read back into a Mini App's files and the
// pictures, music and sounds it wants. No DOM here (gameFiles.test.ts); gameMaker.ts does the asking and making.

export type Asset = { kind: "picture" | "music" | "sound"; path: string; about: string };
export type GameAnswer = { title: string; note: string; files: Record<string, string>; assets: Asset[] };

const TEXT_FILE = /^[a-z0-9_-]+(\/[a-z0-9_-]+)*\.(html|css|js|mjs|json|toml|md|txt|svg)$/i;
const ASSET_FILE = { picture: /^art\/[a-z0-9_-]+\.png$/i, music: /^music\/[a-z0-9_-]+\.(mp3|wav|ogg|m4a)$/i, sound: /^sfx\/[a-z0-9_-]+\.wav$/i };

export function gameSystem(who: string, assets: { pictures: boolean; music: boolean }) {
  return [
    `You are ${who}, making a small browser game for someone you know, as a webxdc Mini App: a few files that run offline in a sandboxed page.`,
    "Rules:",
    "- Plain HTML, CSS and JavaScript only. No build step, no frameworks, no imports from the internet: nothing outside the app's own files can load (no CDNs, no fonts from the web, no fetch to other sites).",
    "- index.html is the page. Keep it to a few files: index.html, style.css, game.js (more only if it really helps).",
    "- It must work with a mouse and with touch, fit any window size, and start without a click if it can (audio may start on the first click).",
    "- Optional: high scores or shared play with window.webxdc (load it with <script src=\"webxdc.js\"></script>): webxdc.sendUpdate({payload}, \"\") and webxdc.setUpdateListener(fn). fn gets an update object, not your data: your data is update.payload (so update.payload.type, never update.type). It's called for every update from the start, yours included, so draw the game from those calls rather than from your own clicks. This device's player is webxdc.selfAddr and webxdc.selfName: never take another player's join for your own.",
    "- Make it fun and finished: a goal, feedback, a way to win or lose or keep going, and a restart.",
    "- If people play it together over webxdc, characters (AIs) play it too: they read the updates as JSON and send updates of their own, without seeing the screen. So also write guide.md for them: every payload shape with a filled-in example, how a player joins or takes a seat, whose turn it is and how to tell, how to work out the board or state from the updates in order, and how the game ends. Make the game's own code accept those same payloads from any player (not only from this device), and keep the whole state derivable from the updates.",
    "Answer in exactly this shape and nothing else:",
    "TITLE: the game's name",
    "NOTE: one or two sentences on what you made (or changed)",
    "=== FILE: index.html ===",
    "(the whole file)",
    "=== END FILE ===",
    "(and the same for each other file)",
    "When changing a game, give only the files that change, each one whole.",
    "The game can ask for sounds, made for it: list each on its own line before the files, like",
    "SOUND: sfx/jump.wav | a jump",
    assets.pictures ? "and pictures (PNG): PICTURE: art/cat.png | a cute pixel-art cat, side view, plain background" : "Don't ask for pictures: draw with canvas, CSS or emoji instead.",
    assets.music ? "and music: MUSIC: music/theme.mp3 | upbeat chiptune loop, 140 bpm" : "Don't ask for music.",
    "Use those paths in the code exactly as listed (new Audio(\"sfx/jump.wav\"), an Image with src \"art/cat.png\"), and let the game still work if one is missing.",
  ].join("\n");
}

/** The game as it is now, for a change: its text files in the answer's own shape (big ones cut short). */
export function filesForChange(files: Record<string, string>, limit = 120_000): string {
  let used = 0;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(files).sort(([a], [b]) => (a === "index.html" ? -1 : b === "index.html" ? 1 : a.localeCompare(b)))) {
    if (!TEXT_FILE.test(k) || k === "manifest.toml") continue;
    const room = Math.max(0, limit - used);
    if (!room) break;
    const body = v.length > room ? `${v.slice(0, room)}\n/* …cut short here */` : v;
    used += body.length;
    parts.push(`=== FILE: ${k} ===\n${body}\n=== END FILE ===`);
  }
  return parts.join("\n");
}

/** Her answer read back: its title, note, files and the things it asks to have made. */
export function parseGame(text: string): GameAnswer {
  const t = text.replace(/\r\n/g, "\n");
  const title = (/^\s*TITLE:\s*(.+)$/m.exec(t)?.[1] ?? "").trim().replace(/^["*]+|["*]+$/g, "").slice(0, 80);
  const note = (/^\s*NOTE:\s*(.+)$/m.exec(t)?.[1] ?? "").trim().slice(0, 400);
  const files: Record<string, string> = {};
  for (const m of t.matchAll(/^===\s*FILE:\s*(\S+)\s*===\n([\s\S]*?)\n===\s*END FILE\s*===/gm)) {
    const p = m[1].replace(/^\.?\//, "");
    if (TEXT_FILE.test(p) && !p.includes("..")) files[p] = stripFence(m[2]);
  }
  // an answer that only gave a fenced page
  if (!Object.keys(files).length) {
    const page = /```html\n([\s\S]*?)```/i.exec(t)?.[1];
    if (page) files["index.html"] = page;
  }
  const assets: Asset[] = [];
  for (const m of t.matchAll(/^\s*(PICTURE|MUSIC|SOUND):\s*(\S+)\s*\|\s*(.+)$/gm)) {
    const kind = m[1].toLowerCase() as Asset["kind"];
    const p = m[2].replace(/^\.?\//, "");
    if (ASSET_FILE[kind].test(p) && !assets.some((a) => a.path === p)) assets.push({ kind, path: p, about: m[3].trim().slice(0, 300) });
  }
  return { title, note, files, assets };
}

/** A file's body, without a code fence the model may have wrapped it in. */
function stripFence(s: string) {
  const m = /^```[a-z]*\n([\s\S]*?)\n?```\s*$/i.exec(s.trim());
  return m ? m[1] : s;
}

export function manifestFor(name: string, version: string, description: string) {
  const q = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ")}"`;
  return `name = ${q(name)}\nversion = ${q(version)}\ndescription = ${q(description)}\n`;
}

/** The next version's label: 1, 2, 3… after the highest whole number among the versions there are. */
export function nextVersion(versions: string[]): string {
  const n = Math.max(0, ...versions.map((v) => Number(/^v?(\d+)$/.exec(v.trim())?.[1] ?? 0)));
  return String(n + 1);
}
