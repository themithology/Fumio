// ─── Data proxy ladder ──────────────────────────────────────────────────────
// TheOGPirateBot never talks to TMDB directly from the browser (no API key shipped in
// the bundle). It calls a Cloudflare Worker that proxies TMDB, and tries
// several independent bases in order until one answers — same idea as
// Iris's axios.jsx/proxyTiers.js ladder, trimmed down (no turnstile, no
// self-edge hosting tier, no per-tier usage accounting).
//
// Order:
//   1. "" (relative) — same-origin. In `npm run dev` this is forwarded by
//      Vite to your LOCAL worker (`npm run worker:dev`, workerd on :8787).
//      In a production build this is wherever TheOGPirateBot itself is deployed —
//      only useful if you deploy worker/ alongside the static site.
//   2. The shared Iris Cloudflare Workers (same org, already running the
//      TMDB proxy) — "use our cloudflare workers" per the project brief.
//      Swap/trim this list for your own workers.dev URLs once you deploy.
//
// Override everything with VITE_PROXY_BASES="https://a.workers.dev,https://b.workers.dev"
// (comma-separated, tried in order, before the defaults below).

const fromEnv = (() => {
  try {
    const raw = import.meta.env?.VITE_PROXY_BASES;
    if (!raw) return [];
    return raw
      .split(",")
      .map((s) => s.trim().replace(/\/+$/, ""))
      .filter(Boolean);
  } catch {
    return [];
  }
})();

const DEFAULT_BASES = [
  "", // relative/same-origin (local worker in dev, co-deployed worker in prod)
  "https://theogpiratebot-tmdb-proxy.gleamcasteheavan.workers.dev",
  "https://sexy.dryfruits.workers.dev",
  "https://damp-bird-e8d5.moviehub4u1209.workers.dev",
  "https://soft.niggasoup45.workers.dev",
];

export const PROXY_BASES = fromEnv.length ? fromEnv : DEFAULT_BASES;
