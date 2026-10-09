# TheOGPirateBot

A small streaming app: **Home → Search → Details → Player**, with Iris-style
Anime and Live TV hubs. The app keeps TheOGPirateBot branding throughout and
uses the Iris/AniList data flow for anime seasons, episodes and schedules.

No ads, no party mode, no Discord bot, no admin panel, no Node backend.
Branding (logo, name, colors, icons) is the real TheOGPirateBot identity,
copied straight from Iris's `public/` assets.

- **Home** (`/`) — trending/popular/top-rated rows pulled from TMDB.
- **Search** (`/search?q=...`) — TMDB multi-search (movies + TV), reachable
  from the search box in the header.
- **Anime** (`/anime`) — a real API-backed anime hub with trending, popular,
  film and currently-airing rails.
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
- **Player** (`/watch/:type/:id?season=&episode=`) — opens **directly in
  fullscreen** (the Fullscreen API is requested on the Details page's Play
  button click). TG Vid is the only primary attempt. If it fails, playback
  hands off to Fumio's existing player as a separate fallback lane. Fumio's
  VidStuck, VidFast, Bingr, Roxy and NXSHA sources are exposed by a clear
  top-left manual server picker and never advance automatically. Exiting
  fullscreen or tapping the floating ✕ returns to Details.

This plays **real content today** — it is not a demo/placeholder stream.
The player keeps Fumio's existing TMDB-keyed sources and episode-number
contract, while Iris remains authoritative for anime season/episode display
and mapping.

## Architecture

```
public/                 # Real TheOGPirateBot branding: logo.svg, favicons,
                          icons, manifest — copied from Iris's public/.
src/
  pages/
    Home.jsx             # trending/popular/top-rated rows (TMDB)
    Search.jsx           # TMDB multi-search
    Details.jsx          # Iris-style details UI + API-backed Iris season/episode browser
    Player.jsx            # fullscreen shell: PlayerStage + close/back handling
    NotFound.jsx
  components/
    partials/Topnav.jsx    # branded top bar
    partials/FloatingNav.jsx # six-slot bottom dock
    partials/Cards.jsx     # poster cards used by browse/search
    PlayerStage.jsx        # TG Vid gate, then handoff to FumioPlayerStage
    FumioPlayerStage.jsx   # original sources + manual top-left server picker
    Loading.jsx
  providers/
    sources.js             # TG Vid primary plus Fumio's original source list
  data/liveTvSnapshot.js   # curated Live TV guide and stream definitions
  utils/liveTv.js          # Live TV API/cache/favorites/recents
  pages/Anime.jsx          # API-backed Anime hub
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

```bash
cp worker/.dev.vars.example worker/.dev.vars   # then fill in TMDB_API_KEY
npm run worker:dev     # http://127.0.0.1:8787, via workerd
npm run dev            # Vite proxies /tmdb and /api to it
```

### Stream sources + manual fallback

`src/providers/sources.js` keeps the two player lanes separate:

1. `TG_VID_SOURCE` is attempted first.
2. If its probe, iframe, or loading timeout fails, `PlayerStage.jsx` mounts
   `FumioPlayerStage.jsx`.
3. `FumioPlayerStage.jsx` retains Fumio's original source list. The active
   source is checked and timed out independently, but a failure only shows an
   error state; the viewer must choose another source in the top-left picker.

TG Vid is never duplicated inside the Fumio list, so the fallback is exactly
the existing Fumio player rather than a new mixed server order.

## Running it

```bash
npm install
npm run worker:dev   # terminal 1 — local data proxy (optional, has fallback)
npm run dev           # terminal 2 — the app
```

Open `/` for Home, `/anime` for Anime, or `/live-tv` for Live TV. You can
also jump straight to any `/details/{movie|tv}/{tmdbId}`.

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

## Disclaimer

TheOGPirateBot is a media browser and player. It does not host, upload or
store any files, and it is not affiliated with any content provider. You
are responsible for the sources you use.
