import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { hintTextOf, isTextClipped, placeHint } from "../../utils/titleHint";

/**
 * TitleHint — a title that reveals its full text when the line is cut off.
 *
 * Visitor suggestion relayed by the owner (2026-10-03): "when hover over the
 * title you can make it show full title in search". Card grids truncate a title
 * to one line so every poster in a row stays the same height; this puts the
 * whole name one hover away instead of a trip to the details page.
 *
 * Three rules, and each one exists to keep the feature from becoming annoying:
 *
 *   1. ONLY when the title is actually clipped (utils/titleHint.js decides).
 *      Hovering a title that already fits shows nothing — a bubble repeating
 *      readable text is noise, and in a 7-column grid it is constant noise.
 *   2. The bubble is PORTALLED to <body>. Every row this is used in sits inside
 *      a horizontally scrolling rail (overflow-x-auto clips its children) and
 *      inside cards that scale on hover, so an inline bubble would be cut off or
 *      dragged around exactly when it is needed.
 *   3. It disappears on scroll, resize or Escape. A fixed-position bubble is
 *      stale the instant anything moves underneath it.
 *
 * Accessibility: the full title is already the element's own text, so it is
 * already in the accessibility tree and read out by a screen reader — the
 * bubble is decoration for sighted hover users, which is why it is
 * aria-hidden and pointer-events-none (it must never eat the click that opens
 * the title it is describing). No tabIndex is added: this component never
 * inserts a tab stop, and keyboard users need no bubble to read text they can
 * already reach.
 *
 * Note: no native `title` attribute, deliberately — the browser's own tooltip
 * would appear a second later underneath this one.
 */
const TitleHint = ({ as, className = "", children, ...rest }) => {
  // Assigned to an uppercase local rather than destructured as `as: Tag`,
  // because this repo's eslint config has no react/jsx-uses-vars: variables that
  // appear only as a JSX tag are not seen as "used", and `varsIgnorePattern:
  // ^[A-Z_]` is the escape hatch the config already provides for exactly that.
  const Tag = as || "h3";
  const ref = useRef(null);
  const [hint, setHint] = useState(null); // { text, left, top, maxWidth, placement }

  const hide = useCallback(() => setHint(null), []);

  const show = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (!isTextClipped(el)) return; // rule 1
    const text = hintTextOf(el);
    if (!text) return;
    const placed = placeHint(el.getBoundingClientRect(), {
      width: window.innerWidth,
      height: window.innerHeight,
    });
    if (!placed) return;
    setHint({ text, ...placed });
  }, []);

  useEffect(() => {
    if (!hint) return undefined;
    const off = () => setHint(null);
    const onKey = (event) => {
      if (event.key === "Escape") off();
    };
    // `capture: true` — the rails this sits in scroll inside their own overflow
    // container, and those scroll events do not bubble to the window.
    window.addEventListener("scroll", off, true);
    window.addEventListener("resize", off);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", off, true);
      window.removeEventListener("resize", off);
      window.removeEventListener("keydown", onKey);
    };
  }, [hint]);

  return (
    <>
      <Tag
        {...rest}
        ref={ref}
        className={className}
        onPointerEnter={show}
        onPointerLeave={hide}
        onPointerCancel={hide}
      >
        {children}
      </Tag>
      {hint &&
        createPortal(
          <span
            role="tooltip"
            aria-hidden="true"
            data-title-hint=""
            className="pointer-events-none fixed z-[150] rounded-lg border border-white/15 bg-black/95 px-2.5 py-1.5 text-[11px] font-semibold leading-snug text-white shadow-[0_10px_30px_rgba(0,0,0,0.65)] backdrop-blur-sm"
            style={{
              left: hint.left,
              top: hint.top,
              maxWidth: hint.maxWidth,
              transform: hint.placement === "below" ? "translate(-50%, 0)" : "translate(-50%, -100%)",
            }}
          >
            {hint.text}
          </span>,
          document.body
        )}
    </>
  );
};

export default TitleHint;
