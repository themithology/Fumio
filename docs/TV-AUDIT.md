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
| Play does nothing on movies/series | two causes: (a) the tap only sent a touch, so a control wired to pointer/mouse events ignored it; (b) if the target's centre was off screen the point was **clamped** to the viewport edge — tapping whatever sat at the edge instead of the button. | (a) after 850 ms with no URL change, `FumioTvPress()` dispatches the full pointer/mouse/click sequence and, failing that, follows the link itself. It never fires when the touch already worked. (b) an off-screen target is scrolled into view first; if it still cannot fit, we report no point and tap where the arrow is rather than somewhere wrong. |

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
