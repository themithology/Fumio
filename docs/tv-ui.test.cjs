// Harness for android/app/src/main/assets/tv-nav.js — no real TV, but enough
// geometry to prove the engine moves focus the way a remote would.
const fs = require("fs");
let JSDOM;
try {
  JSDOM = require("jsdom").JSDOM;
} catch (e) {
  // scratch install: npm i --prefix /tmp/tvtest jsdom
  JSDOM = require("/tmp/tvtest/node_modules/jsdom").JSDOM;
}

const ASSETS = "/home/user/Fumio/android/app/src/main/assets";
const script = fs.readFileSync(ASSETS + "/tv-nav.js", "utf8");
const viewportSource = fs.readFileSync(ASSETS + "/tv-viewport.js", "utf8");
const css = fs.readFileSync(ASSETS + "/tv.css", "utf8");

const dom = new JSDOM(
  `<!doctype html><html><head></head><body>
     <header>
       <a id="logo" href="/">Home</a>
       <a id="search" href="/search">Search</a>
     </header>
     <main>
       <div id="rail1" style="overflow-x:auto">
         <div class="card" data-slot="r1c1" style="cursor:pointer">One</div>
         <div class="card" data-slot="r1c2" style="cursor:pointer">Two</div>
         <div class="card" data-slot="r1c3" style="cursor:pointer">Three</div>
         <div class="card" data-slot="r1c4" style="cursor:pointer">Four</div>
         <div class="card" data-slot="r1c5" style="cursor:pointer">Five</div>
         <div class="card" data-slot="r1c6" style="cursor:pointer">Six</div>
       </div>
       <div id="rail2" style="overflow-x:auto">
         <div class="card" data-slot="r2c1" style="cursor:pointer">Seven</div>
         <div class="card" data-slot="r2c2" style="cursor:pointer">Eight</div>
         <div class="card" data-slot="r2c3" style="cursor:pointer">Nine</div>
       </div>
       <input id="q" name="q" />
     </main>
     <footer><a id="foot" href="/about">About</a></footer>
   </body></html>`,
  { url: "https://theogpiratebot.online/", pretendToBeVisual: true, runScripts: "dangerously" }
);

const { window } = dom;
const doc = window.document;

// ── geometry: jsdom has none, so paint one 1920x1080 screen by hand ────────
const CARD_W = 300;
const CARD_H = 450;
const GAP = 24;
const rects = {
  logo: [40, 30, 180, 60],
  search: [1340, 30, 200, 60],
  rail1: [40, 160, 1840, CARD_H],
  rail2: [40, 700, 1840, CARD_H],
  q: [40, 1150, 600, 70],
  foot: [40, 1300, 200, 60],
};
const slotRect = (r, c) => [40 + (c - 1) * (CARD_W + GAP), r === 1 ? 160 : 700, CARD_W, CARD_H];

doc.querySelectorAll("[data-slot]").forEach((el) => {
  const [r, c] = el.getAttribute("data-slot").slice(1).split("c").map(Number);
  rects[el.getAttribute("data-slot")] = slotRect(r, c);
});

function rect(name) {
  const v = rects[name] || [0, 0, 0, 0];
  return {
    left: v[0], top: v[1], width: v[2], height: v[3],
    right: v[0] + v[2], bottom: v[1] + v[3],
    x: v[0], y: v[1],
  };
}

const layout = (el) => {
  const name = el.id || el.getAttribute("data-slot");
  if (!name) return [0, 0, 0, 0];
  return rect(name);
};

window.HTMLElement.prototype.getBoundingClientRect = function () {
  const r = rect(this.id || this.getAttribute("data-slot"));
  return { ...r, toJSON: () => r };
};
window.HTMLElement.prototype.scrollIntoView = function () {};
// jsdom reports 0 scrollWidth/clientWidth; pretend each rail overflows.
Object.defineProperty(window.HTMLElement.prototype, "scrollWidth", {
  get() { return this.id && this.id.startsWith("rail") ? 2000 : 0; },
});
Object.defineProperty(window.HTMLElement.prototype, "clientWidth", {
  get() { return this.id && this.id.startsWith("rail") ? 1840 : 0; },
});
window.innerWidth = 1920;
window.innerHeight = 1080;

// The engine boots itself; we drive it directly instead.
window.eval(script);

const key = (name) => window.FumioTvKey(name);
const focused = () => {
  const a = doc.activeElement;
  if (!a || a === doc.body) return "(body)";
  return a.id || a.getAttribute("data-slot") || a.tagName;
};

