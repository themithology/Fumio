export const DISCORD_INVITE_URL = "https://discord.gg/t6tjszp5eb";
export const SITE_ORIGIN = "https://theogpiratebot.online";
export const NATIVE_AUTH_SCHEME = "com.fumio.app://auth";

export const isNativeApp = () =>
  typeof window !== "undefined" && Boolean(window.Capacitor?.isNativePlatform?.());

export const nativeGoogleAuthUrl = () =>
  `${SITE_ORIGIN}/account?fumioNative=1&redirect=${encodeURIComponent(NATIVE_AUTH_SCHEME)}`;

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
