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
    "select,textarea,label,summary,audio[controls],video[controls]";

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

  function mark(el) {
    if (el === current) return;
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
  }

  // ─── the API the native side calls ──────────────────────────────────────

  window.FumioTvHover = function (x, y) {
    try {
      style();
      var hit = document.elementFromPoint(x, y);
      if (!hit) {
        mark(null);
        return false;
      }
      // An element the page made draggable or a slider is still worth a click
      // even when nothing above it is actionable.
      var target = actionable(hit);
      mark(target);
      return !!target;
    } catch (e) {
      return false;
    }
  };

  window.FumioTvTarget = function () {
    return !!(current && current.isConnected);
  };

  window.FumioTvClick = function () {
    style();
    var el = current && current.isConnected ? current : null;
    if (!el) return false;
    try {
      // Typing on a TV: a click would work, but the keyboard must open too.
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
