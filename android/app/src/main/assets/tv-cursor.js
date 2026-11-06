/*
 * Pointer helpers for the TV build: "what is under the cursor?" and "click it".
 *
 * The remote is a mouse now (TvPointer.java). A mouse with no feedback is
 * miserable, so this file answers two questions for the native side:
 *
 *   FumioTvHover(x, y)  → is there something clickable under this point?
 *                         If yes it is marked, and CSS draws a thin outline, so
 *                         the viewer always knows what OK will do.
 *   FumioTvClick()      → click that thing, as a real DOM click, which is what
 *                         React / Next / plain onClick handlers all understand.
 *
 * The reason to look for an ANCESTOR rather than trust the pixel: a card is
 * usually an <a> or a <div onClick> wrapping an image and a caption, and the
 * cursor lands on the image. Walking up to the nearest actionable element makes
 * the click forgiving — you aim at a poster, not at a 2-pixel handle.
 *
 * This file is injected on the live website AND on the app's own player page.
 * It changes no layout and no site style of its own: the only CSS it adds is the
 * outline for the currently targeted element.
 */
(function () {
  "use strict";
  if (window.__fumioTvCursor) return;
  window.__fumioTvCursor = true;

  var TARGET_CLASS = "fumio-tv-target";
  var native = window.FumioNative || null;
  var current = null;
  var inputFocused = false;

  // What counts as "clickable" without asking the page. Deliberately broad: a
  // false positive costs one outline, a false negative makes a control
  // unreachable.
  var ACTIONABLE =
    'a[href],button,[role="button"],[role="link"],[role="tab"],[role="menuitem"],' +
    '[onclick],[tabindex]:not([tabindex="-1"]),input:not([type="hidden"]),' +
    "select,textarea,label,summary,audio,video,iframe,object,embed,canvas";

  function style() {
    if (document.getElementById("fumio-tv-css")) return;
    var css =
      "html.fumio-tv,html.fumio-tv *{scroll-behavior:auto!important;" +
      "-webkit-tap-highlight-color:transparent;}" +
      "html.fumio-tv ." +
      TARGET_CLASS +
      "{outline:2px solid rgba(255,255,255,.75)!important;" +
      "outline-offset:3px!important;border-radius:6px;" +
      "transition:outline-offset 90ms ease-out;}" +
      "html.fumio-tv input:focus,html.fumio-tv textarea:focus{" +
      "outline:2px solid rgba(255,212,0,.9)!important;outline-offset:2px!important;}";
    var tag = document.createElement("style");
    tag.id = "fumio-tv-css";
    tag.textContent = css;
    (document.head || document.documentElement).appendChild(tag);
    document.documentElement.classList.add("fumio-tv");
  }

  function actionable(from) {
    // PASS 1 — real controls, nearest ancestor first. This runs before the
    // cursor heuristic on purpose: `cursor` is an INHERITED property, so every
    // child of a link computes `pointer` too. Testing the cursor first would
    // make the poster image its own target instead of the card around it.
    var el = from;
    while (el && el.nodeType === 1) {
      try {
        if (el.matches && el.matches(ACTIONABLE)) return el;
      } catch (e) {
        /* a detached node mid-render */
      }
      el = el.parentElement;
    }
    // PASS 2 — a card the site built as a plain div. Only reached when no real
    // control is anywhere above the hit, so the pointer cursor here really is
    // the page saying "this is clickable".
    el = from;
    while (el && el.nodeType === 1 && el !== document.documentElement) {
      try {
        var cs = getComputedStyle(el);
        if (cs && cs.cursor === "pointer") return el;
      } catch (e) {
        /* ignore */
      }
      el = el.parentElement;
    }
    return null;
  }

  /**
   * The point a tap should land on: the CENTRE of the outlined element, as
   * fractions of the viewport. Published to native on every target change, so a
   * click never needs a round trip and never uses a stale coordinate.
   */
  function tapPointOf(el) {
    try {
      if (!el || !el.isConnected) return "";
      var r = el.getBoundingClientRect();
      if (!r || r.width < 1 || r.height < 1) return "";
      var size = viewportSize();
      if (!size.w || !size.h) return "";
      var cx = Math.max(0, Math.min(size.w - 1, r.left + r.width / 2));
      var cy = Math.max(0, Math.min(size.h - 1, r.top + r.height / 2));
      return (cx / size.w).toFixed(6) + "," + (cy / size.h).toFixed(6);
    } catch (e) {
      return "";
    }
  }

  var lastPublished = null;
  function publishTarget(el) {
    var point = tapPointOf(el);
    // Re-publishing matters even when the TARGET has not changed: scrolling the
    // page moves it, and a cached coordinate would tap where the card used to
    // be. Only a changed string costs a bridge call.
    if (point === lastPublished) return;
    lastPublished = point;
    try {
      if (native && native.tvTarget) native.tvTarget(point);
    } catch (e) {
      /* bridge is optional */
    }
  }

  function mark(el) {
    // The document itself is never a target: `cursor: pointer` on <body> would
    // otherwise outline the entire page and swallow every click.
    if (el && (el === document.body || el === document.documentElement)) el = null;
    if (el === current) {
      publishTarget(current); // same element, possibly a new position
      return;
    }
    if (current) {
      try {
        current.classList.remove(TARGET_CLASS);
      } catch (e) {
        /* ignore */
      }
    }
    current = el && el.isConnected ? el : null;
    if (current) {
      try {
        current.classList.add(TARGET_CLASS);
      } catch (e) {
        /* ignore */
      }
    }
    publishTarget(current);
  }

  // ─── the API the native side calls ──────────────────────────────────────
  //
  // COORDINATES. The native side never sends pixels, it sends FRACTIONS of the
  // WebView's box (0..1) — because the page's own coordinate space is not the
  // same as the view's:
  //
  //   • the layout viewport can be 1920 CSS px wide on a screen with 1280 view
  //     px (the TV viewport normalisation), so a pixel is not a CSS pixel;
  //   • `elementFromPoint` takes CLIENT coordinates, which ignore page scroll,
  //     while a point in the view is where the finger is — so once the page is
  //     scrolled, the two disagree by exactly the scroll offset;
  //   • density, zoom and text zoom all move the ratio as well.
  //
  // A fraction survives every one of those, because the page divides its own
  // viewport by the same fraction. (The first version passed view pixels and
  // worked only on unscrolled pages at scale 1 — which is exactly the bug where
  // the home page responded and a scrolled season rail did not.)

  function viewportSize() {
    var de = document.documentElement || {};
    var w = de.clientWidth || window.innerWidth || 0;
    var h = de.clientHeight || window.innerHeight || 0;
    return { w: w, h: h };
  }

  function toClient(fx, fy) {
    var size = viewportSize();
    var x = Math.max(0, Math.min(size.w - 1, fx * size.w));
    var y = Math.max(0, Math.min(size.h - 1, fy * size.h));
    return { x: x, y: y };
  }

  /** Back to fractions, for anything the native side has to tap. */
  function toFraction(x, y) {
    var size = viewportSize();
    return { fx: size.w ? x / size.w : 0, fy: size.h ? y / size.h : 0 };
  }

  window.FumioTvHoverF = function (fx, fy) {
    try {
      style();
      var point = toClient(fx, fy);
      var hit = document.elementFromPoint(point.x, point.y);
      if (!hit) {
        mark(null);
        return false;
      }
      var target = actionable(hit);
      mark(target);
      return !!target;
    } catch (e) {
      return false;
    }
  };

  /**
   * Where to tap, as fractions of the viewport: the CENTRE of the outlined
   * target, not the cursor's pixel. That is the forgiveness — aim at a poster,
   * tap the card — and it keeps working now that a click is a real touch.
   * Returns "" when nothing is targeted.
   */
  window.FumioTvTapPoint = function () {
    return tapPointOf(current);
  };

  /**
   * Clicks are TAPS now (see the native side): a real touch at this point, which
   * the page turns into pointerdown/pointerup/click itself. Kept for the case
   * where native has no touch to give — and because a DOM click is the only way
   * to activate a <label> that toggles a hidden input on some frameworks.
   */
  window.FumioTvClick = function () {
    style();
    var el = current && current.isConnected ? current : null;
    if (!el) return false;
    try {
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable) {
        el.focus();
        el.click();
        return true;
      }
      el.click();
      return true;
    } catch (e) {
      return false;
    }
  };

  /** Kept for older callers: hover by pixels, then click. */
  window.FumioTvHover = function (x, y) {
    var size = viewportSize();
    return window.FumioTvHoverF(size.w ? x / size.w : 0, size.h ? y / size.h : 0);
  };

  window.FumioTvTarget = function () {
    return !!(current && current.isConnected);
  };

  /** Same answer as FumioTvTarget, named for diagnostics. */
  window.FumioTvVisibleTarget = function () {
    return !!(current && current.isConnected);
  };

  /** Which way the page can still scroll, so native knows when to nudge. */
  window.FumioTvScrollable = function () {
    try {
      var de = document.documentElement;
      var body = document.body || de;
      return JSON.stringify({
        x: (document.scrollingElement || de).scrollWidth - window.innerWidth > 4,
        y: Math.max(de.scrollHeight, body.scrollHeight) - window.innerHeight > 4,
      });
    } catch (e) {
      return '{"x":false,"y":false}';
    }
  };

  // ─── hand the remote to the keyboard while typing ───────────────────────

  function reportInput() {
    var el = document.activeElement;
    var typing =
      !!el &&
      (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable === true);
    if (typing === inputFocused) return;
    inputFocused = typing;
    try {
      if (native && native.tvInputFocused) native.tvInputFocused(typing);
    } catch (e) {
      /* bridge is optional */
    }
  }
  document.addEventListener("focusin", reportInput, true);
  document.addEventListener("focusout", function () {
    setTimeout(reportInput, 0);
  }, true);

  // A page that re-renders under the cursor (SPA route change) must not leave a
  // stale outline on a dead node.
  try {
    new MutationObserver(function () {
      if (current && !current.isConnected) mark(null);
    }).observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {
    /* observer optional */
  }

  style();
})();
