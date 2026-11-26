package com.fumio.app;

import android.app.Activity;
import android.content.Context;
import android.os.Build;
import android.util.Log;
import android.view.View;
import android.view.WindowInsets;
import android.view.inputmethod.InputMethodManager;
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
    /** The focused typing surface: "none", "single", "search", "multiline", "picker". */
    private static volatile String inputState = "none";

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
        // A new document starts with NOTHING focused. Without this the app stayed
        // in "typing" from the previous page: the ring stayed hidden and every
        // letter went into a field that no longer existed — exactly what "after
        // pressing search, the mouse is gone" looked like.
        forgetInputFocus();
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
        forgetInputFocus();
        loadAssets(activity);
        evaluate(webView, cursorScript);
        TvPointer.onPageFinished(activity, webView);
    }

    // ─── keys ───────────────────────────────────────────────────────────────

    /**
     * The page says what kind of surface is focused.
     *
     * Three states matter and they are not interchangeable:
     *
     *   "single"/"search"/"multiline"  a text field: hide the ring, open the
     *                                  keyboard, and forward the remote's letters.
     *   "picker"                       a <select>: opened with OK and driven by
     *                                  the arrows, so the pointer stays.
     *   "none"                         nothing editable: the pointer comes back.
     *
     * A checkbox used to arrive here as "typing", which hid the cursor over a
     * control that needs no keyboard at all.
     */
    static void setInputState(String state) {
        String next = state == null ? "none" : state;
        if (next.equals(inputState)) return;
        inputState = next;
        boolean typing = isTyping();
        TvPointer.setTyping(typing);
    }

    static void setInputFocused(boolean typing) {
        setInputState(typing ? "single" : "none");
    }

    /**
     * The page changed under us: nothing is focused any more.
     *
     * Goes through the ordinary state transition, so the ring comes back by the
     * same path it would have if the viewer had left the field.
     */
    static void forgetInputFocus() {
        setInputState("none");
    }

    /** Is a keyboard supposed to be up right now? */
    static boolean isTyping() {
        String state = inputState;
        return "single".equals(state) || "search".equals(state) || "multiline".equals(state);
    }

    /** @return true when the TV layer handled the key and the WebView must not see it. */
    static boolean handleKey(Activity activity, WebView webView, android.view.KeyEvent event) {
        if (activity == null || webView == null || event == null) return false;
        if (!TvMode.isTv(activity)) return false;
        // Whatever surface is in front owns the pointer — browse page or the
        // player overlay. Without this the cursor kept aiming at the hidden
        // browse WebView while a video was playing.
        TvPointer.ensureTarget(webView);
        return TvPointer.handleKey(activity, webView, event, isTyping());
    }

    // ─── the keyboard ────────────────────────────────────────────────────────

    /**
     * ASK FOR THE SYSTEM KEYBOARD, and be honest about the answer.
     *
     * Many Android TV boxes ship no IME at all, so this can legitimately do
     * nothing there — which is exactly why {@link TvRemoteKeys} types for us
     * when the remote has letters (or the D-pad does not). Both paths are live
     * at once: the IME when the box has one, character forwarding when it does
     * not, and neither breaks the other.
     */
    static void showKeyboard(final Activity activity, final WebView webView) {
        if (activity == null || webView == null) return;
        try {
            webView.requestFocus();
            final InputMethodManager imm =
                (InputMethodManager) activity.getSystemService(Context.INPUT_METHOD_SERVICE);
            if (imm == null) return;
            // post(): the focus change from our own click has not been committed
            // yet, and showSoftInput on a view that is not focused is a no-op.
            webView.post(
                () -> {
                    try {
                        imm.showSoftInput(webView, InputMethodManager.SHOW_IMPLICIT);
                    } catch (Exception ignored) {
                        /* no IME on this box - forwarding covers it */
                    }
                }
            );
        } catch (Exception ignored) {
            /* the keyboard is a nicety, never a crash */
        }
    }

    static void hideKeyboard(Activity activity, WebView webView) {
        if (activity == null || webView == null) return;
        try {
            InputMethodManager imm =
                (InputMethodManager) activity.getSystemService(Context.INPUT_METHOD_SERVICE);
            if (imm != null) imm.hideSoftInputFromWindow(webView.getWindowToken(), 0);
        } catch (Exception ignored) {
            /* nothing to hide */
        }
    }

    /**
     * THE INSETS BUG THAT MAKES A SEARCH BOX UNUSABLE ON A TV.
     *
     * The app runs full screen with the system bars hidden, and the WebView is
     * laid out edge to edge (SystemBars.insetWebView sets fitsSystemWindows
     * false). A keyboard opening over that layout covers the bottom of the page
     * — which is where a focused search field usually is. So: while an IME is
     * up, give the WebView the IME inset as bottom padding, and take it back
     * when the keyboard closes. Nothing else in the layout moves.
     */
    static void watchKeyboardInsets(final Activity activity, final WebView webView) {
        if (activity == null || webView == null) return;
        final View view = webView;
        try {
            view.setOnApplyWindowInsetsListener(
                (v, insets) -> {
                    int ime = 0;
                    try {
                        if (Build.VERSION.SDK_INT >= 30) {
                            ime = insets.getInsets(WindowInsets.Type.ime()).bottom;
                        } else {
                            ime = insets.getSystemWindowInsetBottom();
                        }
                    } catch (Exception ignored) {
                        ime = 0;
                    }
                    // Only ever ADD space at the bottom, and only while typing:
                    // padding that appears for no reason would shift the whole
                    // page under the pointer.
                    int wanted = isTyping() ? ime : 0;
                    if (v.getPaddingBottom() != wanted) v.setPadding(0, 0, 0, wanted);
                    return insets;
                }
            );
            view.requestApplyInsets();
        } catch (Exception ignored) {
            /* insets are best-effort */
        }
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
