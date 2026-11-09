# Changelog

Every published APK, newest last. Release tag = `theogpiratebot-apk-<run number>`,
and that number **is** the `versionCode` the updater compares against.

Download the newest: <https://github.com/themithology/Fumio/releases/latest>

| APK | Commit | What changed |
|---|---|---|
| 106 | `b2e64d6` | **TV round 1.** Cursor-only input replaces D-pad navigation; viewport normalised to 1920 CSS px for the live site; text zoom for a 3 m distance; TV gets no verify wall. 14 bugs found in the first audit pass. |
| 107 | `d569553` | **Rails scroll for real** (a rail is an inner scroll container, not the page) and a press that cannot silently do nothing (real touch first, then a pointer/mouse sequence, then follow the link). |
| 108 | `2dfcef6` | The pointer follows you **into the player**: every OK used to be delivered to the hidden browse WebView. |
| 109 | `ae87668` | **The lag fix.** The cursor stopped being a full-screen overlay repainted every frame (that damaged the WebView's layer 60×/s); it became a small view moved by translation. Hover moved off the per-frame bridge path. `click()` no longer waits for a hover round-trip. **Crashes:** the update dialog is no longer shown from `onCreate` (`BadTokenException`), and the cursor views are released on destroy. |
| 110 | `715b214` | **Bundled "Something went wrong" screen** — Discord, Telegram, Instagram, Try again / Browse offline. Works with zero network. |
| 111 | `7a39f02` | The press ripple plays and finishes (it used to be one frozen frame). |
| 112 | `d1a5476` | CI fails the build if `offline.html` is missing from the APK. |
| 114 | `d1ec744` | **Pointer rewrite, part 1.** Ring instead of arrow (the arrow was painted 44 dp off its own hotspot — every press landed up and left); the scroll offset removed from the press path; real hover (`ACTION_HOVER_ENTER` first, then moves at ~30 Hz) so `:hover`, `mouseenter` and menus work; sensitivity halved; the injected player script stopped re-querying the whole document and stopped forcing layout with `innerText`. |
| 115 | `76a93cc` | Ring **visible over the player** (`raise()`); hover re-entered after a scroll; route changes re-resolve; **no more double activation** (`FumioTvSawPress`); ring hidden while typing; 3 px outline with a halo; route watcher backs off. |
| 116 | `4e314e5` | Docs: round 3 of the audit. |
| 118 | `31d6c57` | **Pointer rewrite, part 2 — no filters.** 1:1 ring movement during a hold (the easing on top of a per-frame curve was the mushiness); hover gated by speed (full cadence aiming, sparse sweeping, exact at rest); `getLocationInWindow` out of the frame path; **hold watchdog** (IR/Bluetooth remotes lose key-ups — the ring used to glide on its own); hold and hover released when the window loses focus. |
| 119 | `85a3c29` | The offline screen **says why** (DNS / TLS / timeout / HTTP 5xx) and **retries itself** when the network returns. |

## Not in a tag (documentation and tooling)

- `SETUP.md`, `.env.example` — how to build everything from a plain zip.
- `docs/` rewritten and indexed; superseded plans moved to `docs/archive/`.

## Known state

- **Signing:** every build from #109 on is signed with
  `android/app/fumio-release.p12`, so updates install over the previous one.
  Builds before that have a different signature and need one uninstall.
- **The old "Can't connect to the site" dialog** belongs to builds from before
  this repo's native layer (the hardcoded-server era). No current build shows it;
  the current app shows the bundled offline screen instead.
