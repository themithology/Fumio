# Television mode

One APK. TV behaviour is not a separate build: it is the same app, switched on by
a single boolean. If `TvMode.isTv()` is false, **not one line of TV code runs** —
which is what keeps the phone path untouched.

For the bug-by-bug history see [TV-AUDIT.md](TV-AUDIT.md). For installing on a
set, [TV-INSTALL.md](TV-INSTALL.md). For the JS ↔ native interface,
[TV-CONTRACT.md](TV-CONTRACT.md).

## How a TV is recognised (`TvMode.java`)

Any of: the system UI mode is `TELEVISION`, the device declares `leanback`, the
device declares `FEATURE_TELEVISION`, or the legacy
`android.hardware.type.television` feature. Touch support is **never** used as
the test — some boxes report it.

## No D-pad navigation — a cursor, always

The browse UI is the live website: we do not own it, and it changes when its owner
changes it. A focus engine can only move between elements the page admits are
focusable, so the moment a card is a plain `<div>`, or a control is a slider, or a
menu opens on hover, a focus ring has nowhere to go. A cursor has no such
dependency.

The pointer is a **ring** (`TvCursorView`):

- **Hotspot = the centre of the view.** An arrow's hotspot is its tip, and the
  first version placed the view at `x − 44dp` while drawing the tip 44dp inside
  it — so every press landed 44dp up and to the left of what the viewer saw. A
  centred ring cannot drift from its own coordinates.
- **A small view (120 dp), hardware layer, moved by translation only.** No
  layout, no redraw, no damage to the WebView's layer. The first version was a
  full-screen overlay repainted every frame; that is what made the page itself
  stutter.
- **1:1 while holding.** The aim advances every frame; the ring is placed on it
  with no easing. Only a *tap* eases (30 ms), because a tap is a jump.
- **Press feedback**: a short shrink and a ripple that finishes inside the same
  110 ms window, so nothing is left half-drawn.

### Feel

| | Value | Why |
|---|---|---|
| Tap | no step; a tap is simply a short hold | the old 16 dp jump on press was the D-pad tell: snap, pause, catch up |
| Ramp to full speed | 400 ms | 240 ms was twitchy on a 10-foot screen |
| Full speed | crosses the screen in 1.5 s | 1.05 s overshot the card it was aimed at |
| Start speed | 26 % of full | a 120 ms tap crosses about half a card, so it can be stopped where it was meant |
| Hold watchdog | 1.2 s without a key event | IR/Bluetooth remotes really do lose a key-up; without this the ring glides on its own |

**There is no focus ring.** An outline box around whatever the pointer is over
looked like D-pad navigation and cost a style recalculation per card. The ring
is the only feedback, and `OK` presses the pixel under it.

## Hover — the part that makes it a mouse

Two separate jobs, and the split is the whole trick:

1. **The page's own hover** (`:hover`, `mouseenter`, preview menus, tooltips):
   a real hover motion event goes into the WebView, `ACTION_HOVER_ENTER` first
   (a document that has never been entered will not look at a hover move), then
   `ACTION_HOVER_MOVE` — ~30 Hz with a 1 px dead zone while aiming slowly, ~9 Hz
   while sweeping (nobody reads a hover state at sweep speed, and the work
   competes with drawing the ring), and one exact event at rest. **No bridge
   call is involved**; Chromium turns it into mouse events itself.
2. **Our outline** ("what will OK press?"): needs the DOM, so it is a bridge call
   — throttled to 150 ms, never during a sweep, and exact at rest.

Hover is re-entered after a scroll, after a route change, and dropped when the
app loses the window.

## Scrolling — rails first, page second

A card rail is an inner `overflow-x` container that usually ends well inside the
screen, so "the cursor reached the screen edge" is the wrong trigger. The page
publishes the scrollable strip under the cursor (bounds as fractions + which axes
can still move); native stops the cursor at **that** edge and scrolls **that**
element, at ~80 ms intervals. The strip is refreshed as it scrolls, so a press can
never over-shoot.

## Pressing

A press is a **real touch** (`ACTION_DOWN`/`UP`) at the outlined target's centre,
with a minimum contact time so the page sees a real gesture — drag rails,
press-and-hold menus and pointer-listener controls all work. Two safety nets:

- If the page reports the touch produced **no click** (`FumioTvSawPress`), a full
  pointer/mouse/click sequence is dispatched (`FumioTvPress`) and, failing that,
  the link is followed.
- A key-up that never arrives is covered by the hold watchdog.

The "no navigation = no reaction" assumption is gone: a Play button that opens a
panel, a mute toggle or a menu all leave the URL alone, and pressing them twice
was a real bug.

