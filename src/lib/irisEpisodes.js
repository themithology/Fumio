// Iris season and episode data adapter.
//
// This module uses the same AniList-backed API that powers Iris's own
// TvDetails page. The visitor's browser calls Iris's shared GraphQL adapter
// first (the `shared/anilist.ts` implementation), then walks Iris's Cloudflare
// API ladder. TMDB is not used to build the Iris season or episode list; it is
// only retained below for the player-number bridge and for non-anime fallback
// titles when Iris has no record.

import { anilistEpisodeCollection, anilistMetadataJson } from "./anilist.ts";
import { PROXY_BASES } from "./proxyTiers.js";
import { tmdbGet } from "./tmdb.js";

const CACHE_PREFIX = "theogpiratebot:iris:";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 20000;

// These are Iris's actual edge API tiers. Keep the full ladder here instead of
// only the four TMDB tiers previously used by Fumio; anime-metadata and
// anime-episodes are Iris API routes on all of these workers.
const IRIS_EDGE_BASES = [
  "https://theogpiratebot.to",
  "https://sexy.dryfruits.workers.dev",
  "https://theogpiratebot-tmdb-proxy.gleamcasteheavan.workers.dev",
  "https://damp-bird-e8d5.moviehub4u1209.workers.dev",
  "https://soft.niggasoup45.workers.dev",
  "https://juicypuhh.request-moviehub4u.workers.dev",
  "https://loudwolf.contact-theogpiratebot.workers.dev",
  "https://froxyproxy.gleamcasteheavan-960.workers.dev",
];

const readCache = (key) => {
  try {
    const raw = sessionStorage.getItem(`${CACHE_PREFIX}${key}`);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!entry || !entry.expiresAt || Date.now() > entry.expiresAt) {
      sessionStorage.removeItem(`${CACHE_PREFIX}${key}`);
      return null;
    }
    return entry.data || null;
  } catch {
    return null;
  }
};

const writeCache = (key, data) => {
  try {
    sessionStorage.setItem(
      `${CACHE_PREFIX}${key}`,
      JSON.stringify({ expiresAt: Date.now() + CACHE_TTL_MS, data }),
    );
  } catch {
    // Caching is best-effort; private browsing must not break the page.
  }
};

const irisBases = () =>
  [...new Set([...IRIS_EDGE_BASES, ...PROXY_BASES.filter(Boolean)])];

