// Small shared registry for things that live in components but agents need to reach.

import type { SeatAct } from "./xdc.ts";

type Reader = () => Promise<string>;
let readScreen: Reader | null = null;
// A character playing an app has her own seat: a hidden copy of it running as her, with her own screen.
const seats = new Map<string, Reader>();
type Actor = (act: SeatAct) => Promise<{ ok: boolean; said: string }>;
const actors = new Map<string, Actor>();

export const gameScreen = {
  register(fn: Reader | null) {
    readScreen = fn;
  },
  registerSeat(id: string, fn: Reader | null) {
    if (fn) seats.set(id, fn);
    else seats.delete(id);
  },
  hasSeat: (id: string) => seats.has(id),
  /** Her own seat's hands: type, click or choose on her own screen (never the person's). */
  registerActor(id: string, fn: Actor | null) {
    if (fn) actors.set(id, fn);
    else actors.delete(id);
  },
  async act(id: string, act: SeatAct) {
    const fn = actors.get(id);
    return fn ? await fn(act) : { ok: false, said: "You have no seat of your own in this app, so there's nothing of yours to use." };
  },
  /** What the game shows: the character's own seat when she has one, else the person's screen. */
  async read(id?: string): Promise<string> {
    try {
      const seat = id ? seats.get(id) : undefined;
      if (seat) return await seat();
      return readScreen ? await readScreen() : "";
    } catch {
      return "";
    }
  },
};
