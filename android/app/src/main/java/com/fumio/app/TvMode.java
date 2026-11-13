package com.fumio.app;

import android.app.UiModeManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.content.res.Configuration;

/**
 * "Am I on a television?" — asked in exactly one place.
 *
 * The app is a single APK installed by a single sideload, so the TV build is
 * not a different product: it is the same app that noticed it is on a 10-foot
 * screen. Everything TV-only (no verify wall, the D-pad layer, the big-screen
 * scale) hangs off this one boolean, which is what keeps the phone path
 * untouched — if {@link #isTv(Context)} is false, not one line of TV code runs.
 *
 * A TV is recognised by any of:
 *   - the system UI mode is TELEVISION (true on Android TV / Google TV),
 *   - the device declares leanback support (launcher + remote, Amazon Fire TV),
 *   - the device declares FEATURE_TELEVISION,
 *   - or the legacy "android.hardware.type.television" feature.
 *
 * Some TV boxes also report touch support, so touch is never used as the test.
 */
final class TvMode {

    private static Boolean cached;

    private TvMode() {}

    static boolean isTv(Context context) {
        if (context == null) return false;
        if (cached != null) return cached;
        boolean tv = false;
        try {
            UiModeManager ui = (UiModeManager) context.getSystemService(Context.UI_MODE_SERVICE);
            if (ui != null && ui.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION) {
                tv = true;
            }
            if (!tv) {
                PackageManager pm = context.getPackageManager();
                tv =
                    pm.hasSystemFeature(PackageManager.FEATURE_LEANBACK) ||
                    pm.hasSystemFeature(PackageManager.FEATURE_TELEVISION) ||
                    pm.hasSystemFeature("android.hardware.type.television");
            }
        } catch (Exception ignored) {
            // A vendor that throws here is a phone as far as we can tell.
            tv = false;
        }
        cached = tv;
        return tv;
    }

    /** Called when the configuration changes (TV in a phone-sized window, etc.). */
    static void forget() {
        cached = null;
    }
}
