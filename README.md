# TheOGPirateBot

A small streaming app: **Home → Search → Details → Player**.
Live TV and Login already exist elsewhere — this app doesn't touch them.

No ads, no party mode, no Discord bot, no admin panel, no Node backend.
Branding (logo, name, colors, icons) is the real TheOGPirateBot identity,
copied straight from Iris's `public/` assets.

- **Home** (`/`) — trending/popular/top-rated rows pulled from TMDB.
- **Search** (`/search?q=...`) — TMDB multi-search (movies + TV), reachable
  from the search box in the header.
- **Details** (`/details/:type/:id`) — poster, title, overview,
  season/episode pickers for TV, a Play button. Anime season and episode
  labels/counts are loaded from Iris, with TMDB as the fallback for ordinary
  TV or when Iris is unavailable.
- **Player** (`/watch/:type/:id?season=&episode=`) — opens **directly in
  fullscreen** (the Fullscreen API is requested on the Details page's Play
  button click, since that's the only point in the flow with a real user
  gesture — by the time the Player route mounts it's too late to ask).
  There is **no Quality or Audio picker**. It tries TheOGPirateBot's real
  embed hosts (ported from Iris's `src/utils/players.js`: tgvid, vidstuck,
  vidfast, bingr, roxy, nxsha) **in order, automatically** — tgvid first,
  falling back silently to the next host if a source is down or fails to
  load. Exiting fullscreen (Esc / back gesture) or tapping the floating ✕
  returns to the Details page.

This plays **real content today** — it is not a demo/placeholder stream.
The one lane intentionally left out is Iris's anime-only Sub/Dub/ToonStream
set, which additionally needs the AniList season bridge and the
`/api/toon-stream` resolver from Iris's edge worker — straightforward to
port into `worker/src/index.js` as a fast follow if you want anime titles
on real sub/dub servers too.

## Architecture

```
public/                 # Real TheOGPirateBot branding: logo.svg, favicons,
                          icons, manifest — copied from Iris's public/.
src/
  pages/
    Home.jsx             # trending/popular/top-rated rows (TMDB)
    Search.jsx           # TMDB multi-search
    Details.jsx          # TheOGPirateBot details UI + Iris season/episode data
    Player.jsx            # fullscreen shell: PlayerStage + close/back handling
    NotFound.jsx
  components/
    Header.jsx            # logo + search box (hidden on /watch/*)
    MediaCard.jsx          # poster card used by Home + Search
    PlayerStage.jsx        # the real player: auto-failover iframe, no UI chrome
    Loading.jsx
  providers/
    sources.js             # the real embed hosts, ported from Iris's
                             # src/utils/players.js (getPlayerUrls) — array
                             # order IS the failover order (tgvid first)
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

### Stream sources + automatic failover

`src/providers/sources.js` is the real, currently-working list of embed
hosts (not an abstraction over a hypothetical "raw" provider — these are
the actual hosts TheOGPirateBot streams from in production), in priority
order (tgvid first).

There is no user-facing server picker. `PlayerStage.jsx` walks `SOURCES`
top to bottom:

1. Before mounting a candidate's iframe, it calls `checkStreamAlive()`
   (`src/lib/streamCheck.js`), which asks the worker's `GET
   /api/stream-check?url=` to probe the host **server-side** — the browser
   can't read a cross-origin response's HTTP status itself (CORS hides it),
   so this has to happen off the client.
2. The probe fails **open**: network hiccups, timeouts, or an
   unrecognized/disallowed host all come back as "unknown", and unknown is
   treated as alive — a flaky probe must never block real playback.
   Only a definitive non-2xx status from the real host counts as dead.
3. If the iframe never actually finishes loading within ~12s (host hangs
   rather than erroring outright), that's a second signal to advance.
4. If every source is exhausted, the Player shows "No server currently has
   this title" instead of a broken iframe.

Add/remove a host by editing `sources.js`; nothing else needs to change.

## Running it

```bash
npm install
npm run worker:dev   # terminal 1 — local data proxy (optional, has fallback)
npm run dev           # terminal 2 — the app
```

Open `/` for Home, or jump straight to any `/details/{movie|tv}/{tmdbId}`.

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
