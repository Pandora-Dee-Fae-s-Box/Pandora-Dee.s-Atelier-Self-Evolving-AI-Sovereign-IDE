// PADS edge crossing (stage 1: between SEASIDE desks). Push the mouse past a screen edge and you're driving the device
// that sits there in the PADS Manager's room: its cursor moves, it hovers, clicks, drags, scrolls and types. Push back
// across (or press Esc) and you're home. The device doing the crossing keeps track of everything (where its cursor
// is on the other screen, which device is past each edge); the device being driven just shows a cursor and acts.
//
// Browsers only let a page take the mouse (pointer lock) after a real click, so the first crossing asks for one click
// at the edge; after that, crossings are seamless. A device can be driven only while it allows it (PADS → "Let my
// other devices control this one", off until switched on there), and the server passes input only between devices of
// the same account (server/padsWire.mjs).

import { account, deviceId, lastRoster, meNow, onMe, type Device } from "./pads.ts";
import { arrival, edgeAt, neighbour, type Rect, type Side } from "./padsCross.ts";

const SCALE = 0.13; // the PADS Manager's card scale (apps/Pads.tsx)
const rectOf = (d: Device): Rect => ({ id: d.id, x: d.layout.x, y: d.layout.y, w: Math.max(56, d.screen.w * SCALE), h: Math.max(56, d.screen.h * SCALE) });

type Ev =
  | { t: "enter"; x: number; y: number; name: string }
  | { t: "move"; x: number; y: number }
  | { t: "down" | "up"; b: number }
  | { t: "wheel"; dx: number; dy: number }
  | { t: "key"; down: boolean; key: string; code: string; ctrl: boolean; shift: boolean; alt: boolean; meta: boolean }
  | { t: "leave" };

let ws: WebSocket | null = null;
let allowedPeers = new Map<string, boolean>();
const send = (msg: unknown) => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg));
const toDevice = (id: string, ev: Ev) => send({ type: "to", to: id, ctl: true, ev });

