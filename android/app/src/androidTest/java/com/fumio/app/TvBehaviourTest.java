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

    /**
     * THE KEYBOARD QUESTION, ON A REAL TV IMAGE.
     *
     * A search box is useless if nothing can type into it. Two independent
     * halves, because a TV may have neither, either, or both:
     *
     *   - an IME service exists and asking for the keyboard cannot crash when
     *     the box has no keyboard installed;
     *   - a letter key produces the right TEXT — the path that works with no IME,
     *     which is the normal case on a television.
     *
     * The key mapping is exercised through {@code charactersFor}, which touches
     * no WebView: a WebView may only be used from the UI thread, and an
     * instrumented test method does not run on it. That is exactly why the
     * mapping was split out of {@code handle()}.
     */
    @Test
    public void aRemoteLetterBecomesText() {
        android.view.KeyEvent letter =
            new android.view.KeyEvent(android.view.KeyEvent.ACTION_DOWN, android.view.KeyEvent.KEYCODE_A);
        assertEquals("a", TvRemoteKeys.charactersFor(letter));

        android.view.KeyEvent upper =
            new android.view.KeyEvent(
                0,
                0,
                android.view.KeyEvent.ACTION_DOWN,
                android.view.KeyEvent.KEYCODE_B,
                android.view.KeyEvent.META_SHIFT_ON
            );
        assertEquals("B", TvRemoteKeys.charactersFor(upper));

        android.view.KeyEvent digit =
            new android.view.KeyEvent(android.view.KeyEvent.ACTION_DOWN, android.view.KeyEvent.KEYCODE_7);
        assertEquals("7", TvRemoteKeys.charactersFor(digit));

        android.view.KeyEvent space =
            new android.view.KeyEvent(android.view.KeyEvent.ACTION_DOWN, android.view.KeyEvent.KEYCODE_SPACE);
        assertEquals(" ", TvRemoteKeys.charactersFor(space));

        // Keys that must never become text: they belong to the page or the box.
        android.view.KeyEvent volume =
            new android.view.KeyEvent(android.view.KeyEvent.ACTION_DOWN, android.view.KeyEvent.KEYCODE_VOLUME_UP);
        assertEquals(null, TvRemoteKeys.charactersFor(volume));
        android.view.KeyEvent left =
            new android.view.KeyEvent(android.view.KeyEvent.ACTION_DOWN, android.view.KeyEvent.KEYCODE_DPAD_LEFT);
        assertEquals(null, TvRemoteKeys.charactersFor(left));
    }

    @Test
    public void thereIsAnInputMethodServiceToAsk() {
        // Asserted, not assumed: if this is null the IME half of the feature has
        // nothing to call. Whether a keyboard is actually INSTALLED is
        // deliberately not asserted — on a TV it often is not.
        assertTrue(
            context().getSystemService(Context.INPUT_METHOD_SERVICE) != null
        );
    }

    @Test
    public void onlyTextFieldsCountAsTyping() {
        // The bug this replaced: tagName === "INPUT" is true for a checkbox, so
        // ticking one hid the pointer and handed the remote to a keyboard.
        TvUi.setInputState("none");
        assertTrue("nothing focused is not typing", !TvUi.isTyping());
        TvUi.setInputState("single");
        assertTrue("a text field is typing", TvUi.isTyping());
        TvUi.setInputState("search");
        assertTrue("a search box is typing", TvUi.isTyping());
        TvUi.setInputState("picker");
        assertTrue("a select keeps the pointer", !TvUi.isTyping());
        TvUi.setInputState("none");
        assertTrue("and it recovers", !TvUi.isTyping());
    }

    @Test
    public void theOfflineScreenIsPackaged() throws Exception {
        // The crash/HTTP-failure screen is an asset, and a missing asset is a
        // blank screen on a device with no network — the exact moment it
        // matters. CI also checks the APK contents, but this checks the app
        // can actually read it.
        // The file lives at the ROOT of assets/, not under public/ - the web
        // build is copied in as public/, but offline.html is placed beside it
        // by the sync job. Listing the root is the honest check.
        String[] assets = context().getAssets().list("");
        boolean found = false;
        for (String name : assets) {
            if (name != null && name.equals("offline.html")) found = true;
        }
        assertTrue(
            "offline.html must be readable from the APK root; found " + java.util.Arrays.toString(assets),
            found
        );
    }
}
