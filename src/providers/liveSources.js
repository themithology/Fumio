// ─── Live server list, handed to us by the APK shell ────────────────────────
//
// The app owns this player. The server LIST does not belong to the app: it
// belongs to the website, which is the thing that gets updated when a host
// moves or a slot is renamed.
//
// The Android shell fetches that list (LiveSourceSync.java — it asks the site
// for /api/players, and when the site has no such endpoint it opens the site's
// own player page in an offscreen WebView and records the servers the site
// actually renders) and injects an ENVELOPE:
//
//   window.__fumioLiveSources = {
//     id: "95479", type: "tv", season: "1", episode: "1",
//     servers: [
//       { key: "tgvid", label: "Server 1 (Hindi•English•Multi Language)", url: "https://…" },
//       …
//     ]
//   }
//
// followed by a `fumio-live-sources` event.
//
// Two rules follow from the envelope:
//
//   1. A list belongs to ONE episode. S1E1's URLs are S1E1's embed URLs — they
//      must never play for S1E2. `liveSourcesAsPlayerSources()` therefore
//      returns null when the envelope does not match the page it is read on.
//   2. BOTH lanes are dynamic. Anime used to keep its own resolver, but that is
//      still "servers the app knows about". The site's anime lane is the
//      authority for anime too, and it re-numbers itself for arcs: a request
//      for S1E1 can land on a different season/episode (see `resolvedSeason`
//      / `resolvedEpisode` / `resolvedHref` below), so this module accepts a
//      list whose season/episode match EITHER what we asked for OR what the
//      site resolved.
//
// On the website itself (no shell, no injection) everything here returns null
// and the site is untouched.

const EVENT = "fumio-live-sources";

const cleanServers = (raw) => {
  if (!Array.isArray(raw)) return null;
  const out = [];
  const seen = new Set();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const url = typeof entry.url === "string" ? entry.url.trim() : "";
    if (!/^https?:\/\//i.test(url)) continue;
    const key = String(entry.key || entry.id || `server-${out.length + 1}`).trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const label = String(entry.label || entry.name || `Server ${out.length + 1}`).trim();
    out.push({
      key,
      label,
      url,
      quality: typeof entry.quality === "string" ? entry.quality : "",
      index: Number.isFinite(entry.index) ? entry.index : out.length,
    });
  }
  return out.length ? out : null;
};

/** Accepts both the envelope and a bare array (older shells). */
const readEnvelope = () => {
  if (typeof window === "undefined") return null;
  const raw = window.__fumioLiveSources;
  if (!raw) return null;
  if (Array.isArray(raw)) {
    const servers = cleanServers(raw);
    return servers ? { servers, id: null, type: null, season: null, episode: null } : null;
  }
  if (typeof raw !== "object") return null;
  const servers = cleanServers(raw.servers);
  if (!servers) return null;
  return {
    servers,
    id: raw.id == null ? null : String(raw.id),
    type: raw.type == null ? null : String(raw.type),
    season: raw.season == null ? null : String(raw.season),
    episode: raw.episode == null ? null : String(raw.episode),
    resolvedSeason: raw.resolvedSeason == null ? null : String(raw.resolvedSeason),
    resolvedEpisode: raw.resolvedEpisode == null ? null : String(raw.resolvedEpisode),
    resolvedHref: typeof raw.resolvedHref === "string" ? raw.resolvedHref : null,
  };
};

/** What this page is: the player route carries id/type/season/episode. */
const pageIdentity = () => {
  try {
    const params = new URLSearchParams(window.location.search);
    const path = String(window.location.pathname || "");
    const fromPath = path.match(/\/watch\/(movie|tv)\/(\d+)/i);
    return {
      id: params.get("id") || (fromPath ? fromPath[2] : null),
      type: params.get("type") || (fromPath ? fromPath[1].toLowerCase() : null),
      season: params.get("season") || null,
      episode: params.get("episode") || null,
    };
  } catch {
    return { id: null, type: null, season: null, episode: null };
  }
};

const same = (a, b) => a == null || b == null || String(a) === String(b);

/**
 * The live list for the page it is read on, or null.
 *
 * Null only when nothing was injected, or the envelope clearly belongs to
 * another TITLE (a stale harvest). Season/episode are allowed to differ when
 * the site itself re-numbered them for an arc — that is the anime case, and the
 * site's answer is the one the hosts actually accept.
 */
export function liveSourcesFor() {
  const envelope = readEnvelope();
  if (!envelope) return null;
  const page = pageIdentity();
  if (envelope.id && page.id && String(envelope.id) !== String(page.id)) return null;
  if (envelope.type && page.type && String(envelope.type) !== String(page.type)) return null;

  const seasonOk =
    same(envelope.season, page.season) ||
    same(envelope.resolvedSeason, page.season) ||
    same(envelope.resolvedSeason, envelope.season);
  const episodeOk =
    same(envelope.episode, page.episode) ||
    same(envelope.resolvedEpisode, page.episode) ||
    same(envelope.resolvedEpisode, envelope.episode);
  if (!seasonOk || !episodeOk) return null;
  return envelope.servers;
}

/** What the site resolved to, when it differs from what we asked for. */
export function liveResolvedEpisode() {
  const envelope = readEnvelope();
  if (!envelope || !envelope.resolvedSeason || !envelope.resolvedEpisode) return null;
  if (same(envelope.resolvedSeason, envelope.season) && same(envelope.resolvedEpisode, envelope.episode)) {
    return null;
  }
  return { season: Number(envelope.resolvedSeason), episode: Number(envelope.resolvedEpisode) };
}

/**
 * Live entries in the shape FumioPlayerStage already understands: a source with
 * a stable `id`, a display `name` and a `url()` returning the string the site
 * would play. `url()` ignores its arguments on purpose — the site resolved this
 * exact episode, and the episode match is enforced above.
 */
export function liveSourcesAsPlayerSources() {
  const servers = liveSourcesFor();
  if (!servers) return null;
  return servers.map((entry) => ({
    id: entry.key,
    name: entry.label,
    quality: entry.quality,
    live: true,
    noProbe: true, // the site resolved it; do not re-probe another host
    url: () => entry.url,
  }));
}

/** Subscribe to list updates (the shell re-injects after a fetch lands). */
export function subscribeLiveSources(onChange) {
  if (typeof window === "undefined") return () => {};
  const handle = () => onChange();
  window.addEventListener(EVENT, handle);
  return () => window.removeEventListener(EVENT, handle);
}

/** The server this page asked for, resolved against the live list. */
export function livePreferredKey() {
  const envelope = readEnvelope();
  if (!envelope) return null;
  let fromUrl = null;
  try {
    fromUrl = new URLSearchParams(window.location.search).get("server");
  } catch {
    fromUrl = null;
  }
  if (!fromUrl) return null;
  if (/^\d+$/.test(fromUrl)) {
    const index = Number(fromUrl);
    return envelope.servers[index]?.key ?? null;
  }
  return envelope.servers.some((entry) => entry.key === fromUrl) ? fromUrl : null;
}
