# TheOGPirateBot (Fumio)

A skeleton of **two screens only**: a **Details page** and a **Player**.
Live TV and Login already exist elsewhere — this app doesn't touch them.

No ads, no party mode, no Discord bot, no admin panel, no Node backend.
Branding (logo, name, colors, icons) is the real TheOGPirateBot identity,
copied straight from Iris's `public/` assets.

- **Details page** (`/details/:type/:id`) — poster, title, overview,
  season/episode pickers for TV, a Play button. Data comes from TMDB,
  fetched through a Cloudflare Worker proxy (so no API key ever ships to the
  browser).
- **Player** (`/watch/:type/:id?season=&episode=`) — a real player, using
  TheOGPirateBot's **actual working embed hosts** (ported from Iris's
  `src/utils/players.js`: tgvid, vidstuck, vidfast, bingr, roxy, nxsha), with
  exactly two controls: **Quality** (which host/tier — e.g. VidFast's 4K vs
  the others' HD) and **Audio** (the language track, on hosts that document
  one — tgvid and vidstuck both take a language query param).

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
    Details.jsx          # fetch TMDB details, season/episode pick, Play
    Player.jsx            # renders StreamFrame for the picked title/episode
    NotFound.jsx
  components/
    Header.jsx
    StreamFrame.jsx        # the real player: iframe + Quality/Audio controls
    Loading.jsx
  providers/
    sources.js             # the real embed hosts, ported from Iris's
                             # src/utils/players.js (getPlayerUrls)
  lib/
    tmdb.js                 # fetch wrapper w/ failover + caching
    proxyTiers.js            # list of proxy bases to try, in order

worker/                   # Cloudflare Worker — TMDB proxy only (vendored,
  src/index.js             # trimmed from Iris's edge/cloudflare-worker)
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

### Stream sources

`src/providers/sources.js` is the real, currently-working list of embed
hosts (not an abstraction over a hypothetical "raw" provider — these are
the actual hosts TheOGPirateBot streams from in production). Add/remove a
host by editing that file; `StreamFrame.jsx` needs no changes since it just
renders whatever `SOURCES` contains.

## Running it

```bash
npm install
npm run worker:dev   # terminal 1 — local data proxy (optional, has fallback)
npm run dev           # terminal 2 — the app
```

Open `/details/movie/550` (the default redirect from `/`) or any
`/details/{movie|tv}/{tmdbId}`.

## The Android APK

This sandbox has no Android SDK/Gradle and no network route to Google's/
Gradle's download hosts, so the APK is built by **GitHub Actions** instead
(`.github/workflows/android-apk.yml`) on every push. Check the repo's
**Releases** page for the newest `app-debug.apk` (tagged
`fumio-apk-<run number>`).

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
