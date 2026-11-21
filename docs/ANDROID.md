# The Android app (`android/`)

Capacitor 7 shell, package **`com.fumio.app`** — one APK for a phone and a
television (TV behaviour is switched on at runtime, never by a separate build).

- `minSdkVersion 23`, `targetSdkVersion 35`, `compileSdk 35`
- `webDir: dist` — the same web build as the site (`npx cap sync android`)
- signing: `android/app/fumio-release.p12`, alias `fumio` (see below)
- version: `versionCode = OGPB_VERSION_CODE` (CI stamps the run number),
  `versionName = "1.<versionCode>"`

## Popups: one window, one decision

`onCreateWindow` cannot decide what a popup is, because the page calls
`window.open()` and only *then* gives the window a URL. So every user-gesture
popup gets:

1. a 2×2 **invisible** probe WebView attached to the content frame (a WebView
   only loads once it is in a window, and nothing may appear on screen before
   we know what the window is for), then
2. one decision in `handlePopupUrl` on the popup's first navigation.

| The popup is… | What happens |
|---|---|
| the site itself (`/download`, a download portal) | loaded in the **main window** — BACK and the site's header work, and its file links reach `DownloadManager` |
| `/my-downloads` | opens the native download library |
| a direct file (`.mkv`, `.mp4`, `.zip`, …) | handed straight to `Downloader`, popup closed |
| Discord / Telegram / Instagram | opened in the browser |
| Google / Firebase (sign-in) | revealed as a popup, never sent to Chrome |
| anything else | **dropped** — this is the ad block, on every server's play button |

A popup that never navigates anywhere is dropped after 1.5 s, so an ad popunder
cannot leave a blank black screen.

Foreign http(s) navigations from the site's own pages are swallowed too: the
site's deliberate external links use `FumioNative.openBrowser`. `mailto:`,
`tel:` and `sms:` still reach the phone.

## The shell in one paragraph

Capacitor loads the bundled web build at `https://localhost`, and the shell
immediately navigates to `https://theogpiratebot.online/`. Everything you see is
the live site, except the four things the app owns: the **player**, the
**downloads**, the **access wall**, and the **update prompt** — plus, on a TV,
the **cursor**.

## Surviving a dead renderer

A WebView is a separate process. When the system kills it — and on a TV it will,
because it is the largest thing in the app — Android's default is to crash the
**whole application**. Both WebViews here handle it:

- **Browse** (`TrustedWebViewClient.onRenderProcessGone`): the dead view is
  destroyed and the activity is rebuilt. The viewer sees the site reload.
