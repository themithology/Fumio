// ─── horizontal row scrolling, for people with a mouse ──────────────────────
//
// The rows are `overflow-x: auto` with the scrollbar HIDDEN (.gtv-no-scrollbar),
// which is fine on a phone — you swipe, it moves. On a desktop with a mouse it
// meant the row could only be moved with Shift+wheel or a trackpad flick, and
// nothing on screen said so. A mouse wheel over a row did NOTHING.
//
// These helpers are the decision logic, kept pure so they can be tested without
// a browser. ScrollRow.jsx wires them to real elements.

/** Sub-pixel slack: layout rounding leaves scrollLeft at 0.4 instead of 0. */
export const EDGE_SLACK = 2;

export const canScrollLeft = (el) => !!el && el.scrollLeft > EDGE_SLACK;

export const canScrollRight = (el) =>
  !!el && el.scrollLeft + el.clientWidth < el.scrollWidth - EDGE_SLACK;

/**
 * How close to the right edge counts as "the visitor has reached the end".
 *
 * Measured in pixels of remaining scroll, not cards, because a rail's card
 * width changes with the breakpoint. ~600px is roughly three posters on a
 * phone and two on a desktop: enough warning that the next page is usually
 * in before the visitor gets there, so the rail never visibly stops.
 */
export const END_REACHED_SLACK = 600;

/**
 * Is this rail scrolled far enough right to ask for the next page?
 *
 * Owner, 2026-10-07: "infinite horizontal scrolling untill the titles end".
 * A rail that cannot scroll at all (everything fits) is NOT at its end — it
 * never got a gesture, and auto-loading into a rail nobody has touched would
 * fetch pages for a search the visitor is not even looking at.
 */
export const isNearEnd = (el, slack = END_REACHED_SLACK) => {
  if (!el) return false;
  const max = el.scrollWidth - el.clientWidth;
  if (max <= EDGE_SLACK) return false; // nothing to scroll: not an "end"
  return max - el.scrollLeft <= slack;
};

/**
 * What should a wheel event over this row do?
 *
 *   +1 scroll the row right · -1 scroll the row left · 0 leave it to the page
 *
 * The "0 at the ends" rule is the important one: a row must never TRAP the
 * page. Wheel down over a row that can still move → the row moves; wheel down
 * once it is at its end → the page scrolls on, exactly as before.
 */
export const wheelDirection = ({ deltaX = 0, deltaY = 0, canLeft = false, canRight = false } = {}) => {
  // A predominantly horizontal gesture (trackpad two-finger, tilt wheel) is
  // already a request to move sideways.
  if (Math.abs(deltaX) > Math.abs(deltaY)) {
    if (deltaX > 0) return canRight ? 1 : 0;
    if (deltaX < 0) return canLeft ? -1 : 0;
    return 0;
  }
  if (deltaY > 0) return canRight ? 1 : 0;
  if (deltaY < 0) return canLeft ? -1 : 0;
  return 0;
};

/**
 * How far one wheel notch should move the row. Browsers report pixels
 * (deltaMode 0) or lines (deltaMode 1, Firefox with some mice) — a line is
 * about 16px. Never returns 0, or a notch would do nothing.
 */
export const wheelStep = ({ deltaX = 0, deltaY = 0, deltaMode = 0 } = {}) => {
  const raw = Math.abs(deltaX) > Math.abs(deltaY) ? Math.abs(deltaX) : Math.abs(deltaY);
  const px = deltaMode === 1 ? raw * 16 : raw;
  return Math.max(24, Math.round(px));
};

/**
 * How far the arrow buttons page the row: a bit less than one viewport so the
 * card that was at the right edge stays visible and the eye keeps its place.
 */
export const pageStep = (el, fraction = 0.85) => {
  const width = el?.clientWidth || 0;
  return Math.max(200, Math.round(width * fraction));
};

/** Keyboard arrows: how far, and in which direction. Same shape as the wheel. */
export const keyDirection = (key) => {
  if (key === "ArrowRight") return 1;
  if (key === "ArrowLeft") return -1;
  return 0;
};

