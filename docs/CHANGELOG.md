# Changelog

## Unreleased — the site is theogpiratebot.to now

The main website moved from `theogpiratebot.online` to `theogpiratebot.to`.
Everything that names the site moved with it, except two things that must not:

- **Both origins count as "us".** `MainActivity.LIVE_ORIGINS` lists `.to` **and**
  `.online`, and `isLiveSite` accepts either. This decides `/watch`
  interception, ad suppression, download routing and in-app-vs-browser link
  handling. Recognising only the new origin would treat any viewer still on the
  old one as a stranger — their own site thrown at a browser, the player no
  longer ours — on every box that was already running when the domain moved.
  `LiveOriginTest` fails if either origin stops being recognised, and it asserts
  that look-alikes (`nottheogpiratebot.to`, `theogpiratebot.to.example.com`)
  are not.
- **Sign-in does not follow the domain, on purpose.** `PRIMARY_AUTH_DOMAIN` is
  now `theogpiratebot.to`, but `resolveAuthDomain()` still returns Firebase's
  own host: Firebase Hosting only answers `/__/auth/handler` on a host it is
  connected to, and Google only accepts a redirect URI registered on the OAuth
  client. Pointing at `.to` before both are true loads the site's own HTML into
  the sign-in popup and kills Google sign-in silently, for everyone. The switch
  afterwards is one environment variable: `VITE_FIREBASE_AUTH_DOMAIN`.

Also moved: `LIVE_ORIGIN`, `LIVE_SITE`, `LiveServers.SITE`,
`LiveSourceSync.ENDPOINT`/`PLAYER_PAGE`, `VerifyClient.BASE`,
`InAppGoogleAuth`'s account URL, the `Downloader` referer check (which accepts
both, for a file link that started on the old origin), `capacitor.config.json`
`allowNavigation` (both, so a bookmark still opens in-app), and every site URL
in `src/` and the docs.

## Unreleased — nothing that can be hardcoded stays hardcoded

The site (`themithology/Iris`) moved while this app still carried its own copy of
the old world. Fixed by learning instead of compiling:

- **Embed hosts are learned.** `LiveServers` now reads the site's own manifest —
  `GET /api/players?type=movie&id=550` → `servers: [{ key, label, url }]` — and
  harvests a host from each published embed URL. The old scrape stays as the
  second tier (it works before any manifest exists), but its host families are no
  longer a brand whitelist: a provider host is recognised by the `/embed/`,
  `/player/`, `/watch/` path it appears on.
  The fifteen-name list in `MainActivity` is gone, replaced by eleven *hints* for
  the first launch. This is the bug that shipped: vidstuck moved to
  `0vidads.top`, and the app kept opening the site's own page — with ads —
  because the new host was not in the APK. Our own Server 1
  (`embed.theogpiratebot.to`) was never in the list at all.
- **Where the player and the hidden iframes come from.** `fumio-player.js` hid
  sixteen literal provider hosts. It now hides the hosts the site published
  (`window.__fumioLiveHosts`), minus our own embed, plus any iframe on an
  `/embed/` or `/player/` path.
- **Three path grammars, not one.** The app only understood `/embed/…`. A TV URL
  with no season is the anime lane's shape and no longer becomes "season 1,
  episode 1". `EmbedTitleTest` holds one live path per grammar.
- **Downloads follow the broker.** The site's download path is `POST
  /api/downloads`: short-lived signed grants, resolved server-side. Detection is
  by path and grant shape now, because `tgdl.lovable.app`, `hubcloud` and
  `filepress` are the *old* picker and no longer appear on the site.
- **Details.jsx is deleted** (647 lines). The site owns that page; the bundled
  copy drifted. `SeasonEpisodeBrowser.jsx`, used only by it, went too.
- **The overlay loads the site's player first**, with the site's own query
  string; the frozen page is the offline fallback, which is all it was ever good
  for. `ACCESS_NETWORK_STATE` is declared for that choice, and an absent
  permission assumes online rather than blocking playback.

Verified: 73/73 TV checks, offline-screen check, `vite build` clean, and the JVM
tests added for the parser and the host matcher.

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
