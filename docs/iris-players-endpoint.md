# `GET /api/players` — the server-list contract

The one thing the Android app must never own is **which servers exist**. This
endpoint is how the site tells it, so adding, renaming, reordering or removing a
server needs no APK release.

**Status:** optional and self-healing. If this endpoint is missing, slow, or
malformed, the app falls back to harvesting the site's own player page, and then
to a bundled list. Nothing breaks — it only gets slower and staler. Implementing
it is a small win; ignoring it costs nothing catastrophic.

- **Implemented by:** the website (Iris repo), not this one.
- **Called by:** `android/app/src/main/java/com/fumio/app/LiveSourceSync.java`.
- **Cached by:** the app, per `type|id|season|episode`, for 6 hours.

## Request

```
GET https://theogpiratebot.online/api/players?id=550&type=movie&season=1&episode=1
```

| Parameter | Notes |
|---|---|
| `id` | TMDB (or the catalogue's own) id, as used in `/player?id=…` |
| `type` | `movie` \| `tv` \| `anime` |
| `season`, `episode` | `1` for a movie |

Read-only, public, no auth, no cookies needed. Must be CORS-free (the app calls
it natively, so CORS is irrelevant, but the **website** also uses this shape).

## Response — accepted shapes

Any of these works. The app is forgiving about *wrapping* and strict about
*content*:

```json
{ "success": true, "season": 2, "episode": 5,
  "servers": [ { "key": "alpha", "label": "Alpha", "url": "https://…" } ] }
```

```json
{ "servers": [ … ] }
```

```json
{ "data": { "servers": [ … ] } }
```

```json
[ { "key": "alpha", "label": "Alpha", "url": "https://…" } ]
```

Per row, these keys are understood:

| Field | Accepted names | Required |
|---|---|---|
| URL | `url`, `embedUrl`, `embed`, `link`, `src` | **yes**, must be `https://` |
| key | `key`, `id`, `slug`, `server` | no — falls back to `server-<n>` |
| label | `label`, `name`, `title` | no — falls back to the key |

Optional top-level: `season` / `resolvedSeason`, `episode` / `resolvedEpisode` —
the app uses these so a list resolved for S1E1 is never played for S1E2.

## What counts as "no answer"

The app treats all of these as *fall back to harvesting* (it never shows an empty
picker):

- HTTP not 2xx, or HTML instead of JSON,
- `{"success": false}` or `{"ok": false}` or an `error` body,
- a `servers` array that is missing, **empty**, or has no usable `https://` URL.

An empty list is not a list: playing nothing is worse than playing the fallback.

## Response headers

- `Content-Type: application/json`
- `Cache-Control: public, max-age=300` is reasonable — the app has its own 6-hour
  cache, and the site can change the list whenever it likes.

## Why this is better than harvesting

| | Endpoint | Harvest the player page |
|---|---|---|
| Speed | one request, 4 s budget | opens a full page, 22 s budget |
| Accuracy | the list, exactly | whatever rendered in time — can be partial |
| Fragility | a JSON contract | a React page's DOM |
| Offline | cache still serves | nothing |

Harvesting stays as the fallback **precisely because it is the page the owner
edits**: it can never be wrong about which servers exist, only slow.
