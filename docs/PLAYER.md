# The player — ours; the servers — the site's

The app has its **own player**. The website's `/player` page is never embedded in
the app (that was a wrong turn on 2026-10-28 and it is gone).

## Two halves, one rule each

| Half | Owner | Rule |
|---|---|---|
| The player UI: iframe surface, server picker, theme, controls, framing | **The app** (`FumioPlayerOverlay` + the bundled React build) | must work on a phone, a TV, and with the site unreachable |
| Which servers exist: names, order, count, each embed URL | **The website** | never hardcoded in the app; a rename on the site must not need an APK |
| Which HOSTS are player hosts | **The website**, via `GET /api/players` → `servers[].url` | `LiveServers` harvests the host from each published embed URL and remembers it. The APK keeps eleven *hints* for the very first launch, before any fetch has succeeded — that is the only list left, and it is deliberately tiny. |
| Which title an embed URL is for | **The site's three path grammars** | `/embed/movie/550`, `/player/movie/550`, `/watch/movie/550`, `/movie/550`. Compiled, because it is a grammar, not a provider name — and covered by `EmbedTitleTest`. |
| Whether a URL is a download | **The site's broker paths and signed grants** | `/api/downloads`, `/downloads/…`, a 32+ character grant token. `tgdl.lovable.app` / `hubcloud` / `filepress` were the OLD picker and are gone from the site — a hardcoded hostname list for downloads is now a bug, not a feature. |

## Where the server list comes from (`LiveSourceSync`)

Resolution order, per title + episode:

1. **Cache** — `SharedPreferences` key `ogpb_live_sources`, key
   `type|id|season|episode`, TTL **6 hours**. A repeat open costs nothing.
2. **The cheap endpoint** — `GET https://theogpiratebot.to/api/players` with a
   4 s timeout. Contract: [iris-players-endpoint.md](iris-players-endpoint.md).
3. **Harvest** — open the site's own player page off-screen (22 s cap) and read
   the server list the page itself rendered. Slower and less exact, but it is the
   page the owner edits, so it is never wrong about *which* servers exist.
4. **Bundled fallback** — `LiveServers`'s compiled list. Only reachable when 1–3
   all failed; it exists so playback still works with no network.

Every success is written back to the cache, so the next episode of the same title
starts instantly with the freshest list known.

## The player overlay

- A full-screen `FrameLayout` added to the activity's content frame, containing a
  WebView plus its own chrome.
- Loads the **bundled** build at `https://localhost/watch/...` — not the site.
  That is what keeps the framing right on a TV and keeps the player alive when
  the site is having a bad day.
- Receives: `type`, `id`, `season`, `episode`, the chosen `server`, and the
  **original query string** of the link that opened it, forwarded verbatim — so a
  parameter the site adds later needs no app change.
- `hideFullscreen()` keeps BACK behaving like a player, not like a browser.
- On close it hands back the `continueWatching` trail so the browse page stays in
  sync; the pointer (TV) retargets to the browse page, and the ring is raised
  above the overlay again when a new video starts.

## Framing on a television

The "half the player is cut off" bug (screenshot, 2026-11-05) was the TV viewport
normaliser (`width=1920`) being applied to **our own** player page. It is now
applied only to the live site; our pages keep the device's real viewport.
See [TV.md](TV.md#scaling) and [TV-AUDIT.md](TV-AUDIT.md).

## Downloads

The website's download entries are **not** hidden any more. A file link is handed
to Android's `DownloadManager` with the page's cookies, referer and user agent,
lands in the public Downloads folder, is indexed by `DownloadsLibrary`, and plays
in `OfflinePlayerActivity` (ExoPlayer: resume, audio tracks, subtitles) with no
network. See [ANDROID.md](ANDROID.md#downloads-and-offline-playback).

## Ads

- **Phone**: unchanged from the website. The app neither injects nor removes ad
  code.
- **Television**: ad-free by design. Nothing in the TV path shows an ad, and the
  TV layer adds no ad logic of its own.

## What the player deliberately does not do

- It does not scrape video files out of a third-party embed; it hands the embed
  the same URL the site would.
- It does not persist a chosen server as a hardcoded default — the choice is a
  preference (`preferredServerKey`) applied to whatever list arrives.