- **Player** (`FumioPlayerOverlay`'s own handler): the player is closed and the
  browse page comes back with its resume point intact.

Related, and in the manifest: `android:largeHeap="true"` and
`android:hardwareAccelerated="true"`. `MainActivity.onTrimMemory` frees renderer
memory and, at the worst level, the WebView cache — bounded to once per 15 s.
`FumioPlayerOverlay` releases every `<video>` (`pause`, `removeAttribute('src')`,
`load()`) **before** its WebView is destroyed, which is what stops decoders
piling up across episodes.

The last uncaught exception is written to `files/last-crash.txt` and shown by
`#diagnostics` — see [`TV.md`](TV.md#diagnostics--the-crash-report-without-a-cable).

## Files

| File | Job |
|---|---|
| `MainActivity.java` | the host: WebView clients, link/interception policy, bridge, offline screen wiring, updater trigger, back handling |
| `FumioPlayerOverlay.java` | the app's own player (full-screen overlay WebView) |
| `LiveSourceSync.java` | fetches the **live** server list: `/api/players`, else harvest, else bundled |
| `LiveServers.java` | binds that list to the player; fallback list lives here |
| `Downloader.java` | hands file links to Android's `DownloadManager` (cookies + referer + user agent carried over) |
| `DownloadsLibrary.java` | index of finished downloads (resume positions, titles) |
| `DownloadsActivity.java` | the downloads screen inside the app |
| `OfflinePlayerActivity.java` | plays a downloaded file: ExoPlayer, resume, subtitle/audio track pickers |
| `OfflineScreen.java` | the bundled "Something went wrong" screen (see [OFFLINE-SCREEN.md](OFFLINE-SCREEN.md)) |
| `Updater.java` | checks GitHub releases, downloads, hands to the installer |
| `VerifyClient.java` | the entitlement check against `/api/verify/*` |
| `VerifyWall.java` | the 12-hour access wall (phone only; a TV never sees it) |
| `NativeHttp.java` | HTTPS from native, no Origin header (the reason the account API works at all) |
| `InAppGoogleAuth.java` | Google sign-in inside the app |
| `SystemBars.java` | status/navigation bar behaviour for browse vs player |
| `TvMode.java` | "is this a television?" |
| `TvUi.java` | TV page setup: viewport normalisation, text zoom, script injection, key routing |
| `TvPointer.java` | the pointer: motion, hover, press, scrolling, hints |
| `TvCursorView.java` | the ring itself (small view, moved by translation only) |

## The JS bridge

### Page → app (`window.FumioNative`)

| Method | Used for |
|---|---|
| `openBrowser(url)` | leave the app for a link (`_blank`, `mailto:`, Discord) |
| `signInWithGoogle()` | start the native Google flow |
| `openWatch(type,id,season,episode)` | open the app player |
| `openWatchServer(type,id,season,episode,server)` | open the app player on a named server |
| `openDownloads()` | the downloads screen |
| `playDownloaded(uri,title)` | play a downloaded file |
| `lockLandscape()` / `unlockOrientation()` | the player's orientation |
| `requestJson(method,url,headers,body,id)` | HTTPS without CORS — the reply arrives as a `fumio-native-http` event with `{id, result}` |
| `tvTarget(point)` | TV: the target's centre under the ring |
| `tvScrollZone(payload)` | TV: the scrollable strip under the cursor |
| `tvInputFocused(bool)` | TV: the remote belongs to a text field |

### App → page (`window.FumioTv*`, TV only)

`FumioTvHoverF(fx,fy)`, `FumioTvTapPoint()`, `FumioTvClick()`, `FumioTvPress()`,
`FumioTvSawPress()`, `FumioTvScroll(dx,dy)`, `FumioTvScrollable()`,
`FumioTvTarget()`, `FumioTvVisibleTarget()`. Full contract:
[TV-CONTRACT.md](TV-CONTRACT.md).

## Link policy (what stays inside the WebView)

- `theogpiratebot.online` and `*.theogpiratebot.online` → in-app.
- Google / Firebase / reCAPTCHA → in-app (sign-in needs them); never sent to Chrome.
- Discord, `mailto:`, `tel:`, any other app scheme, other `_blank` targets → the
  system browser or the matching app.
- Download links → `Downloader` (Android's `DownloadManager`), not the WebView.
- The site's **`/player` page is never embedded**: a `pushState` to a player
  route, or an embed iframe appearing, opens `FumioPlayerOverlay` instead.

## Downloads and offline playback

1. A file link is captured in the shell (`shouldOverrideUrlLoading` /
   download listener) and handed to `DownloadManager`, with the page's cookies,
   user agent and referer so authenticated/expiring links still work.
2. Files land in the public **Downloads** folder; if that is not writable, in the
   app's own files dir. `DownloadsLibrary` records title, size and time.
3. Playback uses `OfflinePlayerActivity` (ExoPlayer) with resume position, audio
   track and subtitle pickers — no network needed.

## Updater

- `Updater.checkAndPrompt()` runs once per launch (after the window exists — a
  dialog shown from `onCreate` throws `BadTokenException`) and at most every 6 h.
- It asks the GitHub releases API for the highest
  `theogpiratebot-apk-<n>`; if `n > versionCode`, it offers the update.
- The APK downloads into the app cache and is handed to the **system installer**.
  Never silent.
- Every dialog goes through `safeShow()`, so a prompt can never crash a launch.
- **Installs over the old build** because every release is signed with the same
  key — which is why `fumio-release.p12` is committed. The one exception is the
  first build after the key was introduced: that needs one uninstall.

## Access wall

`VerifyClient` + `VerifyWall`: a 12-hour entitlement keyed by a random
`installId` (a UUID in `SharedPreferences`; no device fingerprint, no IMEI, no
MAC). Phones see the wall, televisions do not. Full detail:
[DATA-LAYER-PLAN.md](DATA-LAYER-PLAN.md#the-access-wall).

## Building

```bash
npm install && npm run build
npx cap sync android
cd android && ./gradlew assembleDebug      # or just push: CI builds it
```
Details and the signature caveat: [../SETUP.md](../SETUP.md).
