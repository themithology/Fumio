## What CI runs now

There is no TV in this project, so the tests moved into the two places that
exist without one.

### `.github/workflows/tests.yml` — `unit-tests` (JVM, ~90 s, every push)

| Suite | What it guarantees |
|---|---|
| `UpdaterTest` | the update decision: highest build wins (not the first), prereleases count (every CI build is one), non-build tags / releases with no `.apk` / non-https assets are refused, garbage in the feed is survived |
| `DownloaderTest` | what counts as a downloadable file, against the URL shapes the pools actually emit |
| `TvModeTest` | a TV is recognised by all four paths; a phone is not; a vendor service that throws fails **closed** (a phone wrongly answering TV would skip the ad wall) |
| `TvRemoteKeysTest` | the JS string literal for a typed character — a stray quote there silently drops that character |
| `docs/tv-ui.test.cjs` | the injected TV scripts, in jsdom — 67 checks |
| `docs/offline-screen.test.cjs` | the "Something went wrong" screen, its socials and its reason line |

The updater's rule lived inside a network call until it was extracted to
`Updater.bestRelease(JSONArray)` — pure, no Android, and therefore testable.
That extraction is the only production change the tests required.

### `.github/workflows/tests.yml` — `tv-emulator` (a real TV, ~4 min)

An Android TV system image (API 33, x86 — the newest TV image the SDK
publishes) is booted on the runner, and `TvBehaviourTest` runs **on it**:

1. the image really is a television (`UI_MODE_TYPE_TELEVISION`);
2. `TvMode.isTv` agrees — the boolean the whole TV path hangs off;
3. the leanback **and** phone launcher entries both resolve, via
   `queryIntentActivities` (the same question a TV home screen asks);
4. the application carries a banner;
5. the `versionCode` is stamped, so the updater has something to compare;
6. `offline.html` is readable from the APK.

The emulator step is deliberately manual — no emulator action: create the AVD,
boot it, wait for `sys.boot_completed`, and refuse to continue unless something
about the device says television. Every failure prints the emulator's own log.

Practical notes, learned the hard way: the SDK has **no x86_64 TV image** (only
`x86` and `arm64-v8a`, up to API 33), `/dev/kvm` exists but is not writable by
the build user until a udev rule is installed, `avdmanager` and `emulator`
disagree about where AVDs live (pin `ANDROID_AVD_HOME`), and a
software-rendered TV image needs ~5 minutes to boot — so the loop gives it 20 and
reports progress.

### What still cannot be automated

Pointer feel, hover cadence, a rail that scrolls under a thumb, how readable
`TEXT_ZOOM=115` is from a sofa. An emulator has no remote and no 10-foot
judgement; a test that cannot feel the difference would only lie. Those stay
manual, and are listed in the table above.

# Testing — and what honestly cannot be tested here

There is no Android SDK and no television in the development sandbox, so the
strategy is: **prove everything that can be proven headlessly, and say plainly
what must be checked on a device.** Two harnesses do the proving; CI does the
compiling.

## Run everything

```bash
npm ci
npx vite build                      # the web bundle the APK ships

npm install --no-save jsdom         # test-only, deliberately not a dependency
npm run test:tv-ui                  # 67 checks
npm run test:offline-screen         # the failure screen

cd android && ./gradlew testDebugUnitTest   # updater, downloads, TV detection
```

The instrumented TV test needs a device:

```bash
cd android && ./gradlew :app:connectedDebugAndroidTest
```

Both harnesses find jsdom wherever it was installed (`node_modules`, or the
`/tmp` scratch install this repo is sometimes worked on), so they run unchanged
locally and in CI.

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

`.github/workflows/tests.yml` then proves the *behaviour*: see "What CI runs now"
above. The APK job and the test jobs are separate on purpose — a slow TV
emulator must never delay or block a release build.

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

## The tests that pin "learned, not hardcoded"

| Test | What it proves |
|---|---|
| `EmbedTitleTest` — `everyGrammarTheSiteEmitsIsUnderstood` | one live path per grammar the site emits (`/embed/`, `/player/`, `/watch/`, `/movie/`), copied from `src/utils/serverRegistry.js` in `themithology/Iris` |
| `EmbedTitleTest` — `aSeasonlessTvUrlDoesNotInventEpisodeOne` | the anime lane's shape is not silently "season 1, episode 1" |
| `EmbedTitleTest` — `landingPagesAndAssetsAreNotPlayers` | `/api/v1/health`, `/assets/app.js`, `/demo` are not handed to the player |
| `LiveServersTest` | a host the bundle knows **before any network call** is recognised, as is a subdomain of it; an unrelated host is not |

When the site changes a provider path or moves a host, one of these fails with
the URL in the message — which is the whole point of testing the grammar rather
than the provider.
