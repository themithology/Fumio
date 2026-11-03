package com.fumio.app;

import android.app.Activity;
import android.os.SystemClock;
import android.util.Log;
import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;

/**
 * The hybrid remote: two ways to move, one remote.
 *
 *   NAV (default) — the D-pad. {@link TvUi} runs the spatial engine in
 *                   assets/tv-nav.js: cards and buttons get a focus ring and the
 *                   remote steps between them. This is what a TV should feel
 *                   like, and it is what the site's own controls get for free.
 *
 *   POINTER       — the cartoony cursor ({@link TvCursorView}). Pressed MENU (or
 *                   automatically suggested when NAV finds nothing), the D-pad
 *                   now moves a drawn cursor and OK clicks it. Clicks are
 *                   synthesised into the WebView as touch events and moves as
 *                   mouse-hover events, so every single thing a website can
 *                   respond to — a card that is only a div, a hover menu, a
 *                   drag handle, a slider — works again.
 *
 * WHY BOTH. NAV is the good television experience but it depends on the page
 * telling us what is focusable, and we do not control the page: it changes with
 * every website deploy. POINTER has no such dependency — a cursor at a pixel is
 * the mouse the page was designed for. So the rule is: NAV when the page
 * cooperates, POINTER the moment it does not. Nothing is ever unreachable, and
 * no website update can strand a viewer.
 *
 * Only installed when {@link TvMode#isTv} — a phone never sees any of this.
 */
final class TvPointer {

    private static final String TAG = "FumioTvPointer";

    /** Distance from an edge at which the page starts scrolling instead. */
    private static final float EDGE_DP = 10f;
    /** One press of the D-pad key repeat beyond this stops accelerating. */
    private static final int MAX_ACCEL_STEPS = 4;
    private static final long HINT_MS = 4200L;

    private static boolean active;
    private static TvCursorView cursor;
    private static float windowX;
    private static float windowY;
    private static boolean hinted;

    private TvPointer() {}

    static boolean isActive() {
        return active;
    }

    // ─── lifecycle ──────────────────────────────────────────────────────────

    static void install(Activity activity) {
        if (activity == null || !TvMode.isTv(activity)) return;
        ensureView(activity);
    }

    /** A fresh page: keep the mode, recentre the aim if the page shrank. */
    static void onPageFinished(Activity activity, WebView webView) {
        if (activity == null || webView == null || !TvMode.isTv(activity)) return;
        ensureView(activity);
        if (!active) return;
        clampTo(webView);
        pushCursor();
        hover(webView);
    }

