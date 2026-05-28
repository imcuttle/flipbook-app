// Hotspot layout helpers.
//
// The server-supplied anchor_xy is a hint, but cards may overlap when they're
// densely placed or when the server is ignorant of card sizes. We do a simple
// post-layout pass on the client:
//   1) For each hotspot, treat anchor as the card top-left.
//   2) If the projected card box collides with an already-placed card, push
//      it in the dominant axis until it no longer collides (or hits the
//      stage edge, then we wrap to the next available slot).
//   3) Leader endpoint is preserved exactly — we only move the card.

import type { Hotspot } from '../state/types';

// Card dimensions in PERCENT of stage width / height.
// Stage aspect ratio is 16:9, so we approximate sizes in normalized coords.
const CARD_W = 0.18;     // ~ 18% of stage width
const CARD_H = 0.06;     // ~ 6% of stage height (single-line label)
const PADDING = 0.012;   // gap between cards

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function rect(ax: number, ay: number) {
  return { x: ax, y: ay, w: CARD_W, h: CARD_H };
}

function overlaps(a: ReturnType<typeof rect>, b: ReturnType<typeof rect>): boolean {
  return !(
    a.x + a.w + PADDING <= b.x ||
    b.x + b.w + PADDING <= a.x ||
    a.y + a.h + PADDING <= b.y ||
    b.y + b.h + PADDING <= a.y
  );
}

export function layOutHotspots(hotspots: Hotspot[]): { anchor: [number, number]; leader: [number, number]; idx: number }[] {
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  const out: { anchor: [number, number]; leader: [number, number]; idx: number }[] = [];

  hotspots.forEach((h, idx) => {
    let ax = clamp(h.anchor_xy?.[0] ?? 0, 0.01, 0.99 - CARD_W);
    let ay = clamp(h.anchor_xy?.[1] ?? 0, 0.01, 0.99 - CARD_H);
    const lx = clamp(h.leader_xy?.[0] ?? ax, 0, 1);
    const ly = clamp(h.leader_xy?.[1] ?? ay, 0, 1);

    let cur = rect(ax, ay);
    let attempts = 0;
    while (placed.some((p) => overlaps(cur, p)) && attempts < 16) {
      // Find a colliding rect; push past it in the axis with smaller overlap
      const collider = placed.find((p) => overlaps(cur, p))!;
      const dxRight = collider.x + collider.w + PADDING - cur.x;
      const dyDown = collider.y + collider.h + PADDING - cur.y;
      const dxLeft = cur.x + cur.w + PADDING - collider.x;
      const dyUp = cur.y + cur.h + PADDING - collider.y;
      const minHorizPush = Math.min(Math.abs(dxRight), Math.abs(dxLeft));
      const minVertPush = Math.min(Math.abs(dyDown), Math.abs(dyUp));
      if (minVertPush <= minHorizPush) {
        // push down preferred (more space at bottom usually)
        ay = clamp(collider.y + collider.h + PADDING, 0.01, 0.99 - CARD_H);
        if (ay >= 0.99 - CARD_H - 0.001) {
          // wrap: shift right and reset y
          ax = clamp(ax + CARD_W + PADDING, 0.01, 0.99 - CARD_W);
          ay = 0.01;
        }
      } else {
        ax = clamp(collider.x + collider.w + PADDING, 0.01, 0.99 - CARD_W);
        if (ax >= 0.99 - CARD_W - 0.001) {
          ax = 0.01;
          ay = clamp(ay + CARD_H + PADDING, 0.01, 0.99 - CARD_H);
        }
      }
      cur = rect(ax, ay);
      attempts++;
    }
    placed.push(cur);
    out.push({ anchor: [ax, ay], leader: [lx, ly], idx });
  });

  return out;
}
