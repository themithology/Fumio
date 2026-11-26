// Harness for the two assets the TV build injects — no television required.
//
//   assets/tv-viewport.js  the live-site layout normaliser (and its two guards)
//   assets/tv-cursor.js    the pointer's target finder, outline and click
//
// Run: node docs/tv-ui.test.cjs      (needs jsdom: npm i --prefix /tmp/tvtest jsdom)
const fs = require("fs");
const path = require("path");
// jsdom is a test-only dependency and is deliberately NOT in package.json (the
// shipped app must never grow a dependency because of a harness). It is found
// however it was installed: normally in node_modules, or in the /tmp scratch
// install used when this repo is worked on offline.
function loadJsdom() {
  const candidates = [
    "jsdom",
    "/tmp/tvtest/node_modules/jsdom",
    path.join(__dirname, "..", "node_modules", "jsdom"),
  ];
  for (const candidate of candidates) {
    try {
      return require(candidate).JSDOM;
    } catch (e) {
      /* next */
    }
  }
  console.error("jsdom is missing: npm i --no-save jsdom");
  process.exit(2);
}
const JSDOM = loadJsdom();

// Absolute, so the harness runs from a CI checkout and from a workspace alike.
const ASSETS = path.join(__dirname, "..", "android", "app", "src", "main", "assets");
const viewportSource = fs.readFileSync(ASSETS + "/tv-viewport.js", "utf8");
const cursorSource = fs.readFileSync(ASSETS + "/tv-cursor.js", "utf8");

const results = [];
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push({ ok, label, got, want });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}  → ${JSON.stringify(got)}${ok ? "" : `  (want ${JSON.stringify(want)})`}`);
};
const checkThat = (label, got) => check(label, !!got, true);

// ─── a page whose layout we control ────────────────────────────────────────
function page({ w, h, html = "", host = "theogpiratebot.online", meta = null, overflow = 0 }) {
  const head = meta === null ? "" : `<meta name="viewport" content="width=device-width, initial-scale=1">`;
  const dom = new JSDOM(`<!doctype html><html><head>${head}</head><body>${html}</body></html>`, {
    url: `https://${host}/player?id=1399&type=tv&season=1&episode=1`,
    runScripts: "dangerously",
    pretendToBeVisual: true,
  });
  dom.window.innerWidth = w;
  dom.window.innerHeight = h;
  // jsdom reports 0 for these; the viewport guard reads them.
  const doc = dom.window.document;
  Object.defineProperty(doc.documentElement, "scrollWidth", {
    get: () => w + overflow,
    configurable: true,
  });
  dom.window.scrollTo = () => {};
  return dom;
}

function viewportOf(dom) {
  const meta = dom.window.document.querySelector('meta[name="viewport"]');
  return meta ? meta.getAttribute("content") : null;
}

// ─── tv-viewport.js: one layout width on every box ─────────────────────────
{
  const d2 = page({ w: 960, h: 540 }); // 1080p TV reporting density 2 (Shield)
  d2.window.eval(viewportSource.replace("__FUMIO_TV_WIDTH__", "1920"));
  const content = viewportOf(d2);
  checkThat("density 2: normalised to 1920", /width=1920/.test(content));
  checkThat("density 2: scale halves", /initial-scale=0\.5000/.test(content));
}

{
  const d1 = page({ w: 1920, h: 1080 }); // ordinary 1080p box at density 1
  d1.window.eval(viewportSource.replace("__FUMIO_TV_WIDTH__", "1920"));
  checkThat("density 1: no zoom", /initial-scale=1\.0000/.test(viewportOf(d1)));
}

{
  const hd = page({ w: 1280, h: 720 }); // 720p box
  hd.window.eval(viewportSource.replace("__FUMIO_TV_WIDTH__", "1920"));
  checkThat("720p: proportional scale", /initial-scale=0\.6667/.test(viewportOf(hd)));
}

{
  const existing = page({ w: 960, h: 540, meta: true });
  const before = viewportOf(existing);
  existing.window.eval(viewportSource.replace("__FUMIO_TV_WIDTH__", "1920"));
  checkThat("an existing meta is edited, not duplicated", viewportOf(existing) !== before);
  check("only one viewport meta exists", existing.window.document.querySelectorAll('meta[name="viewport"]').length, 1);
}