## Scaling

- The **live site** is told it is `1920` CSS px wide, with `initial-scale =
  cssWidth / 1920`, so a 1080p panel renders the desktop layout instead of the
  tablet one. Two guards: it is never applied to **our own** pages (that once cut
  the player in half), and it reverts itself if the document ends up wider than
  the viewport.
- `textZoom = 115` lifts body text for a 3 m viewing distance.
- Our own pages (player, offline screen) are left exactly as they are.

## Other TV behaviour

- **No verify wall** — and the entitlement prefetch is skipped, so a TV makes no
  `/api/verify` request at all.
- **No ads.**
- `TvUi.setInputFocused(true)` (a text field has focus) hides the ring and gives
  the remote to the keyboard; on blur the ring comes back at the same aim.
- The ring is **re-raised** whenever the top surface changes (player overlay
  open/close), because the overlay is a sibling added after the cursor.
- BACK closes the offline screen, then the player, then goes back in the WebView.
- MENU/INFO re-shows the three-line hint.

## What a TV still cannot do, by design

- Pick up the **OS cursor**: a WebView only accepts synthetic events through
  public APIs. A genuine system cursor needs `uinput` (root, or a Shizuku shell
  user-service) — a separate, optional feature, not the default path.
- Read `isTrusted` OS mouse events: no site that demands those can be satisfied
  from any WebView app.

## Typing: the search box on a sofa

Focusing a search field is easy on a TV. **Putting characters in it is not** —
most Android TV boxes ship no soft keyboard at all, so "show the IME" can
legitimately open nothing and the viewer is left pointing at an empty field.

Both paths are live at once, and neither depends on the other:

| Path | Works when | Where |
|---|---|---|
| **Character forwarding** | always, including D-pad-only remotes with letters | `TvRemoteKeys` → `FumioTvType` / `FumioTvBackspace` in `tv-cursor.js` |
| **System IME** | the box actually has a keyboard installed | `TvUi.showKeyboard` (`showSoftInput`) |

### What counts as "needs a keyboard"

Not `tagName === "INPUT"` — that is also a checkbox, a radio and a submit
button, and treating those as typing hid the pointer over a control that needs
no keyboard. The page classifies the focused element and sends one of
`none`, `single`, `search`, `multiline`, `picker`:

| State | Ring | Keyboard | Remote letters |
|---|---|---|---|
| `single` / `search` / `multiline` | hidden | requested | typed into the field |
| `picker` (a `<select>`) | **kept** | no | no — OK opens it, arrows drive it |
| `none`, or a readonly/disabled field | kept | no | no |

Input types that count: `text, search, url, email, password, tel, number, date,
datetime-local, month, time, week`, plus `<textarea>` and `contenteditable`.
A checkbox, radio, button, range and file input are **not** typing.

### Keys while typing

