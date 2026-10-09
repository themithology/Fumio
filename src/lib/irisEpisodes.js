// Iris season and episode data adapter.
//
// The details page stays Fumio's UI, but anime season segregation and episode
// labels/counts come from the same Iris edge API used by TheOGPirateBot. The
// TMDB proxy remains the metadata fallback for ordinary television and for a
// title whose AniList record is unavailable.

import { PROXY_BASES } from "./proxyTiers.js";

const CACHE_PREFIX = "theogpiratebot:iris:";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 9000;

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

const irisBases = () => {
  // The local TheOGPirateBot worker deliberately exposes TMDB and
  // stream-check, not Iris's AniList routes. Skip the relative base here and
  // walk Iris's existing edge workers directly.
  const defaults = [
    "https://theogpiratebot-tmdb-proxy.gleamcasteheavan.workers.dev",
    "https://sexy.dryfruits.workers.dev",
    "https://damp-bird-e8d5.moviehub4u1209.workers.dev",
    "https://soft.niggasoup45.workers.dev",
  ];
  return [...new Set([...PROXY_BASES.filter(Boolean), ...defaults])];
};

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
      if (body && body.success !== false) return body;
    } catch {
      // Walk the next Iris edge tier.
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

/**
 * Fetch Iris's AniList season bridge for a title. Iris only returns a
 * successful result when the title resolves to an anime chain; callers should
 * use the TMDB seasons when this returns null.
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

  const body = await getIrisJson(`/api/anime-metadata?${params.toString()}`);
  if (!body?.seasons || typeof body.seasons !== "object") return null;

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

  if (seasons.length === 0) return null;

  const result = {
    source: "iris",
    seasons,
    seasonsMap,
    seasonIds: body.anilist_ids || {},
    segments: body.segments || {},
    rawCounts: body.raw_counts || {},
    anilistId: Number(body.anilist_id) || null,
    nextAiring: body.next_airing || null,
  };
  writeCache(cacheKey, result);
  return result;
}

const inflightEpisodes = new Map();

/** Fetch the episode titles/thumbnails for one Iris/AniList season entry. */
export function fetchIrisEpisodes(anilistId) {
  const id = Number(anilistId);
  if (!Number.isFinite(id) || id < 1) return Promise.resolve(null);
  if (inflightEpisodes.has(id)) return inflightEpisodes.get(id);

  const key = `episodes:${id}`;
  const cached = readCache(key);
  if (cached) return Promise.resolve(cached);

  const request = getIrisJson(`/api/anime-episodes?anilist_id=${id}`)
    .then((body) => {
      if (!body || !Array.isArray(body.episodes)) return null;
      const result = {
        source: "iris",
        count: Number(body.count) || body.episodes.length,
        episodes: body.episodes
          .map((episode) => ({
            number: Number(episode.number),
            title: episode.title || "",
            thumbnail: episode.thumbnail || null,
            airingAt: Number(episode.airingAt) || null,
          }))
          .filter((episode) => Number.isFinite(episode.number) && episode.number > 0)
          .sort((a, b) => a.number - b.number),
      };
      writeCache(key, result);
      return result;
    })
    .finally(() => {
      inflightEpisodes.delete(id);
    });
  inflightEpisodes.set(id, request);
  return request;
}

/**
 * Iris's UI can use AniList season numbering while embed hosts use TMDB's
 * season numbering. Convert the selected Iris pair before opening the player.
 * This mirrors Iris's absolute-episode bridge for the common multi-season and
 * single-entry long-running anime cases.
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
  // keep global episode numbers (One Piece/Naruto-style data).
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