// ── the wire ────────────────────────────────────────────────────────────────────────────────────────────────────
function connect() {
  const me = meNow();
  if (!me.on) return; // (a desktop with no accounts is one household: PADS's account is "" there)
  const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/pads/ws?account=${encodeURIComponent(account())}&device=${encodeURIComponent(deviceId())}`;
  const sock = new WebSocket(url);
  ws = sock;
  sock.onopen = () => send({ type: "allow", allow: meNow().control });
  sock.onmessage = (e) => {
    let m: { type: string; peers?: { id: string; allow: boolean }[]; from?: string; ctl?: boolean; ev?: Ev; id?: string };
    try {
      m = JSON.parse(String(e.data));
    } catch {
      return;
    }
    if (m.type === "peers") allowedPeers = new Map((m.peers ?? []).map((p) => [p.id, p.allow]));
    else if (m.type === "from" && m.ctl && m.ev && m.from) driven(m.from, m.ev);
    else if ((m.type === "refused" || m.type === "gone") && remote?.id === m.id) goHome();
  };
  sock.onclose = () => {
    if (ws === sock) ws = null;
    if (remote) goHome();
    hideCursor();
    // the server restarted, or the network blinked: try again while PADS is on here
    window.setTimeout(() => meNow().on && !ws && connect(), 3000);
  };
}

// ── this device crossing into another ──────────────────────────────────────────────────────────────────────────
// lock: the mouse is captured, and moves the other cursor by how far it moves (seamless). mirror: when this browser
// won't capture the mouse, this window stands for the other screen, edge for edge, with this mouse hidden.
let remote: { id: string; name: string; x: number; y: number; w: number; h: number; mode: "lock" | "mirror"; armed: boolean } | null = null;
let clickedForLock = false;
let shield: HTMLDivElement | null = null;
let pending: { id: string; name: string; side: Side; t: number } | null = null; // waiting for the click that allows it
let lockedBefore = false; // after a first lock, the browser lets later ones happen without a click
let movePending = false;

const rects = () => lastRoster().filter((d) => d.here).map(rectOf);
const deviceOf = (id: string) => lastRoster().find((d) => d.id === id);

/** The device past this edge that's here and lets itself be driven. */
function across(fromId: string, side: Side, t: number) {
  const n = neighbour(rects(), fromId, side, t);
  if (!n) return null;
  const d = deviceOf(n.id);
  if (!d || (n.id !== deviceId() && !allowedPeers.get(n.id))) return null;
  return { id: n.id, name: d.name, side, t: n.t, d };
}

function enter(target: { id: string; name: string; d: Device }, side: Side, t: number, mode: "lock" | "mirror" = "lock") {
  const { w, h } = target.d.screen;
  const at = arrival(sideOpposite(side), t, w, h);
  remote = { id: target.id, name: target.name, x: at.x, y: at.y, w, h, mode, armed: mode === "lock" };
  toDevice(target.id, { t: "enter", x: at.x, y: at.y, name: myLabel() });
  if (mode === "mirror") showShield();
  showBanner(mode === "lock" ? `Controlling ${target.name} · move back across the edge, or press Esc` : `Controlling ${target.name} · this window stands for its screen · edges cross, Esc comes home`);
}
/** Mirror mode: a see-through cover over this window, so this page isn't clicked while the other one is. */
function showShield() {
  shield ||= Object.assign(document.createElement("div"), { className: "pads-shield" });
  if (!shield.isConnected) document.body.appendChild(shield);
}
const hideShield = () => shield?.remove();
const sideOpposite = (s: Side): Side => ({ left: "right", right: "left", top: "bottom", bottom: "top" })[s] as Side;
const myLabel = () => deviceOf(deviceId())?.name || "Another device";

function cross(target: { id: string; name: string; d: Device }, side: Side, t: number) {
  if (document.pointerLockElement) return enter(target, side, t);
  pending = { id: target.id, name: target.name, side, t };
  const p = document.documentElement.requestPointerLock?.() as Promise<void> | undefined;
  if (p && typeof p.catch === "function") p.catch(() => showHint(side, target.name)); // needs a click first
  else if (!lockedBefore) showHint(side, target.name);
}

function goHome() {
  if (remote) toDevice(remote.id, { t: "leave" });
  remote = null;
  pending = null;
  clickedForLock = false;
  hideBanner();
  hideShield();
  hideHint();
  if (document.pointerLockElement) document.exitPointerLock();
}

// the browser won't capture the mouse (some won't at all): after the click that was asked for, cross in mirror mode
document.addEventListener("pointerlockerror", () => {
  if (!clickedForLock || !pending) return;
  clickedForLock = false;
  const d = deviceOf(pending.id);
  hideHint();
  if (d) enter({ id: pending.id, name: pending.name, d }, pending.side, pending.t, "mirror");
  pending = null;
});

document.addEventListener("pointerlockchange", () => {
  if (document.pointerLockElement) {
    lockedBefore = true;
    hideHint();
    if (pending) {
      const d = deviceOf(pending.id);
      if (d) enter({ id: pending.id, name: pending.name, d }, pending.side, pending.t);
      pending = null;
    }
  } else if (remote?.mode === "lock") {
    // Esc, or the browser took the mouse back: home
    const id = remote.id;
    remote = null;
    toDevice(id, { t: "leave" });
    hideBanner();
  }
});

// the mouse reaching an edge of this screen (or leaving the window there)
function atEdge(e: MouseEvent) {
  if (remote || !meNow().on || !meNow().cross || document.pointerLockElement) return;
  const edge = edgeAt(e.clientX, e.clientY, innerWidth, innerHeight, 2);
  if (!edge) return void (hint && hideHint());
  const target = across(deviceId(), edge.side, edge.t);
  if (!target) return;
  cross(target, edge.side, edge.t);
}
document.addEventListener("mousemove", (e) => {
  if (!remote) return atEdge(e);
  const r = remote;
  if (r.mode === "mirror") {
    // this window stands for the other screen: where the mouse is here is where it is there
    r.x = (e.clientX / Math.max(1, innerWidth - 1)) * (r.w - 1);
    r.y = (e.clientY / Math.max(1, innerHeight - 1)) * (r.h - 1);
    // arriving puts the mouse at an edge already: crossing on waits until it has moved away from the edges once
    if (!r.armed) {
      if (!edgeAt(e.clientX, e.clientY, innerWidth, innerHeight, 24)) r.armed = true;
    } else {
      const edge = edgeAt(e.clientX, e.clientY, innerWidth, innerHeight, 2);
      if (edge) {
        const next = across(r.id, edge.side, edge.t);
        if (next?.id === deviceId()) return goHome();
        if (next) {
          toDevice(r.id, { t: "leave" });
          hideShield();
          return enter(next, edge.side, next.t, "mirror");
        }
      }
    }
  } else {
  // driving another device: its cursor moves by how far this mouse moves
  remote.x += e.movementX;
  remote.y += e.movementY;
  if (r.x < 0 || r.y < 0 || r.x > r.w - 1 || r.y > r.h - 1) {
    const side: Side = r.x < 0 ? "left" : r.x > r.w - 1 ? "right" : r.y < 0 ? "top" : "bottom";
    const t = side === "left" || side === "right" ? r.y / r.h : r.x / r.w;
    const next = across(r.id, side, t);
    if (next?.id === deviceId()) return goHome();
    if (next) {
      toDevice(r.id, { t: "leave" });
      return enter(next, side, next.t);
    }
    r.x = Math.min(r.w - 1, Math.max(0, r.x));
    r.y = Math.min(r.h - 1, Math.max(0, r.y));
  }
  }
  if (!movePending) {
    movePending = true;
    requestAnimationFrame(() => {
      movePending = false;
      if (remote) toDevice(remote.id, { t: "move", x: Math.round(remote.x), y: Math.round(remote.y) });
    });
  }
}, true);
document.documentElement.addEventListener("mouseleave", (e) => atEdge(e));

const forward = (e: Event, ev: Ev) => {
  if (!remote) return false;
  e.preventDefault();
  e.stopImmediatePropagation();
  toDevice(remote.id, ev);
  return true;
};
for (const type of ["mousedown", "mouseup"] as const)
  window.addEventListener(type, (e) => {
    // the click that lets the mouse cross (browsers ask for one before the first crossing)
    if (!remote && type === "mousedown" && hint && pending) {
      e.preventDefault();
      e.stopImmediatePropagation();
      clickedForLock = true;
      void (document.documentElement.requestPointerLock?.() as Promise<void> | undefined)?.catch?.(() => undefined);
      return;
    }
    forward(e, { t: type === "mousedown" ? "down" : "up", b: e.button });
  }, true);
for (const type of ["click", "dblclick", "contextmenu", "auxclick"] as const) window.addEventListener(type, (e) => void (remote && (e.preventDefault(), e.stopImmediatePropagation())), true);
window.addEventListener("wheel", (e) => void forward(e, { t: "wheel", dx: e.deltaX, dy: e.deltaY }), { capture: true, passive: false });
for (const type of ["keydown", "keyup"] as const)
  window.addEventListener(type, (e) => {
    if (!remote) {
      // Ctrl+Alt+arrow: jump to the device on that side (a key press counts as the click browsers ask for)
      if (type === "keydown" && e.ctrlKey && e.altKey && meNow().on && meNow().cross) {
        const side = ({ ArrowLeft: "left", ArrowRight: "right", ArrowUp: "top", ArrowDown: "bottom" } as Record<string, Side>)[e.key];
        const target = side && across(deviceId(), side, 0.5);
        if (target) {
          e.preventDefault();
          cross(target, side, 0.5);
        }
      }
      return;
    }
    if (e.key === "Escape") {
      // with the mouse captured, the browser brings it home itself; in mirror mode, this does
      if (remote.mode === "mirror") (e.preventDefault(), e.stopImmediatePropagation(), goHome());
      return;
    }
    forward(e, { t: "key", down: type === "keydown", key: e.key, code: e.code, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey });
  }, true);

// ── another device driving this one ────────────────────────────────────────────────────────────────────────────
let cursor: HTMLDivElement | null = null;
let at = { x: 0, y: 0 };
let over: Element | null = null;
let downOn: Element | null = null;
let buttons = 0;
let lastClick = { at: 0, el: null as Element | null };

function showCursor(name: string) {
  if (!cursor) {
    cursor = document.createElement("div");
    cursor.className = "pads-cursor";
    cursor.innerHTML = `<svg width="18" height="22" viewBox="0 0 18 22" aria-hidden="true"><path d="M1 1 L1 17 L5.5 13 L8.5 20.5 L11.5 19.2 L8.6 12 L14.5 12 Z" fill="#fff" stroke="#000" stroke-width="1.4" stroke-linejoin="round"/></svg><span></span>`;
    document.body.appendChild(cursor);
  }
  (cursor.querySelector("span") as HTMLSpanElement).textContent = name;
  cursor.style.display = "block";
}
function hideCursor() {
  if (cursor) cursor.style.display = "none";
  if (over) fire(over, "mouseout"), fire(over, "pointerout");
  over = null;
  buttons = 0;
}
const place = () => cursor && (cursor.style.transform = `translate(${at.x}px, ${at.y}px)`);

function fire(el: Element, type: string, extra: MouseEventInit = {}) {
  const init: PointerEventInit = { bubbles: true, cancelable: true, composed: true, clientX: at.x, clientY: at.y, screenX: at.x, screenY: at.y, buttons, view: window, ...extra };
  const ev = type.startsWith("pointer") ? new PointerEvent(type, { pointerId: 9, pointerType: "mouse", isPrimary: true, ...init }) : new MouseEvent(type, init);
  return el.dispatchEvent(ev);
}
const under = () => {
  if (cursor) cursor.style.display = "none";
  const el = document.elementFromPoint(at.x, at.y) ?? document.body;
  if (cursor) cursor.style.display = "block";
  return el;
};
const editable = (el: Element | null): el is HTMLElement =>
  !!el && (el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !/^(checkbox|radio|button|submit|range|color|file)$/.test(el.type)) || (el as HTMLElement).isContentEditable);
const focusable = (el: Element) => el.closest<HTMLElement>("input, textarea, select, button, a[href], [tabindex], [contenteditable='true'], [contenteditable='']");
function scrollable(el: Element | null): Element | null {
  for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
    const s = getComputedStyle(e);
    if ((/(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight) || (/(auto|scroll)/.test(s.overflowX) && e.scrollWidth > e.clientWidth)) return e;
  }
  return document.scrollingElement;
}

function driven(from: string, ev: Ev) {
  if (!meNow().control) return; // switched off here since: nothing happens
  if (ev.t === "enter") {
    at = { x: ev.x, y: ev.y };
    showCursor(ev.name || "Another device");
    place();
    return;
  }
  if (ev.t === "leave") return hideCursor();
  if (!cursor || cursor.style.display === "none") return;
  void from;
  if (ev.t === "move") {
    at = { x: Math.min(innerWidth - 1, Math.max(0, ev.x)), y: Math.min(innerHeight - 1, Math.max(0, ev.y)) };
    place();
    const el = under();
    if (el !== over) {
      if (over) fire(over, "pointerout"), fire(over, "mouseout");
      fire(el, "pointerover"), fire(el, "mouseover");
      over = el;
    }
    fire(el, "pointermove");
    fire(el, "mousemove");
    return;
  }
  if (ev.t === "down" || ev.t === "up") {
    const el = under();
    const bit = ev.b === 2 ? 2 : ev.b === 1 ? 4 : 1;
    if (ev.t === "down") {
      buttons |= bit;
      downOn = el;
      fire(el, "pointerdown", { button: ev.b });
      if (fire(el, "mousedown", { button: ev.b })) {
        const f = focusable(el);
        if (f) f.focus();
        else if (document.activeElement instanceof HTMLElement && !el.contains(document.activeElement)) document.activeElement.blur();
      }
      return;
    }
    buttons &= ~bit;
    fire(el, "pointerup", { button: ev.b });
    fire(el, "mouseup", { button: ev.b });
    if (downOn && (downOn === el || downOn.contains(el) || el.contains(downOn))) {
      if (ev.b === 2) fire(el, "contextmenu", { button: 2 });
      else if (ev.b === 0) {
        const now = Date.now();
        const detail = lastClick.el === el && now - lastClick.at < 400 ? 2 : 1;
        fire(el, "click", { button: 0, detail } as MouseEventInit);
        if (detail === 2) fire(el, "dblclick", { button: 0, detail: 2 } as MouseEventInit);
        lastClick = { at: detail === 2 ? 0 : now, el };
      }
    }
    downOn = null;
    return;
  }
  if (ev.t === "wheel") {
    const el = under();
    const ok = el.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, composed: true, clientX: at.x, clientY: at.y, deltaX: ev.dx, deltaY: ev.dy, deltaMode: 0 }));
    if (ok) scrollable(el)?.scrollBy({ left: ev.dx, top: ev.dy });
    return;
  }
  if (ev.t === "key") {
    const el = (document.activeElement as HTMLElement | null) ?? document.body;
    const ok = el.dispatchEvent(new KeyboardEvent(ev.down ? "keydown" : "keyup", { bubbles: true, cancelable: true, composed: true, key: ev.key, code: ev.code, ctrlKey: ev.ctrl, shiftKey: ev.shift, altKey: ev.alt, metaKey: ev.meta }));
    if (!ev.down || !ok || !editable(el)) return;
    // what the key would have done in a text box (synthetic key events don't type by themselves)
    if (ev.key.length === 1 && !ev.ctrl && !ev.meta) document.execCommand("insertText", false, ev.key);
    else if (ev.key === "Backspace") document.execCommand("delete");
    else if (ev.key === "Delete") document.execCommand("forwardDelete");
    else if (ev.key === "Enter" && !(el instanceof HTMLInputElement)) document.execCommand("insertLineBreak");
    else if ((ev.ctrl || ev.meta) && ev.key.toLowerCase() === "a") document.execCommand("selectAll");
    else if ((ev.key === "ArrowLeft" || ev.key === "ArrowRight") && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
      const p = Math.max(0, Math.min(el.value.length, (el.selectionStart ?? 0) + (ev.key === "ArrowLeft" ? -1 : 1)));
      el.setSelectionRange(p, p);
    }
  }
}

// ── the little notes on screen ─────────────────────────────────────────────────────────────────────────────────
let banner: HTMLDivElement | null = null;
let hint: HTMLDivElement | null = null;
function showBanner(text: string) {
  banner ||= Object.assign(document.createElement("div"), { className: "pads-banner" });
  banner.textContent = text;
  if (!banner.isConnected) document.body.appendChild(banner);
}
const hideBanner = () => banner?.remove();
function showHint(side: Side, name: string) {
  hint ||= Object.assign(document.createElement("div"), { className: "pads-hint" });
  hint.dataset.side = side;
  hint.textContent = `Click to cross to ${name}`;
  if (!hint.isConnected) document.body.appendChild(hint);
}
function hideHint() {
  hint?.remove();
  hint = null;
}

let started = false;
/** Joins PADS's live wire while PADS is on here; follows this device's crossing and control switches. */
export function startPadsControl() {
  if (started) return;
  started = true;
  connect();
  onMe(() => {
    const me = meNow();
    if (me.on && !ws) connect();
    else if (!me.on && ws) ws.close();
    send({ type: "allow", allow: me.control });
    if (!me.control) hideCursor();
    if (!me.cross && remote) goHome();
  });
}
