# Android TV build — plan & brainstorm

Status: **planning only.** Nothing in this document is implemented yet.
Target: one APK, `com.fumio.app`, that is a good phone app **and** a genuinely
good 10-foot app — D-pad first, no ad wall, proportions that read from 3 m,
and it must not break the day the website ships something new.

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

## 2. The core fork (pick one)

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

## 3. D-pad navigation design (the key component)

### 3.1 Key map

| Key | Browse | Player overlay | Native screens |
|---|---|---|---|
| DPAD ↑↓←→ | move focus (spatial) | ↑↓ = OSD / server row, ←→ = seek ∓10 s | move focus |
| DPAD_CENTER / ENTER | activate focused element | play / pause | activate |
| BACK | `history.back()`, at root → "Exit?" | close OSD, then close player | up a level, then exit |
| MEDIA_PLAY_PAUSE / FF / REW | — | play-pause / +60 s / −60 s | — |
| MENU | focus the site's top bar / app menu | open server row | context menu |
| long-press OK | open details of focused card | — | — |

Rules: **we consume DPAD/ENTER/BACK ourselves** and forward them as JS calls;
we never rely on WebView's built-in arrow scrolling (it fights our engine and
gives no focus ring). All other keys fall through to the WebView so text inputs
(search) behave normally — with one guard: while an `<input>`/`<textarea>` has
focus, DPAD passes through instead of being consumed.

### 3.2 Focus engine (`tv-nav.js`) — designed to survive site updates

Collect candidates **by role, not by name**:
`a[href], button, [role=button], [tabindex]:not([tabindex="-1"]), input, select`
— plus, on demand, `[onclick]` and any element the site marks as a card.
Drop invisible ones (`offsetParent`, zero box, `visibility:hidden`, `opacity:0`,
`pointer-events:none`, `aria-hidden`).

Move focus **geometrically**: from the focused rect, score every other
candidate by angle-weighted distance (primary-axis gap first, cross-axis offset
as penalty), keep the best, `el.focus({preventScroll:true})`, then
`scrollIntoView({block:'center', inline:'center', behavior:'smooth'})` and, if
the nearest scrollable ancestor is horizontal, `scrollLeft` it so the focused
card lands at ~35 % of the row (streaming-service convention, not dead centre).

Because scoring uses bounding boxes only, **a new card component, a renamed
class, or a reordered rail still navigates correctly** — the one thing that can
defeat it is a clickable `<div>` with no `href`/`tabindex`/`role`, so we include
`[onclick]` and a "clickable-ish" heuristic (cursor:pointer + text) as a second
pass.

Escape hatches (so the user is never trapped):
- nothing found in a direction → try scrolling the page by 40 % of the viewport;
  if that did nothing, re-run the search with the relaxed candidate set;
- focus lost after a route change → focus the first card in the main content
  region, never the footer;
- a toast / modal appears → trap focus inside it, restore on close;
- `Escape`/BACK inside a modal → close the modal, don't leave the page.

### 3.3 Focus ring
The site styles `:hover`, which does not exist on a TV. Injected CSS gives every
focusable a TV ring and mirrors hover-ish emphasis:

```css
:focus { outline: none; }
:focus-visible, .fumio-tv-focus {
  outline: 4px solid #ffd400;          /* 4 px reads from 3 m at 1080p */
  outline-offset: 4px;
  border-radius: 10px;
  transform: scale(1.05);
  box-shadow: 0 12px 40px rgba(0,0,0,.65);
  z-index: 2;
  transition: transform .12s ease, box-shadow .12s ease;
}
@media (prefers-reduced-motion: reduce) { /* no scale */ }
```

Also: `:focus-within` for cards, `scroll-margin: 12vh` so a focused card is
never flush against an edge, `::selection` off, and `cursor` rules removed.

---

## 4. Scale — "not too big, not too small"

The trap: a TV at 1080p can report density **1.0** (most boxes) or **2.0**
(Shield, some Sony panels). At density 2 the WebView thinks it is 960 CSS px
wide and renders the site's **tablet** layout on a 55-inch screen. So:

**Normalise the layout to 1920 CSS px on every TV** — `setInitialScale(round(100 / density))`
(100 at density 1, 50 at density 2) + `setUseWideViewPort(true)`, then apply a
14 % text bump for viewing distance with `webSettings.setTextZoom(115)` — a
documented WebView knob that scales text **without** compounding through nested
elements (unlike `em`/`zoom` hacks, which break card layouts). Tune 110–120 in
one place.

| Quantity | Value (1080p) | Why |
|---|---|---|
| Overscan safe area | 32 px (1.7 %) horizontal/vertical, from the native container | 5 % overscan still exists on some panels |
| Body text | 24–26 px effective (≈ 115 % of the site's 21–22 px) | legible at 3 m / 3.5 m |
| Page title / hero | 44–56 px | hierarchy survives a big panel |
| Minimum focusable height | 56 px | D-pad target, not a mouse target |
| Card width in a rail | 300–340 px, 24 px gap | ~5.5 cards visible — "there's more" is legible |
| Focus ring | 4 px, 4 px offset | contrast at distance |
| Player OSD | controls at 64 px tall, 5 % from edges, auto-hide 4 s | cinematic, no clutter |

Not one number is hardcoded per screen: the CSS uses `vw`/`clamp()` (e.g.
`font-size: clamp(22px, 1.25vw, 30px)`) so 720p and 4K are both proportional.
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
2. **Signing stability — settle this before the first TV build.** CI runs
   `assembleDebug` and there is **no keystore in the repo**
   (`git ls-files | grep -i keystore` → empty), so each runner generates a fresh
   debug keystore. If that is what has been happening, two builds have different
   signatures, and:
   - the new APK **cannot install over the old one**
     (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`) → uninstall → **downloads, resume
     points and prefs are wiped**;
   - any "sign in once" state dies with it.

   On a TV that hurts far more than on a phone: nobody wants to re-download
   several GB with a remote. Fix: one keystore, generated once, stored as a
   base64 CI secret, stable signing key. **Verify before assuming** —
   `apksigner verify --print-certs` on two consecutive releases and compare the
   SHA-256; if they match, the runner is reusing a keystore and nothing is broken.
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
| **T0** | Manifest: `uses-feature leanback (required=false)`, `touchscreen (required=false)`, `LEANBACK_LAUNCHER` intent filter, `android:banner` 320×180 + 640×360, `android:screenOrientation="landscape"` handled at runtime for TV only | **none** (additive manifest, single APK, package stays `com.fumio.app`) | TV icon shows up on the launcher; phone behaviour identical |
| **T1** | `TvMode` detection (`UI_MODE_TYPE_TELEVISION` / `FEATURE_LEANBACK` / `FEATURE_TELEVISION`), ad-free gate, viewport+density normalisation, safe area | **none** (guarded by `isTv`) | first installable TV build; site is browsable with a remote but no focus ring yet |
| **T2** | `tv-nav.js` spatial engine + `tv.css` (focus ring, hit sizes, type scale) + native key router | **none** (file only injected on TV) | the phase that decides whether TV feels good |
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
