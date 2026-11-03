/*
 * The D-pad layer — one file, injected only on a television.
 *
 * WHY THIS FILE EXISTS
 * The browse UI is the live website, and the website changes whenever its own
 * owner changes it. Anything that keys off the site's class names (".card",
 * "#main-nav") is a bug with a delay fuse: the next deploy breaks the remote.
 * So this engine knows exactly two things:
 *
 *   1. ELEMENTS THAT CAN TAKE FOCUS — found by role (a[href], button,
 *      [role=button], inputs) plus a "this looks clickable" fallback for a
 *      <div> the site wired with a pointer cursor. A renamed class, a new card
 *      component, a re-ordered rail: all invisible to us, and therefore safe.
 *   2. WHERE THEY ARE ON SCREEN — movement is pure geometry on bounding
 *      boxes. Nearest box in the pressed direction wins, weighted so that a
 *      card directly below beats a diagonal one.
 *
 * The native side (TvUi.java) consumes DPAD/ENTER, calls FumioTvKey(...), and
 * gets back true/false: true = "I moved the focus", false = "not mine, let the
 * page have the key". While a text field has focus the engine says false for
 * everything, so the TV's own keyboard and the remote's arrow keys behave.
 *
 * Escape hatches, because a lost focus on a TV is a dead end with no mouse:
 *   - nothing in that direction → page-scroll, then retry with a wider net;
 *   - the focused element vanished (route change) → pick the first thing in
 *     the main content area;
 *   - a modal appeared → focus is trapped inside it until it closes.
 */
