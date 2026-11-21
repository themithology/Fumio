package com.fumio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.app.UiModeManager;
import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * Runs on the TV emulator in CI, once per push.
 *
 * This is not a UI test — nothing here presses a button or reads a pixel, so it
 * cannot produce a flaky failure. It asserts the four facts that decide whether
 * the app behaves like a TV app at all, on a real Android TV system image:
 *
 *   1. the image really is a TV (otherwise every assertion below is worthless);
 *   2. {@code TvMode.isTv} says so — the single boolean the whole TV path
 *      hangs off, and the one that decides the ad wall is skipped;
 *   3. the manifest carries both launcher entries, so the tile appears on a TV
 *      home screen AND the app still installs on a phone;
 *   4. the app is installed with the version code the updater will compare.
 *
 * The pointer, hover and feel cannot be checked here: an emulator has no
 * remote, and a test that cannot feel the difference is a test that lies. Those
 * stay manual — see {@code docs/TESTING.md}.
 */
@RunWith(AndroidJUnit4.class)
public class TvBehaviourTest {

    private static Context context() {
        return InstrumentationRegistry.getInstrumentation().getTargetContext();
    }

    @Test
    public void theSystemImageIsActuallyATelevision() {
        UiModeManager ui = (UiModeManager) context().getSystemService(Context.UI_MODE_SERVICE);
        assertEquals(Configuration.UI_MODE_TYPE_TELEVISION, ui.getCurrentModeType());
    }

    @Test
    public void theAppRecognisesThisTelevision() {
        TvMode.forget();
        assertTrue("TvMode must say TV on a TV image", TvMode.isTv(context()));
    }

    @Test
    public void theManifestHasBothLaunchers() {
        // Asked of the system, not parsed out of the manifest: this is the same
        // question a TV home screen asks when it builds its app row.
        Intent leanback = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LEANBACK_LAUNCHER);
        Intent phone = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
        assertTrue(
            "a TV home screen needs a leanback launcher entry",
            !context().getPackageManager().queryIntentActivities(leanback, 0).isEmpty()
        );
        assertTrue(
            "the same APK must still appear on a phone",
            !context().getPackageManager().queryIntentActivities(phone, 0).isEmpty()
        );
    }

    @Test
    public void theApplicationHasABanner() throws Exception {
        int banner =
            context()
                .getPackageManager()
                .getApplicationInfo(context().getPackageName(), 0).banner;
        assertTrue("a TV launcher tile needs a banner", banner != 0);
    }

    @Test
    public void theVersionCodeIsStampedSoTheUpdaterCanCompare() throws Exception {
        int code =
            context()
                .getPackageManager()
                .getPackageInfo(context().getPackageName(), 0).versionCode;
        assertTrue("versionCode must be stamped by CI, was " + code, code > 0);
    }

    @Test
    public void theOfflineScreenIsPackaged() throws Exception {
        // The crash/HTTP-failure screen is an asset, and a missing asset is a
        // blank screen on a device with no network — the exact moment it
        // matters. CI also checks the APK contents, but this checks the app
        // can actually read it.
        String[] assets = context().getAssets().list("public");
        boolean found = false;
        for (String name : assets) {
            if (name != null && name.equals("offline.html")) found = true;
        }
        assertTrue("offline.html must be readable from the APK", found);
    }
}
