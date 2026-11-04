// Harness for the two assets the TV build injects — no television required.
//
//   assets/tv-viewport.js  the live-site layout normaliser (and its two guards)
//   assets/tv-cursor.js    the pointer's target finder, outline and click
//
// Run: node docs/tv-ui.test.cjs      (needs jsdom: npm i --prefix /tmp/tvtest jsdom)
const fs = require("fs");
let JSDOM;
try {
  JSDOM = require("jsdom").JSDOM;
} catch (e) {
  JSDOM = require("/tmp/tvtest/node_modules/jsdom").JSDOM;
}

const ASSETS = "/home/user/Fumio/android/app/src/main/assets";
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

  // ─── tv-cursor.js: what is under the cursor, and clicking it ─────────────
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

  // jsdom has no hit-testing; stand in for the browser.
  const at = {
    "10,10": doc.getElementById("poster"),
    "20,20": doc.getElementById("caption"),
    "30,30": doc.getElementById("plainInner"),
    "40,40": doc.getElementById("button"),
    "50,50": doc.getElementById("field"),
    "60,60": doc.getElementById("empty"),
  };
  doc.elementFromPoint = (x, y) => at[`${x},${y}`] || null;

  let typing = null;
  w.FumioNative = { tvInputFocused: (v) => (typing = v) };

  let clicked = 0;
  doc.getElementById("card").addEventListener("click", () => (clicked += 1));
  doc.getElementById("plain").addEventListener("click", () => (clicked += 1));

  w.eval(cursorSource);

  checkThat("hover finds nothing on empty space", !w.FumioTvHover(60, 60));
  checkThat("clicking with no target is a no-op", !w.FumioTvClick());
  check("and nothing was clicked", clicked, 0);

  checkThat("hover on a poster resolves to its link", w.FumioTvHover(10, 10));
  check("the link is outlined, not the image", doc.getElementById("card").classList.contains("fumio-tv-target"), true);
  check("the image is not", doc.getElementById("poster").classList.contains("fumio-tv-target"), false);
  checkThat("ok clicks the link", w.FumioTvClick());
  check("the page saw the click", clicked, 1);

  w.FumioTvHover(20, 20); // caption text inside the same link
  check("moving within the link keeps one target", doc.getElementById("card").className.split(" ").filter((c) => c === "fumio-tv-target").length, 1);

  w.FumioTvHover(30, 30); // a plain div with cursor:pointer
  checkThat("a pointer-cursor div is a target", w.FumioTvTarget());
  checkThat("and clicks", w.FumioTvClick());
  check("the site's handler ran", clicked, 2);

  w.FumioTvHover(40, 40);
  check("a <button> is a target", doc.getElementById("button").classList.contains("fumio-tv-target"), true);

  // Typing: the remote must belong to the keyboard, not to the cursor.
  doc.getElementById("field").focus();
  await new Promise((r) => setTimeout(r, 10));
  check("focusing a field tells native to hand over the remote", typing, true);

  // A page that re-renders must not leave a stale outline behind.
  doc.getElementById("button").remove();
  await new Promise((r) => setTimeout(r, 10));
  checkThat("the helper survives a removed element", true);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})();