| Key | Result |
|---|---|
| A–Z, 0–9, punctuation, SHIFT | the character, inserted at the caret |
| DEL / FORWARD_DEL | backspace |
| OK / ENTER | **not** swallowed — the page's own submit runs the search |
| BACK | leaves the field (the app's BACK still exits on the next press) |
| arrows, MENU, volume, media, power | **not** swallowed — a page's autocomplete uses arrows, and the box owns its volume |

Insertion goes through `document.execCommand("insertText")` first, because a
React-controlled input keeps its own copy of `value` and assigning `.value`
directly is invisible to it for ever; the `.value` + `setSelectionRange` +
`input` event path is the fallback for `contenteditable` and for WebViews where
`execCommand` is gone.

### The two bugs this fixed

- **Ticking a checkbox muted the pointer.** Any `<input>` counted as typing, so
  the ring was hidden and the remote handed to a keyboard that was never needed.
- **A React re-render could trap the app in "typing" for ever.** Replacing the
  focused node fires no `focusout`; `document.activeElement` silently becomes
  `<body>` and the ring never came back. The page now re-checks once a second
  *only while it believes it is typing*, which is a cheap comparison and the only
  thing that recovers that state.

### The crash this feature caused (and the rule that prevents it)

A `@JavascriptInterface` method runs on the WebView's **JavaBridge thread**, not
on the thread that owns the views. `tvInputState` ends in `View.setVisibility`
and `setTranslationX`; from the bridge thread that throws
`CalledFromWrongThreadException`, and an uncaught one takes the whole app down —
no dialog, straight to the TV home screen.

So: **every bridge callback that touches a view hops to the UI thread first**
(`runOnUiThread`), and `TvPointer.setTyping` re-posts itself if it ever finds
itself on the wrong thread anyway. Both are asserted on the TV emulator:
`theTypingStateSurvivesBeingCalledOffTheUiThread` calls it from a background
thread and requires that nothing throws.

This is the same class of crash as the dead-renderer one in #5, and the lesson is
the same: on a television there is no log for the viewer to read, so the app must
survive the mistake rather than report it.

### The ring must always come back

Three separate guarantees, because "the mouse disappeared" is the worst bug this
feature can cause:

1. **A new document starts with nothing focused.** `TvUi.forgetInputFocus()` runs
   on every page finish, so a page that loads after a search cannot inherit
   "typing" from the page before it.
2. **`TvPointer.onPageFinished` re-arms the ring** unconditionally. The pointer
   never depends on a script that might not have run yet.
3. **BACK is an escape hatch.** The first press asks the page to blur; the second
   is handed to the app, because a field the page refuses to give up must not
   trap the viewer on a screen with no other exit.

Also: exactly **one** editor watchdog timer per document. The script is
re-injected on every page finish, and without clearing the old interval an SPA
would accumulate one per navigation, each scanning the DOM every second.

### The keyboard must not cover the field

The app is full screen with the WebView laid out edge to edge. `TvUi
.watchKeyboardInsets` gives the WebView the IME inset as bottom padding while
typing, and takes it back on blur — so a search box at the bottom of a 1080p
screen is not under the keyboard.

## Memory — why the app used to crash on a TV

A TV box is not a small phone; it is a device with 1.5–2 GB of RAM shared with
the system UI, a decoder, and whatever the launcher keeps. Two things killed
this app there, and both are handled:

| What happened | Why | Where it is handled |
|---|---|---|
| A hard crash to the TV home screen, no dialog | On Android 8+, a killed **WebView renderer** crashes the whole app unless `onRenderProcessGone` is overridden. On a TV the renderer is the biggest thing in the process, so the system targets it first. | `TrustedWebViewClient.onRenderProcessGone` rebuilds the activity instead of dying; the **player** overlay has its own handler that closes the player and returns to the browse page |
| It died after a few episodes, not on the first | Each film's `<video>` held its decoder buffers after the overlay was destroyed. Three or four in an evening is enough. | `FumioPlayerOverlay.RELEASE_MEDIA` runs before the WebView is destroyed: `pause()`, `removeAttribute('src')`, `load()` — the documented way to make a media element give its decoder back immediately |
| Killed while a 4K stream decoded | The app held more memory than the system was willing to give it | `android:largeHeap="true"` in the manifest, and `onTrimMemory` (below) |

`onTrimMemory` is the app giving memory back *before* the system decides to kill
it: at `RUNNING_CRITICAL` it frees renderer memory (`freeMemory`), at `COMPLETE`
it also clears the WebView cache. Bounded to once per 15 s — a cache clear is not
something to do per frame.

Nothing here changes what a viewer sees, except that the app stays open.

## `#diagnostics` — the crash report without a cable

On a television there is no adb and no DevTools, so a crash is otherwise
invisible. Two doors:

- **In the app**, put `#diagnostics` at the end of the address (any page of our
  own site, or the bundled build). A black panel covers the screen with: version,
  Android version, whether it thinks this is a TV, heap used/max, and the last
  uncaught exception — class, first frame, message. Tap it to dismiss.
- **Over the network**, if you can reach the box with adb:
  ```bash
  adb connect <TV-IP>:5555
  adb logcat -s FumioCrash:* AndroidRuntime:E
  ```
  Renderer deaths log as `FumioCrash: WebView renderer gone (crashed=true)`.

The crash trail is written by an uncaught-exception handler to
`files/last-crash.txt`. Nothing is uploaded, ever, and **there is no interface
to upload WebView console messages** — that would be a remote script surface
triggered by the site, which is the last thing a wrapper needs.

`

## What CI proves, and what only the sofa can

`.github/workflows/tests.yml` boots a real Android TV image and asserts the four
things that decide whether this is a TV app: the image is a television, `TvMode`
agrees, both launcher entries resolve, and the version is stamped for the
updater. It also runs the injected script harnesses (48 checks) and the JVM
tests for the updater, downloads and TV detection.

It cannot tell you whether the pointer *feels* right. Nothing without a remote
can. See [`TESTING.md`](TESTING.md#what-cannot-be-tested-here--check-on-the-device).

## The self-test line

`TvPointer.state()` returns `aim=…, drawn=…, held=…` for logs. If the drawn
position ever differs from the aim while parked, the frame loop has stopped —
that is the first thing to check.
