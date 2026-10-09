import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  canScrollLeft,
  canScrollRight,
  isDrag,
  isNearEnd,
  keyDirection,
  pageStep,
  wheelDirection,
  wheelStep,
} from "../../utils/horizontalScroll";

// ─── ScrollRow — a horizontal row a mouse can actually drive ─────────────────
//
// Every content row in the app (.gtv-row) was swipe-only for practical
// purposes: the scrollbar is hidden and a mouse wheel over a row did nothing.
// On a phone that is fine. On a desktop it meant "horizontal scrolling never
// works" — the row looked frozen unless you knew about Shift+wheel.
//
// This wraps a row and gives it the four things a PC user will try:
//
//   1. the mouse wheel moves the row (until the row ends — then the page scrolls
//      on, so a short row can never trap the page),
//   2. arrow buttons, revealed on hover, that page and hide at the ends,
//   3. click-and-drag, the way you would drag a photo strip (a drag never
//      counts as a click on the card underneath),
//   4. ← / → when the row has keyboard focus.
//
// Touch behaviour is untouched: on a touch device the native swipe does the
// work, and the arrows stay hidden (see .gtv-arrow in index.css).
const ScrollRow = ({
  children,
  className = "",
  label = "Content",
  wrapClassName = "",
  // Some callers are sometimes a grid and sometimes a rail (e.g. Trending
  // Searches on /search). enabled={false} renders the children in one plain
  // element: no wrapper, no arrows, no wheel/drag handlers — so a grid stays a
  // grid instead of inheriting the rail's flex rules.
  enabled = true,
  // Horizontal paging. When the rail is scrolled within END_REACHED_SLACK of
  // its right edge, this fires — the row asks for more titles instead of just
  // stopping (owner, 2026-10-07: "infinite horizontal scrolling untill the
  // titles end"). Optional: a rail without it behaves exactly as before.
  onEndReached,
  ...rest
}) => {
  const rowRef = useRef(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const plain = !enabled;
  const drag = useRef({ active: false, moved: false, startX: 0, startY: 0, startLeft: 0 });

  // Held in a ref so the scroll listener below is attached once and never
  // re-bound just because the parent re-rendered with a new closure.
  const endRef = useRef(onEndReached);
  endRef.current = onEndReached;

  const sync = useCallback(() => {
    const el = rowRef.current;
    if (!el) return;
    const left = canScrollLeft(el);
    const right = canScrollRight(el);
    setEdges((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
    if (endRef.current && isNearEnd(el)) endRef.current();
  }, []);

  // Arrow visibility follows the scroll position and the content size.
  useEffect(() => {
    const el = rowRef.current;
    if (!el) return undefined;
    sync();
    el.addEventListener("scroll", sync, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(sync) : null;
    ro?.observe(el);
    window.addEventListener("resize", sync);
    return () => {
      el.removeEventListener("scroll", sync);
      ro?.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, [sync, children]);

  // (1) the wheel. React's onWheel is passive at the root, so the listener must
  // be attached by hand to be allowed to preventDefault.
  useEffect(() => {
    const el = rowRef.current;
    if (!el) return undefined;
    const onWheel = (event) => {
      // Ctrl/⌘+wheel is browser zoom; Shift+wheel is the browser's own
      // horizontal scroll. Never take those away.
      if (event.ctrlKey || event.metaKey || event.shiftKey) return;
      const dir = wheelDirection({
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        canLeft: canScrollLeft(el),
        canRight: canScrollRight(el),
      });
      // 0 means "nowhere to go": let the page have the gesture, so a row at its
      // end scrolls the page instead of swallowing the wheel.
      if (!dir) return;
      const step = wheelStep({ deltaX: event.deltaX, deltaY: event.deltaY, deltaMode: event.deltaMode });
      event.preventDefault();
      el.scrollLeft += dir * step;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // (3) drag to scroll. Mouse only — a touch pointer already swipes natively,
  // and hijacking it would fight the browser's own scrolling.
  const onPointerDown = (event) => {
    if (plain || event.pointerType !== "mouse" || event.button !== 0) return;
    const el = rowRef.current;
    drag.current = { active: true, moved: false, startX: event.clientX, startY: event.clientY, startLeft: el.scrollLeft };
  };

  const onPointerMove = (event) => {
    const el = rowRef.current;
    if (!el || !drag.current.active) return;
    if (!drag.current.moved && isDrag(drag.current.startX, drag.current.startY, event.clientX, event.clientY)) {
      drag.current.moved = true;
      el.classList.add("gtv-row-dragging");
      el.style.userSelect = "none";
    }
    if (drag.current.moved) {
      el.scrollLeft = drag.current.startLeft - (event.clientX - drag.current.startX);
    }
  };

  const endDrag = () => {
    const el = rowRef.current;
    drag.current.active = false;
    if (el) {
      el.classList.remove("gtv-row-dragging");
      el.style.userSelect = "";
    }
  };

  // The cards are <a> elements, so a mouse drag over one starts the BROWSER's
  // native link-drag: it takes over the gesture, the pointer stream stops, and
  // the row freezes exactly as if the feature were not there. Cancelling
  // dragstart is what makes drag-to-scroll work on a rail full of links (and it
  // stops a stray drag from dropping a URL somewhere).
  const onDragStart = (event) => {
    if (!plain) event.preventDefault();
  };

  // A drag that ends on a card must not open it. Captured so it stops before
  // the Link/button inside ever sees the click.
  const onClickCapture = (event) => {
    if (!drag.current.moved) return;
    drag.current.moved = false;
    event.preventDefault();
    event.stopPropagation();
  };

  const onKeyDown = (event) => {
    const dir = keyDirection(event.key);
    if (!dir) return;
    const el = rowRef.current;
    event.preventDefault();
    el.scrollBy({ left: dir * pageStep(el), behavior: "smooth" });
  };

  const scrollByPage = (dir) => {
    const el = rowRef.current;
    el?.scrollBy({ left: dir * pageStep(el), behavior: "smooth" });
  };

  if (plain) {
    return <div className={className}>{children}</div>;
  }

  return (
    <div className={`gtv-scroll-wrap relative ${wrapClassName}`}>
      <ScrollArrow side="left" disabled={!edges.left} onClick={() => scrollByPage(-1)} label={label} />
      <div
        ref={rowRef}
        className={`gtv-row ${className}`}
        tabIndex={0}
        role="group"
        aria-label={label}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        onPointerCancel={endDrag}
        onDragStart={onDragStart}
        onClickCapture={onClickCapture}
        onKeyDown={onKeyDown}
        {...rest}
      >
        {children}
      </div>
      <ScrollArrow side="right" disabled={!edges.right} onClick={() => scrollByPage(1)} label={label} />
    </div>
  );
};

const ScrollArrow = ({ side, disabled, onClick, label }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-label={`Scroll ${label} ${side === "left" ? "left" : "right"}`}
    aria-hidden={disabled ? "true" : undefined}
    tabIndex={-1}
    className={`gtv-arrow gtv-arrow-${side} ${disabled ? "gtv-arrow-off" : ""}`}
  >
    <i className={side === "left" ? "ri-arrow-left-s-line" : "ri-arrow-right-s-line"} />
  </button>
);

export default ScrollRow;