(function () {
  "use strict";
  if (window.__fumioTv) return;
  window.__fumioTv = true;

  var native = window.FumioNative || null;
  var FOCUS_CLASS = "fumio-tv-focus";
  var ADOPTED = "data-fumio-tv";

  var ROLES =
    'a[href],button,[role="button"],[role="link"],[role="tab"],[role="option"],' +
    'input:not([type="hidden"]),select,textarea,[' + ADOPTED + "]";

  var current = null;
  var inputFocused = false;
  var cache = null; // [{el, r}] for the current DOM generation

  // ─── tell native when the remote belongs to the page, not to us ──────────

  function reportInput() {
    var el = document.activeElement;
    var typing =
      !!el &&
      (el.tagName === "INPUT" ||
        el.tagName === "TEXTAREA" ||
        el.tagName === "SELECT" ||
        el.isContentEditable === true);
    if (typing === inputFocused) return;
    inputFocused = typing;
    try {
      if (native && native.tvInputFocused) native.tvInputFocused(!!typing);
    } catch (e) {
      /* the bridge is optional */
    }
  }
  document.addEventListener("focusin", reportInput, true);
  document.addEventListener("focusout", function () {
    setTimeout(reportInput, 0);
  }, true);

  // ─── candidates ─────────────────────────────────────────────────────────

  function box(el) {
    try {
      return el.getBoundingClientRect();
    } catch (e) {
      return null;
    }
  }

  function usable(r) {
    return !!r && r.width >= 8 && r.height >= 8;
  }

  /** Cheap sanity check on a winner before we commit to it. */
  function visible(el) {
    if (!el || !el.isConnected) return false;
    if (el.disabled) return false;
    if (el.closest('[aria-hidden="true"],[hidden]')) return false;
    var r = box(el);
    if (!usable(r)) return false;
    var cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") return false;
    if (parseFloat(cs.opacity || "1") < 0.05) return false;
    if (cs.pointerEvents === "none") return false;
    return true;
  }

  /**
   * A clickable thing the site forgot to make a <button>. Adopted once, marked
   * with a data attribute (which the selector above then picks up), so this
   * expensive check runs on a handful of elements per page, not per keypress.
   */
  function adopt(el) {
    if (!el || el.nodeType !== 1 || !el.matches) return false;
    if (el.matches(ROLES)) return true;
    if (el.disabled) return false;
    var cs = getComputedStyle(el);
    if (cs.cursor !== "pointer") return false;
    var hasText = !!(el.textContent && el.textContent.trim());
    var hasMedia = !!el.querySelector("img,picture,video,svg,canvas");
    if (!hasText && !hasMedia) return false;
    el.setAttribute(ADOPTED, "1");
    el.setAttribute("tabindex", "-1");
    return true;
  }

  function collect() {
    if (cache) return cache;
    var out = [];
    var nodes = document.querySelectorAll(ROLES);
    for (var i = 0; i < nodes.length; i += 1) {
      var el = nodes[i];
      var r = box(el);
      if (!usable(r)) continue;
      out.push({ el: el, r: r });
    }
    // Second pass: pointer-cursor containers (the site's cards), only when the
    // page gave us few real controls — otherwise they are noise.
    if (out.length < 40) {
      var extras = document.querySelectorAll(
        "div[class],li[class],article[class],section[class]"
      );
      for (var j = 0; j < extras.length && out.length < 400; j += 1) {
        var cand = extras[j];
        var cr = box(cand);
        if (!usable(cr)) continue;
        if (cr.width * cr.height > 0 && cr.width < 12) continue;
        if (cand.querySelector(ROLES)) continue; // a wrapper, not a card
        if (adopt(cand)) out.push({ el: cand, r: cr });
      }
    }
    cache = out;
    return out;
  }

  function invalidate() {
    cache = null;
  }
  try {
    new MutationObserver(function () {
      invalidate();
    }).observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {
    /* observer is an optimisation, not a requirement */
  }
  window.addEventListener("resize", invalidate);

  // ─── geometry ───────────────────────────────────────────────────────────

  function centreY(r) {
    return r.top + r.height / 2;
  }
  function centreX(r) {
    return r.left + r.width / 2;
  }

  /** Lower is better; Infinity means "not in that direction". */
  function cost(from, to, dir) {
    var primary;
    var cross;
    if (dir === "right") {
      primary = to.left - from.right;
      cross = Math.max(0, Math.max(from.top - to.bottom, to.top - from.bottom));
      cross += Math.abs(centreY(from) - centreY(to)) * 0.25;
    } else if (dir === "left") {
      primary = from.left - to.right;
      cross = Math.max(0, Math.max(from.top - to.bottom, to.top - from.bottom));
      cross += Math.abs(centreY(from) - centreY(to)) * 0.25;
    } else if (dir === "down") {
      primary = to.top - from.bottom;
      cross = Math.max(0, Math.max(from.left - to.right, to.left - from.right));
      cross += Math.abs(centreX(from) - centreX(to)) * 0.25;
    } else {
      primary = from.top - to.bottom;
      cross = Math.max(0, Math.max(from.left - to.right, to.left - from.right));
      cross += Math.abs(centreX(from) - centreX(to)) * 0.25;
    }
    // Slight overlap is normal between cards and their own padding.
    if (primary < -8) return Infinity;
    if (primary < 0) primary = 0;
    return primary + cross * 2.2;
  }

  function pick(dir, fromRect, pool, skip) {
    var best = null;
    var bestCost = Infinity;
    for (var i = 0; i < pool.length; i += 1) {
      var item = pool[i];
      if (!item || !item.el || item.el === skip) continue;
      var c = cost(fromRect, item.r, dir);
      if (c < bestCost) {
        bestCost = c;
        best = item;
      }
    }
    return best;
  }

  function scrollAncestor(el) {
    var node = el && el.parentElement;
    while (node && node !== document.body && node !== document.documentElement) {
      var cs = getComputedStyle(node);
      var scrollsX = /(auto|scroll|overlay)/.test(cs.overflowX) && node.scrollWidth > node.clientWidth + 8;
      var scrollsY = /(auto|scroll|overlay)/.test(cs.overflowY) && node.scrollHeight > node.clientHeight + 8;
      if (scrollsX || scrollsY) return node;
      node = node.parentElement;
    }
    return null;
  }

  function reveal(el) {
    var own = scrollAncestor(el);
    if (own) {
      var r = box(el);
      var box2 = own.getBoundingClientRect();
      var horizontal = own.scrollWidth > own.clientWidth + 8;
      // Landing at ~35 % of the rail, not dead centre: the eye reads "there is
      // more to the right" from the trailing cards.
      if (horizontal && r.left < box2.left + 8) {
        own.scrollLeft += r.left - box2.left - box2.width * 0.2;
      } else if (horizontal && r.right > box2.right - 8) {
        own.scrollLeft += r.right - box2.right + box2.width * 0.25;
      }
    }
    try {
      el.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
    } catch (e) {
      try {
        el.scrollIntoView();
      } catch (e2) {
        /* nothing */
      }
    }
  }

  function focus(el, remember) {
    if (!el || !el.focus) return false;
    if (!el.hasAttribute("tabindex") && !el.matches("a[href],button,input,select,textarea")) {
      el.setAttribute("tabindex", "-1");
    }
    try {
      el.focus({ preventScroll: true });
    } catch (e) {
      try {
        el.focus();
      } catch (e2) {
        return false;
      }
    }
    if (current && current !== el) current.classList.remove(FOCUS_CLASS);
    current = el;
    if (remember !== false) current.classList.add(FOCUS_CLASS);
    reveal(el);
    // Hover reveals (card overlays, tooltips) never fire on a TV. Synthesising
    // one is what makes the site's own hover styling show up for the focused
    // card without touching its CSS.
    try {
      el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      el.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    } catch (e) {
      /* older WebViews */
    }
    reportInput();
    return true;
  }

  /** First thing to focus on a freshly loaded page. */
  function firstFocus() {
    var pool = collect();
    if (!pool.length) return false;
    if (current && current.isConnected && visible(current)) {
      return focus(current, false);
    }
    var best = null;
    var bestKey = Infinity;
    for (var i = 0; i < pool.length; i += 1) {
      var item = pool[i];
      if (!visible(item.el)) continue;
      // Top-left-ish, but never the footer: a page that opens with focus at the
      // bottom is a page the viewer thinks is broken.
      var key = item.r.top * 1 + item.r.left * 0.35;
      if (item.el.closest("footer,[role=contentinfo]")) key += 10000;
      if (item.r.top > window.innerHeight * 0.9) key += 5000;
      if (key < bestKey) {
        bestKey = key;
        best = item;
      }
    }
    return best ? focus(best.el, false) : false;
  }

  // ─── the entry point native calls ───────────────────────────────────────

  function ensure() {
    if (current && current.isConnected) return true;
    current = null;
    return firstFocus();
  }

  function move(dir) {
    reportInput();
    if (inputFocused) return false;
    if (!ensure()) return false;
    var fromRect = box(current);
    if (!usable(fromRect)) return false;

    var pool = collect().filter(function (item) {
      return item.el !== current && !item.el.contains(current) && !current.contains(item.el);
    });

    var best = pick(dir, fromRect, pool, current);
    // The winner may be an invisible duplicate (off-canvas drawer, hidden tab
    // panel). Drop it and try again a bounded number of times.
    var attempts = 0;
    while (best && !visible(best.el) && attempts < 40) {
      pool = pool.filter(function (item) {
        return item !== best;
      });
      best = pick(dir, fromRect, pool, current);
      attempts += 1;
    }

    if (!best) {
      // Nothing that way: scroll the page, then look again with a fresh pool.
      var before = window.scrollY;
      var step = window.innerHeight * 0.4;
      if (dir === "down") window.scrollBy(0, step);
      else if (dir === "up") window.scrollBy(0, -step);
      else if (dir === "left") window.scrollBy(-window.innerWidth * 0.3, 0);
      else window.scrollBy(window.innerWidth * 0.3, 0);
      if (window.scrollY === before && dir !== "up" && dir !== "down") return false;
      invalidate();
      var retryPool = collect().filter(function (item) {
        return item.el !== current;
      });
      var retry = pick(dir, box(current) || fromRect, retryPool, current);
      if (!retry || !visible(retry.el)) return false;
      return focus(retry.el);
    }
    return focus(best.el);
  }

  function activate() {
    reportInput();
    if (inputFocused) return false;
    if (!ensure()) return false;
    try {
      current.click();
      return true;
    } catch (e) {
      return false;
    }
  }

  window.FumioTvKey = function (name) {
    try {
      if (name === "enter") return activate();
      if (name === "first") return firstFocus();
      if (name === "next") {
        // Fallback for pages with nothing focusable: keep the page usable.
        window.scrollBy(0, window.innerHeight * 0.4);
        return true;
      }
      return move(name);
    } catch (e) {
      return false;
    }
  };

  /**
   * Diagnostics for a real box with no console: MENU → the numbers come back
   * through the native log. Deliberately tiny and read-only.
   */
  window.FumioTvSelfTest = function () {
    var pool = collect();
    var dirs = ["up", "down", "left", "right"];
    var report = {
      url: location.pathname,
      candidates: pool.length,
      focused: !!(document.activeElement && document.activeElement !== document.body),
      width: window.innerWidth,
      height: window.innerHeight,
      dpr: window.devicePixelRatio,
      moves: {},
    };
    var start = document.activeElement;
    for (var i = 0; i < dirs.length; i += 1) {
      current = start && start !== document.body ? start : (ensure() ? current : null);
      report.moves[dirs[i]] = current ? move(dirs[i]) : false;
    }
    current = start && start !== document.body ? start : null;
    return JSON.stringify(report);
  };

  // Focus something as soon as the page is usable, so the remote works from
  // the first press instead of the second.
  function boot() {
    if (!document.querySelector("*")) return;
    firstFocus();
  }
  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(boot, 350);
  } else {
    document.addEventListener("DOMContentLoaded", function () {
      setTimeout(boot, 350);
    });
  }
  window.addEventListener("load", function () {
    setTimeout(boot, 350);
  });
})();
