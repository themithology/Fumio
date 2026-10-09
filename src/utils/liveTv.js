// ─── Live TV — runtime data (fetch + cache + favorites + recents) ─────────────
// Snapshot-first: every read path falls back to the bundled snapshot, so the
// guide renders instantly and survives API/CORS/network failures. Live data
// is a 6-hour-cached overlay that only ever ADDS freshness or newcomers.
//
// No DOM at module scope — pure helpers + a storage shim with an in-memory
// fallback, so the whole module runs under node:test.
import {
  LIVE_TV_API,
  LIVE_TV_SECTIONS,
  isBannedLiveName,
  isInfoEnglishMajor,
  isMovieEnglishMajor,
  isMovieHindiMajor,
  isRegionalMajor,
  liveTvCategoryUrl,
  mergeSection,
  snapshotToChannels,
} from "../data/liveTvSnapshot.js";

// ── storage shim (localStorage in browsers, memory under node/tests) ────────
const memoryStore = new Map();
const getStore = () => {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    /* private mode / SSR — fall through to memory */
  }
  return {
    getItem: (k) => (memoryStore.has(k) ? memoryStore.get(k) : null),
    setItem: (k, v) => void memoryStore.set(k, String(v)),
    removeItem: (k) => void memoryStore.delete(k),
  };
};

const readJSON = (key) => {
  try {
    const raw = getStore().getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const writeJSON = (key, value) => {
  try {
    getStore().setItem(key, JSON.stringify(value));
  } catch {
    /* quota / private mode — caching is best-effort */
  }
};

const emit = (name) => {
  try {
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(name));
  } catch {
    /* node — no listeners */
  }
};

// ── live fetch ──────────────────────────────────────────────────────────────
// The four curated facets are small (~105 channels combined) — cheap to
// refresh. The full 1100+ list is fetched lazily (regional enrichment +
// nothing else) and cached the same way.
const CACHE_KEY = "livetv-cache-v1";
const FULL_CACHE_KEY = "livetv-full-v2";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 9000;
const MAX_REGIONAL = 24;

const fetchJSON = async (url) => {
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS) : null;
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: ctrl ? ctrl.signal : undefined,
    });
    if (!res.ok) throw new Error(`Live TV ${res.status} for ${url}`);
    return await res.json();
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const asArray = (payload) =>
  Array.isArray(payload?.channels) ? payload.channels : [];

// Module-level inflight dedup: the hub and the theater share one refresh.
let inflightSections = null;
let inflightFull = null;
let memoSections = null;
let memoFull = null;

export const readSectionsCache = () => {
  const entry = readJSON(CACHE_KEY);
  if (!entry || !entry.exp || Date.now() > entry.exp || !entry.data) return null;
  return entry.data;
};

/** Curated facets, merged over the snapshot. Never rejects with empty data:
// on any failure the snapshot is returned (live:false). */
export const loadLiveTv = (opts = {}) => {
  if (memoSections && !opts.force) return Promise.resolve(memoSections);
  if (inflightSections && !opts.force) return inflightSections;

  const cached = opts.force ? null : readSectionsCache();
  if (cached) {
    memoSections = { ...cached, live: true, fromCache: true };
    return Promise.resolve(memoSections);
  }

  inflightSections = (async () => {
    const facets = LIVE_TV_SECTIONS.filter((s) => s.api);
    const settled = await Promise.allSettled(
      facets.map((s) => fetchJSON(liveTvCategoryUrl(s.api)).then(asArray))
    );
    const sections = snapshotToChannels();
    let liveCount = 0;
    settled.forEach((r, i) => {
      const key = facets[i].key;
      if (r.status === "fulfilled" && r.value.length > 0) {
        sections[key] = mergeSection(key, r.value);
        liveCount += r.value.length;
      }
    });
    // Investigation Discovery arrives via Entertainment but belongs to Info;
    // mergeSection already skips it per-section, so re-home it explicitly.
    const entIdx = facets.findIndex((s) => s.key === "serials");
    if (entIdx >= 0 && settled[entIdx].status === "fulfilled") {
      for (const item of settled[entIdx].value) {
        const id = String(item?.id || "");
        if ((id === "3434" || id === "3435") && item?.name && !isBannedLiveName(item.name)) {
          if (!sections.info.some((c) => c.id === id)) {
            sections.info.push({ id, name: String(item.name), logo: String(item.logo || ""), section: "info" });
          }
        }
      }
    }
    const result =
      liveCount > 0
        ? { sections, updatedAt: Date.now(), live: true, fromCache: false }
        : { sections, updatedAt: Date.now(), live: false, fromCache: false };
    if (liveCount > 0) writeJSON(CACHE_KEY, { exp: Date.now() + CACHE_TTL_MS, data: result });
    memoSections = result;
    return result;
  })().finally(() => {
    inflightSections = null;
  });

  return inflightSections;
};

export const readFullCache = () => {
  const entry = readJSON(FULL_CACHE_KEY);
  if (!entry || !entry.exp || Date.now() > entry.exp || !entry.data) return null;
  return entry.data;
};

