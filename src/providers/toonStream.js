// ToonStream "Anime Special" — resolver-gated, never a dead button.
// The live site's /api/toon-stream scrapes toonstream.us and returns only a
// ravok.buzz player (Abyss as the sanctioned backup). No URL → no slot.
// Client stream-check is skipped (Iris probed:false); the worker already
// confirmed the Play URL.

import { PROXY_BASES } from "../lib/proxyTiers.js";

const BASES = [
  "https://theogpiratebot.online",
  ...PROXY_BASES.filter(Boolean),
];

const isPlayerHostUrl = (url) => {
  try {
    return /^(?:[a-z0-9-]+\.)*ravok\.buzz$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
};

const isAbyssUrl = (url) => {
  try {
    return /^(www\.)?(abyssplayer\.com|abyss\.to)$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
};

const readNativeJson = (url) =>
  new Promise((resolve) => {
    const native = typeof window !== "undefined" ? window.FumioNative : null;
    if (!native?.requestJson) {
      resolve(null);
      return;
    }
    const id = `toon-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const onEvent = (event) => {
      const detail = event.detail || {};
      if (detail.id !== id) return;
      window.removeEventListener("fumio-native-http", onEvent);
      resolve(detail.result || null);
    };
    window.addEventListener("fumio-native-http", onEvent);
    try {
      native.requestJson("GET", url, '{"Accept":"application/json"}', "", id);
    } catch {
      window.removeEventListener("fumio-native-http", onEvent);
      resolve(null);
    }
    setTimeout(() => {
      window.removeEventListener("fumio-native-http", onEvent);
      resolve(null);
    }, 25000);
  });

const readWebJson = async (url) => {
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) return null;
    return { ok: true, data: await response.json() };
  } catch {
    return null;
  }
};

const pickPlayer = (body) => {
  const chosen = body?.success ? body.player : null;
  if (!chosen) return null;
  if (isPlayerHostUrl(chosen) || isAbyssUrl(chosen)) {
    return { url: chosen, backup: body.backup === true };
  }
  return null;
};

/**
 * Resolve the ToonStream Play URL for one anime episode.
 * Returns { url, backup } or null. Never throws.
 */
export async function resolveToonStream({ type, title, id, season, episode, global = false } = {}) {
  const name = String(title || "").trim();
  if (!name || !id) return null;
  const params = new URLSearchParams({
    type: type === "movie" ? "movie" : "tv",
    title: name,
    id: String(id),
    season: String(Number(season) || 1),
    episode: String(Number(episode) || 1),
  });
  if (global) params.set("global", "1");
  const path = `/api/toon-stream?${params.toString()}`;

  for (const base of [...new Set(BASES)]) {
    const url = `${base}${path}`;
    const native = await readNativeJson(url);
    const payload = native?.data && typeof native.data === "object" ? native.data : native?.ok ? native.data : null;
    if (payload) {
      const picked = pickPlayer(payload);
      if (picked) return picked;
      if (payload.success === false) continue;
    }
    if (!native) {
      const web = await readWebJson(url);
      const picked = pickPlayer(web?.data);
      if (picked) return picked;
    }
  }
  return null;
}

export function toonStreamSource(url) {
  if (!url) return null;
  return {
    id: "toonstream",
    name: "Hindi • English • Japanese",
    quality: "Hindi • English • Japanese",
    noProbe: true,
    audioOptions: null,
    url: () => url,
  };
}
