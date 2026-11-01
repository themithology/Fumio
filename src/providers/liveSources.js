// ─── Live server list, handed to us by the APK shell ────────────────────────
//
// The app owns this player. The server LIST does not belong to the app: it
// belongs to the website, which is the thing that gets updated when a host
// moves or a slot is renamed.
//
// The Android shell fetches that list (see LiveSourceSync.java — it asks the
// site for /api/players, and when the site has no such endpoint it opens the
// site's own player page in an offscreen WebView and records the servers the
// site actually renders) and then injects:
//
//   window.__fumioLiveSources = [
//     { key: "tgvid", label: "Server 1 (Hindi•English•Multi Language)", url: "https://…" },
//     …
//   ]
//
// followed by a `fumio-live-sources` event. This module is the only place the
// player reads it, so nothing else has to know the interaction exists.
//
// On the website itself (no shell, no injection) it returns null and every
// caller keeps using the bundled source list — the site is untouched.

const EVENT = "fumio-live-sources";

const clean = (raw) => {
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

/** The live list, or null when the app has not provided one. */
export function readLiveSources() {
  if (typeof window === "undefined") return null;
  return clean(window.__fumioLiveSources);
}

/** Subscribe to list updates (the shell re-injects after a fetch lands). */
export function subscribeLiveSources(onChange) {
  if (typeof window === "undefined") return () => {};
  const handle = () => onChange(readLiveSources());
  window.addEventListener(EVENT, handle);
  return () => window.removeEventListener(EVENT, handle);
}

/**
 * Live entries in the shape FumioPlayerStage already understands: a source
 * with a stable `id`, a display `name` and a `url()` that returns the string
 * the site would play. `url()` ignores the arguments on purpose — the site has
 * already resolved this exact episode.
 */
export function liveSourcesAsPlayerSources() {
  const live = readLiveSources();
  if (!live) return null;
  return live.map((entry) => ({
    id: entry.key,
    name: entry.label,
    quality: entry.quality,
    live: true,
    noProbe: true, // the site resolved it; do not re-probe another host
    url: () => entry.url,
  }));
}

/** The preferred server key, if the shell's list came from a ?server= link. */
export function livePreferredKey() {
  const live = readLiveSources();
  if (!live) return null;
  const fromUrl = (() => {
    try {
      return new URLSearchParams(window.location.search).get("server");
    } catch {
      return null;
    }
  })();
  if (!fromUrl) return null;
  if (/^\d+$/.test(fromUrl)) {
    const index = Number(fromUrl);
    return live[index]?.key ?? null;
  }
  return live.some((entry) => entry.key === fromUrl) ? fromUrl : null;
}
