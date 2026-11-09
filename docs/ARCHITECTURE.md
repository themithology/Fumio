# Architecture

Three parts, one repo. Nothing here is theoretical — every path below exists.

```
┌──────────────────────────────────────────────────────────────────────┐
│  src/ + public/ + index.html        THE WEBSITE (React 19 + Vite)    │
│  theogpiratebot.online — browse, search, details, player, accounts   │
└───────────────┬──────────────────────────────────────────────────────┘
                │  the same build is packed into the app
                ▼
┌──────────────────────────────────────────────────────────────────────┐
│  android/                            THE ANDROID SHELL (Capacitor 7) │
│  WebView = the live site   ┌── own player (FumioPlayerOverlay)        │
│  native layer  = downloads │── offline screen (OfflineScreen)         │
│                = updater   │── verify wall (VerifyWall, 12 h)        │
│                = TV cursor │── offline files player (OfflineActivity) │
└───────────────┬──────────────────────────────────────────────────────┘
                │  HTTPS, no key of its own
                ▼
┌──────────────────────────────────────────────────────────────────────┐
│  worker/                     TMDB PROXY (Cloudflare Worker)          │
│  holds the only real secret (TMDB key); the app never has it         │
└──────────────────────────────────────────────────────────────────────┘
```

## Who owns what

| Thing | Owner | Consequence |
|---|---|---|
| Browse UI, search, details, catalogue | **The live website** | It is loaded in a WebView, so a website deploy reaches every app instantly. The app does not re-implement any of it. |
| Server list (names, order, embed URLs) | **The live website** (`/api/players`, or the player page as a fallback) | Adding or renaming a server needs no APK release. See [PLAYER.md](PLAYER.md). |
| The player screen | **The app** (`FumioPlayerOverlay` + bundled React build) | The site's `/player` page is never embedded. |
| Downloads, offline playback, notifications | **The app** | Pure native, works with the site down. |
| Update prompt | **The app** (`Updater`) | Reads GitHub releases; the website is not involved. |
| Accounts and sync | **The website's API** (`theogpiratebot.online/api/db`) + Firebase | See [ACCOUNTS.md](ACCOUNTS.md) and [DATA-LAYER-PLAN.md](DATA-LAYER-PLAN.md). |
| "Something went wrong" screen | **The app** (`offline.html` in the APK) | Must work with no network at all. See [OFFLINE-SCREEN.md](OFFLINE-SCREEN.md). |

The rule that falls out of this table, and the one every change is checked against:
**anything the site owns must keep working by editing the site, never by shipping an APK.**

## Request flow, in the order it happens

1. **Launch.** Capacitor loads the bundled web build (`https://localhost`).
2. `MainActivity.onPageFinished` sees our own origin and immediately navigates to
   `https://theogpiratebot.online/` — the app is a shell around the live site, not
   a frozen copy.
3. The live site loads. `MainActivity` injects `fumio-player.js` (link handling,
   app-only chrome, iframe stealing) and, on a TV, `tv-viewport.js` +
   `tv-cursor.js`.
4. A press on something that leads to a player route is intercepted
   (`openAppPlayerFromWatch` / `pushState` hook) and opened in the **app's** player.
5. The player fetches the live server list (`LiveSourceSync` → `/api/players`,
   falling back to harvesting the site's player page), then plays in its own
   WebView.
6. Closing the player returns to the browse page, where it was.
7. On failure at any load step: the bundled offline screen, with the reason.

## Data flow (short version)

- **Device**: `localStorage` in the WebView (list, history, look, server choice),
  `SharedPreferences` (install id, unlock time, updater, server cache).
- **Server**: only for signed-in accounts — list/history/look via
  `/api/db/user/<uid>`, public profile via `/api/db/profile/<handle>`, entitlement
  via `/api/verify/*`.
- Full detail, including every key and retention rule: [DATA-LAYER-PLAN.md](DATA-LAYER-PLAN.md).

## Build pipeline

`.github/workflows/android-apk.yml`, on every push to `arena/**` or `main`:

1. `npm ci` → `npm run build` (the web build),
2. Java 21 + the runner's Android SDK,
3. `npx cap sync android` (copies `dist/` into the app),
4. verify the signing key, verify `assets/offline.html` is packaged,
5. `./gradlew assembleDebug` with `OGPB_VERSION_CODE=<run number>`,
6. publish `app-debug.apk` as release `theogpiratebot-apk-<run number>`.

The `versionCode` **is** the run number and the release tag **is** the same
number: that is the entire update protocol (see [ANDROID.md](ANDROID.md#updater)).

## Documentation map

| Document | Covers |
|---|---|
| [WEBSITE.md](WEBSITE.md) | the React app: pages, providers, utilities |
| [ANDROID.md](ANDROID.md) | the native shell, file by file, and the JS bridge |
| [PLAYER.md](PLAYER.md) | the app's own player and live server resolution |
| [ACCOUNTS.md](ACCOUNTS.md) | Firebase auth, profiles, the account API |
| [DATA-LAYER-PLAN.md](DATA-LAYER-PLAN.md) | every stored key, cap, and sync rule |
| [iris-players-endpoint.md](iris-players-endpoint.md) | the `GET /api/players` contract |
| [TV.md](TV.md) | TV mode: detection, scaling, cursor, input |
| [TV-CONTRACT.md](TV-CONTRACT.md) | the JS ↔ native interface on a TV |
| [TV-AUDIT.md](TV-AUDIT.md) | every TV bug found and fixed, round by round |
| [TV-INSTALL.md](TV-INSTALL.md) | installing and updating on a television |
| [OFFLINE-SCREEN.md](OFFLINE-SCREEN.md) | the bundled failure screen |
| [TESTING.md](TESTING.md) | what can be tested without a device |
| [CHANGELOG.md](CHANGELOG.md) | releases, APK by APK |
| [archive/](archive/) | superseded plans and prompts, kept for history |
