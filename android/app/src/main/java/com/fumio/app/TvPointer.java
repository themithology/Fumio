package com.fumio.app;

import android.app.Activity;
import android.os.SystemClock;
import android.util.Log;
import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.widget.FrameLayout;
import android.widget.TextView;

import java.lang.ref.WeakReference;

/**
 * The remote is a mouse — and it glides.
 *
 * Why cursor-only, and not a D-pad focus ring: the browse UI is the live
 * website, which we do not own and which changes whenever its owner changes it.
 * A focus engine can only move between things the page admits are focusable; the
 * moment a card is a plain <div>, or a control is a slider, or a menu opens on
 * hover, the ring has nowhere to go. A cursor has no such dependency.
 *
 * HOW THE MOTION WORKS (the part that decides whether this feels good).
 *
 *   A tap is predictable. One press moves the aim 18 dp — small enough to land
 *   on a 40 dp button, big enough to cross a card in three presses.
 *
 *   A hold accelerates. The FIRST press also starts a continuous advance whose
 *   speed ramps from 22 % to 100 % over about 0.4 s (smoothstep, so there is no
 *   jolt off the mark). Full speed crosses the screen in ~0.9 s, scaled to the
 *   screen so a 720p box and a 4K box feel the same.
 *
 *   The drawn arrow is always chasing the aim (TvCursorView, ~50 ms time
 *   constant), so there is no step, no jump, no notch — the motion is a stream of
 *   positions, 60 times a second.
 *
 *   At an edge the aim stops and the page scrolls continuously, the way a mouse
 *   at the edge of a screen behaves, so nothing below the fold is unreachable.
 *
 * Hover and clicks use the DRAWN position, not the aim: what the viewer sees
 * under the arrow is exactly what gets clicked, which is what makes the whole
 * thing feel honest.
 *
 * Installed only when {@link TvMode#isTv} is true — a phone never sees any of it.
 */
final class TvPointer {

    private static final String TAG = "FumioTvPointer";

    /** One tap of the D-pad, in dp. Precise, but not fiddly. */
    // ─── THE FEEL ────────────────────────────────────────────────────────────
    // All of it is here. The first pass was tuned like a careful pointer for a
    // desktop — 0.9 s to cross the screen with a 0.42 s ramp — which on a sofa
    // reads as lag, not precision. A 10-foot screen is crossed in a glance, so
    // the cursor has to move at the speed of a glance.
    //
    // A single tap is still fine-grained; the speed is in the hold.
    private static final float NUDGE_DP = 24f;
    /** Time for a held direction to reach full speed. Short: no "spool-up". */
    private static final float RAMP_MS = 190f;
    /** Full speed covers the screen width in this many seconds. */
    private static final float CROSS_SECONDS = 0.40f;
    /** Speed the instant a hold starts, as a fraction of full speed. */
    private static final float SLOW_FRACTION = 0.45f;
    /**
     * Hover work is throttled in two tiers: the cheap native hover event follows
     * the cursor at ~60 fps, while the JS target resolution (the outline) runs at
     * 45 ms — a bridge call per frame would jitter the motion it is meant to
     * decorate.
     */
    private static final long HOVER_MS = 55L;
    private static final float HOVER_MIN_DP = 2f;
    /** Continuous edge scrolling cadence. */
    private static final long SCROLL_MS = 80L;
    private static final long HINT_MS = 5200L;

    private static final int HOLD_LEFT = 1;
    private static final int HOLD_RIGHT = 2;
    private static final int HOLD_UP = 4;
    private static final int HOLD_DOWN = 8;

    private static final TvCursorView.Driver DRIVER =
        new TvCursorView.Driver() {
            @Override
            public void onFrame(long dtMs) {
                advance(dtMs);
            }

            @Override
            public boolean wantsFrames() {
                return held != 0;
            }

            @Override
            public void onRendered() {
                maybeHover(); // cheap native hover only
            }
        };

    private static TvCursorView cursor;
    private static TextView hintView;
    private static WeakReference<WebView> target;
    private static final Handler UI = new Handler(Looper.getMainLooper());
    private static Runnable pendingResolve;

