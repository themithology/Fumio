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
 * The remote is a mouse. That is the whole input model on a television now.
 *
 * Why cursor-only, and not a D-pad focus ring: the browse UI is the live
 * website, which we do not own and which changes whenever its owner changes it.
 * A focus engine can only move between things the page admits are focusable; the
 * moment a card is a plain <div>, or a control is a slider, or a menu opens on
 * hover, the ring has nowhere to go. A cursor has no such dependency — it is the
 * mouse the page was designed for — so it cannot be stranded by a deploy.
 *
 * WHAT MAKES IT GOOD ENOUGH TO REPLACE A D-PAD:
 *
 *   1. A target, always. Every move asks the page what is under the cursor
 *      (tv-cursor.js walks up to the nearest link/button/pointer-cursor
 *      ancestor) and outlines it. OK never clicks a random pixel hoping.
 *   2. Forgiveness. OK clicks the TARGET, not the coordinate — so aiming at a
 *      poster works even when the cursor is over its artwork, not its link.
 *   3. Speed. A held direction accelerates up to 4.6x, so crossing the screen is
 *      a second, and a single tap still moves a fine 20 dp.
 *   4. Scrolling. At an edge the cursor stops and the page scrolls, which is how
 *      anything below the fold is reached.
 *   5. Hover that works. Moves are sent to the page as mouse hover, so the site's
 *      own hover states and hover-only menus behave as they do on a desktop.
 *   6. Typing. Click a field and the keyboard opens; while it is open the remote
 *      belongs to the keyboard, not to us.
 *
 * Installed only when {@link TvMode#isTv} is true — a phone never sees any of it.
 */
final class TvPointer {

    private static final String TAG = "FumioTvPointer";

    /** A single tap of the D-pad, in dp. */
    private static final float STEP_DP = 20f;
    /** Extra speed per held-key repeat, capped, so holding glides. */
    private static final float ACCEL_PER_REPEAT = 0.9f;
    private static final float ACCEL_MAX = 3.6f;
    /** Don't spam the page with hover work on every pixel of a held key. */
    private static final long HOVER_MIN_MS = 60L;
    private static final float HOVER_MIN_DP = 3f;
    private static final long HINT_MS = 5000L;

    private static TvCursorView cursor;
    private static float windowX;
    private static float windowY;
    private static long hoveredAt;
    private static float hoveredX;
    private static float hoveredY;
    private static String scrollable = "{\"x\":false,\"y\":false}";

    private TvPointer() {}

    // ─── lifecycle ──────────────────────────────────────────────────────────

    static void install(Activity activity) {
        if (activity == null || !TvMode.isTv(activity)) return;
        ensureView(activity);
    }

    /** A new page: keep the mode, keep the aim if it is still on screen. */
    static void onPageFinished(Activity activity, WebView webView) {
        if (activity == null || webView == null || !TvMode.isTv(activity)) return;
        ensureView(activity);
        clampTo(webView);
        pushCursor();
        readScrollable(webView);
        hover(webView, true);
        if (cursor != null) cursor.setArrowVisible(true);
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
            cursor.setVisibility(View.VISIBLE);
            cursor.setArrowVisible(false);
        } catch (Exception error) {
            Log.w(TAG, "cursor overlay unavailable: " + error.getMessage());
            cursor = null;
        }
    }

    /** The cursor exists for the whole session; the viewer never has to "enter" it. */
    private static void ensureAimed(Activity activity, WebView webView) {
        ensureView(activity);
        if (windowX != 0 || windowY != 0) return;
        int[] loc = new int[2];
        webView.getLocationInWindow(loc);
        windowX = loc[0] + webView.getWidth() / 2f;
        windowY = loc[1] + webView.getHeight() / 2f;
        if (cursor != null) {
            cursor.bringToFront();
            cursor.setArrowVisible(true);
            cursor.showHint("Move with the arrows  ·  OK selects", HINT_MS);
        }
        pushCursor();
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

        // MENU is "what does this thing do?" — a ways to re-show the hint.
        if (code == KeyEvent.KEYCODE_MENU || code == KeyEvent.KEYCODE_INFO) {
            if (up) {
                ensureAimed(activity, webView);
                if (cursor != null) {
                    cursor.setArrowVisible(true);
                    cursor.showHint("Arrows move  ·  OK selects  ·  BACK goes back", HINT_MS);
                }
            }
            return true;
        }

        // BACK belongs to the app (close the player, go back a page). Never
        // swallowed here: a cursor with no exit is a trap.
        if (code == KeyEvent.KEYCODE_BACK) return false;

        boolean click =
            code == KeyEvent.KEYCODE_DPAD_CENTER || code == KeyEvent.KEYCODE_ENTER;
        int dx = 0;
        int dy = 0;
        if (code == KeyEvent.KEYCODE_DPAD_LEFT) dx = -1;
        else if (code == KeyEvent.KEYCODE_DPAD_RIGHT) dx = 1;
        else if (code == KeyEvent.KEYCODE_DPAD_UP) dy = -1;
        else if (code == KeyEvent.KEYCODE_DPAD_DOWN) dy = 1;
        else if (!click) return false; // not ours: let the page have it

        // While the keyboard is open the remote belongs to it.
        if (typing) return false;

        if (up) return true; // consume the release so the WebView never scrolls
        if (!down) return false;

        ensureAimed(activity, webView);

        if (click) {
            if (event.getRepeatCount() > 0) return true; // no machine-gun taps
            if (cursor != null) cursor.pulse();
            click(webView);
            return true;
        }

        move(activity, webView, dx, dy, event.getRepeatCount());
        return true;
    }

    // ─── movement ───────────────────────────────────────────────────────────

    private static void move(Activity activity, WebView webView, int dx, int dy, int repeat) {
        float density = activity.getResources().getDisplayMetrics().density;
        float speed = 1f + Math.min(ACCEL_MAX, repeat * ACCEL_PER_REPEAT);
        float step = STEP_DP * density * speed;

        int[] loc = new int[2];
        webView.getLocationInWindow(loc);
        float margin = 6f * density;
        float left = loc[0] + margin;
        float top = loc[1] + margin;
        float right = Math.max(left, loc[0] + webView.getWidth() - margin);
        float bottom = Math.max(top, loc[1] + webView.getHeight() - margin);

        float nextX = windowX + dx * step;
        float nextY = windowY + dy * step;

        boolean atBottom = nextY > bottom;
        boolean atTop = nextY < top;
        boolean atRight = nextX > right;
        boolean atLeft = nextX < left;

        windowX = Math.max(left, Math.min(right, nextX));
        windowY = Math.max(top, Math.min(bottom, nextY));

        if (cursor != null) cursor.setArrowVisible(true);
        pushCursor();

        // At an edge, the page moves instead: that is how the fold is crossed.
        if (atBottom || atTop || atLeft || atRight) {
            nudge(webView, atRight, atLeft, atBottom, atTop, speed);
        }
        hover(webView, false);
    }

    private static void nudge(
        WebView webView,
        boolean right,
        boolean left,
        boolean down,
        boolean up,
        float speed
    ) {
        int vx = Math.round((right ? 1 : left ? -1 : 0) * webView.getWidth() * 0.16f * speed);
        int vy = Math.round((down ? 1 : up ? -1 : 0) * webView.getHeight() * 0.16f * speed);
        String js =
            "(function(){try{window.scrollBy(" + vx + "," + vy + ");}catch(e){}})();";
        try {
            webView.evaluateJavascript(js, null);
        } catch (Exception ignored) {
            /* a page that will not scroll simply does not scroll */
        }
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
        if (cursor == null) return;
        cursor.bringToFront();
        cursor.moveToWindow(windowX, windowY);
    }

    // ─── page interaction ───────────────────────────────────────────────────

    /** Ask the page what is under the cursor, and outline it. Throttled. */
    private static void hover(WebView webView, boolean force) {
        int[] loc = new int[2];
        webView.getLocationInWindow(loc);
        float x = windowX - loc[0] + webView.getScrollX();
        float y = windowY - loc[1] + webView.getScrollY();
        long now = SystemClock.uptimeMillis();
        float density = webView.getResources().getDisplayMetrics().density;
        float moved = Math.abs(x - hoveredX) + Math.abs(y - hoveredY);

        // Real hover events (so the site's own :hover rules fire) but only when
        // the pointer has actually gone somewhere.
        if (force || (now - hoveredAt >= HOVER_MIN_MS && moved >= HOVER_MIN_DP * density)) {
            hoveredAt = now;
            hoveredX = x;
            hoveredY = y;
            try {
                MotionEvent event = MotionEvent.obtain(now, now, MotionEvent.ACTION_HOVER_MOVE, x, y, 0);
                event.setSource(InputDevice.SOURCE_MOUSE);
                webView.onHoverEvent(event);
                event.recycle();
            } catch (Exception ignored) {
                /* hover is a nicety */
            }
        }
        if (force || now - hoveredAt < 4) {
            try {
                webView.evaluateJavascript(
                    "window.FumioTvHover&&window.FumioTvHover(" + x + "," + y + ");",
                    null
                );
            } catch (Exception ignored) {
                /* the helper is optional */
            }
        }
    }

    /**
     * Click. The page's own target wins — that is the forgiveness described in
     * the class comment. A synthetic tap is the fallback, for anything that only
     * listens to pointer/touch events (a canvas, a custom video control).
     */
    private static void click(final WebView webView) {
        int[] loc = new int[2];
        webView.getLocationInWindow(loc);
        final float x = windowX - loc[0] + webView.getScrollX();
        final float y = windowY - loc[1] + webView.getScrollY();

        try {
            webView.evaluateJavascript(
                "window.FumioTvClick&&window.FumioTvClick();",
                clicked -> {
                    if (clicked != null && clicked.startsWith("true")) return;
                    tap(webView, x, y);
                }
            );
        } catch (Exception error) {
            tap(webView, x, y);
        }
    }

    /** A real tap: down, then up 70 ms later, so :active and pointer handlers run. */
    private static void tap(WebView webView, final float x, final float y) {
        long now = SystemClock.uptimeMillis();
        try {
            MotionEvent down = MotionEvent.obtain(now, now, MotionEvent.ACTION_DOWN, x, y, 0);
            down.setSource(InputDevice.SOURCE_TOUCHSCREEN);
            webView.dispatchTouchEvent(down);
            down.recycle();
            webView.postDelayed(
                () -> {
                    try {
                        MotionEvent up =
                            MotionEvent.obtain(now, SystemClock.uptimeMillis(), MotionEvent.ACTION_UP, x, y, 0);
                        up.setSource(InputDevice.SOURCE_TOUCHSCREEN);
                        webView.dispatchTouchEvent(up);
                        up.recycle();
                    } catch (Exception ignored) {
                        /* the view went away mid-tap */
                    }
                },
                70
            );
        } catch (Exception error) {
            Log.w(TAG, "tap failed: " + error.getMessage());
        }
    }

    private static void readScrollable(WebView webView) {
        try {
            webView.evaluateJavascript(
                "window.FumioTvScrollable&&window.FumioTvScrollable();",
                value -> {
                    if (value != null && value.startsWith("\"{")) {
                        scrollable = value.substring(1, value.length() - 1).replace("\\\"", "\"");
                    }
                }
            );
        } catch (Exception ignored) {
            /* diagnostics only */
        }
    }

    /** For the self-test overlay / logs. */
    static String state() {
        return "cursor=" + Math.round(windowX) + "," + Math.round(windowY) + " scrollable=" + scrollable;
    }
}
