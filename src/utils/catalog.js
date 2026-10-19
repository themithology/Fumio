// ─── catalog.js — what the picker is allowed to offer ────────────────────────
//
// Replaces utils/siteConfig.js (deleted 2026-09-27 with the whole custom-upload
// idea). There is nothing to configure any more and no secret anywhere: the
// shipped catalog is compiled into the build, and the owner's own pictures come
// from the server's GET /api/config, which reads `data/avatars.json` fresh on
// every request.
//
// Two deployment shapes still have to work:
//
//   • Pterodactyl / plain node — /api/config answers with the owner's additions.
//   • A STATIC host (Cloudflare Pages/Workers, Vercel) with no /api at all — the
//     request comes back as index.html, JSON parsing fails, and the shipped
//     catalog is what a member sees. Pictures still work; the owner's extras
//     simply are not there.
//
// A failed lookup is not cached, so a member whose server was just restarted
// does not have to clear anything.

import {
  AVATAR_CATALOG,
  ANIME_AVATARS,
  GENERIC_AVATARS,
  COVER_CATALOG,
  CATALOG_HOSTS,
  AVATAR_CATALOG_CREDIT,
} from "../config/avatarCatalog.js";

export const CONFIG_URL = "https://theogpiratebot.online/api/config";
export const CONFIG_TIMEOUT_MS = 8000;

/** The server's answer, or null — never throws, never half-applied. */
let cached = null;

/** The pictures that need no server at all. */
export const shippedAvatars = () => AVATAR_CATALOG;
/** The two halves, for the picker's filter chips. */
export const animeAvatars = () => ANIME_AVATARS;
export const genericAvatars = () => GENERIC_AVATARS;

/** Owner pictures in front, then the shipped ones. Duplicates by URL are dropped. */
export const mergeAvatars = (ownerList = []) => {
  const seen = new Set();
  const merged = [];
  for (const entry of [...ownerList, ...AVATAR_CATALOG]) {
    const url = String(entry?.url || "");
    if (!url || seen.has(url)) continue;
    seen.add(url);
    merged.push({
      id: String(entry?.id || `a-${merged.length + 1}`),
      name: String(entry?.name || "Picture"),
      series: String(entry?.series || ""),
      url,
      owner: Boolean(entry?.owner),
      kind: entry?.kind || (entry?.owner ? "owner" : "generic"),
    });
  }
  return merged;
};

export const currentCatalog = () =>
  cached?.avatars ? cached : { avatars: shippedAvatars(), covers: COVER_CATALOG, source: "build" };

export const catalogCredit = () => AVATAR_CATALOG_CREDIT;
export const catalogHosts = () => [...CATALOG_HOSTS];

const fetchWithTimeout = async (url, timeoutMs) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
  } finally {
    clearTimeout(timer);
  }
};

/** Validate one owner entry the server sent; a bad one is dropped, not trusted. */
const cleanOwnerAvatar = (entry, index) => {
  const url = String(entry?.url || "").trim();
  if (!/^https:\/\/[^\s"']+$/.test(url) || url.length > 300) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
  } catch {
    return null;
  }
  return {
    id: String(entry?.id || `own-${index + 1}`),
    name: String(entry?.name || "Your picture").slice(0, 40),
    series: String(entry?.series || "Added by the site owner").slice(0, 60),
    url,
    owner: true,
    kind: "owner",
  };
};

/** The cover a stored id points at, falling back to the first, or none. */
export const coverById = (id) => COVER_CATALOG.find((cover) => cover.id === String(id ?? "")) || null;

/**
 * Ask the server once per page load (and cache in memory). Always resolves.
 */
export const loadCatalog = async ({ force = false } = {}) => {
  if (cached && !force) return cached;
  try {
    const res = await fetchWithTimeout(CONFIG_URL, CONFIG_TIMEOUT_MS);
    if (!res.ok) throw new Error(`config ${res.status}`);
    const type = res.headers.get("content-type") || "";
    // A static host answers the SPA's index.html here; that is not a config.
    if (!type.includes("application/json")) throw new Error("no config endpoint");
    const body = await res.json();
    const ownerList = Array.isArray(body?.avatars)
      ? body.avatars.map(cleanOwnerAvatar).filter(Boolean)
      : [];
    cached = {
      avatars: mergeAvatars(ownerList),
      covers: COVER_CATALOG,
      source: "server",
      ownerCount: ownerList.length,
    };
    return cached;
  } catch {
    cached = { avatars: shippedAvatars(), covers: COVER_CATALOG, source: "build", ownerCount: 0 };
    return cached;
  }
};

export const resetCatalogCache = () => {
  cached = null;
};