    private static void ensureView(Activity activity) {
        try {
            if (cursor != null && cursor.getParent() != null) return;
            ViewGroup root = activity.findViewById(android.R.id.content);
            if (root == null) return;
            cursor = new TvCursorView(activity);
            root.addView(
                cursor,
                new ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
                )
            );
            cursor.setArrowVisible(false);
            cursor.setVisibility(View.GONE);
        } catch (Exception error) {
            Log.w(TAG, "cursor overlay unavailable: " + error.getMessage());
            cursor = null;
        }
    }

    // ─── keys ───────────────────────────────────────────────────────────────

    /**
     * @return true when this layer took the key.
     */
    static boolean handleKey(Activity activity, WebView webView, KeyEvent event, boolean typing) {
        if (activity == null || webView == null || event == null) return false;
        if (!TvMode.isTv(activity)) return false;

        int code = event.getKeyCode();
        boolean down = event.getAction() == KeyEvent.ACTION_DOWN;
        boolean up = event.getAction() == KeyEvent.ACTION_UP;

        // MENU toggles the mode, in either direction. It is the one spare button
        // every Android TV remote has.
        if (code == KeyEvent.KEYCODE_MENU) {
            if (up) toggle(activity, webView, !active);
            return true;
        }

        if (!active) return false;

        // BACK leaves pointer mode before it leaves the page: a viewer who wants
        // the D-pad back should not be thrown out of what they were watching.
        if (code == KeyEvent.KEYCODE_BACK) {
            if (up) toggle(activity, webView, false);
            return true;
        }

        boolean click =
            code == KeyEvent.KEYCODE_DPAD_CENTER ||
            code == KeyEvent.KEYCODE_ENTER ||
            code == KeyEvent.KEYCODE_NUMPAD_ENTER;

        int dx = 0;
        int dy = 0;
        if (code == KeyEvent.KEYCODE_DPAD_LEFT) dx = -1;
        else if (code == KeyEvent.KEYCODE_DPAD_RIGHT) dx = 1;
        else if (code == KeyEvent.KEYCODE_DPAD_UP) dy = -1;
        else if (code == KeyEvent.KEYCODE_DPAD_DOWN) dy = 1;
        else if (!click) return false; // not ours: let the page have it

        // While a text field has focus the remote belongs to the TV's keyboard.
        if (typing) return false;

        if (up) return true;
        if (click) {
            if (event.getRepeatCount() > 0) return true;
            ensureView(activity);
            if (cursor != null) cursor.pulse();
            click(webView);
            return true;
        }

        move(activity, webView, dx, dy, event.getRepeatCount());
        return true;
    }

    private static void toggle(Activity activity, WebView webView, boolean on) {
        ensureView(activity);
        active = on;
        if (cursor != null) {
            if (on) {
                // Start where the eye already is: the middle of the picture.
                int[] loc = new int[2];
                webView.getLocationInWindow(loc);
                windowX = loc[0] + webView.getWidth() / 2f;
                windowY = loc[1] + webView.getHeight() / 2f;
                cursor.bringToFront();
                cursor.setVisibility(View.VISIBLE);
                cursor.moveToWindow(windowX, windowY);
                cursor.setArrowVisible(true);
                cursor.showHint("OK clicks  ·  MENU or BACK returns to D-pad", HINT_MS);
            } else {
                cursor.setArrowVisible(false);
                cursor.setVisibility(View.GONE);
                // Hand the "you are here" back to the focus engine, so a viewer
                // leaving pointer mode still has a ring on something.
                try {
                    webView.evaluateJavascript("window.FumioTvKey&&window.FumioTvKey('first');", null);
                } catch (Exception ignored) {
                    /* the engine is optional */
                }
            }
        }
        if (on) hover(webView);
    }

    /**
     * NAV found nothing in that direction twice in a row — the page has
     * something a D-pad cannot reach. Say so once, don't take the remote away.
     */
    static void suggest(Activity activity) {
        if (activity == null || !TvMode.isTv(activity) || active) return;
        if (hinted) return;
        hinted = true;
        ensureView(activity);
        if (cursor == null) return;
        try {
            cursor.setVisibility(View.VISIBLE);
            cursor.bringToFront();
            cursor.showHint("Press MENU to use the pointer", HINT_MS);
        } catch (Exception ignored) {
            // A hint is never worth a crash.
        }
    }

    // ─── movement ───────────────────────────────────────────────────────────

    private static void move(Activity activity, WebView webView, int dx, int dy, int repeat) {
        float density = activity.getResources().getDisplayMetrics().density;
        float step = TvCursorView.STEP_DP * density;
        // A held button accelerates: one card is a tap, crossing the screen
        // should not take forty presses.
        step *= 1f + Math.min(repeat, MAX_ACCEL_STEPS) * 0.45f;

        int[] loc = new int[2];
        webView.getLocationInWindow(loc);
        float margin = EDGE_DP * density;
        float left = loc[0] + margin;
        float top = loc[1] + margin;
        float right = loc[0] + webView.getWidth() - margin;
        float bottom = loc[1] + webView.getHeight() - margin;

        float nextX = windowX + dx * step;
        float nextY = windowY + dy * step;

        // At an edge the page scrolls instead of the cursor stopping dead —
        // this is how the pointer reaches anything below the fold.
        boolean hitBottom = nextY > bottom;
        boolean hitTop = nextY < top;
        boolean hitRight = nextX > right;
        boolean hitLeft = nextX < left;

        windowX = Math.max(left, Math.min(right, nextX));
        windowY = Math.max(top, Math.min(bottom, nextY));

        if (hitBottom || hitTop || hitLeft || hitRight) {
            int amount = Math.round((hitBottom || hitTop ? webView.getHeight() : webView.getWidth()) * 0.14f);
            String js =
                "(function(){try{window.scrollBy(" +
                (hitRight ? amount : hitLeft ? -amount : 0) +
                "," +
                (hitBottom ? amount : hitTop ? -amount : 0) +
                ");}catch(e){}})();";
            try {
                webView.evaluateJavascript(js, null);
            } catch (Exception ignored) {
                /* a page that refuses to scroll simply does not scroll */
            }
        }

        pushCursor();
        hover(webView);
    }

    private static void clampTo(WebView webView) {
        int[] loc = new int[2];
        webView.getLocationInWindow(loc);
        float cx = loc[0] + webView.getWidth() / 2f;
        float cy = loc[1] + webView.getHeight() / 2f;
        if (windowX < loc[0] || windowX > loc[0] + webView.getWidth()) windowX = cx;
        if (windowY < loc[1] || windowY > loc[1] + webView.getHeight()) windowY = cy;
        pushCursor();
    }

    private static void pushCursor() {
        if (cursor != null) cursor.moveToWindow(windowX, windowY);
    }

    // ─── synthesised input ──────────────────────────────────────────────────

    /** A real tap: down, then up 60 ms later, so :active and pointer handlers see it. */
    private static void click(WebView webView) {
        int[] loc = new int[2];
        webView.getLocationInWindow(loc);
        final float x = windowX - loc[0] + webView.getScrollX();
        final float y = windowY - loc[1] + webView.getScrollY();
        long now = SystemClock.uptimeMillis();
        try {
            MotionEvent down = MotionEvent.obtain(now, now, MotionEvent.ACTION_DOWN, x, y, 0);
            down.setSource(InputDevice.SOURCE_TOUCHSCREEN);
            webView.dispatchTouchEvent(down);
            down.recycle();
            webView.postDelayed(
                () -> {
                    try {
                        MotionEvent up = MotionEvent.obtain(
                            now,
                            SystemClock.uptimeMillis(),
                            MotionEvent.ACTION_UP,
                            x,
                            y,
                            0
                        );
                        up.setSource(InputDevice.SOURCE_TOUCHSCREEN);
                        webView.dispatchTouchEvent(up);
                        up.recycle();
                    } catch (Exception ignored) {
                        /* the view went away mid-tap */
                    }
                },
                60
            );
        } catch (Exception error) {
            Log.w(TAG, "click failed: " + error.getMessage());
        }
    }

    /** Move the page's hover state with the cursor, so cards light up as it passes. */
    private static void hover(WebView webView) {
        int[] loc = new int[2];
        webView.getLocationInWindow(loc);
        float x = windowX - loc[0] + webView.getScrollX();
        float y = windowY - loc[1] + webView.getScrollY();
        long now = SystemClock.uptimeMillis();
        try {
            MotionEvent event = MotionEvent.obtain(now, now, MotionEvent.ACTION_HOVER_MOVE, x, y, 0);
            event.setSource(InputDevice.SOURCE_MOUSE);
            webView.onHoverEvent(event);
            event.recycle();
        } catch (Exception ignored) {
            /* hover is a nicety */
        }
    }
}
