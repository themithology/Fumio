# TheOGPirateBot

Watch movies, TV shows, anime and live TV — on the web, and in an Android app
that ships as a direct APK for phones **and** Android TV.

Same codebase for both: the app loads the live site
([theogpiratebot.to](https://theogpiratebot.to)) in a WebView and owns
only the four things a browser cannot do for it — **the player, downloads, the
access wall and its own updater** — plus a real cursor on a television.

```
src/  public/  index.html    website + the web layer the app loads   → docs/WEBSITE.md
android/                     native shell (Capacitor 7, com.fumio.app) → docs/ANDROID.md
worker/                      TMDB proxy (the only real secret)        → docs/ARCHITECTURE.md
docs/                        everything documented, indexed          → docs/README.md
```

**New here?** [SETUP.md](SETUP.md) builds all of it. **Want the map?**
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). **Just the docs?**
[docs/README.md](docs/README.md).

## What the product does

| | |
|---|---|
| **Browse** | home rails, explore with filters, search, per-provider browsing, weekly schedule, anime hub, live TV |
| **Watch** | the app's **own** player with a server picker; the server list is fetched live from the site, so a rename needs no APK release |
| **Keep** | My List (100), continue watching (10), resume positions, profile "look", all synced across devices for signed-in members |
| **Offline** | downloads to the Downloads folder, then a native player with resume, audio tracks and subtitles — no network needed |
| **Television** | cursor-only (no D-pad navigation), 1920 CSS-px layout normalisation, text lift, no ads, no access wall |
| **Updates** | the app checks GitHub releases and offers the new APK itself, on a phone and on a TV |

## Quick start

```bash
npm install
npm run dev              # website          → http://localhost:5173
npm run build            # dist/            → what the APK ships
npx cap sync android && (cd android && ./gradlew assembleDebug)   # the APK
```

No `.env` is needed — every variable has a default in code, and the client holds
no secrets (see [.env.example](.env.example)). The TMDB key lives only in
`worker/.dev.vars` or as a Worker secret.

## Releases

Newest APK: <https://github.com/themithology/Fumio/releases/latest>

Tag = `theogpiratebot-apk-<run number>`, and that number is the `versionCode` —
that is the whole update protocol. Every build is signed with the committed key
`android/app/fumio-release.p12`, so a new APK installs **over** the previous one
without touching downloads or settings. Full history: [docs/CHANGELOG.md](docs/CHANGELOG.md).

## Rules this repo is held to

1. **Everything the website does, the app does** — the app loads the site rather
   than re-implementing it.
2. **Nothing hardcoded that the owner edits.** Server lists come from the site at
   runtime; a bundled list is only a fallback.
3. **A website deploy needs no APK; an APK release breaks no website.**
4. **Ads stay as they are on mobile; the TV build is ad-free.**
5. **Nothing TV-only may run on a phone** — it all hangs off `TvMode.isTv()`.
6. **No analytics, no crash SDK, no ad SDK in the app.** The only device
   identifier is a random install id used for the access window.

## Documentation

| | |
|---|---|
| [SETUP.md](SETUP.md) | build the website, the APK and the worker, from a plain zip |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | the three parts, request flow, who owns what |
| [docs/WEBSITE.md](docs/WEBSITE.md) | pages, providers, the no-hardcoding rule |
| [docs/ANDROID.md](docs/ANDROID.md) | native shell, JS bridge, downloads, updater, wall |
| [docs/PLAYER.md](docs/PLAYER.md) | the app's own player and live server resolution |
| [docs/ACCOUNTS.md](docs/ACCOUNTS.md) · [docs/DATA-LAYER-PLAN.md](docs/DATA-LAYER-PLAN.md) | auth, profiles, every stored key and cap |
| [docs/iris-players-endpoint.md](docs/iris-players-endpoint.md) | the `GET /api/players` contract |
| [docs/TV.md](docs/TV.md) · [docs/TV-CONTRACT.md](docs/TV-CONTRACT.md) · [docs/TV-AUDIT.md](docs/TV-AUDIT.md) | television: behaviour, interface, bug history |
| [docs/OFFLINE-SCREEN.md](docs/OFFLINE-SCREEN.md) | the bundled "site is down" screen |
| [docs/TESTING.md](docs/TESTING.md) | what is proven headlessly, and what needs a device |
| [docs/CHANGELOG.md](docs/CHANGELOG.md) | APK by APK |
| [docs/archive/](docs/archive/) | superseded plans |

## Disclaimer

This project does not host or store any media. It links to third-party sources
and plays what those sources serve. If you are a rights holder, contact the site.
