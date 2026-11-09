// PADS edge crossing: which device sits past each edge of a screen, from the PADS Manager's room layout. A device's
// card is its screen at a fixed scale, placed where you arranged it, so "the device to my right" is the card whose
// left edge is near this one's right edge and that overlaps it vertically (and so on for the other sides).

export type Side = "left" | "right" | "top" | "bottom";
export type Rect = { id: string; x: number; y: number; w: number; h: number };

/** How far apart two cards' edges may be (in layout units) and still count as touching. */
export const NEAR = 60;

export const opposite: Record<Side, Side> = { left: "right", right: "left", top: "bottom", bottom: "top" };

/** The device past `side` of `from`, at `t` (0–1 along that edge), and where on its own facing edge you'd arrive. */
export function neighbour(rects: Rect[], fromId: string, side: Side, t: number): { id: string; t: number } | null {
  const a = rects.find((r) => r.id === fromId);
  if (!a) return null;
  const tt = Math.min(1, Math.max(0, t));
  const along = side === "left" || side === "right";
  // the point on a's edge, in layout units
  const px = side === "right" ? a.x + a.w : side === "left" ? a.x : a.x + tt * a.w;
  const py = side === "bottom" ? a.y + a.h : side === "top" ? a.y : a.y + tt * a.h;
  let best: { id: string; t: number; d: number } | null = null;
  for (const b of rects) {
    if (b.id === a.id) continue;
    // the gap between a's edge and b's facing edge (negative when they overlap a little: still fine)
    const gap = side === "right" ? b.x - px : side === "left" ? px - (b.x + b.w) : side === "bottom" ? b.y - py : py - (b.y + b.h);
    if (gap < -NEAR || gap > NEAR) continue;
    // how far the point is past b's span along the edge (0 when it's within it)
    const lo = along ? b.y : b.x;
    const len = along ? b.h : b.w;
    const p = along ? py : px;
    const off = p < lo ? lo - p : p > lo + len ? p - (lo + len) : 0;
    if (off > NEAR / 2) continue;
    const d = Math.abs(gap) + off * 2;
    if (!best || d < best.d) best = { id: b.id, t: Math.min(1, Math.max(0, (p - lo) / len)), d };
  }
  return best ? { id: best.id, t: best.t } : null;
}

/** Which edge a point has reached, if any (in a screen of width w and height h, within `margin` pixels). */
export function edgeAt(x: number, y: number, w: number, h: number, margin = 1): { side: Side; t: number } | null {
  if (x <= margin) return { side: "left", t: y / h };
  if (x >= w - 1 - margin) return { side: "right", t: y / h };
  if (y <= margin) return { side: "top", t: x / w };
  if (y >= h - 1 - margin) return { side: "bottom", t: x / w };
  return null;
}

/** Where you arrive on a screen of width w and height h, coming in through `side` at `t`. */
export function arrival(side: Side, t: number, w: number, h: number, inset = 4): { x: number; y: number } {
  const tt = Math.min(1, Math.max(0, t));
  if (side === "left") return { x: inset, y: tt * (h - 1) };
  if (side === "right") return { x: w - 1 - inset, y: tt * (h - 1) };
  if (side === "top") return { x: tt * (w - 1), y: inset };
  return { x: tt * (w - 1), y: h - 1 - inset };
}
