// A turn in a game lasts as long as a character's room for it, not a handful of actions: she plays on, action after
// action, while her context has space, the way a person plays until they need to stop. When it's nearly full the desk
// tells her, and she does what a person does before stepping away from a game: gets somewhere safe, then says where
// she is and what she'll do next, so the next turn (hers, with a fresh context) picks it up.

/** Most actions in one game turn, whatever the room (so a turn always ends). */
export const PLAY_STEPS = 150;
/** The share of her context at which she's told to wrap up. */
export const WRAP_AT = 0.8;
/** Actions she has, after being told, to get safe before she says her piece. */
export const WRAP_STEPS = 4;
/** When the model's window isn't known: a size most current models hold. */
export const DEFAULT_WINDOW = 32768;

/** Whether this step's prompt has used enough of her window that it's time to wrap up. */
export const timeToWrap = (prompt: number | undefined, window: number) => typeof prompt === "number" && prompt >= window * WRAP_AT;

const k = (n: number) => (n >= 10000 ? `${Math.round(n / 1000)}k` : n.toLocaleString("en"));

// A reply that writes out play instead of playing ("I clicked Start. Slide 1 says… I'll continue.", over and over):
// some models, given a long turn, narrate tool use in text, each "turn" closed with a stray </think>, and never call
// a tool (Dee in the Learning Lab, 2026-11-20: 29,000 characters of lessons she never opened). Caught while it
// streams, not after.
const PRETEND = /<\/think>/g;
/** Whether a reply streaming in a game seat has run away: several pretend turns, or a long stretch with no action. */
export const runaway = (text: string) => (text.match(PRETEND) || []).length >= 3 || text.length > 6000;
export const RUNAWAY_NOTE =
  "[Desk note] Stopped: you were writing out what you'd do instead of doing it, and none of it happened (your screen hasn't changed). Writing a move doesn't make it. Take one real action now with game_seat_act, read what comes back, then the next.";

/** At the start of a game turn: how long she has, and how it ends. */
export const playNote = (window: number) =>
  `[Desk note] You're playing. Your turn lasts as long as you keep taking actions, up to about ${k(window * WRAP_AT)} tokens of this turn's room (of ${k(window)}): you don't need to stop after a few. A reply with no action ends your turn, so if you want to talk as you go, use the game's own chat if it has one, and keep playing. The desk will tell you when your room is nearly full.`;

/** When her room is nearly full: get safe, then say where she is and what's next. */
export const wrapNote = (prompt: number, window: number) =>
  `[Desk note] Your room for this turn is nearly full (${k(prompt)} of ${k(window)} tokens). Before you stop, leave things in a good place, in up to ${WRAP_STEPS} actions (in a world game: somewhere safe, out of reach of anything hostile, off any drop, under cover at night). Then, in words, say where you are (in a world: x, y, z from your screen; in an app: which screen or lesson), what you did this turn, and what you'll do next turn.`;
