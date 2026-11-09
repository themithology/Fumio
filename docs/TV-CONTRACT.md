# The TV contract — JS ↔ native

Injected page scripts and the native pointer talk through a small, fixed
interface. This document is the contract: change one side, change the other, and
update this file. (Native side: `TvPointer.java`, `TvUi.java`, `MainActivity.java`.
Page side: `android/app/src/main/assets/tv-cursor.js`.)

## Coordinates — the rule that prevents most bugs

Native never sends pixels. It sends **fractions of the WebView's box** (0…1).

Why: the page's own coordinate space is not the view's. The layout viewport can be
1920 CSS px on a 1280 px screen (the TV normaliser), `elementFromPoint` takes
*client* pixels that ignore page scroll, and density/text-zoom move the ratio too.
A fraction survives all of them because the page divides its own viewport by the
same fraction.

Two exceptions, both deliberate:

- **Touch events** are dispatched in **view** coordinates and must **not** have
  `getScrollX/Y` added (a WebView scrolls its content, it does not move the view).
- **Hover events** are view coordinates too, computed as
  `cursorView − webViewLocationInWindow`.

## Native → page (`window.FumioTv*`)

| Function | Arguments | Returns | Meaning |
|---|---|---|---|
| `FumioTvHoverF(fx, fy)` | fractions | `bool` (a target exists) | Resolve what is under the point, outline it, publish tap centre |
| `FumioTvTapPoint()` | — | `"fx,fy"` or `""` | The outlined target's centre, for a forgiving tap |
| `FumioTvClick()` | — | `bool` | DOM click on the outlined target (legacy path) |
| `FumioTvPress()` | — | `bool` | Full pointer/mouse/click sequence on the outlined target |
| `FumioTvSawPress()` | — | `bool` | Did the last touch become a click? Resets on read |
| `FumioTvScroll(dx, dy)` | `-1\|0\|1` | `bool` | Scroll the strip under the cursor; page second |
| `FumioTvScrollable()` | — | JSON `{x,y}` | Diagnostics: can the page scroll each way |
| `FumioTvTarget()` / `FumioTvVisibleTarget()` | — | `bool` | Is there a live outlined target |

## Page → native (`window.FumioNative`, TV members)

| Method | Payload | When |
|---|---|---|
| `tvTarget(point)` | `"fx,fy"` (6 dp) | the outlined target's centre changed |
| `tvScrollZone(payload)` | `"l,t,r,b,canX,canY"` (fractions, 4 dp) | the scrollable strip under the cursor changed |
| `tvInputFocused(bool)` | — | focus entered/left a text field |

`tvTarget` and `tvScrollZone` are **published, not polled**: native never asks the
page where something is during a glide, so no bridge round-trip is on the frame
path.

## Event flow for one press

```
key DOWN (OK)
  └ native: pulse the ring, ensure the target is current
    └ tap at (fx,fy) from the last published centre, as ACTION_DOWN
      └ 70 ms later: ACTION_UP                      ← the page's own click
        └ 850 ms later, only if the page says no click happened:
             FumioTvPress() → pointer/mouse/click, then follow the link
```

## Event flow for a hover

```
frame (ring moved ≥ 1 px, ≥ 28 ms since last)
  └ native: ACTION_HOVER_ENTER once per document
    └ ACTION_HOVER_MOVE at the ring's exact position   ← the page's :hover
      └ every 150 ms while aiming (never while sweeping):
           FumioTvHoverF(fx,fy)                        ← our outline
```

## Invariants

1. **The ring is never eased during a hold** — it is placed on the aim.
2. **A fraction is always clamped to 0…1 by native before sending.**
3. **`FumioTvHoverF` clears its per-element `getComputedStyle` cache** on each
   resolve, so a stylesheet swap is never stale; within a resolve the cache saves
   every repeated ancestor walk.
4. **The outline is drawn with `outline` + `box-shadow`**, never anything that
   takes layout space: a target must never move the page it sits on.
5. **Any new `window.FumioTv*` function must be added to `docs/tv-ui.test.cjs`**
   — that harness is the only thing that runs before a TV does.
