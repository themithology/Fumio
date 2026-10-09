// ─────────────────────────────────────────────────────────────────────────
// TheOGPirateBot data proxy — a trimmed Cloudflare Worker, vendored from Iris's
// edge/cloudflare-worker (edge/worker/main.ts). Iris's worker also resolves
// iframe-embed "servers" (nxsha, bingr, vidfast, toonstream, …) — TheOGPirateBot
// drops all of that. A real TheOGPirateBot *provider* (see src/providers/) is
// expected to return a raw stream URL on its own; this worker's only job is
// the thing every page needs regardless of provider: a CORS-safe TMDB proxy
// so the browser never needs (or leaks) a TMDB API key.
//
// Routes:
//   GET /tmdb/{path}        TMDB proxy (e.g. /tmdb/movie/550)
//   GET /api/tmdb/{path}    same, alias (matches Iris's client ladder)
//   GET /api/health         liveness probe
//
// Run locally:  npm run worker:dev   (wrangler/workerd on :8787)
// Deploy:       npm run worker:deploy
// ─────────────────────────────────────────────────────────────────────────

const TMDB_API_BASE = "https://api.themoviedb.org/3";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...CORS_HEADERS,
      ...extraHeaders,
    },
  });
}

/** Cache-Control lifetime per TMDB path shape — mirrors Iris's tiers. */
function clientMaxAgeFor(path) {
  const p = path.toLowerCase();
  if (p.includes("search")) return 600; // 10 min — results change often
  if (/^\/?(movie|tv)\/\d+(\/.*)?$/.test(p) && !p.includes("recommendations") && !p.includes("similar")) {
    return 3600; // 1 h — details/season/episode payloads are stable
  }
  if (p.includes("top_rated")) return 86400; // 24 h
  if (p.includes("trending") || p.includes("popular") || p.includes("discover")) return 1800; // 30 min
  return 1800;
}

async function proxyTmdb(path, url, env) {
  const params = new URLSearchParams(url.search);

  const authVal = (
    env.TMDB_READ_ACCESS_TOKEN ||
    env.TMDB_API_KEY ||
    env.TMDB_TOKEN ||
    env.TMDB_KEY ||
    ""
  )
    .toString()
    .trim()
    .replace(/^["']+/, "")
    .replace(/["']+$/, "");

  if (!authVal) {
    return json(
      {
        success: false,
        error:
          "TMDB API key not configured on this Worker. Add TMDB_API_KEY (v3 key) or TMDB_READ_ACCESS_TOKEN (v4 bearer token) — locally in worker/.dev.vars, in production via `wrangler secret put`.",
      },
      500,
    );
  }

  const headers = {
    Accept: "application/json",
    "User-Agent": "TheOGPirateBot-Proxy/1.0-edge",
  };
  // v4 read access tokens are JWTs (start with "eyJ") or just long; v3 keys
  // are a plain 32-char string sent as a query param instead.
  if (authVal.startsWith("eyJ") || authVal.length > 40) {
    headers.Authorization = `Bearer ${authVal}`;
  } else {
    params.set("api_key", authVal);
  }

  const target = `${TMDB_API_BASE}/${path.replace(/^\/+/, "")}?${params.toString()}`;
  try {
    const resp = await fetch(target, {
      method: "GET",
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });
    return new Response(resp.body, {
      status: resp.status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": `public, max-age=${clientMaxAgeFor(path)}, stale-while-revalidate=86400`,
        ...CORS_HEADERS,
      },
    });
  } catch (e) {
    return json({ success: false, error: `TMDB proxy error: ${String(e)}` }, 502);
  }
}

// ─── Stream availability probe ──────────────────────────────────────────────
// The browser can't read the HTTP status of a cross-origin fetch (CORS hides
// it), which is exactly what's needed to tell "tgvid has this title" from
// "tgvid is down/404s it" before committing to an iframe. The Worker has no
// such restriction, so it does the HEAD/GET check server-side. Only the real
// embed hosts in src/providers/sources.js are allowed — this is NOT an open
// proxy.
const STREAM_CHECK_HOSTS = new Set([
  "tgvid.lovable.app",
  "vidstuck.xyz",
  "bingr.one",
  "vidfast.vc",
  "zxcstream.xyz",
  "nxsha.space",
]);

async function streamCheck(rawUrl) {
  let target;
  try {
    target = new URL(rawUrl);
  } catch {
    return json({ ok: false, error: "invalid url" }, 400);
  }
  if (!STREAM_CHECK_HOSTS.has(target.hostname)) {
    return json({ ok: false, error: "host not allowed" }, 403);
  }
  try {
    const res = await fetch(target.toString(), {
      method: "GET",
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; TheOGPirateBotStreamCheck/1.0)" },
      signal: AbortSignal.timeout(7000),
    });
    return json({ ok: res.ok, status: res.status }, 200, { "Cache-Control": "public, max-age=120" });
  } catch (e) {
    // Network failure / timeout — report as "unknown", not "dead". The
    // client fails OPEN on unknown (never blocks playback on a probe
    // hiccup), exactly like Iris's stream-check behaviour.
    return json({ ok: null, error: String(e) }, 200);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (path === "/api/health" || path === "/api/version") {
      return json({ ok: true, service: "theogpiratebot-data-proxy", features: { edge: true } });
    }

    if (path === "/api/stream-check") {
      return streamCheck(url.searchParams.get("url") || "");
    }

    if (path.startsWith("/tmdb/")) {
      return proxyTmdb(path.slice("/tmdb/".length), url, env);
    }
    if (path.startsWith("/api/tmdb/")) {
      return proxyTmdb(path.slice("/api/tmdb/".length), url, env);
    }

    return json({ success: false, error: "Not found" }, 404);
  },
};