const getIrisJson = async (path) => {
  for (const base of irisBases()) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${base}${path}`, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      if (!response.ok) continue;
      const body = await response.json();
      if (body?.success !== false) return body;
    } catch {
      // Walk Iris's next independent edge tier.
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
};

const numericMap = (value) => {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, count]) => [String(key), Number(count)])
      .filter(([key, count]) => /^\d+$/.test(key) && Number.isFinite(count) && count > 0),
  );
};

const unwrapApiBody = (body) => {
  // Iris edge deployments have returned both the route body directly and a
  // `{ data: routeBody }` envelope during rolling updates. Normalize both so
  // a valid episode response is not mistaken for "no episodes".
  if (body?.data && typeof body.data === "object" && body.data.success !== undefined) {
    return body.data;
  }
  return body;
};

const normalizeMetadata = (rawBody, transport) => {
  const body = unwrapApiBody(rawBody);
  if (!body?.success || !body.seasons || typeof body.seasons !== "object") return null;
  const seasonsMap = numericMap(body.seasons);
  const seasons = Object.keys(seasonsMap)
    .sort((a, b) => Number(a) - Number(b))
    .map((key) => ({
      season_number: Number(key),
      name: body.titles?.[key] || `Season ${key}`,
      episode_count: seasonsMap[key],
      poster_path: body.posters?.[key] || null,
      anilist_id: Number(body.anilist_ids?.[key]) || null,
    }));

  // AniList movies intentionally have no season map. Preserve their root
  // entry id so the player can still build the episode-1 Sub/Dub lanes.
  // TV/OVA responses without either seasons or a root id remain unresolved.
  if (seasons.length === 0 && !Number(body.anilist_id)) return null;
  return {
    source: "iris",
    transport,
    seasons,
    seasonsMap,
    seasonIds: body.anilist_ids || {},
    segments: body.segments || {},
    rawCounts: body.raw_counts || {},
    anilistId: Number(body.anilist_id) || null,
    nextAiring: body.next_airing || body.nextAiring || body.nextAiringEpisode || null,
  };
};

/**
 * Fetch Iris's AniList season bridge for a title.
 *
 * The live site API is first: it carries title-specific exceptions
 * (Demon Slayer, Naruto, Mushoku). Browser-direct AniList is the fallback
 * when theogpiratebot.to / edge workers are down.
 */
export async function fetchIrisSeasonData({ title, tmdbEpisodes = null, year = null } = {}) {
  const cleanTitle = String(title || "").trim();
  if (!cleanTitle) return null;

  const params = new URLSearchParams({ title: cleanTitle });
  if (Number.isFinite(Number(tmdbEpisodes)) && Number(tmdbEpisodes) > 0) {
    params.set("tmdb_episodes", String(Math.round(Number(tmdbEpisodes))));
  }
  if (Number.isFinite(Number(year)) && Number(year) > 0) {
    params.set("tmdb_year", String(Math.round(Number(year))));
  }

  const cacheKey = `metadata:${params.toString()}`;
  const cached = readCache(cacheKey);
  if (cached) return cached;

  const edgeBody = await getIrisJson(`/api/anime-metadata?${params.toString()}`);
  const edgeParsed = normalizeMetadata(edgeBody, "iris-edge");
  if (edgeParsed) {
    writeCache(cacheKey, edgeParsed);
    return edgeParsed;
  }

  try {
    const direct = await anilistMetadataJson(cleanTitle, tmdbEpisodes, year);
    const parsed = normalizeMetadata(direct?.body, "browser-direct");
    if (parsed) {
      writeCache(cacheKey, parsed);
      return parsed;
    }
  } catch {
    // No metadata from either the site API or AniList.
  }

  return null;
}

const normalizeEpisodes = (rawBody) => {
  const body = unwrapApiBody(rawBody);
  if (!body?.success || !Array.isArray(body.episodes)) return null;
  const episodes = body.episodes
    .map((episode) => ({
      number: Number(episode.number),
      title: episode.title || "",
      thumbnail: episode.thumbnail || null,
      airingAt: Number(episode.airingAt) || null,
    }))
    .filter((episode) => Number.isFinite(episode.number) && episode.number > 0)
    .sort((a, b) => a.number - b.number);
  return {
    source: "iris",
    count: Number(body.count) || episodes.length,
    episodes,
  };
};

const inflightEpisodes = new Map();

/** Fetch the episode titles/thumbnails for one Iris/AniList season entry. */
export function fetchIrisEpisodes(anilistId) {
  const id = Number(anilistId);
  if (!Number.isFinite(id) || id < 1) return Promise.resolve(null);
  if (inflightEpisodes.has(id)) return inflightEpisodes.get(id);

  const key = `episodes:${id}`;
  const cached = readCache(key);
  if (cached) return Promise.resolve(cached);

  const request = (async () => {
    const body = await getIrisJson(`/api/anime-episodes?anilist_id=${id}`);
    const edgeParsed = normalizeEpisodes(body);
    if (edgeParsed) {
      writeCache(key, edgeParsed);
      return edgeParsed;
    }

    try {
      const direct = await anilistEpisodeCollection(id);
      const parsed = normalizeEpisodes(direct?.body);
      if (parsed) {
        writeCache(key, parsed);
        return parsed;
      }
    } catch {
      // Both the site API and browser-direct AniList failed.
    }

    return null;
  })().finally(() => {
    inflightEpisodes.delete(id);
  });

  inflightEpisodes.set(id, request);
  return request;
}

/**
 * Iris's UI can use AniList season numbering while embed hosts use TMDB's
 * season numbering. Convert the selected Iris pair before opening the player.
 * This keeps Iris episode data on screen while preserving Fumio's existing
 * player route contract.
 */
export function mapIrisEpisodeToTmdb(season, episode, irisSeasonsMap, tmdbSeasons) {
  const uiSeason = Number(season) || 1;
  const uiEpisode = Number(episode) || 1;
  const map = numericMap(irisSeasonsMap);
  const orderedTmdb = (tmdbSeasons || [])
    .filter((item) => item?.season_number > 0 && item?.episode_count > 0)
    .slice()
    .sort((a, b) => a.season_number - b.season_number);

  if (!Object.keys(map).length || !orderedTmdb.length) {
    return { season: uiSeason, episode: uiEpisode };
  }

  // One AniList entry can represent a long-running show whose TMDB seasons
  // keep global episode numbers (One Piece/Naruto-style data). The visible
  // episode number remains the Iris/AniList number.
  if (Object.keys(map).length === 1 && orderedTmdb.length > 1) {
    let remaining = uiEpisode;
    for (const tmdbSeason of orderedTmdb) {
      if (remaining <= tmdbSeason.episode_count) {
        return { season: tmdbSeason.season_number, episode: uiEpisode };
      }
      remaining -= tmdbSeason.episode_count;
    }
    const last = orderedTmdb[orderedTmdb.length - 1];
    return { season: last.season_number, episode: uiEpisode };
  }

  let absolute = uiEpisode;
  for (const [key, count] of Object.entries(map)) {
    if (Number(key) < uiSeason) absolute += count;
  }

  let remaining = absolute;
  for (const tmdbSeason of orderedTmdb) {
    if (remaining <= tmdbSeason.episode_count) {
      return { season: tmdbSeason.season_number, episode: remaining };
    }
    remaining -= tmdbSeason.episode_count;
  }

  const last = orderedTmdb[orderedTmdb.length - 1];
  return { season: last.season_number, episode: Math.max(remaining, 1) };
}

const stillOf = (episode) => {
  const thumbnail = episode?.thumbnail;
  if (typeof thumbnail === "string" && thumbnail) return thumbnail;
  if (thumbnail?.large) return thumbnail.large;
  if (thumbnail?.medium) return thumbnail.medium;
  return episode?.still_path || null;
};

/** Borrow TMDB names/stills when AniList numbering is real but display data is thin. */
export async function tmdbEnrichAnilistEpisodes({ id, season, episodes, irisSeasonsMap, tmdbSeasons }) {
  if (!id || !Array.isArray(episodes) || !episodes.length) return episodes || [];
  const thin = episodes.some((episode) => !episode.title || !stillOf(episode));
  if (!thin || !irisSeasonsMap || !tmdbSeasons?.length) return episodes;

  const needed = new Set();
  const mapped = new Map();
  for (const episode of episodes) {
    const pair = mapIrisEpisodeToTmdb(season, episode.number, irisSeasonsMap, tmdbSeasons);
    needed.add(pair.season);
    mapped.set(episode.number, pair);
  }

  const bySeason = new Map();
  await Promise.all(
    [...needed].map(async (tmdbSeason) => {
      const data = await tmdbGet(`tv/${id}/season/${tmdbSeason}`).catch(() => null);
      bySeason.set(
        tmdbSeason,
        new Map((data?.episodes || []).map((item) => [item.episode_number, item])),
      );
    }),
  );

  return episodes.map((episode) => {
    const pair = mapped.get(episode.number);
    const tmdb = bySeason.get(pair.season)?.get(pair.episode);
    return {
      ...episode,
      title: episode.title || tmdb?.name || "",
      thumbnail: stillOf(episode) || tmdb?.still_path || null,
      airingAt:
        episode.airingAt ||
        (tmdb?.air_date ? Math.floor(new Date(tmdb.air_date).getTime() / 1000) : null),
    };
  });
}

export async function tmdbSeasonEpisodes(id, season) {
  const data = await tmdbGet(`tv/${id}/season/${season}`).catch(() => null);
  return data?.episodes || [];
}