    /** The aim, in window coordinates. The arrow eases toward this. */
    private static float aimX;
    private static float aimY;
    private static boolean placed;

    private static int held;
    private static long heldMs;

    /** The tap point the page published for the outlined target ("fx,fy"). */
    private static float[] tapTarget;
    /**
     * Where the arrow was when that point was measured. The point belongs to one
     * scroll position and one target, so it is only trustworthy while the arrow
     * is still on that target — the classic bug here is a tap landing on the
     * card you left two presses ago.
     */
    private static float tapTargetX;
    private static float tapTargetY;
    /** Generous: a target is a card, not a pixel. */
    private static final float TAP_TARGET_SLOP_DP = 90f;

    /**
     * The strip under the cursor, as fractions of the WebView, and whether it
     * can still scroll each way: "l,t,r,b,canX,canY" (tv-cursor.js).
     *
     * This is what makes horizontal browsing work. A card rail is an inner
     * scroll container that usually ends well inside the screen, so "the cursor
     * hit the edge of the screen" is the wrong trigger for scrolling it — the
     * rail has to scroll as soon as the cursor reaches the RAIL's edge. The
     * bounds come from the page, so native can test that every frame without a
     * bridge round trip.
     */
    private static float[] scrollZone;
    /** A press is in flight: DOWN sent, UP pending. */
    private static boolean pressDown;
    private static float pressX;
    private static float pressY;
    private static long pressAt;
    private static int pressGeneration;
    private static final long MIN_PRESS_MS = 70L;
    private static final long MAX_PRESS_MS = 1500L;
    private static long lastHoverAt;
    private static long lastScrollAt;
    private static float hoverX;
    private static float hoverY;

    private TvPointer() {}

    // ─── lifecycle ──────────────────────────────────────────────────────────

    static void install(Activity activity) {
        if (activity == null || !TvMode.isTv(activity)) return;
        ensureView(activity);
    }

    /** A new page: keep the position, kill any glide left over from the last one. */
    static void onPageFinished(Activity activity, WebView webView) {
        if (activity == null || webView == null || !TvMode.isTv(activity)) return;
        ensureView(activity);
        target = new WeakReference<>(webView);
        held = 0;
        heldMs = 0;

        int[] loc = new int[2];
        webView.getLocationInWindow(loc);
        float cx = loc[0] + webView.getWidth() / 2f;
        float cy = loc[1] + webView.getHeight() / 2f;
        if (!placed || aimX < loc[0] || aimX > loc[0] + webView.getWidth() ||
            aimY < loc[1] || aimY > loc[1] + webView.getHeight()) {
            aimX = cx;
            aimY = cy;
            placed = true;
            if (cursor != null) cursor.snapTo(aimX, aimY);
        } else if (cursor != null) {
            cursor.snapTo(aimX, aimY);
        }
        if (cursor != null) cursor.setArrowVisible(true);
        bringCursorToFront();
        scheduleResolve(140);
    }

    /**
     * bringToFront() triggers a layout pass on the whole host, so it runs only
     * when the cursor is not already on top — not on every key press.
     */
    private static void bringCursorToFront() {
        if (cursor == null) return;
        try {
            ViewGroup parent = (ViewGroup) cursor.getParent();
            if (parent == null) return;
            if (parent.getChildAt(parent.getChildCount() - 1) != cursor) cursor.bringToFront();
        } catch (Exception ignored) {
            /* not worth a crash */
        }
    }

    private static void ensureView(Activity activity) {
        try {
            if (cursor != null && cursor.getParent() != null) return;
            ViewGroup root = activity.findViewById(android.R.id.content);
            if (root == null) return;
            cursor = new TvCursorView(activity);
            cursor.setDriver(DRIVER);
            // SMALL view, moved by translation — never a full-screen overlay.
            // The view supplies its own LayoutParams.
            root.addView(cursor);
            cursor.setVisibility(View.GONE);
            cursor.setArrowVisible(false);
            ensureHintView(activity, root);
        } catch (Exception error) {
            Log.w(TAG, "cursor overlay unavailable: " + error.getMessage());
            cursor = null;
        }
    }

