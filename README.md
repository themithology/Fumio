# Fumio

A skeleton of **two screens only**: a **Details page** and a **Player**.
Live TV and Login already exist elsewhere — this app doesn't touch them.

No ads, no party mode, no Discord bot, no admin panel, no multi-server
iframe picker, no Node backend. Just:

- **Details page** (`/details/:type/:id`) — poster, title, overview,
  season/episode pickers for TV, a Play button. Data comes from TMDB,
  fetched through a Cloudflare Worker proxy (so no API key ever ships to the
  browser).
- **Player** (`/watch/:type/:id?season=&episode=`) — a plain `<video>` +
  [hls.js](https://github.com/video-dev/hls.js) player with exactly two
  controls: **Quality** and **Audio**. No server-switcher UI — the point of
  a real ("raw") stream provider is that the stream itself already carries
  multiple quality renditions and audio tracks, so hls.js exposes them
  directly.

## Why it looks like this

Iris (the sister project) is iframe-embed based: every "server" (nxsha,
bingr, vidfast, vidstuck, tgvid, toonstream…) is a third-party page in an
`<iframe>`, so its player UI is really a "pick a branded host" switcher.
Fumio's own concept (see its original README) is provider/extension based —
a provider hands back a **raw stream** (direct video URL), which is why the
UI here is just Quality + Audio, the same two things any real raw stream
exposes.

## Architecture

```
src/
  pages/
    Details.jsx     # fetch TMDB details, season/episode pick, Play button
    Player.jsx       # resolves a stream via providers/, renders VideoPlayer
    NotFound.jsx
  components/
    Header.jsx
    VideoPlayer.jsx   # <video> + hls.js, Quality + Audio dropdowns only
    Loading.jsx
  providers/
    index.js          # registry + resolveStream() — Fumio's "Extensions" hook
    demoProvider.js    # demo stream (see "Providers" below)
  lib/
    tmdb.js            # fetch wrapper w/ failover + caching
    proxyTiers.js       # list of proxy bases to try, in order

worker/                 # Cloudflare Worker — TMDB proxy only (vendored,
  src/index.js          # trimmed from Iris's edge/cloudflare-worker)
  wrangler.toml
```

### Data + proxy

`src/lib/proxyTiers.js` is a ladder of bases to try in order:

1. **Relative / same-origin** — in `npm run dev` this is forwarded by Vite
   to a **local Cloudflare Worker** running in `workerd` (the real CF
   runtime, not a mock) via `npm run worker:dev`. See `worker/`.
2. **Iris's existing live Cloudflare Workers** — the same TMDB proxy fleet
   Iris already runs in production, listed in `proxyTiers.js`. If your local
   worker has no `TMDB_API_KEY` set (or isn't running), the app transparently
   falls over to these.

Override with `VITE_PROXY_BASES="https://your-worker.workers.dev"` (comma
separated) in a `.env.local`.

To run the local worker with your own TMDB key:

```bash
cp worker/.dev.vars.example worker/.dev.vars   # then fill in TMDB_API_KEY
npm run worker:dev     # http://127.0.0.1:8787, via workerd
npm run dev            # Vite proxies /tmdb and /api to it
```

To deploy your own worker instead of relying on Iris's fleet:
`npm run worker:deploy` (needs `wrangler login` once), then put its URL in
`VITE_PROXY_BASES`.

### Providers (the "raw stream" layer)

`src/providers/index.js` is the extension point: a provider is an async
function `resolve({ tmdbId, type, season, episode, title })` that returns
`{ url, type: "hls" | "mp4", label }` for a **direct** stream — not an
iframe embed. `VideoPlayer.jsx` needs nothing provider-specific: hls.js
reads quality levels and audio tracks straight out of the manifest.

**Important:** this sandbox can only reach `github.com` / `npmjs.org` /
`pypi.org` — there was no way to build or test a real extractor against an
actual streaming host from here. `demoProvider.js` plays Apple's public
"bipbop advanced" HLS reference stream (real multi-bitrate + multi-audio
manifest) so the Quality/Audio UI is provably wired end-to-end. **Swap it
for your real provider** by editing `demoProvider.js` or adding a new file
and registering it in `providers/index.js`.

## Running it

```bash
npm install
npm run worker:dev   # terminal 1 — local data proxy (optional, has fallback)
npm run dev           # terminal 2 — the app
```

Open `/details/movie/550` (the default redirect from `/`) or any
`/details/{movie|tv}/{tmdbId}`.

## Building the Android APK

This repo is Capacitor-ready: the native `android/` project is already
generated and committed (`capacitor.config.json`). The dev sandbox that
built this has no Android SDK/Gradle and no network route to Google's/
Gradle's download hosts, so the APK is built in **GitHub Actions** instead
— see `.github/workflows/android-apk.yml`. It runs on every push to this
branch and:

1. `npm ci && npm run build` — builds the web app
2. `npx cap sync android` — copies the build into the native project
3. `./gradlew assembleDebug` — builds `app-debug.apk`
4. Uploads it as a workflow artifact, **and** attaches it to a rolling
   pre-release tagged `fumio-apk-<run number>` so it's a direct download
   link, no GitHub login/Actions tab needed.

Check the repo's **Releases** page (or the **Actions** tab → latest run →
Artifacts) for the newest `app-debug.apk`.

To build it yourself locally instead (needs Android Studio / JDK 17+ / the
Android SDK installed):

```bash
npm run build
npm run cap:sync
npm run cap:open       # opens Android Studio — Build > Build APK
```

## Disclaimer

Fumio is a media browser and player skeleton. It does not host, upload or
store any files. `demoProvider.js` ships a public demo stream only — you are
responsible for whatever real provider you wire in.
