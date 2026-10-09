// ─── TMDB client ────────────────────────────────────────────────────────────
// Thin fetch wrapper around the data-proxy ladder (see proxyTiers.js). Tries
// each base in order, caches successful GETs in memory + sessionStorage so
// repeat navigation (Home -> Details -> Back) doesn't re-hit the network.

import { PROXY_BASES } from "./proxyTiers.js";

const memCache = new Map(); // key -> { data, at }
const TTL_MS = 30 * 60 * 1000;
const FAILOVER_TIMEOUT_MS = 8000;

function cacheKey(path, params) {
  return `${path}?${new URLSearchParams(params || {}).toString()}`;
}

function readSessionCache(key) {
  try {
    const raw = sessionStorage.getItem(`fumio:tmdb:${key}`);
    if (!raw) return null;
    const { data, at } = JSON.parse(raw);
    if (Date.now() - at > TTL_MS) return null;
    return data;
  } catch {
    return null;
  }
}

function writeSessionCache(key, data) {
  try {
    sessionStorage.setItem(`fumio:tmdb:${key}`, JSON.stringify({ data, at: Date.now() }));
  } catch {
    /* storage full / private mode — in-memory cache still works */
  }
}

async function timedFetch(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
  } finally {
    clearTimeout(timer);
  }
}

/** GET /tmdb/{path}?{params} through the proxy ladder, with caching. */
export async function tmdbGet(path, params = {}) {
  const key = cacheKey(path, params);

  const mem = memCache.get(key);
  if (mem && Date.now() - mem.at < TTL_MS) return mem.data;

  const cached = readSessionCache(key);
  if (cached) {
    memCache.set(key, { data: cached, at: Date.now() });
    return cached;
  }

  const qs = new URLSearchParams(params).toString();
  let lastError = null;
  for (const base of PROXY_BASES) {
    const url = `${base}/tmdb/${path.replace(/^\/+/, "")}${qs ? `?${qs}` : ""}`;
    try {
      const res = await timedFetch(url, FAILOVER_TIMEOUT_MS);
      if (!res.ok) {
        lastError = new Error(`HTTP ${res.status} from ${base || "(relative)"}`);
        continue;
      }
      const data = await res.json();
      if (data && data.success === false) {
        lastError = new Error(data.error || "proxy reported failure");
        continue;
      }
      memCache.set(key, { data, at: Date.now() });
      writeSessionCache(key, data);
      return data;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error("tmdbGet: every proxy base failed");
}

export const img = (path, size = "w500") =>
  path ? `https://image.tmdb.org/t/p/${size}${path}` : null;