    /**
     * A real TextView for the hint, not something we paint. It only exists while
     * it is being read, and its fade is a ViewPropertyAnimator (compositor), so
     * showing it never makes the cursor's own view dirty.
     */
    private static void ensureHintView(Activity activity, ViewGroup root) {
        if (hintView != null && hintView.getParent() == root) return;
        try {
            TextView view = new TextView(activity);
            view.setTextColor(Color.WHITE);
            view.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f);
            view.setGravity(Gravity.CENTER);
            int padH = (int) (18 * activity.getResources().getDisplayMetrics().density);
            int padV = (int) (10 * activity.getResources().getDisplayMetrics().density);
            view.setPadding(padH, padV, padH, padV);
            GradientDrawable background = new GradientDrawable();
            background.setColor(0xE6121216);
            background.setCornerRadius(24 * activity.getResources().getDisplayMetrics().density);
            view.setBackground(background);
            FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            );
            params.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
            params.topMargin = (int) (24 * activity.getResources().getDisplayMetrics().density);
            view.setLayoutParams(params);
            view.setAlpha(0f);
            view.setVisibility(View.GONE);
            root.addView(view);
            hintView = view;
        } catch (Exception ignored) {
            hintView = null;
        }
    }

    private static void showHint(String text, long millis) {
        if (hintView == null) return;
        hintView.setText(text);
        hintView.setVisibility(View.VISIBLE);
        hintView.animate().cancel();
        hintView.animate().alpha(1f).setDuration(120).start();
        UI.removeCallbacks(hideHint);
        UI.postDelayed(hideHint, millis);
    }

    private static final Runnable hideHint =
        new Runnable() {
            @Override
            public void run() {
                if (hintView == null) return;
                hintView.animate().cancel();
                hintView
                    .animate()
                    .alpha(0f)
                    .setDuration(220)
                    .withEndAction(() -> {
                        if (hintView != null) hintView.setVisibility(View.GONE);
                    })
                    .start();
            }
        };

    /** First key press of the session: put the arrow on screen, with a hint. */
    private static void ensureAimed(Activity activity, WebView webView) {
        ensureView(activity);
        target = new WeakReference<>(webView);
        if (placed) return;
        int[] loc = new int[2];
        webView.getLocationInWindow(loc);
        aimX = loc[0] + webView.getWidth() / 2f;
        aimY = loc[1] + webView.getHeight() / 2f;
        placed = true;
        if (cursor != null) {
            cursor.setArrowVisible(true);
            cursor.snapTo(aimX, aimY);
            bringCursorToFront();
            showHint("Arrows glide  ·  OK selects  ·  BACK goes back", HINT_MS);
        }
    }

    // ─── keys ───────────────────────────────────────────────────────────────

    /** @return true when this layer took the key. */
    static boolean handleKey(Activity activity, WebView webView, KeyEvent event, boolean typing) {
        if (activity == null || webView == null || event == null) return false;
        if (!TvMode.isTv(activity)) return false;

        int code = event.getKeyCode();
        boolean down = event.getAction() == KeyEvent.ACTION_DOWN;
        boolean up = event.getAction() == KeyEvent.ACTION_UP;

        // MENU / INFO: re-show the hint. Remotes with no manual deserve a way to
        // ask "how does this work?".
        if (code == KeyEvent.KEYCODE_MENU || code == KeyEvent.KEYCODE_INFO) {
            if (up) {
                ensureAimed(activity, webView);
                if (cursor != null) cursor.setArrowVisible(true);
                showHint("Arrows glide  ·  OK selects  ·  BACK goes back", HINT_MS);
            }
            return true;
        }

        // BACK is the app's. A cursor with no exit is a trap.
        if (code == KeyEvent.KEYCODE_BACK) return false;

        boolean click = code == KeyEvent.KEYCODE_DPAD_CENTER || code == KeyEvent.KEYCODE_ENTER;
        int bit = holdBit(code);
        if (!click && bit == 0) return false; // not ours

        // While the keyboard is open the remote belongs to it — and any held
        // direction is released, otherwise the cursor keeps gliding behind the
        // keyboard because the matching key-up never reaches us.
        if (typing) {
            held = 0;
            heldMs = 0;
            return false;
        }

        if (up) {
            if (bit != 0) release(bit);
            if (click) {
                WebView webViewNow = web();
                if (webViewNow != null) releasePress(webViewNow);
            }
            return true; // consume the release so the WebView never scrolls
        }
        if (!down) return false;

        ensureAimed(activity, webView);

        if (click) {
            if (event.getRepeatCount() > 0) return true; // no machine-gun taps
            if (cursor != null) cursor.pulse();
            click(webView);
            return true;
        }

        // Auto-repeat is ignored on purpose: the glide advances the aim every
        // frame, and stacking key-repeat jumps on top of it is exactly the
        // notchy motion this replaces. The press we act on is the first one.
        if (event.getRepeatCount() == 0) press(webView, bit);
        return true;
    }

    private static int holdBit(int code) {
        switch (code) {
            case KeyEvent.KEYCODE_DPAD_LEFT:
                return HOLD_LEFT;
            case KeyEvent.KEYCODE_DPAD_RIGHT:
                return HOLD_RIGHT;
            case KeyEvent.KEYCODE_DPAD_UP:
                return HOLD_UP;
            case KeyEvent.KEYCODE_DPAD_DOWN:
                return HOLD_DOWN;
            default:
                return 0;
        }
    }

    private static void press(WebView webView, int bit) {
        boolean idle = held == 0;
        held |= bit;
        if (idle) {
            // A fresh hold always starts slow: the first frames are the fine
            // aiming, and the ramp is what makes long moves feel effortless.
            heldMs = 0;
            nudge(webView, bit);
        }
        if (cursor != null) {
            cursor.setArrowVisible(true);
            cursor.startGlide();
        }
    }

    private static void release(int bit) {
        held &= ~bit;
        if (held == 0) heldMs = 0;
    }

    /** The tap: an immediate, predictable 18 dp step. */
    private static void nudge(WebView webView, int bit) {
        float density = webView.getResources().getDisplayMetrics().density;
        float step = NUDGE_DP * density;
        float dx = 0;
        float dy = 0;
        if ((bit & HOLD_LEFT) != 0) dx -= step;
        if ((bit & HOLD_RIGHT) != 0) dx += step;
        if ((bit & HOLD_UP) != 0) dy -= step;
        if ((bit & HOLD_DOWN) != 0) dy += step;
        float[] bounds = bounds(webView, density);
        aimX = clamp(aimX + dx, bounds[0], bounds[2]);
        aimY = clamp(aimY + dy, bounds[1], bounds[3]);
        if (cursor != null) cursor.setAim(aimX, aimY);
    }

    // ─── the glide ──────────────────────────────────────────────────────────

    /** One frame of held-direction movement. Called from the view's loop. */
    private static void advance(long dt) {
        if (held == 0) return;
        WebView webView = web();
        if (webView == null) {
            // The page is gone: stop gliding, or the Choreographer loop would
            // keep running at 60 fps for a cursor that cannot move.
            held = 0;
            heldMs = 0;
            return;
        }

        float density = webView.getResources().getDisplayMetrics().density;
        float[] bounds = bounds(webView, density);
        float left = bounds[0];
        float top = bounds[1];
        float right = bounds[2];
        float bottom = bounds[3];
        float widthPx = Math.max(1f, right - left);

        // Full speed is expressed as "cross the screen in CROSS_SECONDS", so the
        // feel is identical on a 720p box and a 4K one.
        float fastPxPerSecond = widthPx / CROSS_SECONDS;
        heldMs = Math.min(20000L, heldMs + dt);
        float t = Math.min(1f, heldMs / RAMP_MS);
        float ramp = t * t * (3f - 2f * t); // smoothstep: no jolt off the mark
        float speed = fastPxPerSecond * (SLOW_FRACTION + (1f - SLOW_FRACTION) * ramp);

        float dx = 0;
        float dy = 0;
        if ((held & HOLD_LEFT) != 0) dx -= 1f;
        if ((held & HOLD_RIGHT) != 0) dx += 1f;
        if ((held & HOLD_UP) != 0) dy -= 1f;
        if ((held & HOLD_DOWN) != 0) dy += 1f;
        if (dx != 0 && dy != 0) {
            // Diagonal: same ground speed, not 1.41x faster.
            dx *= 0.7071f;
            dy *= 0.7071f;
        }

        float stepPx = speed * dt / 1000f;
        float nextX = clamp(aimX + dx * stepPx, left, right);
        float nextY = clamp(aimY + dy * stepPx, top, bottom);

        // Where the cursor is stopped. Two different edges matter: the WebView's
        // (the page must scroll) and the strip under the cursor (a card rail must
        // scroll). The strip is usually the nearer of the two, which is exactly
        // why "only scrolls at the screen edge" felt broken.
        float edgeRight = right;
        float edgeLeft = left;
        float edgeBottom = bottom;
        float edgeTop = top;
        boolean railX = false;
        boolean railY = false;
        if (scrollZone != null) {
            int[] where = new int[2];
            webView.getLocationInWindow(where);
            float zl = where[0] + scrollZone[0] * webView.getWidth();
            float zt = where[1] + scrollZone[1] * webView.getHeight();
            float zr = where[0] + scrollZone[2] * webView.getWidth();
            float zb = where[1] + scrollZone[3] * webView.getHeight();
            boolean canX = scrollZone[4] > 0.5f;
            boolean canY = scrollZone[5] > 0.5f;
            if (canX) {
                railX = true;
                if (zr > zl + 1) {
                    edgeRight = Math.min(edgeRight, zr);
                    edgeLeft = Math.max(edgeLeft, zl);
                }
            }
            if (canY) {
                railY = true;
                if (zb > zt + 1) {
                    edgeBottom = Math.min(edgeBottom, zb);
                    edgeTop = Math.max(edgeTop, zt);
                }
            }
        }

        boolean stuckX = (dx > 0 && nextX >= edgeRight) || (dx < 0 && nextX <= edgeLeft);
        boolean stuckY = (dy > 0 && nextY >= edgeBottom) || (dy < 0 && nextY <= edgeTop);

        float clampedX = clamp(nextX, Math.min(edgeLeft, right), Math.max(edgeRight, left));
        float clampedY = clamp(nextY, Math.min(edgeTop, bottom), Math.max(edgeBottom, top));

        if (clampedX != aimX || clampedY != aimY) {
            aimX = clampedX;
            aimY = clampedY;
            if (cursor != null) cursor.setAim(aimX, aimY);
        }

        // Holding into an edge scrolls continuously — the strip under the cursor
        // first (that is the rail), the page second.
        if (stuckX || stuckY) {
            long now = SystemClock.uptimeMillis();
            if (now - lastScrollAt >= SCROLL_MS) {
                lastScrollAt = now;
                int sx = stuckX && (railX || dx != 0) ? (dx > 0 ? 1 : -1) : 0;
                int sy = stuckY && (railY || dy != 0) ? (dy > 0 ? 1 : -1) : 0;
                if (sx != 0 || sy != 0) scroll(webView, sx, sy);
            }
        }
    }

    // ─── page interaction ───────────────────────────────────────────────────

    /**
     * Called every animation frame by the view. It does the CHEAP thing only:
     * a throttled native hover so the page's own :hover styling follows the
     * arrow. The expensive part — asking the DOM what is under the cursor and
     * outlining it — is deferred until the motion stops (see scheduleResolve).
     *
     * That split is what fixed the jitter: a JS bridge call per frame was
     * competing with input on the same thread, and each one forced a style
     * resolution in the page.
     */
    private static void maybeHover() {
        if (cursor == null) return;
        WebView webView = web();
        if (webView == null) return;
        long now = SystemClock.uptimeMillis();
        if (now - lastHoverAt < HOVER_MS) return;
        lastHoverAt = now;

        float[] fractions = fractions(webView);
        hoverX = cursor.viewX();
        hoverY = cursor.viewY();
        try {
            MotionEvent event = MotionEvent.obtain(
                now, now, MotionEvent.ACTION_HOVER_MOVE,
                fractions[0] * webView.getWidth() + webView.getScrollX(),
                fractions[1] * webView.getHeight() + webView.getScrollY(),
                0
            );
            event.setSource(InputDevice.SOURCE_MOUSE);
            webView.onHoverEvent(event);
            event.recycle();
        } catch (Exception ignored) {
            /* hover is a nicety */
        }
        // The outline follows a beat later, when the viewer has stopped aiming.
        scheduleResolve(90);
    }

    /** Resolve + outline once the arrow has been still for {@code delay} ms. */
    private static void scheduleResolve(long delay) {
        if (pendingResolve != null) UI.removeCallbacks(pendingResolve);
        pendingResolve = () -> {
            pendingResolve = null;
            resolveTarget();
        };
        UI.postDelayed(pendingResolve, delay);
    }

    /** Ask the page what is under the arrow, now. Only on stop, and on click. */
    static void resolveTarget() {
        WebView webView = web();
        if (webView == null) return;
        float[] fractions = fractions(webView);
        try {
            webView.evaluateJavascript(
                "window.FumioTvHoverF&&window.FumioTvHoverF(" + fmt(fractions[0]) + "," + fmt(fractions[1]) + ");",
                null
            );
        } catch (Exception ignored) {
            /* the helper is optional */
        }
    }

    /**
     * Click = a real touch at the target's centre.
     *
     * Two deliberate changes from the first version, both because a DOM
     * `element.click()` is NOT what a finger does:
     *
     *   1. It is a native ACTION_DOWN/ACTION_UP pair, so the page generates
     *      pointerdown / pointerup / click itself. A DOM click only fires
     *      `click` — any control listening to pointer or touch events (drag
     *      rails, motion-driven cards, canvas players) ignored it, which is one
     *      reason the season rail did not respond.
     *   2. It lands on the outlined target's CENTRE, not on the cursor pixel, so
     *      aiming at a poster still hits the card. The page computes the centre
     *      and hands it back as a fraction, so it is correct under any scale or
     *      scroll.
     */
    private static void click(final WebView webView) {
        // No bridge round trip before the tap: the page has already published the
        // target's centre on every hover tick, so a press responds on the frame it
        // happens. Refreshing the outline first cost 20–50 ms of dead time, which
        // is exactly what makes a remote feel laggy.
        float fx;
        float fy;
        float slop = TAP_TARGET_SLOP_DP * webView.getResources().getDisplayMetrics().density;
        boolean targetIsCurrent =
            tapTarget != null &&
            Math.abs(aimX - tapTargetX) <= slop &&
            Math.abs(aimY - tapTargetY) <= slop;
        if (targetIsCurrent) {
            fx = tapTarget[0];
            fy = tapTarget[1];
        } else {
            // No target yet, or the arrow has moved off the one it describes: tap
            // where the arrow actually is. A stale centre is worse than the pixel
            // under the cursor — it presses something the viewer is not on.
            float[] at = fractions(webView);
            fx = at[0];
            fy = at[1];
            scheduleResolve(0); // and refresh it for the key-up that follows
        }

        pressX = clamp(fx, 0f, 1f) * webView.getWidth() + webView.getScrollX();
        pressY = clamp(fy, 0f, 1f) * webView.getHeight() + webView.getScrollY();
        pressAt = SystemClock.uptimeMillis();
        pressDown = true;
        final int generation = ++pressGeneration;

        try {
            MotionEvent down =
                MotionEvent.obtain(pressAt, pressAt, MotionEvent.ACTION_DOWN, pressX, pressY, 0);
            down.setSource(InputDevice.SOURCE_TOUCHSCREEN);
            webView.dispatchTouchEvent(down);
            down.recycle();
        } catch (Exception error) {
            pressDown = false;
            Log.w(TAG, "tap down failed: " + error.getMessage());
            return;
        }

        // A real touch is the first attempt. If the page has not reacted at all
        // (same URL, no navigation), the control is one of the few that listens
        // to pointer/mouse events rather than touch — so press it that way too.
        // This is the "some buttons just do nothing" fix: it never fires when
        // the touch already worked.
        final String before = webView.getUrl();
        final WebView webViewForFallback = webView;
        webView.postDelayed(
            () -> {
                try {
                    String now = webViewForFallback.getUrl();
                    if (now != null && now.equals(before)) {
                        webViewForFallback.evaluateJavascript(
                            "window.FumioTvPress&&window.FumioTvPress();",
                            null
                        );
                    }
                } catch (Exception ignored) {
                    /* the view may be gone */
                }
            },
            850
        );

        // Safety net: a key-up can be swallowed (page navigation, focus loss).
        // Without this the page would be left mid-gesture forever.
        final WebView target = webView;
        webView.postDelayed(
            () -> {
                if (pressDown && generation == pressGeneration) releasePress(target);
            },
            MAX_PRESS_MS
        );
    }

    /**
     * The finger leaves. A short press still gets MIN_PRESS_MS of contact, so
     * the page sees a real gesture (pointerdown → pointerup → click) rather than
     * a zero-length one — and a HELD press stays down for as long as the button
     * is held, which is what drag-threshold rails and press-and-hold menus need.
     */
    private static void releasePress(final WebView webView) {
        if (!pressDown) return;
        pressDown = false;
        long now = SystemClock.uptimeMillis();
        long heldFor = now - pressAt;
        long delay = heldFor >= MIN_PRESS_MS ? 0L : (MIN_PRESS_MS - heldFor);
        final float x = pressX;
        final float y = pressY;
        final int generation = pressGeneration;
        webView.postDelayed(
            () -> {
                // A newer press took over while this UP was waiting: its DOWN is
                // the live gesture now, and sending this UP would orphan it.
                if (pressDown && generation != pressGeneration) return;
                try {
                    MotionEvent up =
                        MotionEvent.obtain(
                            SystemClock.uptimeMillis(),
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
            delay
        );
    }

    /** The page publishes the scrollable strip under the cursor. */
    static void setScrollZone(String payload) {
        if (payload == null || payload.isEmpty()) {
            scrollZone = null;
            return;
        }
        String[] parts = payload.split(",");
        if (parts.length < 6) {
            scrollZone = null;
            return;
        }
        try {
            float[] zone = new float[6];
            for (int i = 0; i < 6; i += 1) {
                zone[i] = Float.parseFloat(parts[i].trim());
            }
            scrollZone = zone;
        } catch (Exception ignored) {
            scrollZone = null;
        }
    }

    /** The page publishes the outlined target's centre here (tv-cursor.js). */
    static void setTapTarget(String point) {
        float[] parsed = parseFractions(point);
        tapTarget = parsed;
        tapTargetX = aimX;
        tapTargetY = aimY;
    }

    /**
     * Follow the viewer. The pointer talks to ONE WebView at a time — the browse
     * site, or the player overlay's own page — and it used to keep talking to the
     * browse page after the player opened. The result: inside the player, every
     * arrow moved a cursor over the video and every OK was delivered to a hidden
     * WebView behind it, so the player's own controls (servers, subtitles,
     * play/pause) could not be pressed at all. Called on every key, which is
     * cheap: the identity check is a reference comparison.
     */
    static void ensureTarget(WebView webView) {
        if (webView == null) return;
        WebView currentTarget = web();
        if (currentTarget == webView) return;
        retarget(webView);
    }

    /**
     * The activity is going away. The cursor and the hint are REAL views parented
     * to its content frame, so a static reference to them outlives the activity:
     * that is an Activity leak, and worse, the next activity finds `cursor`
     * non-null with a parent and never gets an overlay of its own. Dropped here.
     */
    static void release() {
        try {
            if (pendingResolve != null) UI.removeCallbacks(pendingResolve);
        } catch (Exception ignored) {
            /* the looper is gone */
        }
        pendingResolve = null;
        try {
            if (hintView != null) {
                ViewGroup parent = (ViewGroup) hintView.getParent();
                if (parent != null) parent.removeView(hintView);
            }
        } catch (Exception ignored) {
            /* already detached */
        }
        hintView = null;
        try {
            if (cursor != null) {
                ViewGroup parent = (ViewGroup) cursor.getParent();
                if (parent != null) parent.removeView(cursor);
            }
        } catch (Exception ignored) {
            /* already detached */
        }
        cursor = null;
        target = null;
        tapTarget = null;
        scrollZone = null;
        placed = false;
        pressDown = false;
        held = 0;
        heldMs = 0;
    }

    /** The browse page is back in front: point the pointer at it again. */
    static void retarget(WebView webView) {
        if (webView == null) return;
        target = new WeakReference<>(webView);
        tapTarget = null;
        scrollZone = null;
        pressedCancel();
    }

    private static void pressedCancel() {
        pressDown = false;
        held = 0;
        heldMs = 0;
    }

    /** A real tap at view coordinates: down, then up 70 ms later. */
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
                            MotionEvent.obtain(now, SystemClock.uptimeMillis(),
                                MotionEvent.ACTION_UP, x, y, 0);
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

    // ─── helpers ────────────────────────────────────────────────────────────

    /** The usable rectangle inside the WebView, in window coordinates. */
    private static float[] bounds(WebView webView, float density) {
        int[] loc = new int[2];
        webView.getLocationInWindow(loc);
        float margin = 6f * density;
        float left = loc[0] + margin;
        float top = loc[1] + margin;
        float right = Math.max(left, loc[0] + webView.getWidth() - margin);
        float bottom = Math.max(top, loc[1] + webView.getHeight() - margin);
        return new float[] { left, top, right, bottom };
    }

    /**
     * Scroll by one step in a direction, using the page's own resolver:
     * the strip under the cursor if it can move that way, the page otherwise.
     */
    private static void scroll(WebView webView, int dirX, int dirY) {
        try {
            webView.evaluateJavascript(
                "window.FumioTvScroll&&window.FumioTvScroll(" + dirX + "," + dirY + ");",
                null
            );
        } catch (Exception ignored) {
            /* a page that will not scroll simply does not scroll */
        }
    }

    /**
     * Where the arrow is, as a fraction of the WebView's box. Fractions are the
     * only currency that survives page scale (a 1920 CSS layout on a 1280 px
     * view), page scroll, text zoom and density — see the note in tv-cursor.js.
     */
    private static float[] fractions(WebView webView) {
        int[] loc = new int[2];
        webView.getLocationInWindow(loc);
        float viewX = cursor != null ? cursor.viewX() : aimX;
        float viewY = cursor != null ? cursor.viewY() : aimY;
        float w = Math.max(1f, webView.getWidth());
        float h = Math.max(1f, webView.getHeight());
        return new float[] {
            clamp((viewX - loc[0]) / w, 0f, 1f),
            clamp((viewY - loc[1]) / h, 0f, 1f),
        };
    }

    /** "0.412000,0.733000" → {0.412f, 0.733f}; anything else → null. */
    private static float[] parseFractions(String value) {
        if (value == null) return null;
        String raw = value.trim();
        if (raw.length() > 1 && raw.startsWith("\"") && raw.endsWith("\"")) {
            raw = raw.substring(1, raw.length() - 1);
        }
        if (raw.isEmpty() || "null".equals(raw) || "false".equals(raw)) return null;
        int comma = raw.indexOf(',');
        if (comma <= 0) return null;
        try {
            float fx = Float.parseFloat(raw.substring(0, comma).trim());
            float fy = Float.parseFloat(raw.substring(comma + 1).trim());
            if (Float.isNaN(fx) || Float.isNaN(fy)) return null;
            return new float[] { clamp(fx, 0f, 1f), clamp(fy, 0f, 1f) };
        } catch (Exception ignored) {
            return null;
        }
    }

    private static String fmt(float value) {
        return String.format(java.util.Locale.US, "%.6f", value);
    }

    private static WebView web() {
        return target == null ? null : target.get();
    }

    private static float clamp(float value, float min, float max) {
        return value < min ? min : (value > max ? max : value);
    }

    /** For logs and the self-test screen. */
    static String state() {
        return "aim=" + Math.round(aimX) + "," + Math.round(aimY) +
            " drawn=" + (cursor == null ? "-" : Math.round(cursor.viewX()) + "," + Math.round(cursor.viewY())) +
            " held=" + held;
    }
}
