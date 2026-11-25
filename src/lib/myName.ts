// Who "you" are on this device: the name set in Settings › Look, else the signed-in account's name, else "You". Kept
// per device (several people can share one SEASIDE, each on their own device), and used wherever the desk shows or
// tells the characters who is speaking: the room, games (and the address a person plays as), and who's present.

import { useSyncExternalStore } from "react";
import { desk } from "./store.ts";

const KEY = "pdd-my-name";
const EVENT = "pdd-my-name";

function stored() {
  try {
    return (localStorage.getItem(KEY) ?? "").trim();
  } catch {
    return "";
  }
}

/** The name set on this device, if any (not the account's). */
export const ownName = () => stored();

export function setMyName(name: string) {
  const clean = name.replace(/\s+/g, " ").trim().slice(0, 40);
  try {
    if (clean) localStorage.setItem(KEY, clean);
    else localStorage.removeItem(KEY);
  } catch {
    /* storage off: the account's name, or You, stays */
  }
  window.dispatchEvent(new Event(EVENT));
}

/** The person's name here, or "" if there's none (no name set, nobody signed in). */
export const myName = () => stored() || desk().session || "";
/** As shown: the name, or "You". */
export const shownName = () => myName() || "You";
/** The address the person plays as in a game ("you:sam"). */
export const myAddrName = () => shownName().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "you";

export function useMyName() {
  return useSyncExternalStore(
    (fire) => {
      window.addEventListener(EVENT, fire);
      window.addEventListener("storage", fire);
      return () => {
        window.removeEventListener(EVENT, fire);
        window.removeEventListener("storage", fire);
      };
    },
    () => stored() + "\n" + (desk().session ?? ""),
  ).split("\n").find(Boolean) || "You";
}
