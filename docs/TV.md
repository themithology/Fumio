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
| Tap step | 16 dp | about one card; precise without being fiddly |
| Ramp to full speed | 420 ms | no spool-up, no jolt |
| Full speed | crosses the screen in 1.25 s | a deliberate mouse, not a rocket |
| Start speed | 28 % of full | first frames are fine aiming |
| Hold watchdog | 1.2 s without a key event | IR/Bluetooth remotes really do lose a key-up; without this the ring glides on its own |

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

## The self-test line

`TvPointer.state()` returns `aim=…, drawn=…, held=…` for logs. If the drawn
position ever differs from the aim while parked, the frame loop has stopped —
that is the first thing to check.