/** Full-list enrichment: regional GEC majors + English infotainment majors +
English/Hindi movie stragglers (HBO, UTV Movies…). Returns { regional,
infoEn, moviesEn, moviesHi } (empty arrays when offline/unavailable). */
export const loadLiveTvFull = (opts = {}) => {
  if (memoFull && !opts.force) return Promise.resolve(memoFull);
  if (inflightFull && !opts.force) return inflightFull;

  const cached = opts.force ? null : readFullCache();
  if (cached) {
    memoFull = cached;
    return Promise.resolve(memoFull);
  }

  inflightFull = (async () => {
    let result = { regional: [], infoEn: [], moviesEn: [], moviesHi: [] };
    try {
      const all = await fetchJSON(LIVE_TV_API).then(asArray);
      const seen = new Set();
      const regional = [];
      const infoEn = [];
      const moviesEn = [];
      const moviesHi = [];
      for (const item of all) {
        const id = String(item?.id || "");
        if (!id || seen.has(id) || !item?.name) continue;
        seen.add(id);
        if (isRegionalMajor(item.name)) {
          if (regional.length < MAX_REGIONAL) {
            regional.push({ id, name: String(item.name), logo: String(item.logo || ""), section: "regional" });
          }
        } else if (isInfoEnglishMajor(item.name)) {
          infoEn.push({ id, name: String(item.name), logo: String(item.logo || ""), section: "info" });
        } else if (isMovieEnglishMajor(item.name)) {
          moviesEn.push({ id, name: String(item.name), logo: String(item.logo || ""), section: "moviesEn" });
        } else if (isMovieHindiMajor(item.name)) {
          moviesHi.push({ id, name: String(item.name), logo: String(item.logo || ""), section: "moviesHi" });
        }
      }
      regional.sort((a, b) => a.name.localeCompare(b.name));
      infoEn.sort((a, b) => a.name.localeCompare(b.name));
      moviesEn.sort((a, b) => a.name.localeCompare(b.name));
      moviesHi.sort((a, b) => a.name.localeCompare(b.name));
      result = { regional, infoEn, moviesEn, moviesHi };
      writeJSON(FULL_CACHE_KEY, { exp: Date.now() + CACHE_TTL_MS, data: result });
    } catch {
      /* offline — enrichment is optional, sections still render */
    }
    memoFull = result;
    return result;
  })().finally(() => {
    inflightFull = null;
  });

  return inflightFull;
};

/** Resolve any id to a channel (snapshot → section cache → full cache). */
export const resolveLiveTvChannel = (id, extra = null) => {
  const sid = String(id || "");
  if (!sid) return null;
  const pools = [];
  if (extra?.sections) pools.push(...Object.values(extra.sections));
  if (extra?.regional) pools.push(extra.regional);
  if (extra?.infoEn) pools.push(extra.infoEn);
  for (const pool of pools) {
    const hit = (pool || []).find((c) => c && String(c.id) === sid);
    if (hit) return hit;
  }
  const snap = snapshotToChannels();
  for (const pool of Object.values(snap)) {
    const hit = pool.find((c) => c.id === sid);
    if (hit) return hit;
  }
  const cached = readSectionsCache();
  if (cached?.sections) {
    for (const pool of Object.values(cached.sections)) {
      const hit = (pool || []).find((c) => c && String(c.id) === sid);
      if (hit) return hit;
    }
  }
  return null;
};

// ── favorites (on-device, same privacy model as My List) ────────────────────
const FAV_KEY = "livetv-favorites";
export const FAV_EVENT = "livetv-favorites-updated";
const MAX_FAVS = 60;

export const readLiveTvFavorites = () => {
  const raw = readJSON(FAV_KEY);
  return Array.isArray(raw) ? raw.map(String).filter(Boolean).slice(0, MAX_FAVS) : [];
};

export const isLiveTvFavorite = (id) => readLiveTvFavorites().includes(String(id));

export const toggleLiveTvFavorite = (id) => {
  const sid = String(id);
  const favs = readLiveTvFavorites();
  const next = favs.includes(sid)
    ? favs.filter((f) => f !== sid)
    : [sid, ...favs].slice(0, MAX_FAVS);
  writeJSON(FAV_KEY, next);
  emit(FAV_EVENT);
  return next.includes(sid);
};

// ── recents ("Continue Watching" for live — its own key, never pollutes the
// movie/tv continueWatching rail on Home) ────────────────────────────────────
const RECENT_KEY = "livetv-recent";
export const RECENT_EVENT = "livetv-recent-updated";
const MAX_RECENTS = 12;

export const readLiveTvRecents = () => {
  const raw = readJSON(RECENT_KEY);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r) => r && r.id)
    .map((r) => ({ id: String(r.id), at: Number(r.at) || 0 }))
    .slice(0, MAX_RECENTS);
};

export const pushLiveTvRecent = (id) => {
  const sid = String(id);
  if (!sid) return;
  const next = [{ id: sid, at: Date.now() }, ...readLiveTvRecents().filter((r) => r.id !== sid)].slice(0, MAX_RECENTS);
  writeJSON(RECENT_KEY, next);
  emit(RECENT_EVENT);
};

export const clearLiveTvRecents = () => {
  try {
    getStore().removeItem(RECENT_KEY);
  } catch {
    /* ignore */
  }
  emit(RECENT_EVENT);
};
