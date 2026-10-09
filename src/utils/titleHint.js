// ─── titleHint.js — "hover a clipped title, see the whole thing" ────────────
//
// Suggestion from a visitor (owner, 2026-10-03): "when hover over the title you
// can make it show full title in search".
//
// Posters are in a grid and titles are one line, so anything longer than the
// column gets an ellipsis — and a card grid can't reflow to fit a name like
// "The Lord of the Rings: The Fellowship of the Ring". The answer is not to make
// every card taller; it is to show the whole title on hover, and ONLY when the
// line is actually being cut. A tooltip that repeats a title the visitor can
// already read is noise, and in a dense grid it is worse than noise.
//
// This file holds the two decisions that can be made without a browser:
// "is this title clipped?" and "where does the bubble go?". The component that
// uses them is components/partials/TitleHint.jsx, and the browser-side details
// (portalling the bubble out of scroll containers, hiding it on scroll) live
// there. tests/title-hover.test.mjs pins all of it.

/** Widest the bubble ever gets. Long titles wrap to two lines instead. */
export const HINT_MAX_WIDTH = 340;

/** Narrowest it ever gets — below this a two-word title wraps absurdly. */
export const HINT_MIN_WIDTH = 140;

/** Keep this far from the viewport edges, so the bubble never touches them. */
export const HINT_MARGIN = 8;

/** Distance between the title and its bubble. */
export const HINT_GAP = 6;

/** Room needed below before the bubble flips above the title instead. */
export const HINT_FLIP_ROOM = 56;

/**
 * Is this line of text wider (or taller) than the box it is in?
 *
 * `truncate` reports itself through scrollWidth; `line-clamp` through
 * scrollHeight. Both are compared with 1px of slack, because sub-pixel layout
 * routinely rounds a line up by a fraction and a title that LOOKS complete must
 * never produce a bubble claiming otherwise.
 *
 * An element that is not laid out at all (display:none, a collapsed
 * container, a card that has not painted yet) reports clientWidth 0 — that is
 * "unknown", not "clipped", so it returns false.
 */
export const isTextClipped = (el) => {
  if (!el) return false;
  const width = Number(el.clientWidth);
  if (!Number.isFinite(width) || width <= 0) return false;
  const height = Number(el.clientHeight);
  const scrolledW = Number(el.scrollWidth);
  const scrolledH = Number(el.scrollHeight);
  const overflowsWidth = Number.isFinite(scrolledW) && scrolledW > width + 1;
  const overflowsHeight =
    Number.isFinite(scrolledH) && Number.isFinite(height) && height > 0 && scrolledH > height + 1;
  return overflowsWidth || overflowsHeight;
};

/** The title as one clean line — JSX indentation must not leak into the bubble. */
export const hintTextOf = (el) =>
  String(el?.textContent || "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Where the bubble goes, from the title's rect and the viewport it sits in.
 *
 *   { left, top, maxWidth, placement } — or null when there is nothing sane to
 *   do (no rect, no viewport), in which case the caller shows no bubble at all.
 *
 * `left` is the CENTRE of the bubble: the component translates itself by -50%,
 * so the bubble is centred on the title and then clamped inside the viewport —
 * a title hugging the left edge of the last column in a grid must not push its
 * bubble off-screen.
 *
 * Below by default (the title sits under its art, so the space below is the one
 * that reads as "attached"), flipping above only when the title is near the
 * bottom of the window and there is genuinely more room up there.
 */
export const placeHint = (rect, viewport) => {
  if (!rect || !viewport) return null;
  const vw = Number(viewport.width);
  const vh = Number(viewport.height);
  if (!Number.isFinite(vw) || !Number.isFinite(vh) || vw <= 0 || vh <= 0) return null;
  const top = Number(rect.top);
  const left = Number(rect.left);
  const width = Number(rect.width);
  const bottom = Number(rect.bottom);
  if (![top, left, width, bottom].every(Number.isFinite)) return null;

  const maxWidth = Math.max(HINT_MIN_WIDTH, Math.min(HINT_MAX_WIDTH, vw - HINT_MARGIN * 2));
  const half = Math.min(maxWidth, vw - HINT_MARGIN * 2) / 2;
  const centre = left + width / 2;
  const clampedLeft = Math.min(Math.max(centre, HINT_MARGIN + half), vw - HINT_MARGIN - half);

  const roomBelow = vh - bottom;
  const roomAbove = top;
  const placement = roomBelow < HINT_FLIP_ROOM && roomAbove > roomBelow ? "above" : "below";

  return {
    left: Math.round(clampedLeft),
    top: Math.round(placement === "below" ? bottom + HINT_GAP : top - HINT_GAP),
    maxWidth: Math.round(maxWidth),
    placement,
  };
};
