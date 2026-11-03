package com.fumio.app;

import android.app.Activity;
import android.util.Log;
import android.view.KeyEvent;
import android.webkit.WebView;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;

/**
 * The television layer: D-pad in, 10-foot scale, and nothing else.
 *
 * It is a thin native shim around two shipped assets, {@code tv-nav.js} (the
 * spatial focus engine) and {@code tv.css} (the focus ring), because the part
 * that has to survive website changes is the geometry, and the part that has to
 * be cheap is the key path:
 *
 *   remote key → {@link #handleKey} → one evaluateJavascript("FumioTvKey(…)")
 *              → tv-nav.js moves focus and scrolls what needs scrolling.
 *
 * The key is CONSUMED natively. WebView's own arrow-key behaviour (scroll the
 * page, move its internal caret) would fight the engine and, worse, gives the
 * viewer no idea what is selected — a TV interface without a visible focus is
 * unusable.
 *
 * Only ever active when {@link TvMode#isTv} is true. On a phone every method
 * here returns immediately, which is what keeps the shipped phone app identical.
 */
final class TvUi {

    private static final String TAG = "FumioTv";

    /** The layout width a TV is normalised to, in CSS pixels (1080p = 1 px/pt). */
    private static final int DESIGN_WIDTH = 1920;
    /** Text bump for a 3 m viewing distance (110–120 is the usable band). */
    private static final int TEXT_ZOOM = 115;

    private static String navScript = "";
    private static String navCss = "";
    private static String viewportScript = "";
    private static volatile boolean inputFocused;

    private TvUi() {}

    // ─── install ─────────────────────────────────────────────────────────────

    static void install(Activity activity, WebView webView) {
        if (activity == null || webView == null) return;
        if (!TvMode.isTv(activity)) return;
        loadAssets(activity);
        apply(webView);
        TvPointer.install(activity);
    }

    private static void loadAssets(Activity activity) {
        if (navScript.isEmpty()) navScript = asset(activity, "tv-nav.js");
        if (navCss.isEmpty()) navCss = asset(activity, "tv.css");
        if (viewportScript.isEmpty()) {
            viewportScript = asset(activity, "tv-viewport.js")
                .replace("__FUMIO_TV_WIDTH__", String.valueOf(DESIGN_WIDTH));
        }
    }

    /** Scaling only — safe to call more than once (rotation, reattach). */
    static void apply(WebView webView) {
        if (webView == null) return;
        try {
            webView.getSettings().setTextZoom(TEXT_ZOOM);
            webView.getSettings().setBuiltInZoomControls(false);
            webView.getSettings().setDisplayZoomControls(false);
            webView.getSettings().setSupportZoom(false);
            webView.setFocusable(true);
            webView.setFocusableInTouchMode(true);
        } catch (Exception ignored) {
            // A settings quirk is never worth a crash.
        }
    }

    /**
     * Called from every {@code onPageFinished} — the browse site and the app's
     * own player page. Idempotent; the engine guards against a second copy of
     * itself.
     */
    static void onPageFinished(Activity activity, WebView webView) {
        if (activity == null || webView == null) return;
        if (!TvMode.isTv(activity)) return;
        loadAssets(activity);

        // 1. Normalise the layout width. The site ships
        //    <meta name="viewport" content="width=device-width">, so on a TV
        //    that reports density 2 (Shield, some Sony panels) it would lay out
        //    at 960 CSS px and pick its TABLET design for a 55-inch screen.
        //    Rewriting the viewport meta is the one supported way to say "you
        //    are 1920 px wide" without touching the site: Blink re-computes the
        //    layout viewport when the meta's content changes.
        evaluate(webView, viewportScript);

        // 2. Focus ring + no smooth-scroll fights.
        evaluate(
            webView,
            "(function(){if(document.documentElement.classList.contains('fumio-tv'))return;" +
            "document.documentElement.classList.add('fumio-tv');" +
            "var s=document.createElement('style');s.id='fumio-tv-css';" +
            "s.textContent=" + quote(navCss) + ";" +
            "(document.head||document.documentElement).appendChild(s);})();"
        );

        // 3. The engine.
        evaluate(webView, navScript);

        // 4. And the other half of the hybrid: if the viewer is aiming with the
        //    pointer, the new page must know where that pointer is.
        TvPointer.onPageFinished(activity, webView);
    }

    /** NAV hit a wall — say "MENU gives you a pointer", once. */
    static void suggestPointer(Activity activity) {
        if (activity == null || !TvMode.isTv(activity)) return;
        TvPointer.suggest(activity);
    }

    // ─── keys ───────────────────────────────────────────────────────────────

    static void setInputFocused(boolean typing) {
        inputFocused = typing;
    }

    /**
     * @return true when the layer handled the key and the WebView must not see
     *         it.
     */
    static boolean handleKey(Activity activity, WebView webView, KeyEvent event) {
        if (activity == null || webView == null || event == null) return false;
        if (!TvMode.isTv(activity)) return false;

        int code = event.getKeyCode();
        boolean down = event.getAction() == KeyEvent.ACTION_DOWN;
        boolean up = event.getAction() == KeyEvent.ACTION_UP;

        // Diagnostics live on the Info/Help button: remotes that have one can
        // print the focus engine's report to logcat without a dev build.
        if (code == KeyEvent.KEYCODE_INFO || code == KeyEvent.KEYCODE_HELP) {
            if (down) {
                evaluate(
                    webView,
                    "window.FumioTvSelfTest&&console.log('FumioTvSelfTest '+window.FumioTvSelfTest());"
                );
            }
            return true;
        }

        // THE HYBRID. Pointer mode owns D-pad/OK/BACK/MENU while it is on; when
        // it is off this call only watches for MENU, so NAV below is untouched.
        if (TvPointer.handleKey(activity, webView, event, inputFocused)) return true;

        // Typing in a field: the TV's keyboard owns the remote.
        if (inputFocused) return false;

        String name = keyName(code);
        if (name == null) return false;

        // Consume both edges: the DPAD down we act on, the up so the WebView
        // never sees a half-press and scrolls.
        if (up) return true;
        if (!down) return false;
        if (event.getRepeatCount() > 0) return true; // a held button must not spam

        try {
            webView.requestFocus();
        } catch (Exception ignored) {
            /* nothing to focus */
        }

        evaluate(webView, "window.FumioTvKey&&window.FumioTvKey(" + quote(name) + ");");
        return true;
    }

    private static String keyName(int keyCode) {
        switch (keyCode) {
            case KeyEvent.KEYCODE_DPAD_UP:
                return "up";
            case KeyEvent.KEYCODE_DPAD_DOWN:
                return "down";
            case KeyEvent.KEYCODE_DPAD_LEFT:
                return "left";
            case KeyEvent.KEYCODE_DPAD_RIGHT:
                return "right";
            case KeyEvent.KEYCODE_DPAD_CENTER:
            case KeyEvent.KEYCODE_ENTER:
            case KeyEvent.KEYCODE_NUMPAD_ENTER:
                return "enter";
            default:
                return null;
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

    private static String quote(String raw) {
        if (raw == null) return "''";
        StringBuilder sb = new StringBuilder(raw.length() + 16);
        sb.append('\'');
        for (int i = 0; i < raw.length(); i += 1) {
            char c = raw.charAt(i);
            if (c == '\\' || c == '\'') sb.append('\\').append(c);
            else if (c == '\n') sb.append("\\n");
            else if (c == '\r') sb.append("\\r");
            else if (c == '\u2028' || c == '\u2029') sb.append(' ');
            else sb.append(c);
        }
        sb.append('\'');
        return sb.toString();
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
