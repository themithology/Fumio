// Anime schedule data and AniList-to-TMDB bridge used by the weekly schedule.
// All calls are best effort: a schedule outage should never affect browsing or
// playback on the rest of the site.

import { PROXY_BASES } from "../lib/proxyTiers.js";
import axios from "../lib/irisAxios.js";

const CACHE_PREFIX = "anime-schedule:";
const CACHE_TTL_MS = 15 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 9000;

const readCache = (key) => {
  try {
    const entry = JSON.parse(sessionStorage.getItem(`${CACHE_PREFIX}${key}`) || "null");
    if (!entry || Date.now() > entry.expiresAt) return null;
    return entry.data;
  } catch {
    return null;
  }
};

const writeCache = (key, data) => {
  try {
    sessionStorage.setItem(`${CACHE_PREFIX}${key}`, JSON.stringify({ expiresAt: Date.now() + CACHE_TTL_MS, data }));
  } catch {
    // Storage is optional, especially in private browsing.
  }
};

const edgeBases = () => [...new Set(["", ...PROXY_BASES.filter(Boolean)])];

const getScheduleFromEdge = async (start, end, signal) => {
  for (const base of edgeBases()) {
    const controller = signal ? null : new AbortController();
    const timer = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : null;
    try {
      const response = await fetch(`${base}/api/anime-schedule?start=${start}&end=${end}`, {
        signal: signal || controller.signal,
        headers: { Accept: "application/json" },
      });
      if (!response.ok) continue;
      const body = await response.json();
      if (body?.success !== false && Array.isArray(body?.items)) return body.items;
    } catch {
      // Continue to the next independent edge base.
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  return null;
};

const directAniListSchedule = async (start, end, signal) => {
  const query = `query { Page(page: 1, perPage: 50) { airingSchedules(airingAt_greater: ${start}, airingAt_lesser: ${end}, sort: TIME) { id airingAt episode media { id format status title { english romaji } coverImage { large } bannerImage genres countryOfOrigin } } } }`;
  try {
    const response = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query }),
      signal,
    });
    if (!response.ok) return null;
    const body = await response.json();
    if (Array.isArray(body?.errors)) return null;
    return (body?.data?.Page?.airingSchedules || []).map((item) => ({
      id: item.id,
      airingAt: Number(item.airingAt),
      episode: Number(item.episode),
      media: {
        id: item.media?.id,
        format: item.media?.format,
        title: item.media?.title || {},
        coverImage: item.media?.coverImage || {},
        bannerImage: item.media?.bannerImage || null,
      },
    })).filter((item) => item.airingAt && item.media?.id);
  } catch {
    return null;
  }
};

export const fetchWeekSchedule = async (start, end, { signal } = {}) => {
  const key = `week:${start}:${end}`;
  const cached = readCache(key);
  if (Array.isArray(cached)) return cached;

  const edge = await getScheduleFromEdge(start, end, signal);
  const direct = edge || await directAniListSchedule(start, end, signal);
  if (!Array.isArray(direct)) throw new Error("Schedule unavailable");
  writeCache(key, direct);
  return direct;
};

export const displayTitle = (media) => media?.title?.english || media?.title?.romaji || "Untitled";

export const fetchAnimeTrending = async ({ signal } = {}) => {
  const cached = readCache("trending");
  if (Array.isArray(cached)) return cached;
  for (const base of edgeBases()) {
    try {
      const response = await fetch(`${base}/api/anime-trending`, {
        signal,
        headers: { Accept: "application/json" },
      });
      if (!response.ok) continue;
      const body = await response.json();
      if (body?.success !== false && Array.isArray(body?.items)) {
        writeCache("trending", body.items);
        return body.items;
      }
    } catch {
      // Try AniList directly below.
    }
  }
  try {
    const response = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query: "{ Page(page: 1, perPage: 20) { media(type: ANIME, sort: TRENDING_DESC) { id format title { english romaji } startDate { year } coverImage { large } } } }" }),
      signal,
    });
    const body = await response.json();
    const items = body?.data?.Page?.media;
    if (response.ok && Array.isArray(items)) {
      writeCache("trending", items);
      return items;
    }
  } catch {
    // Trending is optional; TMDB discovery remains the fallback.
  }
  return [];
};

const resolveCacheKey = (media) => `match:${media?.id}:${media?.format || "tv"}`;

export const resolveAnimeMatch = async (media) => {
  if (!media?.id) return null;
  const key = resolveCacheKey(media);
  const cached = readCache(key);
  if (cached?.match) return cached.match;
  const title = displayTitle(media);
  const type = media.format === "MOVIE" ? "movie" : "tv";
  if (!title) return null;
  try {
    const { data } = await axios.get(`/search/${type}?query=${encodeURIComponent(title)}&include_adult=false`);
    const hit = (data?.results || []).find((item) => item?.id);
    if (hit?.id) {
      const match = { ...hit, media_type: type };
      writeCache(key, { match });
      return match;
    }
  } catch {
    // A missing match should not remove the title from the discovery hub.
  }
  return null;
};

export const resolveTmdbId = async (media) => {
  if (!media?.id) return null;
  const key = resolveCacheKey(media);
  const cached = readCache(key);
  if (cached?.id) return cached.id;
  const title = displayTitle(media);
  if (!title) return null;
  const type = media.format === "MOVIE" ? "movie" : "tv";
  try {
    const { data } = await axios.get(`/search/${type}?query=${encodeURIComponent(title)}&include_adult=false`);
    const hit = (data?.results || []).find((item) => item?.id);
    if (hit?.id) {
      writeCache(key, { id: hit.id });
      return hit.id;
    }
  } catch {
    // The schedule remains usable even when a title cannot be resolved.
  }
  return null;
};

export * from "./scheduleWeek.js";
