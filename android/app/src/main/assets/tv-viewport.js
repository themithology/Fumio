/*
 * "You are a 1920-wide screen" — for the LIVE WEBSITE ONLY.
 *
 * There is no such thing as a television viewport. The same 1080p panel reports
 * density 1 on one box and density 2 on another (NVIDIA Shield, several Sony
 * models), so the page lays out at 1920 CSS px on the first and 960 on the
 * second — and the site, seeing 960, renders its TABLET design on a 55-inch
 * screen: giant margins, half the cards per row, text sized for a hand.
 *
 * Normalising that away means telling the page it is 1920 wide and letting the
 * scale factor fill the panel:
 *
 *   width=1920, initial-scale = cssWidth / 1920
 *
 * Blink re-computes the layout viewport when a viewport meta's content changes,
 * so this works after load, without touching the site.
 *
 * ─── TWO GUARDS, because this is a page we do not own ──────────────────────
 *
 * 1. NEVER on our own pages. This file is only injected into the live site. Our
 *    player is a normal responsive app and must keep the device's real viewport
 *    — an earlier version applied the rewrite there too, and the result was a
 *    1920-wide layout inside a smaller visual viewport: the player was cut in
 *    half (screenshot of 2026-11-05). `location.hostname` is the last line of
 *    defence in case an injection path is ever added back by mistake.
 *
 * 2. REVERT IF IT OVERFLOWS. `initial-scale` can be clamped by the WebView (min
 *    zoom, accessibility settings, odd densities), and then the layout is wider
 *    than the picture again. So after applying we measure: if the document is
 *    wider than the visible viewport, put the original meta back and leave the
 *    page exactly as the site wanted it. Wrong-but-readable beats
 *    right-but-clipped.
 */
(function () {
  "use strict";
  var DESIGN_WIDTH = __FUMIO_TV_WIDTH__;
  try {
    if (location && location.hostname === "localhost") return;

    var meta = document.querySelector('meta[name="viewport"]');
    var original = meta ? meta.getAttribute("content") : null;

    var cssWidth = window.innerWidth || 0;
    var cssHeight = window.innerHeight || 0;
    if (cssWidth <= 0) return;

    // A portrait or square window is not a television — some boxes report a
    // square window while an app's splash is up. Do nothing rather than guess.
    if (cssHeight > 0 && cssWidth / cssHeight < 1.2) return;

    var scale = cssWidth / DESIGN_WIDTH;
    // Nothing sane lives outside this band; outside it, leave the page alone.
    if (!(scale > 0.2 && scale < 2)) return;

    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "viewport");
      (document.head || document.documentElement).appendChild(meta);
    }
    meta.setAttribute(
      "content",
      "width=" +
        DESIGN_WIDTH +
        ", initial-scale=" +
        scale.toFixed(4) +
        ", minimum-scale=" +
        (scale * 0.5).toFixed(4) +
        ", maximum-scale=" +
        (scale * 2).toFixed(4)
    );

    // Guard 2: did it actually take? The layout viewport is only correct if the
    // document is not wider than what we can see.
    setTimeout(function () {
      try {
        var doc = document.scrollingElement || document.documentElement;
        var overflow = doc.scrollWidth - window.innerWidth;
        if (overflow > window.innerWidth * 0.02) {
          if (original == null) meta.parentNode && meta.parentNode.removeChild(meta);
          else meta.setAttribute("content", original);
        }
      } catch (e) {
        /* a measurement we cannot take is not a reason to change anything */
      }
    }, 700);
  } catch (e) {
    /* a page we cannot measure stays as it is — never worse than before */
  }
})();
