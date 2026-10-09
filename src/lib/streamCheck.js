import { PROXY_BASES } from "./proxyTiers.js";

// Ask the data-proxy worker whether a candidate stream URL is actually up.
// Fails OPEN on anything inconclusive (network hiccup, a proxy tier that
// doesn't recognize the host, every tier down) — a probe glitch must never
// block real playback. Only a definitive non-2xx status from the real host
// counts as "dead".
export async function checkStreamAlive(url) {
  for (const base of PROXY_BASES) {
    try {
      const res = await fetch(`${base}/api/stream-check?url=${encodeURIComponent(url)}`, {
        signal: AbortSignal.timeout(7000),
      });
      if (!res.ok) continue; // this proxy tier itself errored — try the next
      const data = await res.json();
      if (typeof data.status === "number" && data.ok === false) return false; // real dead
      return true; // ok, or unknown/inconclusive — fail open
    } catch {
      continue;
    }
  }
  return true; // every tier failed to even answer — fail open
}
