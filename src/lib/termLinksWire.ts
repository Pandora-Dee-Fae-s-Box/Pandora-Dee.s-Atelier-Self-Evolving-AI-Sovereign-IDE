import type { IBufferCellPosition, Terminal } from "@xterm/xterm";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { urlAt } from "./termLinks.ts";

/** Makes the web addresses a terminal shows clickable, sending each click to `open`. Call it after `term.open`.
 *
 *  xterm's own link handling (the web-links addon, and `linkHandler` for the hidden OSC 8 links some programs print)
 *  gives the underline and pointer on hover and opens a plain click. It loses track of the link under the pointer
 *  when a full-screen program keeps redrawing that row, so clicks there did nothing. And a program that has turned
 *  on mouse reporting gets every plain click itself. So this also reads the address straight from the screen at the
 *  moment of the click:
 *  - Ctrl+click (⌘+click on a Mac) on an address always opens it, and the program doesn't get that click.
 *  - A plain click on an address opens it whenever the program hasn't taken the mouse.
 *  Shift+click stays xterm's "select text even while a program has the mouse". */
export function wireTermLinks(term: Terminal, open: (e: MouseEvent, uri: string) => void): () => void {
  // two paths can see the same click: open each address once
  let last = { uri: "", at: 0 };
  const fire = (e: MouseEvent, uri: string) => {
    if (!/^https?:/i.test(uri)) return;
    const now = performance.now();
    if (last.uri === uri && now - last.at < 600) return;
    last = { uri, at: now };
    open(e, uri);
  };
  // the hidden link under the pointer, for Ctrl+click: the screen's text doesn't hold its address
  let hidden: string | undefined;
  term.options.linkHandler = {
    activate: (e, uri) => fire(e, uri),
    hover: (_e, uri) => void (hidden = uri),
    leave: () => void (hidden = undefined),
  };
  const addon = new WebLinksAddon(fire);
  term.loadAddon(addon);

  const el = term.element;
  if (!el) return () => addon.dispose();
  const cellAt = (e: MouseEvent): IBufferCellPosition | undefined => {
    const screen = el.querySelector(".xterm-screen");
    if (!screen) return undefined;
    const r = screen.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * term.cols);
    const y = Math.floor(((e.clientY - r.top) / r.height) * term.rows);
    if (x < 0 || y < 0 || x >= term.cols || y >= term.rows) return undefined;
    return { x, y: term.buffer.active.viewportY + y };
  };
  /** The address shown at a cell: the whole wrapped line is read, cell by cell, so wide characters line up. */
  const addressAt = (pos: IBufferCellPosition): string | undefined => {
    const buf = term.buffer.active;
    let top = pos.y;
    while (top > 0 && buf.getLine(top)?.isWrapped) top--;
    let text = "";
    let at = -1;
    for (let y = top, line = buf.getLine(y); line && (y === top || line.isWrapped); line = buf.getLine(++y)) {
      for (let x = 0; x < term.cols; x++) {
        const cell = line.getCell(x);
        if (!cell || cell.getWidth() === 0) continue;
        if (y === pos.y && x <= pos.x) at = text.length;
        text += cell.getChars() || " ";
      }
    }
    return at < 0 ? undefined : urlAt(text, at);
  };
  const forced = (e: MouseEvent) => e.ctrlKey || e.metaKey;
  let pressed: { uri: string; took: boolean } | undefined;
  const down = (e: MouseEvent) => {
    pressed = undefined;
    if (e.button !== 0) return;
    const pos = cellAt(e);
    const uri = (pos && addressAt(pos)) || (forced(e) ? hidden : undefined);
    if (!uri) return;
    const took = forced(e);
    pressed = { uri, took };
    if (took) {
      // ours alone: not the program's, not a selection
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  };
  const up = (e: MouseEvent) => {
    const p = pressed;
    pressed = undefined;
    if (!p || e.button !== 0) return;
    if (p.took) {
      e.preventDefault();
      e.stopImmediatePropagation();
    } else if (term.modes.mouseTrackingMode !== "none") return;
    const pos = cellAt(e);
    const uri = (pos && addressAt(pos)) || (p.took ? hidden : undefined);
    if (uri === p.uri) fire(e, uri);
  };
  // capture: before xterm hands the press to the program or starts a selection
  el.addEventListener("mousedown", down, true);
  el.addEventListener("mouseup", up, true);
  return () => {
    el.removeEventListener("mousedown", down, true);
    el.removeEventListener("mouseup", up, true);
    addon.dispose();
  };
}
