# Android TV build — plan & brainstorm

Status: **planning only.** Nothing in this document is implemented yet.
Target: one APK, `com.fumio.app`, that is a good phone app **and** a genuinely
good 10-foot app — D-pad first, no ad wall, proportions that read from 3 m,
and it must not break the day the website ships something new.

**Built in this pass (T0, T1, T2, the updater), all unverified on a real TV:**
manifest/banner/leanback entry, `TvMode`, `TvUi` + `assets/tv-viewport.js` +
`assets/tv-cursor.js`, the cursor remote (`TvPointer`, `TvCursorView`), the
ad-wall gate, `Updater`, and a versionCode stamped by CI. Verification so far is
`docs/tv-ui.test.cjs` (25/25: the viewport maths, both of its guards, and the
cursor's target resolution) plus a full APK build. **Nothing has run on a
television yet** — §8 keeps that honest. The D-pad engine described in §2/§3 as
"built" has since been **removed by decision** (2026-11-05); §3 is now the
cursor-only design.

**Distribution: direct APK** (GitHub release → sideload). Not the Play Store, so
no listing/TV-review/package rules apply. That removes a pile of constraints and
adds three of its own — signing stability, an install path for a remote-only
device, and an update path for a device with no browser (§7).

---

## 1. What we actually have (facts, not wishes)

| Surface | What it is | Who controls it | Volatility |
|---|---|---|---|
| **Browse** (home, movie, tv, anime, search, live-tv) | the **live website** in the WebView — `MainActivity` loads `https://theogpiratebot.online/` first, bundled `dist` only as fallback (`onPageFinished`/`onReceivedError`) | **the site** | **high** — can change any day |
| **Player** | **ours**: overlay WebView on `https://localhost/watch/{type}/{id}` → `src/pages/Player.jsx` + `FumioPlayerStage.jsx` + `ServerPickerBar.jsx` | us, in this repo | low — ships with the APK |
| **Server list** | native harvest / `/api/players` when it lands, injected as `window.__fumioLiveSources` | site data, our code | medium |
| **Downloads / offline** | native: `Downloader`, `DownloadsLibrary`, `DownloadsActivity`, `OfflinePlayerActivity` (Media3) | us | none |
| **Ads** | **only** the `/verify` 12-hour unlock wall (`VerifyClient` + `VerifyWall`, `MainActivity.refreshUnlock()`). No AdMob, no interstitials. | us | none |
| **Injection channel** | `MainActivity.injectPlayerScript()` → `assets/fumio-player.js` already runs our JS **inside the live site** on every page load | us | proven |

Two consequences that decide the whole architecture:

1. **The browse UI will change under us.** Any TV work that depends on the
   site's DOM structure (`.card`, `.hero`, `#main-nav`) is a timer that goes
   off on the site's next deploy. So the TV layer must depend on **geometry and
   element roles**, never on selectors.
2. **The player is ours.** We can give it a proper cinematic TV surface — big
   OSD, server row, quality/audio/subtitle menus — and it ships with the APK,
   so no website update can touch it.

---

## 2. The core fork — DECIDED: B (native TV shell)

**Decision (2026-11-03): B, the native TV shell.** The owner's reason: the app's
cloud-sync setup is complicated enough that skinning the live site on a TV
adds a second thing to keep in sync with it. So the TV gets a real television
UI built natively, not a scaled website.

Two facts make B affordable rather than a rewrite:

1. **There is already a data contract that is not the website's DOM.**
   `src/lib/proxyTiers.js` + `src/lib/tmdb.js` show the app talks to
   `GET {base}/tmdb/{path}?{params}` through a ladder of four Cloudflare
   workers (plus same-origin), with `https://image.tmdb.org/t/p/{size}{path}`
   for art. A native shell can call exactly that: no key, no scraping, and it
   is *the same pipeline the phone uses today*.
2. **Playback is already ours.** The server list comes from
   `GET /api/players` (or the harvest fallback), and the player is the bundled
   `https://localhost/watch/...` surface. The shell only has to decide *what*
   to watch and hand `{type,id,season,episode,server}` to the existing overlay.

So the shell duplicates **presentation only** — rows, cards, details, pickers —
over data both builds already consume. A change on the website (new TMDB
source, a new server) reaches TV through the same JSON the phone reads.

What the earlier A/C analysis is still good for: the site-skin path (T2) is
already built and stays as the fallback browse surface — if a TV build ever
fails to render the shell, or a pref turns it off, the app drops back to the
live site with working D-pad. Nothing is thrown away.

### A / C, for the record (superseded)

### A. TV presentation layer on the live site — *recommended*
Reuse the existing injection channel: `assets/tv-nav.js` (spatial focus engine,
D-pad) + `assets/tv.css` (10-foot scale, safe area, focus ring) injected only
when `TvMode.isTv(this)`. Native `dispatchKeyEvent` routes DPAD/OK/BACK into
`window.FumioTvKey(...)`.

- ✅ Bugs fixed once, phone and TV share the same content and the same fixes.
- ✅ Site updates arrive for free — no second front-end to keep in sync.
- ✅ Zero risk to the phone path: different branch, different APK code path.
- ⚠️ Looks like the website, scaled and focused. Good, not "streaming service".
- ⚠️ Needs a geometric focus engine that is genuinely solid (this is the real work).

### B. Native Leanback shell (rows, cards, details, player)
- ✅ Best possible big-screen look; true TV product.
- ❌ Duplicates the site's entire data + layout layer. Every site feature the
  user adds (new hub, new badge, new rail ordering) is *missing* on TV until we
  re-implement it. That is exactly the "website updated → app broken" failure
  the user explicitly forbids.
- ❌ Weeks of work, and it needs the site's API surface that doesn't exist yet.
- **Rejected as the primary surface.**

### C. A + native "TV Home" spotlight — *recommended stretch*
Keep A for browsing, and put a **native card as the first thing on the TV**:
brand billboard + `Continue watching` / `My downloads` / `Recently opened`
rails built from **app-local data we already store** (`ogpb_resume`,
`ogpb_downloads`, browse history). Each card hands off to the same `/watch/...`
route in the WebView.

- ✅ Looks like a TV app on the screen people actually stare at, on launch.
- ✅ Cannot break on a site update — it reads no site DOM.
- ✅ Reuses the app player and downloads, no duplicated content layer.
- ⚠️ New native screen → needs its own D-pad + focus pass (small, contained).

**Recommendation: C.** A gives correctness and durability, C gives the
"showcase the potential" first impression, and neither duplicates the site.

---

## 3. Navigation — cursor only (decided 2026-11-05)

**The D-pad focus engine is gone.** Not parked, not demoted — removed
(`assets/tv-nav.js`, `assets/tv.css` and the `FumioTvKey` bridge are deleted).

The reason is the one thing about this app that never changes: the browse UI is
the live website, owned by someone else and edited whenever they like. A focus
ring can only move between things the page *admits* are focusable. A card
rendered as a plain `<div>`, a slider, a drag handle, a menu that opens on hover
— all of those are dead ends for a ring, and every site deploy is a fresh chance
to create one. A cursor has no such dependency.

So: **the remote is a mouse.** Everything below is about making that feel like a
television remote rather than a laptop trackpad.

### 3.1 Key map

| Key | What happens |
|---|---|
| DPAD ↑↓←→ | moves the cursor: 20 dp per tap, accelerating to ~4.6× while held |
| OK / ENTER | clicks the outlined target; falls back to a synthetic tap at the pixel |
| BACK | **never consumed** — closes the player, goes back a page, exits |
| MENU / INFO | re-shows the one-line hint ("Arrows move · OK selects · BACK goes back") |
| arrows at an edge | cursor stops, the page scrolls 16 % per press (accelerating) |
| while a text field is focused | the remote belongs to the TV keyboard, not to us |

### 3.2 What makes it feel good (the five things that replace a D-pad)

1. **A target, always.** Every move asks the page what is under the cursor
   (`FumioTvHover`) and outlines it with a 2 px white edge. You never press OK
   into darkness.
2. **Forgiveness.** OK clicks the *target*, not the coordinate. `tv-cursor.js`
   walks up to the nearest `a[href] / button / [onclick] / [role=button] /
   tabindex` — so aiming at a poster image clicks the card around it. There is a
   second pass for divs the site only marked `cursor: pointer`, and it runs
   **after** the first one, because `cursor` is an inherited property: every
   child of a link computes `pointer`, and testing that first would make the
   poster its own target. (A test caught exactly that.)
3. **It glides.** Three mechanisms, and together they are what stops it feeling
   like a remote pretending to be a mouse:

   - *A tap is a fixed 18 dp step.* Predictable, small enough to land on a 40 dp
     button, big enough that crossing a card takes three presses.
   - *A hold accelerates.* The first press also starts a continuous advance that
     ramps 22 % → 100 % over ~0.4 s with a smoothstep curve, so there is no jolt
     off the mark. Full speed crosses the screen in ~0.9 s, expressed relative to
     the screen so a 720p box and a 4K box feel identical.
   - *The drawn arrow chases the aim.* `TvCursorView` keeps two positions: the
     aim (what OK clicks, what the page is asked about) and the drawn position,
     which eases toward it each frame with `k = 1 - exp(-dt/50ms)`. Frame-rate
     independent, fixed-target interpolation, so it cannot drift — and it means
     motion is a stream of positions at vsync instead of discrete steps.

   The loop runs on `Choreographer` (vsync-aligned, not `postDelayed` timers),
   only while the cursor is moving or animating, and **stops when parked** — at
   rest it requests no frames at all. Hover and clicks use the *drawn* position,
   so what you see under the tip is exactly what gets clicked.
4. **Hover that works.** Moves are delivered as real mouse hover events, so the
   site's own `:hover` styling and hover-only menus behave exactly as on a
   desktop — that is content a D-pad could never show.
5. **No dead ends.** Edge scrolling, and a click is a **real touch** at the
   target's centre — `ACTION_DOWN`/`ACTION_UP` — so the page generates
   pointerdown/pointerup/click itself and every handler style reacts (a DOM
   `element.click()` only fires `click`, which is why drag rails and
   motion-driven cards ignored the first version).

### 2.5 Coordinates: fractions, never pixels

The single most important detail in the whole remote, and the cause of the one
bug that mattered (`2026-11-05`: home page responded, a scrolled season rail did
not).

The page's coordinate space is not the view's:

- the layout viewport can be 1920 CSS px on a 1280 px screen (the TV viewport
  normalisation), so a view pixel is not a CSS pixel;
- `elementFromPoint` takes **client** coordinates, which ignore page scroll, so
  once the page is scrolled a view point and a client point differ by exactly the
  scroll offset;
- density, zoom and text zoom all move the ratio too.

So the native side never sends pixels. It sends **fractions of the WebView's
box** (`FumioTvHoverF(fx, fy)`, `FumioTvTapPoint()` → `"fx,fy"`), and the page
multiplies by its own `clientWidth`/`clientHeight`. Fractions are invariant under
every one of the factors above, so this cannot drift again when the site changes
its layout.

### 3.3 The cursor itself

Plain arrow, white body, 1.6 dp near-black edge, one tight shadow, 20×29 dp, no
motion at rest (a 110 ms squash on click, and that is all). The edge is not
decoration: on bright poster art a pure white arrow disappears — see
`docs/cursor-styles.png`, where four styles were drawn to scale over dark, mid
and bright art before choosing.

The first attempt had a yellow glow, orbiting sparkles and an idle bob. It looked
generated, and it competed with the poster art. Cutting the idle animation also
removed a permanent repaint loop: at rest the overlay now asks for no frames.

### 3.4 Cost

While the cursor moves, the overlay invalidates only the corridor between its old
and new positions (plus the hint), on vsync. Once it settles — and no direction
is held — the frame loop returns without re-posting, so a parked cursor costs
exactly nothing, which is what makes it safe to leave on top of video. On a phone
the whole layer does not exist.

## 4. Scale — "not too big, not too small"

The trap: a TV at 1080p can report density **1.0** (most boxes) or **2.0**
(Shield, some Sony panels). At density 2 the WebView thinks it is 960 CSS px
wide and renders the site's **tablet** layout on a 55-inch screen. So:

**Normalise the layout to 1920 CSS px on every TV.** `setInitialScale` does not
do this for a page that already carries `<meta name="viewport" content="width=device-width">`
— the layout width stays `physicalWidth / density`, so a density-2 box gets a
960-unit viewport and the site's *tablet* design. What does work is rewriting the
viewport meta itself (`assets/tv-viewport.js`, injected on every page):

```
width=1920, initial-scale=(cssWidth / 1920)
```

Blink re-computes the layout viewport when that attribute changes, so the site
lays out as a 1920-wide desktop and the scale factor fills the panel exactly —
1080p@1.0 → scale 1, 1080p@2.0 (Shield) → 0.5, 720p@1.0 → 0.667. Same CSS for
every box, no per-device numbers, and nothing about the site is rewritten.

**Two guards**, because the page is not ours and the player is:

- it never runs on `localhost` (our own player) — an earlier version applied it
  there too and cut the player in half (see §11.6);
- after applying, it measures the document; if the layout is wider than the
  visible viewport (a WebView can clamp `initial-scale`), it puts the original
  meta back. Wrong-but-readable beats right-but-clipped.

Then a text bump for viewing distance: `WebSettings.setTextZoom(115)` — a
documented WebView knob that scales text **without** compounding through nested
elements (unlike `em`/`zoom` hacks, which break card layouts). Tune 110–120 in
one place: `TvUi.TEXT_ZOOM`.

| Quantity | Value (1080p) | Why |
|---|---|---|
| Overscan safe area | 32 px (1.7 %) horizontal/vertical, from the native container | 5 % overscan still exists on some panels |
| Body text | 24–26 px effective (≈ 115 % of the site's 21–22 px) | legible at 3 m / 3.5 m |
| Page title / hero | 44–56 px | hierarchy survives a big panel |
| Minimum focusable height | 56 px | D-pad target, not a mouse target |
| Card width in a rail | 300–340 px, 24 px gap | ~5.5 cards visible — "there's more" is legible |
| Focus ring | 4 px, 4 px offset | contrast at distance |
| Player OSD | controls at 64 px tall, 5 % from edges, auto-hide 4 s | cinematic, no clutter |

The values above are the *design* numbers, measured in the 1920-unit layout the
viewport rewrite guarantees — so they hold on 720p, 1080p and 4K alike, because
the layout is always 1920 units and only the scale factor changes.
**Test matrix:** 720p (`-tvdpi`), 1080p@1.0, 1080p@2.0 (Shield), 4K@2.0.

---

## 5. No ads on TV

Scope, stated precisely so mobile cannot regress:

- TV: `refreshUnlock()` returns early → no `VerifyWall`, no 12-hour timer, no
  Chrome ad wall. `/verify` deep links open the app directly.
- Phone: unchanged, byte for byte — the ad path is guarded by one `if (isTv)`.
- Optional (decision D4): also drop the site's own ad scripts/resources in TV
  mode (`shouldInterceptRequest` blocklist for known ad hosts) and hide ad slots
  with injected CSS. Cheap, but any site that gates content on an ad script
  would break → only with a live "retry without blocking" escape hatch.
- Honest limit: **ads inside the third-party embeds** (tgvid, vidfast, …) are
  served by those hosts in their iframe. We cannot remove them without breaking
  playback. TV will show fewer ads, not zero.

---

## 6. "Nothing must break when the website updates"

The contract we depend on — write it down once, check it per release
(`docs/TV-CONTRACT.md`):

1. Cards and links are real `<a href>` / `<button>` (or carry `tabindex`/`role`).
2. Horizontal rails live in a scrollable ancestor.
3. `meta viewport` is `width=device-width`.
4. Nothing essential is hover-only or drag-only.
5. Content is reachable without a pointer gesture (no swipe-only carousels).

Guards so a violation degrades instead of bricking:

- **Kill switch**: pref `ogpb_tv_ui` — if a site update breaks navigation, a
  long-press BACK (or a hidden tap sequence) turns the TV layer off and reloads
  the plain page. Support can also flip it remotely later.
- **Self-test screen** (hidden, reachable with `MENU` on the splash): reports
  candidate count, first-focus result, per-direction move success, layout width
  in CSS px, density, textZoom, server count from the current harvest. A 60-second
  TV QA pass after any site deploy.
- **Auto-demote** (decision D3): if the engine finds zero candidates 3 s after
  load on two pages in a row, reload the **bundled snapshot** instead of live —
  the TV keeps a known-good site while the phone stays live-first.
- The existing live→bundled fallback stays as-is: a dead site is never a dead app.

---

## 7. Distribution: direct APK (sideload, no Play Store)

Constraints that **disappear**: Play policy, TV listing review, a separate TV
package, Play size limits, "the TV app must pass review".

What replaces them, and still matters on a sideloaded TV:

1. **The TV launcher still needs a banner.** `android:banner` (320×180 + 640×360)
   plus the `LEANBACK_LAUNCHER` intent filter are what put the app on the Android
   TV home screen as a real tile; without them it is a bare letter tile or not
   listed at all. That is a *launcher* requirement, not a Play one. Sideloading
   ignores `<uses-feature>` (no filtering risk) — keep the flags anyway, they are
   correct and free.
2. **Signing stability — DONE.** The old builds were signed by a per-run debug
   keystore, which is why an update could only be installed after uninstalling
   (and losing every download). There is now a single committed key:
   `android/app/fumio-release.p12` (PKCS12, alias `fumio`, 30-year self-signed
   cert, SHA-256 `E3:4D:70:3A:…:F1:B9`), wired into **both** build types in
   `android/app/build.gradle`, so the debug APK CI publishes carries it too.
   Consequence, stated once: **the first APK with this key still needs one
   uninstall** (different signature from the old builds). Every build after
   that installs over the top. The key is committed on purpose — a sideloaded
   app has no store identity to protect, and a key in a CI secret is a key
   someone forgets to set. Rotating it later means the same one-time uninstall.
3. **How it reaches a TV.** Pick one path and document it in `docs/TV-INSTALL.md`:
   `adb install -r` over USB or `adb connect` wireless debugging (best for us),
   a Downloader-style short code, or USB stick + a file manager on the box.
   Include the "enable developer options on Android TV" steps — they differ per
   vendor, and that is where people give up.
4. **Updating without a browser.** Most TVs have no browser and typing a URL with
   a remote is miserable. In-app updater (decision D6): read the public releases
   (`api.github.com/repos/themithology/Fumio/releases`), compare with
   `BuildConfig`, download the APK to cache, hand it to the system installer via
   `FileProvider` + `ACTION_VIEW` (`REQUEST_INSTALL_PACKAGES`). One
   D-pad-reachable button and an "Update" badge on the TV home. Highest-value
   sideload feature there is.
5. **Storage.** Many boxes ship 8–16 GB. Cap the offline queue (2 in flight),
   show free space before queuing, offer "keep the newest N". `Downloader`
   already targets external Downloads / external files dir — keep it, but a full
   disk is a dead app on a TV.
6. **Auth on TV.** Google sign-in in a WebView with a remote is the worst part of
   a first run: no fast typing, no QR. Options: device-code flow ("open
   theogpiratebot.online/tv, enter `4F2K-9Q`"), or anonymous-first on TV and never
   ask (recommended default — everything except synced watchlists works). Decide
   before T4, not during it.
7. **Text input.** Search works (Android TV IME) but is slow on a remote. In TV
   mode inject a D-pad grid keyboard for the search field, and put "Continue
   watching" first so a normal session needs no typing at all.
8. **Playback performance.** Embeds are iframes in a WebView on cheap GPUs. Test
   the worst box you have at 1080p. If a box stutters, that is the host embed,
   not our layout — no app fix saves it. `OfflinePlayerActivity` (Media3) stays
   the guaranteed-smooth route for downloaded files.

One artifact or two? With no store we can publish a single universal APK (one
link, one update path — recommended) or the same code as `app.apk` +
`app-tv.apk` where the TV one defaults the TV layer on and hides touch-only
affordances. Same source, same package (`com.fumio.app`), same signing key —
only a build-config default differs (decision D5).

## 8. Phases (each one shippable, each one phone-safe)

| # | Ships | Risk to phone | Notes |
|---|---|---|---|
| **T0** ✅ | Manifest: `uses-feature leanback / touchscreen / gamepad` (all `required=false`), `LEANBACK_LAUNCHER` filter, `android:banner` (320×180 + 640×360), `REQUEST_INSTALL_PACKAGES` | **none** (additive manifest; package still `com.fumio.app`) | shipped: the app now appears as a proper TV tile |
| **T1** ✅ | `TvMode` (ui-mode TELEVISION / leanback / FEATURE_TELEVISION), ad-free gate in `ensureUnlocked`, `TvUi.apply` (textZoom 115, zoom controls off), viewport rewrite in `assets/tv-viewport.js` | **none** (one `if` in one method) | shipped: a TV build with no verify wall, laid out as 1920 CSS px |
| **T2** ✅ | **Cursor remote** (decided): `TvPointer` + `TvCursorView` + `assets/tv-cursor.js` (target outline, forgiving click, hover), `dispatchKeyEvent` routing, `TvUi` split into live-site vs own-page injection. The earlier D-pad engine was removed. | **none** (only when `TvMode.isTv`) | 25/25 in `docs/tv-ui.test.cjs`; needs a real remote to sign off |
| **T3** | TV player surface: big OSD, server row (`ServerPickerBar` as a horizontal focus rail), quality/audio/subtitle menus, 10 s seek, resume, D-pad everywhere, MKV track menus in `OfflinePlayerActivity` | player code is shared → touched, but behind `window.__fumioTv` / `isTv`; phone visuals unchanged | our surface, safest place to invest |
| **T4** | Native TV Home spotlight (C) + D-pad pass on `DownloadsActivity` / offline player | new screen only | the "wow" screen |
| **T5** | Self-test screen, kill switch, auto-demote, TV smoke-test checklist in CI notes | none | the durability layer |
| **T6** | Sideload plumbing: stable signing key, `docs/TV-INSTALL.md`, in-app updater (D6) | none (release plumbing only) | do the signing part **early**, before people start keeping downloads on a TV |

T0–T2 is the honest MVP ("TV app that works"). T3 is the one that makes it feel
premium. T4 is the showcase. T5/T6 are what keep it alive across site deploys and
across sideload updates.

---

## 9. Open decisions

- **D1 — browse surface:** A (skin the live site) / C (A + native TV Home) /
  B (native shell, not recommended).
- **D2 — TV Home:** build the native spotlight now, or after the player surface
  is great?
- **D3 — site-drift safety:** auto-demote to the bundled snapshot, or stay
  live-first with only the manual kill switch?
- **D4 — ad-free scope:** skip our verify wall only (safe), or also block the
  site's own ad hosts in TV mode (riskier, needs an escape hatch)?
- **D5 — artifacts:** one universal APK, or `app.apk` + `app-tv.apk` from the
  same code and key?
- **D6 — in-app updater:** build it (no browser on a TV), or keep "download the
  new APK on a phone, push it over adb"?

## 10. Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| Debug builds signed with a per-run key | cannot update over the old install; uninstall wipes downloads | verify cert SHA-256 across two releases; move to one stable keystore (§7.2) |
| No browser on TV | user cannot reach a new APK | in-app updater (D6) or `adb install -r` |
| TV box with 8 GB storage fills up | downloads fail, app feels broken | queue cap + free-space check (§7.5) |
| Google sign-in unusable with a remote | first run dead-ends on TV | anonymous-first, or device-code flow (§7.6) |

| Risk | Impact | Mitigation |
|---|---|---|
| Site renders tablet layout on density-2 TVs | UI looks broken on Shield | `setInitialScale(100/density)` + viewport normalisation, verified on a density-2 profile |
| Site ships div-based cards | D-pad cannot reach content | role+`[onclick]`+cursor heuristics, relaxed second pass, self-test catches it |
| Focus engine fights WebView scrolling | jank / lost focus | consume DPAD natively; single owner of scroll (`scrollIntoView`) |
| Text bump breaks card layout | clipped titles | `setTextZoom` only, 110–120 band, screenshot check at 4 sizes |
| TV surface leaks into phone | regression in shipped phone app | one `TvMode.isTv()` gate at boot; injection only on TV; phone APK diff = manifest only |
| Embed iframe ads on TV | expectation mismatch | stated up front, in-app note on first TV launch |

---

## 11. B in practice — the native shell

### 11.1 Screens (each one a new Activity; the phone app never sees them)

| Screen | What it is | Data | Ships |
|---|---|---|---|
| `TvHomeActivity` | hero billboard + vertical rails (Trending, Popular movies, Popular series, Top rated, Anime, Continue watching, My downloads) | `/tmdb/trending/all/week`, `/tmdb/movie/popular`, `/tmdb/tv/popular`, `/tmdb/movie/top_rated`, anime via the site's `/api/anime-trending`, local prefs for the last two rails | 1 |
| `TvDetailsActivity` | backdrop, title, year/runtime/rating, overview, Play, season + episode rails, "More like this" | `/tmdb/{type}/{id}` + `/tmdb/{type}/{id}/season/{n}` | 2 |
| `TvSearchActivity` | D-pad grid keyboard + results rail | `/tmdb/search/multi` | 3 |
| player | **existing** `FumioPlayerOverlay` (WebView, our React player) — unchanged | `/api/players` → harvest → bundled | 0 |
| downloads | **existing** `DownloadsActivity`, given a D-pad pass | local | 3 |

`MainActivity` stays the phone app. On a TV it does one thing differently: if
`TvMode.isTv(this)` and the shell pref is on, it launches `TvHomeActivity` and
finishes, so the WebView never loads the site at all on a TV.

### 11.2 Focus, natively

RecyclerView + `LinearLayoutManager`: vertical list of rails, each rail a
horizontal RecyclerView with `ItemBridgeAdapter`-free focus handling:

- cards are `focusable=true` views; the rail scrolls the focused card to 35 % of
  its width (same convention as the WebView engine);
- `nextFocusDown` is left to Android's geometric default, which already does the
  right thing inside a RecyclerView — with one exception: the *rail* must
  remember its last focused card, so moving down and back up returns to the same
  column. One field per rail.
- `android:descendantFocusability="afterDescendants"` on the containers, and
  `android:focusable="false"` on the page root, so the first D-pad press lands on
  a card and not on nothing (the classic "TV app that ignores the remote until
  you press down twice" bug).
- BACK: close the details, then home; on home it asks to exit (`AlertDialog`),
  because a TV remote's BACK is the only way out and hitting it twice by
  accident should not kill the app.

The shell keeps the same input model as everywhere else on a TV build: the
cursor (`TvPointer`), because a native focus ring and a web cursor behave
differently enough that two models on one box is exactly the inconsistency this
whole redesign exists to avoid.

### 11.3 Look, without a design system

- 1080p layout; `values-tvdpi`/`values-xxhdpi` dimension buckets expressed as
  `dp` from a single `dimens.xml` so a 720p box is proportional, not clipped.
- Cards: 320×180 (16:9) poster art, 12 dp radius, title 22 sp, meta 16 sp,
  focus = 1.06 scale + a 2 dp white outline (mirrors the cursor's target
  outline, so the whole app highlights the same way).
- Rows: 24 dp gutters, 56 dp between rails, safe area 48 dp on all sides
  (overscan), no scrollbars, no ripple-tap artefacts.
- Palette: black background, the site's yellow `#ffd400` as the only accent.
- Images: **Coil** (`io.coil-kt:coil:2.7.0`, Java API usable from Java) with a
  memory+disk cache, so a rail scrolls without re-downloading posters.
- Reduced motion honoured; no parallax; nothing animates longer than 150 ms.

### 11.4 What "adaptable when the website updates" means for B

| Website changes | Effect on TV |
|---|---|
| a server is renamed / reordered / added | none — `/api/players` (or harvest) feeds the picker at play time |
| a new TMDB row is added to the site | **not** automatic (the native rows are our own list) → the row list lives in one Java array, `TvRows.java`, deliberately easy to edit; the *content* of every row is still live |
| the player or the ad wall changes | none — TV never loads the player page, and has no ad wall |
| the site adds a whole new hub (e.g. Live TV) | needs a native screen when we want it there; until then Live TV is reachable in the fallback WebView |
| the site dies | TV keeps working entirely: catalogs come from the TMDB proxies, playback from the cached/harvested list, downloads are local |

That last row is the real argument for B: **the TV build gets more robust, not
less**, because it stops depending on a page rendering.

### 11.5 Build order (each step is a shippable APK)

1. `TvRows` + `TvHomeActivity` with three rows and a working "Play" hand-off.
2. `TvDetailsActivity` (movie and series, season/episode pickers).
3. Search + downloads pass.
4. Hero billboard, Continue-watching rail, anime rail.
5. Polish: focus memory per rail, transitions, self-test screen.

Every step is guarded by `TvMode.isTv(...)` at the `MainActivity` entry point,
so a bad TV build can never change what a phone does.

---

## 12. Post-mortem: the player was cut in half (2026-11-05)

**Symptom.** On a TV the player showed a 1920-wide layout inside a smaller
visual viewport: the embed's "no source available" text was sliced at the left
edge, roughly half the frame off screen.

**Cause.** `assets/tv-viewport.js` was injected into *every* WebView, including
our own bundled player at `https://localhost/…`. It rewrote that page's viewport
meta to `width=1920, initial-scale=cssWidth/1920`. If the WebView clamps
`initial-scale` (or the page re-derives its own scale), the layout viewport is
wider than the picture and a `position: fixed; inset: 0` player — which is
exactly what `Player.jsx` renders — is laid out at 1920 while only part of it
fits. The screenshot of the embed is that overflow.

**Fix, three layers.**

1. The viewport rewrite is only injected into the live site:
   `TvUi.onLivePageFinished` vs `TvUi.onOwnPageFinished` (pointer helper only).
   `tv-viewport.js` also refuses outright when `location.hostname` is
   `localhost`.
2. Self-healing: after applying, it measures `scrollWidth` against
   `innerWidth`; on overflow it restores the original meta after 700 ms.
3. `Player.jsx` no longer sizes itself with `h-[100dvh] w-[100dvw]`; it is
   `fixed inset-0 h-full w-full`. Dynamic-viewport units can disagree with the
   layout viewport in a WebView; pinning to the containing block cannot.

**Rule for anything added later:** the live site may be told what screen it is
on. Our own pages must never be — they already know, because we ship them.
