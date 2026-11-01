# Live server list for the app (`GET /api/players`)

The app's player is its **own** player (bundled build, own surface, own picker,
own ads). The only thing it does not own is **which servers exist** — that comes
from this website, live, so a rename, a reorder, a new host or a retired server
shows up on phones without an APK release.

Right now the app gets that list by **harvesting the site's own player page**
(`LiveSourceSync.harvest`): it opens `/player?…` offscreen, clicks each
`Server N (…)` button and records the iframe URL that appears. That works today
with zero site changes — but it costs one page load and a few clicks.

Adding this endpoint turns that into **one request** and makes the contract
explicit. It is optional: without it, the app still follows the site.

---

## The contract

```
GET /api/players?id=<tmdbId>&type=<movie|tv>&season=<n>&episode=<n>
```

```json
{
  "success": true,
  "id": "312359",
  "type": "tv",
  "season": 1,
  "episode": 1,
  "lane": "normal",
  "servers": [
    { "key": "tgvid",    "label": "Server 1 (Hindi•English•Multi Language)", "url": "https://tgvid.lovable.app/embed/tv/312359/1/1?…" },
    { "key": "vidstuck", "label": "Server 2 (Hindi•English•Multi-language Ad Free)", "url": "https://0vidads.top/embed/tv/312359/1/1?…" }
  ]
}
```

Rules the app relies on:

| field | meaning |
| --- | --- |
| `key` | stable id (`tgvid`, `roxy`, `sub`…). Survives reordering. Used for `?server=` deep links and saved preferences. |
| `label` | exactly what the picker shows. Rename here, the app renames. |
| `url` | the fully resolved embed URL for **this** episode. The app plays it verbatim. |
| order | array order **is** the "Server N" order. Reorder here, the app reorders. |

A server the site cannot resolve for this episode is simply **absent** — the app
never renders a dead button (same rule as `buildServerSlots`).

---

## Implementation in this repo (drop-in)

`src/utils/players.js` already resolves everything needed; `serverSlots.js`
already builds the ordered, labelled, resolver-gated list. The endpoint is a
thin serialiser over them:

```js
// edge/worker/main.ts (or a Vercel function / the Node server — same shape)
import { getPlayerUrls } from "../../src/utils/players.js";
import { buildServerSlots } from "../../src/utils/serverSlots.js";

async function playersResponse(url: URL, env: Env): Promise<Response> {
  const id = url.searchParams.get("id") || "";
  const type = url.searchParams.get("type") === "movie" ? "movie" : "tv";
  const season = Number(url.searchParams.get("season") || 1) || 1;
  const episode = Number(url.searchParams.get("episode") || 1) || 1;
  if (!/^\d+$/.test(id)) return json({ success: false, error: "bad id" }, 400);

  const urls = getPlayerUrls(id, type, season, episode);
  const slots = await buildServerSlots({
    playerUrls: urls,
    mediaType: type,
    season,
    episode,
    // whatever else this call needs on your side (details, ids, lane…)
  });

  return json({
    success: true,
    id,
    type,
    season,
    episode,
    lane: slots.lane === "jpAnime" ? "anime" : "normal",
    servers: slots.servers
      .filter((s) => s.src && !s.dead && !s.pending)
      .map((s) => ({ key: s.key, label: s.name, url: s.src })),
  });
}
```

Wire it next to the routes already handled in `edge/worker/main.ts`:

```ts
if (path === "/api/players" || path === "/players") return playersResponse(url, env);
```

Nothing else on the site changes: the same `players.js` / `serverSlots.js` that
render the website's own player produce the app's list, so the two can never
disagree.

---

## What the app does with it

1. `GET /api/players` (4 s budget) → normalise → cache per
   `type|id|season|episode` for **6 hours**.
2. No answer (endpoint missing, offline, error) → **harvest** the site's player
   page (22 s budget) and cache that.
3. Nothing at all → the bundled list, exactly as before. Playback never blocks
   on this call.

Cache is keyed per episode, so changing a server on the site reaches a phone the
next time that episode is opened (or after the 6-hour cache expires).
