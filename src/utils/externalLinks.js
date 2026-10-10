export const DISCORD_INVITE_URL = "https://discord.gg/t6tjszp5eb";
export const SITE_ORIGIN = "https://theogpiratebot.online";
export const NATIVE_AUTH_SCHEME = "com.fumio.app://auth";

export const isNativeApp = () =>
  typeof window !== "undefined" && Boolean(window.Capacitor?.isNativePlatform?.());

/**
 * Google must start in the same browser that later loads Firebase's
 * `/__/auth/handler`. Opening the handler as a standalone URL is what
 * produced "missing initial state" (no sessionStorage from the SDK).
 *
 * Native: a loopback page inside the APK, opened in the default browser.
 * Fallback: the same HTML on the website once it is deployed.
 */
export const nativeGoogleAuthUrl = () => {
  try {
    const local = window.FumioNative?.startGoogleAuth?.();
    if (typeof local === "string" && /^https?:\/\//i.test(local)) return local;
  } catch {
    // Use the hosted copy.
  }
  return `${SITE_ORIGIN}/fumio-google.html?redirect=${encodeURIComponent(NATIVE_AUTH_SCHEME)}`;
};

export const openSystemBrowser = (url) => {
  if (!url) return false;
  try {
    if (window.FumioNative?.openBrowser) {
      window.FumioNative.openBrowser(url);
      return true;
    }
  } catch {
    // Fall through to window.open / location.
  }
  try {
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (opened) return true;
  } catch {
    // Continue.
  }
  try {
    window.location.assign(url);
    return true;
  } catch {
    return false;
  }
};
