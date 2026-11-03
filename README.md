# TheOGPirateBot

A small streaming app: **Home → Search → Details → Player**, with Iris-style
Anime and Live TV hubs. The app keeps TheOGPirateBot branding throughout and
uses the Iris/AniList data flow for anime seasons, episodes and schedules.

No ads, no party mode, no Discord bot, no admin panel. The frontend stays
optional-account and local-first: Firebase Auth is used only for sign-in, while
Iris's existing Node/SQLite `/api/db` service stores the signed-in member's
library. No Firestore list/history storage is used.
Branding (logo, name, colors, icons) is the real TheOGPirateBot identity,
copied straight from Iris's `public/` assets.

- **Home** (`/`) — Iris-style quality-first hero built from local history/My List plus TMDB top-rated fallback; Discord community recommendations (when Iris's `/api/recommendations/top` is available), local Continue Watching/My List, Top 10 Rated, Trending This Week, Picked For You, streaming-platform filters, Anime, Korean Dramas, Indian Cinema, Action & Crime, Sci-Fi & Horror, Comedy, and API-backed lazy rails.
- **Search** (`/search?q=...`) — TMDB multi-search (movies + TV), reachable
  from the search box in the header.
- **Anime** (`/anime`) — a reference-style anime hub with a rotating title-logo
  hero, Top 10, local recommendations, anime films, genre rails and quality
  filtering.
- **Movies** (`/movie`, `/movies`) and **Series** (`/tv`, `/series`) — dedicated
  cinematic hubs with hero spotlights, Top 10 rails, local recommendations,
  genre rows and filtered Explore links.
- **Schedule** (`/schedule`) — local-time weekly anime airing schedule with
  recently aired cards, day tabs, timeline status and manual episode actions.
- **Details** (`/details/:type/:id`) — Iris-style cinematic poster/backdrop
  details, API-backed title logo, cast and trailer, plus the Iris season/episode
  browser for TV. Anime season cards and episode cards come from the Iris
  AniList-backed API (`/api/anime-metadata` and `/api/anime-episodes`, with
  browser-direct GraphQL first). Resolved Iris data stays authoritative; TMDB
  seasons are used only for ordinary TV or when Iris cannot resolve a title.
  AniList `nextAiringEpisode` drives a live countdown with loading, ended and
  unavailable states.
- **Live TV** (`/live-tv`, `/live-tv/watch/:id`) — snapshot-first curated guide
  with runtime API enrichment/cache, channel logos, search, favorites, recents,
  retry states, channel zapping/picker and iframe playback. Channels with
  configured feeds also use direct HLS playback through hls.js.
- **Player** (`/watch/:type/:id?season=&episode=&server=`) — opens **directly
  in fullscreen** (the Fullscreen API is requested on the Details page's Play
  button click). The server selector stays in the bottom bar, including below the player when
  the layout permits. TG Vid is the preferred attempt; selecting another entry hands off to
  the existing fallback lane without mixing the two playback contracts.
  VidStuck, VidFast, Bingr, Roxy and NXSHA sources remain available,
  and Japanese anime titles resolve real AniList/MAL Sub/Dub lanes for
  MegaPlay, ZokoAnime and 4animo (Sub, Dub, Sub 2, Dub 2, Sub 3, Dub 3).
  Anime season/episode coordinates are carried separately from TMDB player
  coordinates, including split-cour segments and the Demon Slayer MAL
  carve-out. Stable server keys work in deep links and are saved globally and
  per title; sources never advance automatically after a viewer choice.
  On mobile, playback locks to landscape and shows a rotate-device guard in portrait.
  Exiting fullscreen or tapping the floating ✕ returns to Details. Opening a
  title records local Continue Watching progress context.
- **Account** (`/account`) — optional Firebase email/password or Google sign-in.
  Signed-out browsing, My List and playback remain local. A signed-in session
  merges local My List and Continue Watching with `/api/db/user/:uid`, then
  debounces changes back to Iris's own Node/SQLite service. Timeouts and server
  errors show a local-safe status and never disable browsing.

This plays **real content today** — it is not a demo/placeholder stream.
The player keeps its existing TMDB-keyed sources and episode-number
contract, while Iris remains authoritative for anime season/episode display
and mapping.

## Architecture

```
public/                 # Real TheOGPirateBot branding: logo.svg, favicons,
                          icons, manifest — copied from Iris's public/.
src/
  pages/
    Home.jsx             # full Iris-style quality/personalized home rails
    Search.jsx           # TMDB multi-search
    Details.jsx          # Iris-style details UI + API-backed Iris season/episode browser
    Player.jsx            # fullscreen shell: PlayerStage + close/back handling
    Account.jsx           # optional Firebase sign-in + SQLite sync status
    NotFound.jsx
  components/
    auth/                 # Firebase session hooks and email/Google form
    partials/Topnav.jsx    # branded top bar
    partials/FloatingNav.jsx # six-slot bottom dock
    partials/Cards.jsx     # poster cards used by browse/search
    PlayerStage.jsx        # TG Vid gate and explicit manual source choice
    the fallback player component # original sources + bottom server picker
    Loading.jsx
  providers/
    sources.js             # TG Vid primary plus the existing source list
    animeEmbeds.js         # AniList/MAL Anime Sub/Dub URL + episode resolver
  data/liveTvSnapshot.js   # curated Live TV guide and stream definitions
  utils/liveTv.js          # Live TV API/cache/favorites/recents
  utils/myList.js          # local-first My List storage/events
  utils/watchHistory.js    # local-first Continue Watching storage/events
  utils/accountSync.js     # merge/debounce/error-safe `/api/db` sync
  utils/dbApi.js           # authenticated Iris Node/SQLite API client
  utils/auth.js             # Firebase Auth session and sign-in helpers
  pages/Anime.jsx          # title-logo Anime hub
  pages/MediaHub.jsx       # Movies and Series hero hubs + filtered grids
  pages/Schedule.jsx       # local-time weekly Anime schedule
  pages/LiveTv*.jsx        # Live TV guide and theater
  lib/
    tmdb.js                 # fetch wrapper w/ failover + caching
    proxyTiers.js            # list of proxy bases to try, in order
    streamCheck.js            # asks the worker if a candidate source is alive

worker/                   # Cloudflare Worker — TMDB proxy + stream-check
  src/index.js             # probe (vendored/trimmed from Iris's edge worker)
  wrangler.toml

android/                  # Capacitor Android project (committed — the
                            # usual convention for native platform folders).
.github/workflows/
  android-apk.yml          # builds + publishes a debug APK on every push
```

### Data + proxy

`src/lib/proxyTiers.js` is a ladder of bases to try in order:

1. **Relative / same-origin** — in `npm run dev` this is forwarded by Vite
   to a **local Cloudflare Worker** running in `workerd` (the real CF
   runtime, not a mock) via `npm run worker:dev`. See `worker/`.
2. **Iris's existing live Cloudflare Workers** — the same TMDB proxy fleet
   Iris already runs in production. If your local worker has no
   `TMDB_API_KEY` set (or isn't running), the app transparently falls over
   to these.

Override with `VITE_PROXY_BASES="https://your-worker.workers.dev"` (comma
separated) in a `.env.local`.

### Optional accounts and the Iris data API

The client defaults to `https://theogpiratebot.online/api/db`, matching the
production Node/SQLite account service. Set `VITE_ACCOUNT_API_BASE` before
building when staging or another deployment uses a different API origin. The
server must allow the app origin for authenticated CORS requests. Firebase's
public web configuration defaults to the existing project and can be overridden
with `VITE_FIREBASE_*` variables when a deployment needs a different project.
These are public client settings; no SQLite credential is placed in the browser.

```bash
# Optional override for staging or another deployment.
VITE_ACCOUNT_API_BASE=https://theogpiratebot.online

# Or, for local Vite development with a Node server on port 3014:
VITE_ACCOUNT_API_DEV_TARGET=http://127.0.0.1:3014
```

```bash
cp worker/.dev.vars.example worker/.dev.vars   # then fill in TMDB_API_KEY
npm run worker:dev     # http://127.0.0.1:8787, via workerd
npm run dev            # Vite proxies /tmdb and /api to it
```

### The player: ours — the servers: the site's

The app has its **own** player: the bundled build (`https://localhost`), its own
iframe surface, its own picker, its own theme and its own ad behaviour. The
website's player page is **never** embedded — that was a wrong turn on
2026-10-28 and it is gone.

What comes from the website is the **server list** — names, order, count and
each embed URL — because the site is the thing the owner edits:

- `LiveSourceSync.java` **harvests** the site's own player page in an offscreen
  WebView: it waits for the site's React render, then clicks each
  `Server N (…)` button and records the iframe URL the site plays. Nothing is
  required from the website — no endpoint, no export, no hardcoded list.
  Buttons are matched by their LABEL (never by position, which drifts as the
  site re-renders), and a capture that misses any server the page rendered is
  discarded rather than half-used.
- The list is cached per title+episode for 6 hours and injected into the player
  page as `window.__fumioLiveSources`.
- `src/providers/liveSources.js` is the only consumer: when that array exists,
  `PlayerStage` feeds it to `FumioPlayerStage` instead of the bundled list.
- Nothing fetched? The bundled list stays. Playback never waits on the network
  call.

So: rename, reorder, add or retire a server on the website → the app shows it,
with no APK release.

Side effect worth knowing: browsing and the player share one origin, so
Continue Watching / the auth token live in a single `localStorage` instead of
two (`applySeed()` seeds it on player open).

The `src/providers/*` files in this repo remain the **offline / first-run
fallback** lane: they are what plays before the fetch lands, and when the site
cannot be reached at all.

### Downloads

`Downloader.java` replaces the old no-op `setDownloadListener` (the single
reason "download" never worked on mobile). Every file link — from the site's
`/download` window, from a popup portal, or a direct `.mkv`/`.mp4`/`.apk` hop —
goes to Android's `DownloadManager`:

- forwards the site's cookies, UA and referer so gated pools hand over the file;
- saves into the public `Downloads/` collection (API 29+, no permission) or the
  app folder on older devices;
- survives the WebView being destroyed, and its completion notification opens
  the file with whatever the phone has.

The site's `/download` page itself is no longer intercepted by
`MainActivity.handleExternalUrl`, and download portals opened with
`window.open()` now render in-app instead of being dismissed. `fumio-player.js`
(the script injected into the live site) no longer hides Download buttons,
swallows download clicks or bounces `/download` back to `/` — that whole block
existed only because downloads were dead.

**What is deliberately unchanged:** the smartlink/ad killing in
`fumio-player.js`, the popunder blocking in the player surface, and the
`/verify` gate (one ad wall in Chrome every 12 hours — `VerifyClient` /
`VerifyWall`). Ad behaviour is exactly what it was.

### Saved files + offline playback

- `DownloadsLibrary.java` records every enqueue (name, page title, mime,
  DownloadManager id) and folds live status back in, so the app can list what
  is actually on the phone.
- `DownloadsActivity.java` is the app's own **Downloads** screen: dark theme,
  one card per file, Play / Delete. Reachable at `/my-downloads` on the site's
  origin, or via `window.FumioNative.openDownloads()`.
- `OfflinePlayerActivity.java` plays a saved file natively with Media3
  (ExoPlayer): **MKV with every embedded audio track and subtitle selectable**,
  each labelled with its language, plus per-file resume. The website keeps its
  own player; a file on the phone does not need a WebView.

Everything in this section works with the network off.

### Stream sources + manual fallback

`src/providers/sources.js` keeps the two player lanes separate:

1. `TG_VID_SOURCE` is attempted first and has the compact always-available
   server selector.
2. If TG Vid cannot stay connected, `PlayerStage.jsx` leaves a visible
   failed/manual-choice state; it does not silently select another server.
3. The fallback player retains the existing source list and appends
   resolved Anime Sub/Dub slots only for titles whose Iris metadata produced a
   valid AniList/MAL reference. The active source is checked and timed out
   independently, but a failure only shows an error state; the viewer must
   choose another source in the picker.
4. Stable keys (`tgvid`, `vidstuck`, `sub`, `dub`, `sub2`, `dub2`, `sub3`,
   `dub3`, etc.) are honored by `?server=` and persisted per title/global.

TG Vid is never duplicated inside the fallback list. The viewer remains in
control of every server change, while the newer Anime lanes are available when
they can actually resolve.

## Running it

```bash
npm install
npm run worker:dev   # terminal 1 — local data proxy (optional, has fallback)
npm run dev           # terminal 2 — the app
```

Open `/` for Home, `/anime` for Anime, `/movie` for Movies, `/tv` for Series,
`/schedule` for the weekly schedule, or `/live-tv` for Live TV. You can also
jump straight to any `/details/{movie|tv}/{tmdbId}`.

## The Android APK

This sandbox has no Android SDK/Gradle and no network route to Google's/
Gradle's download hosts, so the APK is built by **GitHub Actions** instead
(`.github/workflows/android-apk.yml`) on every push. Check the repo's
**Releases** page for the newest `app-debug.apk` (tagged
`theogpiratebot-apk-<run number>`).

To build it yourself locally (needs Android Studio / JDK 17+ / Android SDK):

```bash
npm run build
npm run cap:sync
npm run cap:open       # opens Android Studio — Build > Build APK
```

### Android TV

The same APK runs on a television — no separate build, no Play Store. On a TV
it recognises itself (`TvMode`) and changes exactly three things:

- **No ad wall.** The `/verify` 12-hour unlock is skipped (`ensureUnlocked`),
  because a popup in front of a film on a family screen is the wrong trade.
  Phones are untouched.
- **A D-pad layer.** `MainActivity.dispatchKeyEvent` hands the remote to
  `assets/tv-nav.js`, a geometry-only focus engine (roles + bounding boxes, never
  the site's class names) with a 4 px focus ring from `assets/tv.css`. While a
  text field has focus the remote goes back to the page, so the TV keyboard
  works.
- **A 10-foot scale.** `assets/tv-viewport.js` rewrites the viewport meta to
  `width=1920` before the engine runs, so a box that reports density 2 lays out
  as a desktop rather than a tablet; `TvUi.TEXT_ZOOM` (115 %) covers viewing
  distance.

Also for TV (and useful on a phone): **`Updater`** — the app checks the GitHub
releases feed and installs the next APK itself, because most TVs have no
browser. Every build is signed with one committed key
(`android/app/fumio-release.p12`), so an update installs over the old one and
keeps downloads, resume points and settings.

Sideload instructions: **`docs/TV-INSTALL.md`**. The plan, the native-shell
build order and the risk register live in **`docs/PLAN-android-tv.md`**.

## Disclaimer

TheOGPirateBot is a media browser and player. It does not host, upload or
store any files, and it is not affiliated with any content provider. You
are responsible for the sources you use.
