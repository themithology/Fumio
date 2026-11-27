// Embed hosts are no longer a frozen APK list. Defaults cover the known
// vidstuck/zxcstream TLD move; the native shell scrapes theogpiratebot.to
// and writes window.__fumioLiveHosts so a site deploy can retarget hosts
// without a new APK.

const DEFAULTS = {
  vidstuck: "vidstuck.cc",
  zxcstream: "zxcstream.cc",
};

const currentMap = () => {
  const live = typeof window !== "undefined" ? window.__fumioLiveHosts : null;
  if (!live || typeof live !== "object") return { ...DEFAULTS };
  return { ...DEFAULTS, ...live };
};

export function applyLiveHost(url) {
  if (!url) return url;
  try {
    const parsed = new URL(url, "https://theogpiratebot.to");
    const host = (parsed.hostname || "").replace(/^www\./i, "").toLowerCase();
    if (!host) return url;
    const family = host.split(".")[0];
    const map = currentMap();
    const next = map[family];
    if (next && next !== host) {
      parsed.hostname = next;
      return parsed.toString();
    }
    if (host === "vidstuck.xyz") {
      parsed.hostname = map.vidstuck || DEFAULTS.vidstuck;
      return parsed.toString();
    }
    if (host === "zxcstream.xyz") {
      parsed.hostname = map.zxcstream || DEFAULTS.zxcstream;
      return parsed.toString();
    }
  } catch {
    /* keep the original URL */
  }
  return url;
}

export function subscribeLiveHosts(onChange) {
  if (typeof window === "undefined") return () => {};
  const handle = () => onChange();
  window.addEventListener("fumio-live-hosts", handle);
  return () => window.removeEventListener("fumio-live-hosts", handle);
}
