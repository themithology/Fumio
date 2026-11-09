# The website (`src/` + `public/`)

React 19 + Vite + Tailwind. This is the thing at `theogpiratebot.online`, **and**
the web layer the Android app loads — there is one codebase, not two.

```
npm install
npm run dev      # http://localhost:5173
npm run build    # dist/  (what Capacitor copies into the APK)
npm run lint
```

No `.env` is required. Every variable has a working default in code; see
[`.env.example`](../.env.example) for the full list.

## Layout

| Path | What lives there |
|---|---|
| `src/pages/` | one file per route |
| `src/components/partials/` | page sections: heroes, rails, cards, nav, players |
| `src/components/auth/`, `src/components/account/` | sign-in and profile editing |
| `src/providers/` | **where server and stream lists come from** |
| `src/lib/` | HTTP and data plumbing (TMDB, Iris, proxies, AniList) |
| `src/utils/` | pure helpers: lists, history, profiles, formatting |
| `src/config/` | static config: avatars, auth domain, anime characters |
| `src/data/` | static snapshots (the Live TV channel list) |

## Routes

| Route | Page | Notes |
|---|---|---|
| `/` | `Home.jsx` | hero + rails; the rails are horizontal scroll containers |
| `/explore` | `Explore.jsx` | filters, infinite scroll, provider/region browsing |
| `/search` | `Search.jsx` | paging, trending searches |
| `/movie/details/:id`, `/tv/details/:id`, `/anime/details/:id` | `Details.jsx` | cast, seasons, episode browser |
| `/watch/:type/:id` | redirect into the player | the app intercepts the same routes |
| `/player` | `Player.jsx` | the player screen (see [PLAYER.md](PLAYER.md)) |
| `/anime` | `Anime.jsx` | anime hub |
| `/schedule` | `Schedule.jsx` | weekly airing calendar |
| `/live-tv`, `/live-tv/:id` | `LiveTv.jsx`, `LiveTvWatch.jsx` | channel list and a channel |
| `/media-hub` | `MediaHub.jsx` | discovery hub |
| `/my-list` | `MyList.jsx` | saved titles (cap 100) |
| `/profile/:handle`, `/account` | `Profile.jsx`, `Account.jsx` | public profile and settings |
| `*` | `NotFound.jsx` | |

## Where server lists come from — the one rule

**Nothing is hardcoded.** A server list is resolved at runtime, in this order:

1. `src/providers/liveSources.js` — the live API/player-page answer (the same
   source the Android app uses; contract in
   [iris-players-endpoint.md](iris-players-endpoint.md)),
2. `src/providers/sources.js` + `serverSlots.js` — the mapper that turns whatever
   came back into labelled slots,
3. `src/providers/animeEmbeds.js`, `toonStream.js`, `liveHosts.js` — the
   per-catalogue families,
4. a **bundled fallback** only when every live path failed. A fallback is a
   fallback: if it is ever the normal path, that is a bug.

Renaming or adding a server on the site must show up in the app with no APK
release. That is what `LiveSourceSync` in the Android shell depends on.

## Data and accounts

- Lists, history, "look" (avatar/banner) and the chosen server are
  device-first (`localStorage`), then synced for signed-in members.
- Endpoints and merge rules: [ACCOUNTS.md](ACCOUNTS.md),
  [DATA-LAYER-PLAN.md](DATA-LAYER-PLAN.md).
- Caps: **My List 100**, **continue-watching 10**. Progress is pushed at most
  once a minute; list changes are debounced 2.5 s.

## The proxy ladder (`src/lib/proxyTiers.js`)

TMDB requests try, in order: same-origin (a local Worker in dev, a co-deployed
Worker in production) → the shared Worker fleet → any `VITE_PROXY_BASES` you
override. If one base fails, the next is tried; the page never shows an empty
catalogue because one proxy is down.

## Ads

The website keeps **the same ad behaviour on mobile** as it always had; the app
does not strip or rewrite ads, and the TV build is **ad-free by design** (see
[TV.md](TV.md)). The only wall the app enforces is the access check
(`/verify`, 12 hours) — nothing else.

## Adding a page

1. Create `src/pages/Thing.jsx`.
2. Register the route in `src/App.jsx`.
3. If it needs data, put the fetch in `src/lib/` (not in the component) and the
   pure logic in `src/utils/`.
4. If it introduces a new server source, add it to `src/providers/` and to the
   documented order above — never inline it in a page.
5. `npm run build` must stay clean; `npm run lint` should stay clean.
