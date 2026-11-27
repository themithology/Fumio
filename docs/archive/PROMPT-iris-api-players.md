# Prompt for the Iris (website) agent — `GET /api/players`

Copy everything inside the fence below into the Iris repo session.

```
Add a new public read-only endpoint to the site: GET /api/players

WHY
The Android app (themithology/Fumio) has its own player UI — its own iframe
surface, its own server picker, its own theme and ad behaviour. The only thing
it must never own is WHICH servers exist. Right now it scrapes the site's
/player page to find out, which is fragile (it captures partial lists and dead
URLs). This endpoint publishes the same list the website's own player would
play, so the app can read it in one request.

HARD CONSTRAINTS
- Do NOT hardcode any embed URL in the new file. Every URL must come from
  src/utils/players.js#getPlayerUrls — the same function the website's player
  uses. If a host moves on the site, this endpoint follows automatically.
- Do NOT invent labels. Labels come from src/utils/serverRegistry.js
  (STREAM_SERVERS[].labels[LANE_NORMAL]) and the order comes from
  NORMAL_ORDER in that same file.
- Do NOT touch the existing player, the ad stack, or any current route.
- GET only. No auth, no writes, no new secrets.

WHERE IT LIVES
It must be the Cloudflare Worker, not Vercel: vercel.json redirects
/api/:path* -> /, so a Vercel function would never be reached. Wire it in
edge/worker/main.ts next to the existing "/api/stream-check" branch:

    if (path === "/api/players" || path === "/players") {
      return playersResponse(url);
    }

and import it near the shared/anilist.ts import:

    import { playersResponse } from "./players.ts";

CONTRACT (the app already calls exactly this — do not change the shape)

    GET /api/players?id=<tmdbId>&type=<movie|tv>&season=<n>&episode=<n>

    200 {
      "success": true,
      "id": "1399",
      "type": "tv",
      "season": 2,
      "episode": 5,
      "lane": "normal",
      "servers": [
        { "key": "tgvid",    "label": "Server 1 (Hindi•English•Multi Language)",             "url": "https://…" },
        { "key": "vidstuck", "label": "Server 2 (Hindi•English•Multi-language Ad Free)",     "url": "https://…" },
        { "key": "tgfrost",  "label": "Server 3 (Hindi • English • Multi • Highest Bitrate • Ad Free)", "url": "https://…" },
        { "key": "roxy",     "label": "Server 4 (Original Language • Fast Streams)",         "url": "https://…" },
        { "key": "vidfast",  "label": "Server 5 (Original Audio • 4K • Ads)",                "url": "https://…" },
        { "key": "nxsha",    "label": "Server 6 (Hindi • Dual Audio)",                       "url": "https://…" }
      ]
    }

    400 { "success": false, "error": "A numeric TMDB id is required" }   (id not digits)

RULES THE APP RELIES ON
- key   : stable id (tgvid, roxy…). Survives reordering; used for ?server= deep
          links and saved per-title preferences.
- label : exactly the string the picker shows.
- url   : fully resolved embed URL for THIS episode.
- order : array order IS "Server N".
- absence: a slot that is parked, or cannot resolve, is simply not in the array.
          Never emit a placeholder or a dead URL.
- headers: Content-Type: application/json; charset=utf-8,
          Access-Control-Allow-Origin: *,
          Cache-Control: public, max-age=300, stale-while-revalidate=3600.

IMPLEMENTATION
New file edge/worker/players.ts:

  import { getPlayerUrls } from "../../src/utils/players.js";
  // tsconfig has allowJs: true, and esbuild resolves the .js source directly —
  // the same way the app-side tests import players.js. Do not copy the URL
  // templates into the worker.

  // getPlayerUrls returns a POSITIONAL array. The positions are an API (legacy
  // ?server=<index> links read them), so map by index instead of reading
  // names: [nxsha, bingr, vidfast, roxy, vidstuck, tgfrost, tgvid]
  const NORMAL_SLOTS = [
    { key: "tgvid",    urlIndex: 6 },
    { key: "vidstuck", urlIndex: 4 },
    { key: "tgfrost",  urlIndex: 5 },
    { key: "roxy",     urlIndex: 3 },
    { key: "vidfast",  urlIndex: 2 },
    { key: "nxsha",    urlIndex: 0 },
  ];

  Build the list by walking NORMAL_ORDER from serverRegistry.js (so a parked
  slot such as "bingr" is never offered), looking each key up in a
  key -> urlIndex map, taking the label from that registry entry's
  labels[LANE_NORMAL], and numbering the label as
  `Server ${n} (${label})` with n starting at 1 in output order.

  Skip any entry whose URL is missing or not https://.

ANIME — PHASE 2, DO NOT GUESS
Anime slots (MegaPlay sub/dub, ZokoAnime, 4animo, ToonStream) are keyed on
AniList/MAL ids, not TMDB, and need this site's arc/season bridging. Without
those ids any URL would be wrong, so for now the endpoint returns the normal
lane for every request and the app keeps using its own anime resolver. When you
want anime here:
  - accept optional `anilist=<id>` / `mal=<id>` query params,
  - build the anime list with src/utils/serverSlots.js#buildServerSlots using
    ANIME_JP_ORDER and the resolved toonStreamUrl,
  - return { "lane": "anime", "season": <resolved>, "episode": <resolved>,
    "servers": [...] }.
The app already accepts that envelope and prefers it when present.
(Note: the app must also start sending anilist/mal — do that in the app repo,
not here.)

TESTS (tests/players-endpoint.test.mjs — these must pass)
- the endpoint's slot order equals NORMAL_ORDER read out of
  src/utils/serverRegistry.js;
- every offered label equals that registry entry's LANE_NORMAL label (this is
  the test that catches label drift, e.g. tgfrost's
  "Hindi • English • Multi • Highest Bitrate • Ad Free" being replaced by a
  generic string);
- every urlIndex resolves to an https URL from getPlayerUrls("550","movie");
- for a TV id the URL contains "/tv/<id>/";
- no parked key (one absent from NORMAL_ORDER) is offered;
- edge/worker/main.ts contains the route and calls playersResponse.

VERIFY BEFORE YOU FINISH
1. npm test                       (whole suite green)
2. Bundle and call it locally:
     npx esbuild edge/worker/players.ts --bundle --format=esm \
       --platform=neutral --outfile=/tmp/players.mjs
     node --input-type=module -e "const m=await import('/tmp/players.mjs');
       const r=m.playersResponse(new URL('https://x/api/players?id=1399&type=tv&season=2&episode=5'));
       console.log(r.status, JSON.stringify(await r.json(),null,1))"
   Expected: 200, six servers, Server 1's url contains
   tgvid.lovable.app/embed/tv/1399/2/5
3. Deploy: npm run workers:deploy  (all three workers — the app hits whichever
   tier answers; a tier without this route answers 404 and the app silently
   falls back to scraping, so deploy them all).
4. Confirm live: curl -s "https://theogpiratebot.to/api/players?id=550&type=movie"
   must return JSON, not index.html.

Report back: the deployed URL, the JSON for id=550 type=movie, and whether any
registry entry had to be skipped (and why).
```

## What the app does with it

`LiveSourceSync` already tries `https://theogpiratebot.to/api/players`
first with a 4 s budget, before any scraping:

- **200 + `servers[]`** → used directly (labels, order, URLs), cached 6 h per
  title+episode. Scraper never runs.
- **404 / HTML / timeout** → falls back to the page scrape, then to the bundled
  list. So deploying the endpoint is a pure upgrade; nothing has to be released
  in the app for it to start working.

Known gap until phase 2: anime requests get the normal lane, so the app will
keep its bundled anime resolver for those titles. The app must also start
sending `anilist=`/`mal=` for that to change — a one-line change on our side
once the endpoint supports it.
