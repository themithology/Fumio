# TV audit — 2026-11-05

A full pass over everything the television build touches, done the way the bug
reports came in: read the code, find what is wrong with it, fix it, and say
plainly what has and has not been verified.

Legend: **fixed** = changed in this repo; **verified** = a test or a build here
proves it; **unverified** = needs the television.

## What the reports were

| Report | Root cause | State |
|---|---|---|
| Player cut off on TV (screenshot 1) | the live-site viewport rewrite (`width=1920`) was being injected into **our own** player page as well | fixed, verified (harness + build) |
| Cursor responds on the home page, not on a scrolled season rail | **coordinates**: view pixels were passed to `document.elementFromPoint`, which wants *client* pixels — they differ by the page scroll offset, and by the page-scale factor | fixed, verified (harness) |
| Clicking does nothing on some cards | a DOM `element.click()` only fires `click`; anything driven by pointer/touch events (drag rails, motion cards) ignored it | fixed (real `ACTION_DOWN`/`ACTION_UP`) |
| Cursor jumps instead of gliding | discrete 20 dp steps | fixed (aim + eased render on a vsync loop) |

## Round 2 (2026-11-06) — reported after #106

| Report | Cause | Fix |
|---|---|---|
| Horizontal scrolling does not work (season cards, home rails) | scrolling was triggered only at the **screen** edge and only ever called `window.scrollBy`. A card rail is an inner `overflow-x` container that ends well inside the screen, so it never scrolled at all. | The page now publishes the scrollable strip under the cursor (bounds + which axes can still move) as fractions; native stops the cursor at **that** edge and scrolls **that** element. The strip is refreshed as it scrolls, so one press can never over-shoot. |
| Inside the player, nothing responded (servers, subtitles, play/pause) | the pointer kept pointing at the **browse** WebView after the player overlay opened: arrows moved a cursor over the video and every OK was delivered to the hidden page behind it. | `TvPointer.ensureTarget()` runs on every key, so the pointer follows whichever surface is in front. |
| Play does nothing on movies/series | two causes: (a) the tap only sent a touch, so a control wired to pointer/mouse events ignored it; (b) if the target's centre was off screen the point was **clamped** to the viewport edge — tapping whatever sat at the edge instead of the button. | (a) after 850 ms with no URL change, `FumioTvPress()` dispatches the full pointer/mouse/click sequence and, failing that, follows the link itself. It never fires when the touch already worked. (b) an off-screen target is scrolled into view first; if it still cannot fit, we report no point and tap where the arrow is rather than somewhere wrong. |

## Round 3 (2026-11-07) — reported after #112

| Report | Cause | Fix |
|---|---|---|
| Clicks land **up and left** of the pointer | two independent bugs. (a) the cursor view was placed at `x − 44dp` and then drew its arrow tip 44dp *inside* itself, so the painted arrow was 44dp right and down of the point it was actually pressing. (b) the press added `getScrollX/Y` to a **view** coordinate — `dispatchTouchEvent` does not take the view's scroll offset — so every tap on a scrolled page was off by the scroll position. | the pointer is a **ring**: the hotspot is the centre of the view and the view is centred on the point, so the drawn position and the pressed position are the same number. The scroll offset is gone from the press path, and a published tap centre is only trusted while the ring is still on the target that produced it. |
| Hover does not work | hover was sent **once**, after a glide finished, and never sent `ACTION_HOVER_ENTER` — until a document has been entered Chromium refuses to treat it as hovered, so the page never saw a pointer at all. | two separate jobs: a real hover motion event **every frame the ring moves** (entered first, 1 px dead zone, ~35 Hz, no bridge involved) so the page's own `:hover`/`mouseenter`/menus work as under a mouse; and the outline, which needs the DOM and stays throttled to 150 ms plus one exact call at rest. Re-entered after a scroll and on every route change. |
| Pointer drifts away / too fast | full speed crossed the screen in 0.40 s from a 190 ms ramp, so a press held a moment too long threw the ring across the screen | 1.25 s to cross, 420 ms ramp, from 28 % of full speed; a tap is 16 dp |
| Whole app lags, "but the site in a browser is fine" | three things in our injected `fumio-player.js` ran from one MutationObserver callback, and that callback fires on every React re-render: a **full-document `querySelectorAll`**, `innerText` over a list of modal candidates (which forces Blink to lay out each one), and `fitScreen()` (reads `getComputedStyle`, **writes inline styles** — a read→write→recalc loop) | the observer handles only the records that changed, the sweep is debounced to 400 ms and capped, `innerText` → `textContent`, and `fitScreen` runs only on load / resize / route change. The frame loop no longer allocates (scratch arrays reused). |
| Pointer disappears in the player | the player overlay is a *sibling* added to the same content frame **after** the cursor, so it covered the ring while every press still went to the player | `TvPointer.raise()` puts the ring back on top whenever the top surface changes |
| A press does the thing twice | when a press did not change the URL the DOM-click fallback fired anyway — "no navigation" is not "no reaction" (a Play panel, a mute toggle, a menu) | the page answers *did that touch become a click?* (`FumioTvSawPress`) and the fallback only runs when the answer is no |

