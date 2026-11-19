# Testing — and what honestly cannot be tested here

There is no Android SDK and no television in the development sandbox, so the
strategy is: **prove everything that can be proven headlessly, and say plainly
what must be checked on a device.** Two harnesses do the proving; CI does the
compiling.

## Run everything

```bash
npm ci
npx vite build                     # the web bundle the APK ships

npm install --prefix /tmp/tvtest jsdom
NODE_PATH=/tmp/tvtest/node_modules node docs/tv-ui.test.cjs          # 45 checks
NODE_PATH=/tmp/tvtest/node_modules node docs/offline-screen.test.cjs # the failure screen
```

`npm run lint` should also stay clean.

## What `tv-ui.test.cjs` covers

Loads the two injected assets in **jsdom** with a stubbed layout, because jsdom has
no hit-testing, no scroll geometry and no `elementFromPoint`:

- **the TV viewport normaliser**: 1080p at density 2 → `width=1920`,
  `initial-scale=0.5`; the localhost guard; the overflow revert.
- **coordinates**: fractions → client points; the published tap centre; the
  centre republished after a scroll; iframes as targets; `body` never a target;
  the field/keyboard handover.
- **rails**: the scroll zone publishes the *rail's* edge, not the screen's; a
  horizontal press moves the rail; a vertical press inside a rail still reaches
  the page.
- **presses**: the `FumioTvSawPress` guard (a touch that became a click is
  reported once; a touch that did nothing is reported as such).
- **routes**: `history.pushState` is wrapped, and a route change does not resolve
  synchronously.

## What `offline-screen.test.cjs` covers

The bundled screen, in jsdom: three social cards, the three exact URLs, three
official brand `path` payloads, the three buttons calling the bridge
(`open`/`retry`/`browse`), and the diagnosis line (hidden until native sends a
reason, exact text after).

## What CI proves

`.github/workflows/android-apk.yml`: `npm ci` → `npm run build` → Java 21 →
`cap sync` → signing key readable → **`assets/offline.html` is inside the APK** →
`gradlew assembleDebug` → release. A green run means the Java compiles, the assets
are packaged, and the APK installs as an update of the previous one.

## What cannot be tested here — check on the device

| Needs a device | Why |
|---|---|
| Pointer **feel** (1.05 s cross, 240 ms ramp, no step on press) | a matter of taste measured in a hand, not an assertion |
| Whether the site's hover menus open at ~30 Hz on your SoC | Chromium's hit-testing speed on that hardware |
| `TEXT_ZOOM = 115` | can clip tight components; it is one constant |
| Real season-rail drag thresholds | the min press (70 ms) is the lever if a rail ignores a tap |
| Player framing at 4K | layout at scale is the one thing jsdom cannot see |
| Z-order of the ring over the player | `TvPointer.raise()` handles it; a TV confirms it |

**The rule that follows:** anything shipped without a device check must be a
**constant**, not a code path, so it can be corrected in one line — and the change
must not be able to affect the phone.

## Debugging a report on a TV

1. `adb logcat -s FumioTv FumioTvPointer FumioOffline` — the TV layer logs its
   own tag.
2. `TvPointer.state()` → `aim=…, drawn=…, held=…`. If `drawn` ≠ `aim` while
   parked, the frame loop stopped.
3. The offline screen prints the failure reason in small type: DNS, TLS, timeout
   or HTTP 5xx — a screenshot of it is a bug report.
