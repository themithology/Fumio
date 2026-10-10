export const DISCORD_INVITE_URL = "https://discord.gg/t6tjszp5eb";
export const SITE_ORIGIN = "https://theogpiratebot.online";
export const NATIVE_AUTH_SCHEME = "com.fumio.app://auth";
export const FIREBASE_AUTH_HANDLER =
  "https://ogpb-331d5.firebaseapp.com/__/auth/handler";
export const FIREBASE_WEB_API_KEY = "AIzaSyDapNgnKdO8l_t7BJPCO8IsbL73aILA1cI";

export const isNativeApp = () =>
  typeof window !== "undefined" && Boolean(window.Capacitor?.isNativePlatform?.());

/** Same helper URL the website popup opens for one-tap Google. */
export const nativeGoogleAuthUrl = () => {
  const params = new URLSearchParams({
    apiKey: FIREBASE_WEB_API_KEY,
    appName: "[DEFAULT]",
    authType: "signInViaPopup",
    redirectUrl: `${SITE_ORIGIN}/account`,
    v: "12.18.0",
    providerId: "google.com",
    scopes: "profile",
  });
  return `${FIREBASE_AUTH_HANDLER}?${params.toString()}`;
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