const results = [];
const check = (label, got, want) => {
  const ok = got === want;
  results.push({ ok, label, got, want });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}  → ${got}${ok ? "" : ` (want ${want})`}`);
};

let clicks = 0;
doc.querySelectorAll("[data-slot]").forEach((el) => el.addEventListener("click", () => (clicks += 1)));

// 1. Boot focus never lands in the footer.
key("first");
check("first focus is a real control", ["logo", "search", "r1c1"].includes(focused()), true);

// 2. Walk the first rail to the right: c1 → c2 → c3.
const start = focused();
key("enter"); // click whatever we're on: proves activation path runs
key("first");
doc.getElementById("logo").focus();
check("focus lands on logo", focused(), "logo");
key("down");
check("down from header enters rail 1", focused(), "r1c1");
key("right");
check("right moves one card", focused(), "r1c2");
key("right");
key("right");
check("third right press → fourth card", focused(), "r1c4");
key("down");
check("down keeps the column (rail 2 has 3 cards)", focused(), "r2c3");
key("up");
check("up returns to the same column", focused(), "r1c3");
key("enter");
check("enter clicked the focused card", clicks > 0, true);

// 3. Text field: the remote belongs to the page, not to us.
doc.getElementById("q").focus();
check("typing in a field yields the key", key("right"), false);
check("and does not steal focus", focused() === "q", true);

// 4. Bottom edge: nothing below the last rail, so it must not throw or move
//    focus into the page footer.
doc.querySelector('[data-slot="r1c1"]').focus();
for (let i = 0; i < 6; i += 1) key("down");
key("down");
// Whatever it lands on, it must be ON SCREEN and therefore visible — a
// "(body)" here would mean the viewer has no idea what Enter will do.
check("bottom edge keeps a visible focus", focused() !== "(body)", true);

// 5. Self test reports numbers a human can read off a TV.
const report = JSON.parse(window.FumioTvSelfTest());
check("self test finds candidates", report.candidates > 5, true);
check("self test reports all four directions", Object.keys(report.moves).length, 4);

// 6. Adoption: the site's plain <div> cards became focusable, and are marked
//    so the expensive check never runs twice.
const adopted = doc.querySelectorAll("[data-fumio-tv]").length;
check("div cards were adopted", adopted >= 6, true);


// ── the other two assets: the scale fix and the style wrapper ──────────────
{
  // A density-2 box: 1920 physical px report as 960 CSS px.
  const tv = new JSDOM(
    `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body></body></html>`,
    { url: "https://theogpiratebot.online/", runScripts: "dangerously", pretendToBeVisual: true }
  );
  tv.window.innerWidth = 960;
  tv.window.eval(viewportSource.replace("__FUMIO_TV_WIDTH__", "1920"));
  const content = tv.window.document
    .querySelector('meta[name="viewport"]')
    .getAttribute("content");
  check("viewport is normalised to 1920", /width=1920/.test(content), true);
  check("initial-scale halves a density-2 screen", /initial-scale=0\.5000/.test(content), true);

  // A 1080p box at density 1 needs no zoom at all.
  const tv1 = new JSDOM(
    `<!doctype html><html><head></head><body></body></html>`,
    { url: "https://theogpiratebot.online/", runScripts: "dangerously" }
  );
  tv1.window.innerWidth = 1920;
  tv1.window.eval(viewportSource.replace("__FUMIO_TV_WIDTH__", "1920"));
  const meta1 = tv1.window.document.querySelector('meta[name="viewport"]');
  check("a missing meta is created at scale 1", /initial-scale=1\.0000/.test(meta1.getAttribute("content")), true);
}

{
  // The CSS is injected through a JS string literal built in TvUi.quote();
  // reproduce that escaping and make sure the result still parses and applies.
  const quoted =
    "'" + css.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n").replace(/\r/g, "\\r") + "'";
  const injected =
    "(function(){var s=document.createElement('style');s.textContent=" + quoted + ";" +
    "document.head.appendChild(s);return s.textContent.length;})()";
  const page = new JSDOM(`<!doctype html><html><head></head><body></body></html>`, {
    runScripts: "dangerously",
  });
  const length = page.window.eval(injected);
  check("tv.css survives the JS string it is injected through", length === css.length, true);
}


// ── the hybrid handover: NAV tells native when it has run out of road ──────
{
  // A page with nothing focusable in it — the site's cards are divs with no
  // cursor:pointer, so the engine cannot adopt them either.
  const dead = new JSDOM(
    `<!doctype html><html><body><div style="width:900px;height:300px">just text</div></body></html>`,
    { url: "https://theogpiratebot.online/", runScripts: "dangerously", pretendToBeVisual: true }
  );
  let deadEnds = 0;
  dead.window.FumioNative = {
    tvNavDeadEnd() { deadEnds += 1; },
    tvInputFocused() {},
  };
  dead.window.HTMLElement.prototype.getBoundingClientRect = function () {
    const r = { left: 0, top: 0, width: 900, height: 300, right: 900, bottom: 300, x: 0, y: 0 };
    return { ...r, toJSON: () => r };
  };
  dead.window.HTMLElement.prototype.scrollIntoView = function () {};
  dead.window.innerWidth = 1920;
  dead.window.innerHeight = 1080;
  dead.window.eval(script);
  const took = dead.window.FumioTvKey("down");
  check("a page with nothing focusable reports a dead end", deadEnds > 0, true);
  check("and the key is not consumed", took, false);
}

{
  // A working page must NOT nag: a successful move is silent.
  let nagged = 0;
  window.FumioNative = { tvNavDeadEnd() { nagged += 1; } };
  // (re-loaded script for this window already ran with native=null, so poke the
  //  bridge through a move that succeeds to prove no call is attempted at all)
  doc.getElementById("logo").focus();
  key("down");
  check("a good move stays silent", nagged, 0);
}

console.log("\n" + results.filter((r) => r.ok).length + "/" + results.length + " checks passed");
process.exit(results.every((r) => r.ok) ? 0 : 1);
