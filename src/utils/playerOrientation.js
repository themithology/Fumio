import { Capacitor } from "@capacitor/core";
import { ScreenOrientation } from "@capacitor/screen-orientation";

const isMobileViewport = () => {
  if (typeof window === "undefined") return false;
  return Capacitor.isNativePlatform() || window.matchMedia?.("(max-width: 767px)").matches;
};

/** Lock the player to landscape on phones, using the native Capacitor plugin
 * in the APK and the browser Screen Orientation API in supported browsers. */
export const lockPlayerLandscape = async () => {
  if (!isMobileViewport()) return false;
  try {
    await ScreenOrientation.lock({ orientation: "landscape" });
    return true;
  } catch {
    // Some browsers only allow orientation locks while fullscreen. The player
    // also renders a rotate-device guard when the lock is unavailable.
    return false;
  }
};

export const unlockPlayerOrientation = async () => {
  // Unlock unconditionally on teardown: after rotating landscape the viewport
  // may no longer match the mobile-width media query that triggered the lock.
  try {
    await ScreenOrientation.unlock();
    return true;
  } catch {
    return false;
  }
};