/** Was this pointer gesture a drag (a scroll) rather than a click on a card? */
export const isDrag = (startX, startY, x, y, threshold = 6) =>
  Math.abs(x - startX) > threshold || Math.abs(y - startY) > threshold;

// ─── finding the rail under the pointer, without wrapping every one of them ──
//
// ScrollRow gives the content rails their arrows. But the app also has strips
// nobody wrapped — the Live TV channel bars, the party room's lists, the
// schedule day tabs — and any rail added tomorrow. DesktopRowDriver installs one
// set of document-level listeners and walks UP from whatever the mouse is over
// to find the rail it belongs to. These are the decisions that walk makes; they
// are plain functions of the numbers and styles so they can be tested without a
// browser (see tests/horizontal-scroll.test.mjs).

/** Browsers report the scrollable cases in `overflow-x`/`overflow-y`. */
export const SCROLLABLE_OVERFLOW = new Set(["auto", "scroll", "overlay"]);

const defaultStyleOf = (el) =>
  typeof getComputedStyle === "function" && el ? getComputedStyle(el) : null;

const isRoot = (el) => {
  const doc = el?.ownerDocument;
  return !el || el === doc?.body || el === doc?.documentElement;
};

/** Is this element a horizontal rail — it overflows sideways and scrolls there? */
export const isHorizontalRail = (el, styleOf = defaultStyleOf) => {
  if (isRoot(el)) return false;
  if (!el.clientWidth || !el.clientHeight) return false;
  if (el.scrollWidth - el.clientWidth <= EDGE_SLACK) return false;
  const style = styleOf(el);
  return !!style && SCROLLABLE_OVERFLOW.has(style.overflowX);
};

/** Is this element a vertical scroller that still has room to move? */
export const canScrollVertically = (el, deltaY) =>
  deltaY > 0
    ? el.scrollTop + el.clientHeight < el.scrollHeight - EDGE_SLACK
    : el.scrollTop > EDGE_SLACK;

export const isVerticalScroller = (el, styleOf = defaultStyleOf) => {
  if (isRoot(el)) return false;
  if (!el.clientHeight) return false;
  if (el.scrollHeight - el.clientHeight <= EDGE_SLACK) return false;
  const style = styleOf(el);
  return !!style && SCROLLABLE_OVERFLOW.has(style.overflowY);
};

/**
 * Which element should a gesture on `node` move?
 *
 *   dir = +1 (right/down) or -1 (left/up), 0 = "whichever way it can"
 *
 * Walks up the tree and answers with the first horizontal rail that can still
 * move that way. Two rules matter:
 *
 *   • a vertical scroller that can still consume a vertical gesture WINS — a
 *     rail inside a scrollable panel (a modal, a drawer) must not steal the
 *     scroll that panel needs. The page itself is not such a scroller, so
 *     outside those panels a vertical wheel over a rail still moves the rail;
 *   • nothing found → null → the caller leaves the event alone, so the page
 *     scrolls exactly as it always did (a rail at its end never traps a page).
 */
export const railFor = (node, dir, { deltaY = 0, styleOf = defaultStyleOf } = {}) => {
  const chain = [];
  let el = node;
  while (el && !isRoot(el)) {
    chain.push(el);
    el = el.parentElement;
  }
  if (deltaY) {
    const panel = chain.find((n) => isVerticalScroller(n, styleOf) && canScrollVertically(n, deltaY));
    if (panel) return null;
  }
  for (const candidate of chain) {
    if (!isHorizontalRail(candidate, styleOf)) continue;
    const canMove =
      dir === 0 ? canScrollLeft(candidate) || canScrollRight(candidate) : dir > 0 ? canScrollRight(candidate) : canScrollLeft(candidate);
    if (canMove) return candidate;
  }
  return null;
};

/** The nearest horizontal rail above `node`, movement aside — drag and keys. */
export const nearestRail = (node, styleOf = defaultStyleOf) => {
  let el = node;
  while (el && !isRoot(el)) {
    if (isHorizontalRail(el, styleOf)) return el;
    el = el.parentElement;
  }
  return null;
};