## Bugs found in the first audit, all fixed

1. **The pointer kept talking to a dead WebView.** After closing the player, the
   cursor's `target` still referenced the player's hidden WebView, so every
   hover and every click went there — the browse page looked dead. Now
   `TvPointer.retarget(...)` runs when the overlay closes and when the TV layer
   installs.
2. **The bundled fallback had no pointer at all.** When the live site fails, the
   app loads its own build — and the `onPageFinished` branch for that page
   returned before injecting anything, so the cursor could not resolve a target
   and every press landed blind. It now gets the pointer helper (still no
   viewport rewrite — it is our page).
3. **A held direction never released when the keyboard opened.** The key-up goes
   to the IME, so `held` stayed set and the cursor glided forever behind the
   keyboard. Typing now clears the held bits.
4. **Runaway frame loop.** If the WebView disappeared mid-glide, `advance()`
   returned early but `wantsFrames()` stayed true — a 60 fps loop drawing
   nothing, forever, on top of video. A dead WebView now clears `held`.
5. **The hint pill ghosted.** The loop invalidated only the cursor's rectangle
   while the pill fades in the top centre, so its old frames were never
   repainted. It has its own dirty region now.
6. **A stale tap point after a page scroll** (found by the harness, not by
   anyone's eyes): the target's centre was published once per *target*, so
   scrolling a rail under a stationary cursor left the click pointing at where
   the card used to be. It republishes whenever the point changes.
7. **No press/hold gesture.** A tap was a fixed 70 ms touch, which never reaches
   the drag threshold some rails use to distinguish a click from a swipe. A
   click is now a real press: DOWN on the key, UP on release, minimum 70 ms of
   contact, maximum 1.5 s if the key-up is swallowed.
8. **Orphaned gestures.** Two fast presses could leave the first DOWN without an
   UP. A generation counter guarantees exactly one UP per DOWN.
9. **The endpoint timeout was decorative.** `ENDPOINT_TIMEOUT_MS = 4000` was
   declared and never used, and `NativeHttp` had no timeout parameter, so a hung
   `/api/players` could stall for 15 s before the harvest fallback even started.
10. **The updater nagged forever.** After installing, the pending marker and the
    cached APK were never cleared, so every launch offered "Finish the update"
    for an update that had already happened. The pending *build number* is now
    recorded and cleared once the installed version is at least that.
11. **"Rotate your phone" could appear on a TV.** The player's portrait guard is
    a media query; a box that reports a portrait or square window (some do while
    starting up) got a dead-end screen asking the viewer to rotate a television.
    The guard is now excluded when `<html class="fumio-tv">` (which our TV layer
    sets on our pages).
12. **The player embed was not clickable-looking.** An `<iframe>` was not an
    actionable element, so the cursor showed no outline over the video and OK
    fell through to a blind tap. `iframe`, `video`, `object`, `embed` and
    `canvas` are targets now.
13. **The whole page could become the target.** `cursor: pointer` on `<body>`
    made the body the nearest "clickable" ancestor, so the outline covered the
    page and every click hit the body. The document root and body are excluded.
14. **A wasted request on every TV launch:** the ad-wall entitlement prefetch ran
    even though a television never shows the wall.

## Verified here

- `docs/tv-ui.test.cjs` — **32 checks**, including: the live-site viewport rewrite
  and both of its guards (localhost, overflow revert), fractions → client
  coordinates, the target's centre published and republished after a scroll,
  iframes as targets, body never a target, the field/keyboard handover.
- `npx vite build` (the web bundle the APK ships).
- The APK compiles and packages on CI.

## Not verified — needs the television

- Anything about **feel**: glide time constant (`TAU_MS = 50`), hold ramp
  (`RAMP_MS = 420`), tap step (`NUDGE_DP = 18`), scroll cadence.
- The press/hold gesture against the real season rail. If a rail still ignores
  the click, the next lever is a longer minimum press (300–400 ms) which defeats
  most drag thresholds — one constant.
- `TEXT_ZOOM = 115` on the live site: it can clip tight components. A taste
  call, one constant.
- z-order of the cursor over the player overlay on real hardware (we
  `bringToFront()` on every press and on every page finish).

## Known gaps (by design, not bugs)

- **`DownloadsActivity` and `OfflinePlayerActivity` are native screens** and use
  Android's own focus system, not the cursor. They are usable with a remote but
  look different from the cursor world. Converting them is the natural next step
  if you want one input model everywhere (they would need the same overlay).
- **Dialogs** (the updater's "Update available") are system dialogs; the remote
  drives them natively, not with our cursor.
- **Hover inside a cross-origin iframe** cannot be forwarded into the frame. The
  frame gets an outline as a whole; the tap goes in.
- **The updater offers every CI build.** While we iterate this means a prompt
  per release; "Skip this build" silences one.
