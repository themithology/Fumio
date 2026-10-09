// ─── Iris axios compat shim ─────────────────────────────────────────────────
// The Home/Search/Explore UI below is ported close to verbatim from Iris
// (themithology/Iris.), which calls `axios.get("/discover/movie?...")` and
// reads `res.data`. TheOGPirateBot's own TMDB client (./tmdb.js) already does proxy
// failover + caching but has a different call shape (`tmdbGet(path, params)`
// returning the data directly) — this shim bridges the two so the ported
// components don't need their internals rewritten, which would risk
// transcription bugs in logic (URL building, pagination, filters) that was
// already debugged upstream.
import { tmdbGet } from "./tmdb.js";

function splitUrl(url) {
  const [path, qs] = String(url).split("?");
  const params = Object.fromEntries(new URLSearchParams(qs || ""));
  return { path: path.replace(/^\/+/, ""), params };
}

export default {
  async get(url) {
    const { path, params } = splitUrl(url);
    const data = await tmdbGet(path, params);
    return { data };
  },
};
