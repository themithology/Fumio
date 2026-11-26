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
  var inputState = "none";

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
      // NO TARGET OUTLINE. A box that appeared around whatever the cursor was
      // over looked exactly like D-pad focus navigation — the thing the pointer
      // replaced — and it cost a style recalculation on the whole document
      // every time it moved between cards, which on a TV box is the stutter
      // people could see. The ring under the pointer IS the feedback now.
      // Text fields keep their focus ring: that one is information.
      "html.fumio-tv input:focus,html.fumio-tv textarea:focus{" +
      "outline:2px solid rgba(255,212,0,.9)!important;outline-offset:2px!important;}";
    var tag = document.createElement("style");
    tag.id = "fumio-tv-css";
    tag.textContent = css;
    (document.head || document.documentElement).appendChild(tag);
    document.documentElement.classList.add("fumio-tv");
  }

  /**
   * `getComputedStyle` forces a style resolution, and on a React page the same
   * ancestors are walked over and over as the cursor moves. The cursor value of
   * an element almost never changes, so it is cached per element: the walk
   * costs nothing after the first pass over a rail.
   */
  var cursorCache = null;
  function cursorOf(el) {
    try {
      if (!cursorCache) cursorCache = new WeakMap();
      var cached = cursorCache.get(el);
      if (cached !== undefined) return cached;
      var value = getComputedStyle(el).cursor;
      cursorCache.set(el, value);
      return value;
    } catch (e) {
      return "auto";
    }
  }

  var MAX_DEPTH = 12;

  function actionable(from) {
    // PASS 1 — real controls, nearest ancestor first. This runs before the
    // cursor heuristic on purpose: `cursor` is an INHERITED property, so every
    // child of a link computes `pointer` too. Testing the cursor first would
    // make the poster image its own target instead of the card around it.
    var el = from;
    var depth = 0;
    while (el && el.nodeType === 1 && depth < MAX_DEPTH) {
      try {
        if (el.matches && el.matches(ACTIONABLE)) return el;
      } catch (e) {
        /* a detached node mid-render */
      }
      el = el.parentElement;
      depth += 1;
    }
    // PASS 2 — a card the site built as a plain div. Only reached when no real
    // control is anywhere above the hit, so the pointer cursor here really is
    // the page saying "this is clickable".
    el = from;
    depth = 0;
    while (el && el.nodeType === 1 && el !== document.documentElement && depth < MAX_DEPTH) {
      if (cursorOf(el) === "pointer") return el;
      el = el.parentElement;
      depth += 1;
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
      var size = viewportSize();
      if (!size.w || !size.h) return "";
      var r = el.getBoundingClientRect();
      if (!r || r.width < 1 || r.height < 1) return "";

      // A target that is half off screen must be brought in first. Clamping its
      // centre to the edge would tap whatever happens to be at the edge instead
      // — which is how a "Play" press can land on a poster behind it.
      var cx = r.left + r.width / 2;
      var cy = r.top + r.height / 2;
      if (cx < 0 || cy < 0 || cx > size.w - 1 || cy > size.h - 1) {
        try {
          el.scrollIntoView({ block: "center", inline: "center" });
        } catch (e) {
          el.scrollIntoView();
        }
        r = el.getBoundingClientRect();
        cx = r.left + r.width / 2;
        cy = r.top + r.height / 2;
      }
      // Still outside: report nothing, so native taps where the arrow is (which
      // is at least where the viewer thinks they are pointing).
      if (cx < 0 || cy < 0 || cx > size.w - 1 || cy > size.h - 1) return "";
      return (cx / size.w).toFixed(6) + "," + (cy / size.h).toFixed(6);
    } catch (e) {
      return "";
    }
  }

  /**
   * The nearest ancestor that actually scrolls — vertically (the page) or
   * horizontally (a card rail). The home page's rails are `overflow-x: auto`
   * containers, so `window.scrollBy` does nothing on them: the rail has to be
   * scrolled itself. That is why horizontal browsing felt broken.
   */
  function scrollContainerOf(el, axis) {
    var node = el;
    while (node && node !== document.body && node !== document.documentElement) {
      try {
        var cs = getComputedStyle(node);
        var overflow = axis === "x" ? cs.overflowX : cs.overflowY;
        if (/(auto|scroll|overlay)/.test(overflow)) {
          var can =
            axis === "x"
              ? node.scrollWidth - node.clientWidth > 4
              : node.scrollHeight - node.clientHeight > 4;
          if (can) return node;
        }
      } catch (e) {
        /* detached */
      }
      node = node.parentElement;
    }
    return null;
  }

  var lastPublished = null;
  var lastScrollPublished = null;
  var activeScroll = null; // { el, axis }

  function publishTarget(el) {
    var point = tapPointOf(el);
    // Re-publishing matters even when the TARGET has not changed: scrolling the
    // page moves it, and a cached coordinate would tap where the card used to
    // be. Only a changed string costs a bridge call.
    if (point !== lastPublished) {
      lastPublished = point;
      try {
        if (native && native.tvTarget) native.tvTarget(point);
      } catch (e) {
        /* bridge is optional */
      }
    }
    publishScroll(el);
  }

  /**
   * Tell native where the rail/page under the cursor ends and in which
   * directions it can still move, as fractions:
   *
   *   "left,top,right,bottom,canScrollX,canScrollY"
   *
   * With that, native can decide SYNCHRONOUSLY — every animation frame, while a
   * direction is held — whether a press should move the cursor or scroll the
   * strip underneath it. Asking over the JS bridge per frame would be far too
   * slow, and a rail only scrolls when the cursor reaches ITS edge, which is
   * usually well inside the screen.
   */
  function publishScroll(el) {
    try {
      var size = viewportSize();
      var node = el || document.body;
      var sx = scrollContainerOf(node, "x");
      var sy = scrollContainerOf(node, "y");
      activeScroll = { x: sx, y: sy };
      var rect;
      if (sx) rect = sx.getBoundingClientRect();
      else if (sy) rect = sy.getBoundingClientRect();
      else rect = { left: 0, top: 0, right: size.w, bottom: size.h };
      var canX = !!sx;
      var canY = !!sy;
      var payload =
        (Math.max(0, rect.left) / size.w).toFixed(4) + "," +
        (Math.max(0, rect.top) / size.h).toFixed(4) + "," +
        (Math.min(size.w, rect.right) / size.w).toFixed(4) + "," +
        (Math.min(size.h, rect.bottom) / size.h).toFixed(4) + "," +
        (canX ? 1 : 0) + "," +
        (canY ? 1 : 0);
      if (payload === lastScrollPublished) return;
      lastScrollPublished = payload;
      if (native && native.tvScrollZone) native.tvScrollZone(payload);
    } catch (e) {
      /* publishing is best effort */
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
    // No classList write: touching the class attribute of a card in a React
    // grid invalidates style for it and its subtree, on every pointer move.
    // The element is tracked in a variable; the page is never modified.
    current = el && el.isConnected ? el : null;
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

  /** The last point the native side asked about, for re-resolving later. */
  var lastPoint = null;

  window.FumioTvHoverF = function (fx, fy) {
    try {
      lastPoint = { fx: fx, fy: fy };
      // A fresh resolve means a fresh answer: the page may have swapped a
      // stylesheet or re-rendered a rail since the last one. Within one resolve
      // the cache still saves every repeated ancestor walk.
      cursorCache = null;
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

  /**
   * Scroll the strip under the cursor. Called by native when a direction is
   * held and the cursor has reached the edge of that strip (or of the page).
   * Container first, window second: pressing right at the end of a rail must
   * move the RAIL, not the page.
   */
  window.FumioTvScroll = function (dx, dy) {
    try {
      var step = 0;
      if (activeScroll && dx !== 0 && activeScroll.x) {
        step = dx * Math.max(90, activeScroll.x.clientWidth * 0.15);
        activeScroll.x.scrollLeft += step;
        publishScroll(current);
        return true;
      }
      if (activeScroll && dy !== 0 && activeScroll.y) {
        step = dy * Math.max(70, activeScroll.y.clientHeight * 0.18);
        activeScroll.y.scrollTop += step;
        publishScroll(current);
        return true;
      }
      // The page itself (or a container we lost track of).
      var node = current && current.isConnected ? current : null;
      var sx = node ? scrollContainerOf(node, "x") : null;
      var sy = node ? scrollContainerOf(node, "y") : null;
      if (dx !== 0 && sx) {
        sx.scrollLeft += dx * Math.max(90, sx.clientWidth * 0.15);
        publishScroll(node);
        return true;
      }
      if (dy !== 0 && sy) {
        sy.scrollTop += dy * Math.max(70, sy.clientHeight * 0.18);
        publishScroll(node);
        return true;
      }
      window.scrollBy(dx * Math.round(window.innerWidth * 0.16), dy * Math.round(window.innerHeight * 0.16));
      publishScroll(node);
      return true;
    } catch (e) {
      return false;
    }
  };

  /**
   * The last resort for a control that ignored a real touch.
   *
   * Some of the site's components are wired to pointer/mouse events, or guard
   * their handler behind a drag threshold, and a synthesised touch can miss
   * them. This dispatches the full sequence at the target — pointer, mouse and
   * click, with the properties handlers read — and then, if the page still has
   * not navigated, follows the link itself. A Play button that does nothing is
   * worse than a Play button that navigates one way or another.
   */
  window.FumioTvPress = function () {
    try {
      var el = current && current.isConnected ? current : null;
      if (!el) return false;
      var r = el.getBoundingClientRect();
      var size = viewportSize();
      var x = r.left + r.width / 2;
      var y = r.top + r.height / 2;
      var common = {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: x,
        clientY: y,
        screenX: x,
        screenY: y,
        view: window,
        button: 0,
        buttons: 1,
        detail: 1,
        pointerId: 1,
        pointerType: "touch",
        isPrimary: true,
      };
      var fire = function (Ctor, type, extra) {
        try {
          var options = {};
          for (var key in common) options[key] = common[key];
          if (extra) for (var k2 in extra) options[k2] = extra[k2];
          el.dispatchEvent(new Ctor(type, options));
        } catch (e) {
          /* an old WebView may lack a constructor; the others still fire */
        }
      };
      if (window.PointerEvent) {
        fire(window.PointerEvent, "pointerdown");
      }
      fire(window.MouseEvent, "mousedown");
      if (window.PointerEvent) {
        fire(window.PointerEvent, "pointerup", { buttons: 0 });
      }
      fire(window.MouseEvent, "mouseup", { buttons: 0 });
      fire(window.MouseEvent, "click", { buttons: 0 });

      // If that did nothing and the thing is (or sits inside) a link, follow it.
      var before = location.href;
      var link = el.closest && el.closest("a[href]");
      if (link) {
        setTimeout(function () {
          try {
            if (location.href === before) {
              var href = link.getAttribute("href") || "";
              if (href && href.charAt(0) !== "#" && !/^javascript:/i.test(href)) {
                location.assign(link.href);
              }
            }
          } catch (e) {
            /* if the page blocks it, nothing more we can do */
          }
        }, 420);
      }
      return true;
    } catch (e) {
      return false;
    }
  };

  // ─── did the touch the native side sent actually reach the page? ──────────
  //
  // The press is a real touch. When the URL does not change afterwards, native
  // used to assume the touch was ignored and ALSO fire a synthetic DOM click
  // (FumioTvPress) — but "no navigation" is not "no reaction": a Play button
  // that opens a panel, a mute toggle, a menu that expands all leave the URL
  // alone. The double activation that followed is a real bug ("pressing once
  // does the thing twice"). So the page reports the truth instead: a touch
  // began, and did a click follow it?
  var touchOpenedAt = 0;
  var sawClick = false;

  document.addEventListener(
    "pointerdown",
    function (event) {
      if (event.pointerType === "touch" || event.pointerType === "pen") {
        touchOpenedAt = Date.now();
        sawClick = false;
      }
    },
    true
  );
  document.addEventListener(
    "click",
    function () {
      if (touchOpenedAt && Date.now() - touchOpenedAt < 2000) sawClick = true;
    },
    true
  );

  /** true once, if the last touch produced a click. Resets the flag. */
  window.FumioTvSawPress = function () {
    var value = sawClick;
    sawClick = false;
    touchOpenedAt = 0;
    return value;
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

  // ─── SPA route changes: the ring cannot know the page under it changed ──
  //
  // A navigation without a page load (React Router, Next, any pushState) swaps
  // the whole view while the pointer stays exactly where it was. Without this,
  // the outline and the tap target still describe the page you just left, and
  // the first press after a navigation can hit an element that is no longer
  // there. Once per route, 300 ms after it settles, re-ask.
  var routeTimer = 0;
  function afterRoute() {
    if (routeTimer) clearTimeout(routeTimer);
    routeTimer = setTimeout(function () {
      routeTimer = 0;
      if (!lastPoint) return;
      try {
        window.FumioTvHoverF(lastPoint.fx, lastPoint.fy);
      } catch (e) {
        /* the page is between renders; the next hover will fix it */
      }
    }, 300);
  }

  try {
    window.addEventListener("popstate", afterRoute);
    window.addEventListener("hashchange", afterRoute);
    var push = history.pushState;
    var replace = history.replaceState;
    if (typeof push === "function") {
      history.pushState = function () {
        var out = push.apply(this, arguments);
        afterRoute();
        return out;
      };
    }
    if (typeof replace === "function") {
      history.replaceState = function () {
        var out = replace.apply(this, arguments);
        afterRoute();
        return out;
      };
    }
  } catch (e) {
    /* history we cannot wrap simply keeps the old behaviour */
  }

  // ─── hand the remote to the keyboard while typing ───────────────────────

  /**
   * DOES THIS FIELD NEED A KEYBOARD?
   *
   * The old check was `tagName === "INPUT"`, which is true for a checkbox, a
   * radio and a submit button - so ticking a box hid the pointer and handed the
   * remote to a keyboard nobody asked for. The distinction that matters is
   * "text goes in here", and that is decided by the TYPE, not the tag.
   */
  var TEXT_TYPES = {
    text: 1, search: 1, url: 1, email: 1, password: 1, tel: 1,
    number: 1, date: 1, "datetime-local": 1, month: 1, time: 1, week: 1
  };

  function editorOf(el) {
    if (!el || el.nodeType !== 1) return null;
    var tag = (el.tagName || "").toUpperCase();
    if (tag === "TEXTAREA") return "multiline";
    if (tag === "INPUT") {
      var type = (el.getAttribute("type") || "text").toLowerCase();
      if (!TEXT_TYPES[type]) return null;
      return type === "search" ? "search" : "single";
    }
    if (el.isContentEditable === true) return "multiline";
    return null;
  }

  /** The focused element, if it is editable at all. */
  function editableOf(el) {
    var kind = editorOf(el);
    if (!kind || !el) return null;
    if (el.disabled === true || el.readOnly === true) return null;
    return kind;
  }

  function activeEditor() {
    return editableOf(document.activeElement);
  }

  /**
   * Tell native what kind of typing surface is focused, when it changes.
   *
   * "picker" is reported rather than ignored: a <select> on a TV is opened with
   * OK and then navigated with the arrows, so native must keep the pointer alive
   * for it - but must not hide the ring or start eating letters.
   */
  function reportInput() {
    var el = document.activeElement;
    var kind = editableOf(el);
    var tag = el && el.tagName ? el.tagName.toUpperCase() : "";
    var state = kind || (tag === "SELECT" ? "picker" : "none");
    if (state === inputState) return;
    inputState = state;
    inputFocused = state === "single" || state === "search" || state === "multiline";
    try {
      if (native && native.tvInputState) native.tvInputState(state);
      else if (native && native.tvInputFocused) native.tvInputFocused(inputFocused);
    } catch (e) {
      /* bridge is optional */
    }
  }

  /**
   * THE STUCK-IN-TYPING BUG.
   *
   * A React page can replace the focused node while it is focused: no focusout
   * ever fires, document.activeElement silently becomes <body>, and the app
   * stayed in "typing" with the ring hidden and no way back. This is a cheap
   * comparison, and it is the only thing that recovers that state.
   */
  function watchEditor() {
    if (inputFocused && !activeEditor()) reportInput();
  }

  // ─── typing, from the remote ─────────────────────────────────────────────
  //
  // Most Android TV boxes ship NO soft keyboard at all, so "show the IME" solves
  // nothing there: the viewer points at a search box, presses OK, and the app
  // goes quiet. These two functions are what actually makes a search box work
  // from a sofa — native forwards the remote's printable keys here and this
  // inserts them the way a keyboard would, character by character.

  function setValue(el, text) {
    try {
      el.value = text;
      return true;
    } catch (e) {
      /* a field that refuses .value is handled below */
    }
    return false;
  }

  function caretOf(el) {
    try {
      if (typeof el.selectionStart === "number") return [el.selectionStart, el.selectionEnd];
    } catch (e) {
      /* some input types throw on selectionStart */
    }
    var len = (el.value || "").length;
    return [len, len];
  }

  /**
   * Insert text at the caret, exactly as a keypress would.
   *
   * React-controlled inputs keep their own copy of the value, so assigning
   * .value alone is invisible to them forever. execCommand('insertText') goes
   * through the browser's editing pipeline, which fires beforeinput/input and
   * updates React — so it is tried FIRST, and .value is the fallback for
   * contenteditable and for WebViews where execCommand is gone.
   */
  window.FumioTvType = function (text) {
    var kind = activeEditor();
    if (!kind || typeof text !== "string" || !text) return false;
    var el = document.activeElement;
    try {
      el.focus();
      var inserted = false;
      try {
        inserted = document.execCommand("insertText", false, text);
      } catch (e) {
        inserted = false;
      }
      if (!inserted && !el.isContentEditable) {
        var range = caretOf(el);
        var value = el.value == null ? "" : String(el.value);
        var next = value.slice(0, range[0]) + text + value.slice(range[1]);
        if (setValue(el, next)) {
          try {
            el.setSelectionRange(range[0] + text.length, range[0] + text.length);
          } catch (e) {
            /* number/date inputs refuse it */
          }
          el.dispatchEvent(new Event("input", { bubbles: true }));
        } else {
          return false;
        }
      } else if (!inserted) {
        // contenteditable: execCommand failed and there is no .value
        return false;
      }
      return true;
    } catch (e) {
      return false;
    }
  };

  /** Delete one character backwards (the remote's DEL / backspace). */
  window.FumioTvBackspace = function () {
    var kind = activeEditor();
    if (!kind) return false;
    var el = document.activeElement;
    try {
      el.focus();
      var deleted = false;
      try {
        deleted = document.execCommand("delete", false, null);
      } catch (e) {
        deleted = false;
      }
      if (deleted) return true;
      if (el.isContentEditable) return false;
      var range = caretOf(el);
      if (range[0] === range[1] && range[0] === 0) return true; // nothing to do
      var value = el.value == null ? "" : String(el.value);
      var from = range[0] === range[1] ? range[0] - 1 : range[0];
      var next = value.slice(0, from) + value.slice(range[1]);
      if (!setValue(el, next)) return false;
      try {
        el.setSelectionRange(from, from);
      } catch (e) {
        /* ignore */
      }
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    } catch (e) {
      return false;
    }
  };

  /** Give up the field: closes the keyboard, puts the ring back. */
  window.FumioTvBlur = function () {
    try {
      if (document.activeElement && document.activeElement.blur) {
        document.activeElement.blur();
      }
      reportInput();
      return true;
    } catch (e) {
      return false;
    }
  };

  document.addEventListener("focusin", reportInput, true);
  document.addEventListener("focusout", function () {
    setTimeout(reportInput, 0);
  }, true);

  // Once a second, and only while the app believes it is typing: recovers a
  // field the page replaced underneath us.
  //
  // ONE timer per document. The script is re-injected on every page finish, and
  // the guard at the top of this IIFE is what stops a second set of listeners
  // existing; without clearing the old timer an SPA would slowly accumulate one
  // interval per navigation, each scanning the DOM once a second.
  if (window.__fumioEditorTimer) {
    try {
      clearInterval(window.__fumioEditorTimer);
    } catch (e) {
      /* nothing to clear */
    }
  }
  window.__fumioEditorTimer = setInterval(watchEditor, 1000);

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