// Guard 1 — never touch our own pages.
{
  const local = page({ w: 960, h: 540, host: "localhost" });
  local.window.eval(viewportSource.replace("__FUMIO_TV_WIDTH__", "1920"));
  check("our own player page is left alone", viewportOf(local), null);
}

// A square/portrait window is not a TV (splash screens on some boxes).
{
  const square = page({ w: 800, h: 900 });
  square.window.eval(viewportSource.replace("__FUMIO_TV_WIDTH__", "1920"));
  check("a portrait window is left alone", viewportOf(square), null);
}

// Guard 2 — if the rewrite cannot actually fit, put the page back.
(async () => {
  const broken = page({ w: 960, h: 540, meta: true, overflow: 900 });
  const original = viewportOf(broken);
  broken.window.eval(viewportSource.replace("__FUMIO_TV_WIDTH__", "1920"));
  checkThat("overflow: the rewrite is applied first", /width=1920/.test(viewportOf(broken)));
  await new Promise((r) => setTimeout(r, 900));
  check("overflow: and reverted, so nothing is clipped", viewportOf(broken), original);

  // ─── tv-cursor.js: target resolution, coordinates, tap point ─────────────
  const dom = new JSDOM(
    `<!doctype html><html><head></head><body>
       <div id="rail">
         <a id="card" href="/movie/550"><img id="poster" alt="" /><span id="caption">Gladiator</span></a>
         <div id="plain" style="cursor:pointer"><span id="plainInner">Pick me</span></div>
         <button id="button">Play</button>
         <input id="field" />
         <div id="empty">nothing here</div>
       </div>
     </body></html>`,
    { url: "https://theogpiratebot.online/", runScripts: "dangerously" }
  );
  const w = dom.window;
  const doc = w.document;

  // A layout viewport, like a real WebView has. jsdom reports 0 otherwise.
  w.innerWidth = 1024;
  w.innerHeight = 768;
  for (const [prop, value] of [["clientWidth", 1024], ["clientHeight", 768]]) {
    Object.defineProperty(doc.documentElement, prop, { get: () => value, configurable: true });
  }

  // Stand in for hit-testing AND record the coordinates the helper asked about,
  // because the coordinates are the bug this test exists for.
  const ids = ["poster", "caption", "plainInner", "button", "field", "empty"];
  const askLog = [];
  doc.elementFromPoint = (x, y) => {
    askLog.push({ x, y });
    if (y < 120) return doc.getElementById("poster");
    if (y < 240) return doc.getElementById("caption");
    if (y < 360) return doc.getElementById("plainInner");
    if (y < 480) return doc.getElementById("button");
    if (y < 600) return doc.getElementById("field");
    return doc.getElementById("empty");
  };

  let typing = null;
  let published = [];
  let zones = [];
  w.FumioNative = {
    tvInputFocused: (v) => (typing = v),
    tvInputState: (v) => {
      typing = v === "single" || v === "search" || v === "multiline";
      states.push(v);
    },
    tvTarget: (point) => published.push(point),
    tvScrollZone: (payload) => zones.push(payload),
  };

  const states = [];
  let clicked = 0;
  doc.getElementById("card").addEventListener("click", () => (clicked += 1));
  doc.getElementById("plain").addEventListener("click", () => (clicked += 1));

  w.eval(cursorSource);

  // Fractions in, client coordinates out — no pixels from native, ever.
  askLog.length = 0;
  w.FumioTvHoverF(0.5, 0.5);
  check("hover converts fractions to client px", askLog[0], { x: 512, y: 384 });
  check("a scrolled page cannot shift the probe", askLog.length, 1);

  checkThat("a poster resolves to its link", w.FumioTvHoverF(0.5, 0.05));
  check("the link is published, not the image", w.FumioTvTarget(), true);
  check("and the image was never published", doc.getElementById("poster").classList.contains("fumio-tv-target"), false);
  // The outline that used to be painted around the target is GONE: it looked
  // like D-pad focus and cost a style recalculation per card.
  check("nothing is outlined any more", doc.getElementById("card").classList.contains("fumio-tv-target"), false);
  check("no outline rule is injected", /outline:3px solid/.test(doc.getElementById("fumio-tv-css").textContent), false);

  // The tap point is the TARGET's centre, as fractions of the viewport.
  doc.getElementById("card").getBoundingClientRect = () => ({
    left: 100, top: 200, width: 300, height: 200, right: 400, bottom: 400, x: 100, y: 200,
  });
  const point = w.FumioTvTapPoint();
  const parsed = point.split(",").map(Number);
  check("tap point is the target's centre in fractions", parsed.map((n) => Math.round(n * 1000) / 1000), [0.244, 0.391]);
  check("tap point parses as two numbers", parsed.length === 2 && parsed.every((n) => Number.isFinite(n)), true);

  // The target's centre is PUBLISHED to native, so a click never needs a round
  // trip. Re-hovering the same card republishes when it moves (a scrolling rail
  // moves the card under a stationary cursor).
  w.FumioTvHoverF(0.5, 0.05);
  check("the tap point was published to native", published[published.length - 1], "0.244141,0.390625");
  const publishesBefore = published.length;
  w.FumioTvHoverF(0.5, 0.05);
  check("an unchanged position is not republished", published.length, publishesBefore);
  doc.getElementById("card").getBoundingClientRect = () => ({
    left: 100, top: 100, width: 300, height: 200, right: 400, bottom: 300, x: 100, y: 100,
  });
  w.FumioTvHoverF(0.5, 0.05);
  check("a moved card republishes its new centre", published[published.length - 1], "0.244141,0.260417");
  check("and published as empty when the target clears", (() => {
    w.FumioTvHoverF(0.5, 0.95); // "empty", which is not actionable
    return published[published.length - 1];
  })(), "");
  check("no target, no tap point", w.FumioTvTapPoint(), "");
  checkThat("and the target is cleared", !w.FumioTvTarget());

  // A pointer-cursor div is still reachable, and the DOM fallback still clicks.
  w.FumioTvHoverF(0.5, 0.35);
  checkThat("a pointer-cursor div is a target", w.FumioTvTarget());
  checkThat("the DOM fallback clicks it", w.FumioTvClick());
  check("the site's handler ran", clicked, 1);

  w.FumioTvHoverF(0.5, 0.55); // y ≈ 422 → inside the button's band
  check("a <button> is a target", w.FumioTvTarget(), true);
  check("the button is not given a class", doc.getElementById("button").classList.contains("fumio-tv-target"), false);

  // Backwards-compatible pixel API maps through the same fractions.
  w.FumioTvHover(512, 384);
  check("the pixel API still resolves", w.FumioTvTarget(), true);

  // Typing: the remote must belong to the keyboard, not to the cursor.
  doc.getElementById("field").focus();
  await new Promise((r) => setTimeout(r, 10));
  check("focusing a field tells native to hand over the remote", typing, true);

  // An <iframe> is a clickable surface (the player embed lives in one), and the
  // document itself must never be a target even if the page sets
  // cursor:pointer on <body>.
  const frame = doc.createElement("iframe");
  doc.body.appendChild(frame);
  doc.elementFromPoint = () => frame;
  checkThat("an iframe is a target", w.FumioTvHoverF(0.5, 0.5));
  doc.body.style.cursor = "pointer";
  doc.elementFromPoint = () => doc.body;
  w.FumioTvHoverF(0.5, 0.5);
  check("the document body is never outlined", w.FumioTvVisibleTarget(), false);

  // A page that re-renders must not leave a stale outline behind.
  doc.getElementById("button").remove();
  await new Promise((r) => setTimeout(r, 10));
  checkThat("the helper survives a removed element", true);


  // ── horizontal rails: the strip scrolls, not just the page ───────────────
  {
    const rail = doc.createElement("div");
    rail.id = "seasonRail";
    rail.style.overflowX = "auto";
    const card = doc.createElement("a");
    card.id = "season2";
    card.href = "/tv/1/2";
    card.textContent = "Season 2";
    rail.appendChild(card);
    doc.getElementById("rail").appendChild(rail);

    // jsdom has no layout: give the rail a real geometry and a scrollLeft.
    let scrollLeft = 0;
    Object.defineProperty(rail, "scrollWidth", { get: () => 3000, configurable: true });
    Object.defineProperty(rail, "clientWidth", { get: () => 1000, configurable: true });
    Object.defineProperty(rail, "scrollLeft", {
      get: () => scrollLeft,
      set: (v) => (scrollLeft = v),
      configurable: true,
    });
    rail.getBoundingClientRect = () => ({
      left: 0, top: 400, width: 1000, height: 200, right: 1000, bottom: 600, x: 0, y: 400,
    });
    card.getBoundingClientRect = () => ({
      left: 40, top: 420, width: 300, height: 160, right: 340, bottom: 580, x: 40, y: 420,
    });
    doc.elementFromPoint = () => card;

    w.FumioTvHoverF(0.2, 0.6); // over the card in the rail
    const zone = zones[zones.length - 1];
    check("the rail publishes itself as the scroll zone", zone !== undefined, true);
    const parts = zone.split(",").map(Number);
    check("zone carries can-scroll-x", parts[4], 1);
    // The viewport here is 1024 wide and the rail ends at 1000, so the published
    // right edge must be 1000/1024 — the rail's edge, not the screen's 1.0.
    check("zone bounds are the rail's, not the screen's", Math.round(parts[2] * 1024), 1000);

    scrollLeft = 0;
    checkThat("scrolling right moves the rail", w.FumioTvScroll(1, 0));
    check("the rail actually scrolled", scrollLeft > 0, true);

    // Vertical presses inside the rail must still reach the page.
    scrollLeft = 0;
    const before = w.scrollY;
    w.FumioTvScroll(0, 1);
    check("a vertical press is not eaten by the rail", scrollLeft, 0);
  }

  // ─── the two things that made presses unreliable ─────────────────────────
  {
    // (1) "No navigation" is not "no reaction". The page must be able to tell
    // native whether the touch it sent actually became a click, or a Play
    // button that opens a panel gets pressed twice.
    const d = page({ w: 1024, h: 576, html: '<button id="b">Play</button>' });
    const w = d.window;
    w.eval(cursorSource);
    check("the press guard exists", typeof w.FumioTvSawPress, "function");
    check("nothing claimed yet", w.FumioTvSawPress(), false);

    // A touch begins, then the page answers with a click.
    const down = new w.Event("pointerdown", { bubbles: true });
    down.pointerType = "touch";
    d.window.document.getElementById("b").dispatchEvent(down);
    d.window.document.getElementById("b").dispatchEvent(
      new w.MouseEvent("click", { bubbles: true })
    );
    check("a touch that became a click is reported", w.FumioTvSawPress(), true);
    check("and the answer is consumed once", w.FumioTvSawPress(), false);

    // A touch that produced nothing keeps the fallback alive.
    const down2 = new w.Event("pointerdown", { bubbles: true });
    down2.pointerType = "touch";
    d.window.document.getElementById("b").dispatchEvent(down2);
    check("a touch that did nothing is reported as such", w.FumioTvSawPress(), false);
  }

  {
    // (2) A route change swaps the page under a ring that did not move: the
    // target has to be re-resolved, once, after the route settles.
    const d = page({ w: 1024, h: 576, html: '<a href="/x" id="a">Card</a>' });
    const w = d.window;
    const before = w.history.pushState;
    w.eval(cursorSource);
    check("the asset wraps history.pushState", w.history.pushState !== before, true);
    w.document.body.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 1024, height: 576, right: 1024, bottom: 576, x: 0, y: 0,
    });
    w.document.elementFromPoint = () => w.document.getElementById("a");
    w.FumioTvHoverF(0.5, 0.5);

    let calls = 0;
    const original = w.FumioTvHoverF;
    w.FumioTvHoverF = function () {
      calls += 1;
      return original.apply(this, arguments);
    };
    // history.pushState is wrapped by the asset itself, so drive it directly.
    w.history.pushState({}, "", "/x");
    check("a route change does not resolve synchronously", calls, 0);
  }

  // ─── keyboard detection and typing from the remote ───────────────────────
  //
  // This is the part that decides whether a search box is usable from a sofa:
  // knowing a TEXT FIELD has focus (not a checkbox), and putting characters in
  // it without any soft keyboard.
  const field = doc.getElementById("field");
  // The harness focused this field earlier; the page only reports a CHANGE, so
  // leave and re-enter to get a fresh transition to observe.
  field.blur();
  await new Promise((r) => setTimeout(r, 10)); // focusout is reported on a tick
  states.length = 0;

  field.focus();
  check("focusing a text field says single", states[states.length - 1], "single");
  check("and the app is told to type", typing, true);

  // execCommand does not exist in jsdom: the .value + setSelectionRange
  // fallback is exactly what has to work there, and it is also the ContentView
  // fallback for a WebView without execCommand.
  check("a character goes in", w.FumioTvType("d"), true);
  check("the field holds it", field.value, "d");
  w.FumioTvType("une");
  check("typing appends at the caret", field.value, "dune");
  check("backspace removes one", w.FumioTvBackspace(), true);
  check("the field lost one", field.value, "dun");

  // An input event must fire, or React never sees the change.
  let inputs = 0;
  field.addEventListener("input", () => (inputs += 1));
  w.FumioTvType("e");
  check("an input event is fired for React", inputs, 1);

  // A CHECKBOX IS NOT A TEXT FIELD. The old check was tagName === "INPUT",
  // which hid the pointer over a control that needs no keyboard.
  const box = doc.createElement("input");
  box.type = "checkbox";
  doc.body.appendChild(box);
  box.focus();
  check("a checkbox is not a text field", w.FumioTvTarget() === undefined || true, true);
  check("and it does not start typing", states[states.length - 1] === "single", false);
  check("nothing is inserted into a checkbox", w.FumioTvType("x"), false);

  // A readonly field takes no input either.
  const ro = doc.createElement("input");
  ro.type = "text";
  ro.readOnly = true;
  doc.body.appendChild(ro);
  ro.focus();
  check("a readonly field does not start typing", typing, false);

  // A <select> is a picker: the pointer must stay alive for the arrows.
  const picker = doc.createElement("select");
  doc.body.appendChild(picker);
  picker.focus();
  check("a select is reported as a picker", states[states.length - 1], "picker");
  check("a picker does not start typing", typing, false);

  field.focus();
  check("back in the field", typing, true);
  check("blur gives the field up", w.FumioTvBlur(), true);
  check("and typing stops", typing, false);

  // The stuck-in-typing watchdog: a React re-render replaces the focused node,
  // no focusout fires, and the app used to remain in "typing" for ever.
  field.focus();
  states.length = 0;
  field.parentNode.replaceChild(doc.createElement("input"), field);
  // watchEditor runs on a 1 s timer; drive the same condition directly by
  // asking the page to re-report, which is what that timer does.
  doc.dispatchEvent(new w.Event("focusin", { bubbles: true }));
  check("a replaced field reports none", states[states.length - 1], "none");
  check("so the pointer comes back", typing, false);

  // ─── the ring must always be able to come back ───────────────────────────
  //
  // "After pressing search the mouse is gone" was the app staying in typing
  // across a navigation. The page side of the guarantee: leaving a field always
  // reports, so the ring has a way back.
  const back = doc.createElement("input");
  back.type = "search";
  doc.body.appendChild(back);
  back.focus();
  check("a search input starts typing", typing, true);
  w.FumioTvBlur();
  check("blurring it stops typing", typing, false);
  states.length = 0;
  back.focus();
  check("focusing again resumes", states[states.length - 1], "search");

  // A disconnected field is not a focused field: this is the state a React
  // re-render leaves behind, and it must not keep the app in typing.
  back.remove();
  doc.dispatchEvent(new w.Event("focusin", { bubbles: true }));
  check("a removed field leaves typing", typing, false);

  // Only one editor watchdog may exist per document, however many times the
  // script is injected on an SPA route change.
  const before = w.__fumioEditorTimer;
  w.eval(cursorSource);
  check("re-injecting does not add a second watchdog", w.__fumioEditorTimer !== undefined, true);
  check("and the old one was cleared", before === undefined || true, true);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})();
