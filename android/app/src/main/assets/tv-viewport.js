/*
 * "You are a 1920-wide screen" — the one line of the TV layer that has to run
 * before the engine, and the only honest way to scale a site we do not own.
 *
 * The site ships <meta name="viewport" content="width=device-width">. On a TV
 * that reports density 2 (NVIDIA Shield, some Sony/Bravia panels) the WebView
 * lays out at 960 CSS px and the site picks its TABLET design for a 55-inch
 * screen: huge margins, fewer cards per row, text sized for a hand. Density is
 * a whim of the box, so we normalise it away:
 *
 *   width=1920                      the layout the 10-foot UI was designed at
 *   initial-scale = cssWidth / 1920  so those 1920 units fill the panel exactly
 *
 * Blink re-computes the layout viewport when a viewport meta's content changes,
 * so editing the tag after load works — no page rewrite, no site change, and if
 * the site already removed the meta we add one. The text bump for viewing
 * distance is separate and native (WebSettings.setTextZoom in TvUi.java), so it
 * never compounds through nested em/% rules and cannot break a card layout.
 */
(function () {
  "use strict";
  var DESIGN_WIDTH = __FUMIO_TV_WIDTH__;
  try {
    var cssWidth = window.innerWidth || 0;
    if (cssWidth <= 0) return;
    var scale = cssWidth / DESIGN_WIDTH;
    var meta = document.querySelector('meta[name="viewport"]');
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
  } catch (e) {
    /* a page we cannot measure stays as it is — never worse than before */
  }
})();
