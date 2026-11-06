package com.fumio.app;

import android.app.Activity;
import android.util.Log;
import android.webkit.WebView;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;

/**
 * The television layer, split in two by OWNERSHIP.
 *
 *   OUR PAGES (the bundled player, https://localhost/…): touch nothing. Our
 *   React player is already responsive and the TV is just a big landscape
 *   screen; forcing a 1920-wide layout viewport into it is what cut the player
 *   in half on 2026-11-05. The only thing injected is the pointer helper
 *   (tv-cursor.js), which adds no layout of its own.
 *
 *   THE LIVE WEBSITE (theogpiratebot.online): it does not know it is on a TV,
 *   so it is told. tv-viewport.js normalises the layout width to 1920 CSS px
 *   and reverts itself if that ever overflows, and textZoom lifts body text for
 *   a 3 m viewing distance.
 *
 * The input model lives in {@link TvPointer}: a cursor for everything, always on.
 */
final class TvUi {

    private static final String TAG = "FumioTv";

    /** The layout width the live site is normalised to, in CSS px. */
    private static final int DESIGN_WIDTH = 1920;
    /** Text lift for a 3 m viewing distance (110–120 is the usable band). */
    private static final int TEXT_ZOOM = 115;

    private static String cursorScript = "";
    private static String viewportScript = "";
    private static volatile boolean inputFocused;

    private TvUi() {}

    // ─── install ─────────────────────────────────────────────────────────────

    static void install(Activity activity, WebView webView) {
        if (activity == null || webView == null) return;
        if (!TvMode.isTv(activity)) return;
        loadAssets(activity);
        TvPointer.install(activity);
        // Point the pointer at the browse WebView straight away: if the viewer
        // presses a key before the first page finishes, hover/click must not go
        // to a WebView from a previous activity instance.
        TvPointer.retarget(webView);
        applyPageScale(webView);
    }

    private static void loadAssets(Activity activity) {
        if (cursorScript.isEmpty()) cursorScript = asset(activity, "tv-cursor.js");
        if (viewportScript.isEmpty()) {
            viewportScript = asset(activity, "tv-viewport.js")
                .replace("__FUMIO_TV_WIDTH__", String.valueOf(DESIGN_WIDTH));
        }
    }

    /** Live-site scaling. Never called for our own pages. */
    static void applyPageScale(WebView webView) {
        if (webView == null) return;
        try {
            webView.getSettings().setTextZoom(TEXT_ZOOM);
            webView.getSettings().setBuiltInZoomControls(false);
            webView.getSettings().setDisplayZoomControls(false);
            webView.getSettings().setSupportZoom(false);
        } catch (Exception ignored) {
            // A settings quirk is never worth a crash.
        }
    }

    /**
     * The live website finished loading: normalise its viewport and give it the
     * pointer helper.
     */
    static void onLivePageFinished(Activity activity, WebView webView) {
        if (activity == null || webView == null) return;
        if (!TvMode.isTv(activity)) return;
        loadAssets(activity);
        evaluate(webView, viewportScript);
        evaluate(webView, cursorScript);
        TvPointer.onPageFinished(activity, webView);
    }

    /**
     * One of OUR pages finished loading (the player): pointer helper only.
     * No viewport rewrite, no text zoom — see the class comment.
     */
    static void onOwnPageFinished(Activity activity, WebView webView) {
        if (activity == null || webView == null) return;
        if (!TvMode.isTv(activity)) return;
        loadAssets(activity);
        evaluate(webView, cursorScript);
        TvPointer.onPageFinished(activity, webView);
    }

    // ─── keys ───────────────────────────────────────────────────────────────

    static void setInputFocused(boolean typing) {
        inputFocused = typing;
    }

    /** @return true when the TV layer handled the key and the WebView must not see it. */
    static boolean handleKey(Activity activity, WebView webView, android.view.KeyEvent event) {
        if (activity == null || webView == null || event == null) return false;
        if (!TvMode.isTv(activity)) return false;
        // Whatever surface is in front owns the pointer — browse page or the
        // player overlay. Without this the cursor kept aiming at the hidden
        // browse WebView while a video was playing.
        TvPointer.ensureTarget(webView);
        return TvPointer.handleKey(activity, webView, event, inputFocused);
    }

    // ─── plumbing ───────────────────────────────────────────────────────────

    private static void evaluate(WebView webView, String js) {
        if (js == null || js.isEmpty()) return;
        try {
            webView.evaluateJavascript(js, null);
        } catch (Exception error) {
            Log.w(TAG, "evaluate failed: " + error.getMessage());
        }
    }

    static String asset(Activity activity, String name) {
        try (InputStream in = activity.getAssets().open(name)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[16 * 1024];
            int read;
            while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
            return out.toString("UTF-8");
        } catch (Exception error) {
            Log.w(TAG, "asset " + name + " missing: " + error.getMessage());
            return "";
        }
    }
}
