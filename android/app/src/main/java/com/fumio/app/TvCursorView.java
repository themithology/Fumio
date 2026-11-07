package com.fumio.app;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.os.SystemClock;
import android.view.Choreographer;
import android.view.MotionEvent;
import android.view.View;

/**
 * The pointer: a ring. Small view, moved, never redrawn.
 *
 * ─── WHY A RING AND NOT AN ARROW ────────────────────────────────────────────
 *
 * An arrow has a HOTSPOT — the tip — that is not the centre of anything, and
 * that is a bug factory. The previous version placed the view at (x - 44dp) and
 * then drew the tip 44dp inside it, so the arrow was painted 44dp right and
 * 44dp down of the point it was actually pointing at: every press landed up and
 * to the left of the arrow, by exactly the padding. A ring has no such
 * ambiguity: the hotspot is the CENTRE of the circle, the circle is centred on
 * the view, so the position the input layer knows and the pixels on screen
 * cannot drift apart again.
 *
 * ─── WHY IT IS CHEAP ────────────────────────────────────────────────────────
 *
 * The first version was a MATCH_PARENT view repainted every frame on top of the
 * WebView. Every dirty rectangle punched a hole in the window and forced the
 * page underneath to be recomposited: the page stuttered while the rest of the
 * app looked fine, and a playing video dropped frames. Now the view is
 * {@link #BOX_DP} square, has a hardware layer (the ring is rasterised once),
 * and is moved with translation only — a compositor operation with no layout,
 * no invalidation and no damage to the WebView's layer.
 */
final class TvCursorView extends View {

    /** What the input layer gives the animation loop. */
    interface Driver {
        /** Advance the aim by one frame. Runs before the ease. */
        void onFrame(long dtMs);

        /**
         * The arrow has just been placed for this frame. Hover events are sent
         * here, after the move, so the page is told about the position that is
         * actually on screen — not last frame's.
         */
        void onPlaced();

        boolean wantsFrames();

        /** The loop is parking: the arrow is exactly on the aim. */
        void onRendered();
    }

    /**
     * Time constant of the easing, used for a TAP only.
     *
     * During a HOLD the ring is placed exactly on the aim every frame and this
     * is not used at all: the aim is already a continuous 60 Hz curve, so easing
     * it as well is a filter on top of a filter — pure added latency, and it is
     * what made the pointer feel mushy next to a real mouse. A tap is a jump, so
     * that one still gets a short ease to take the edge off.
     */
    private static final float TAU_MS = 30f;
    private static final float SETTLED_PX = 0.35f;
    private static final long MAX_FRAME_MS = 34L;
    /** The press: a quick shrink and a ring that leaves. */
    private static final long CLICK_MS = 160L;

    /** Big enough for the ring plus the press ripple, and nothing more. */
    private static final float BOX_DP = 120f;
    /** Radius of the white ring. */
    private static final float RING_DP = 11.5f;
    private static final float STROKE_DP = 2.4f;
    /** The dot in the middle: the actual point being pointed at. */
    private static final float DOT_DP = 2.6f;

    private static final int INK = 0xFF0C0C10;
    private static final int BODY = 0xFFFFFFFF;
    /** A dark edge behind the white, so the ring reads on a white page too. */
    private static final int CONTRAST = 0x66000000;

    private final float dp;
    private final float centre;
    private final float ringPx;
    private final float strokePx;
    private final float dotPx;

    private final Paint contrast = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint ring = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint dot = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint dotEdge = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint ripple = new Paint(Paint.ANTI_ALIAS_FLAG);

    /** Window coordinates: where the input wants to be, and where we are drawn. */
    private float aimX;
    private float aimY;
    private float renderX;
    private float renderY;

    private Driver driver;
    private boolean running;
    private long lastFrameAt;
    private boolean visible;
    private long clickAt = -1;
    private boolean clickDrawn;

    private final Choreographer.FrameCallback frameCallback =
        new Choreographer.FrameCallback() {
            @Override
            public void doFrame(long frameTimeNanos) {
                long now = SystemClock.uptimeMillis();
                long dt =
                    lastFrameAt == 0
                        ? 16L
                        : Math.max(1L, Math.min(MAX_FRAME_MS, now - lastFrameAt));
                lastFrameAt = now;

                if (driver != null) driver.onFrame(dt);

                float k = 1f - (float) Math.exp(-dt / TAU_MS);
                renderX += (aimX - renderX) * k;
                renderY += (aimY - renderY) * k;
                boolean settled =
                    Math.abs(aimX - renderX) < SETTLED_PX &&
                    Math.abs(aimY - renderY) < SETTLED_PX;
                if (settled) {
                    renderX = aimX;
                    renderY = aimY;
                }
                place(renderX, renderY);
                if (driver != null) driver.onPlaced();

                boolean clicking = clickAt > 0 && now - clickAt < CLICK_MS;
                if (clicking) invalidate();

                boolean held = driver != null && driver.wantsFrames();
                if (held || !settled || clicking) {
                    Choreographer.getInstance().postFrameCallback(this);
                    return;
                }
                running = false;
                lastFrameAt = 0;
                if (clickDrawn) {
                    clickDrawn = false;
                    invalidate();
                }
                if (driver != null) driver.onRendered();
            }
        };

    TvCursorView(Context context) {
        super(context);
        dp = context.getResources().getDisplayMetrics().density;
        float size = BOX_DP * dp;
        centre = size / 2f;
        ringPx = RING_DP * dp;
        strokePx = STROKE_DP * dp;
        dotPx = DOT_DP * dp;

        // Fixed, small, and never laid out again.
        setLayoutParams(
            new android.widget.FrameLayout.LayoutParams((int) size, (int) size)
        );
        setFocusable(false);
        setClickable(false);
        setWillNotDraw(false);

        // A hardware layer means the transform is the compositor's job and the
        // ring is rasterised once instead of per frame.
        setLayerType(LAYER_TYPE_HARDWARE, null);

        contrast.setStyle(Paint.Style.STROKE);
        contrast.setColor(CONTRAST);
        contrast.setStrokeWidth(strokePx + dp * 2f);

        ring.setStyle(Paint.Style.STROKE);
        ring.setColor(BODY);
        ring.setStrokeWidth(strokePx);

        dot.setStyle(Paint.Style.FILL);
        dot.setColor(BODY);

        dotEdge.setStyle(Paint.Style.FILL);
        dotEdge.setColor(INK);

        ripple.setStyle(Paint.Style.STROKE);
        ripple.setColor(BODY);
    }

    // ─── state, set from TvPointer ──────────────────────────────────────────

    void setDriver(Driver value) {
        driver = value;
    }

    /** Move the target; the view eases onto it (a tap). Nothing is redrawn. */
    void setAim(float x, float y) {
        aimX = x;
        aimY = y;
        startGlide();
    }

    /**
     * Move the target AND the ring together (a hold).
     *
     * 1:1, no easing: the aim already advances every frame, so this is the
     * shortest possible path from "the input says here" to "the pixels are
     * here". A mouse has no easing either — that is the whole reason it feels
     * different from an app-drawn pointer.
     */
    void setAimNow(float x, float y) {
        aimX = x;
        aimY = y;
        renderX = x;
        renderY = y;
        place(x, y);
    }

    /** Place aim and view at once (first appearance, page change). */
    void snapTo(float x, float y) {
        aimX = x;
        aimY = y;
        renderX = x;
        renderY = y;
        place(x, y);
    }

    /** The point being pointed at, in window coordinates. */
    float viewX() {
        return renderX;
    }

    float viewY() {
        return renderY;
    }

    void setArrowVisible(boolean show) {
        visible = show;
        if (getVisibility() != (show ? VISIBLE : GONE)) {
            setVisibility(show ? VISIBLE : GONE);
        }
    }

    boolean isArrowVisible() {
        return visible;
    }

    /** The press: shrink now, the loop paints the ripple and stops when done. */
    void pulse() {
        clickAt = SystemClock.uptimeMillis();
        invalidate();
        // The ripple is an animation: without the loop it would be one frozen
        // frame on screen until the next key press.
        startGlide();
    }

    void startGlide() {
        if (running || !isAttachedToWindow()) return;
        running = true;
        lastFrameAt = 0;
        try {
            Choreographer.getInstance().postFrameCallback(frameCallback);
        } catch (Exception ignored) {
            running = false;
        }
    }

    /**
     * Translation only, and the hotspot is the centre: the ring is centred on
     * the view, so the drawn centre IS (x, y) with no padding arithmetic to get
     * wrong.
     */
    private void place(float x, float y) {
        float left = x - centre;
        float top = y - centre;
        setTranslationX(left - getLeft());
        setTranslationY(top - getTop());
    }

    @Override
    protected void onAttachedToWindow() {
        super.onAttachedToWindow();
        place(renderX, renderY);
    }

    @Override
    protected void onDetachedFromWindow() {
        try {
            Choreographer.getInstance().removeFrameCallback(frameCallback);
        } catch (Exception ignored) {
            /* nothing posted */
        }
        running = false;
        super.onDetachedFromWindow();
    }

    // ─── drawing (only for the press) ───────────────────────────────────────

    @Override
    protected void onDraw(Canvas canvas) {
        long now = SystemClock.uptimeMillis();
        float scale = 1f;
        float t = -1f;
        if (clickAt > 0) {
            t = (now - clickAt) / (float) CLICK_MS;
            if (t < 1f) {
                // A short dip, not a bounce: the ring reads as "pressed" and
                // returns to exactly where it was.
                scale = 1f - 0.16f * (float) Math.sin(Math.min(1f, t * 2f) * Math.PI);
                clickDrawn = true;
            }
        }

        canvas.save();
        canvas.translate(centre, centre);
        canvas.scale(scale, scale);

        canvas.drawCircle(0f, 0f, ringPx, contrast);
        canvas.drawCircle(0f, 0f, ringPx, ring);
        canvas.drawCircle(0f, 0f, dotPx + dp * 0.9f, dotEdge);
        canvas.drawCircle(0f, 0f, dotPx, dot);

        canvas.restore();

        // The ripple is drawn unscaled and outside the shrink, so it travels
        // from the ring's edge outward. Same 160 ms window as CLICK_MS: the
        // frame the loop parks on is already clean, so no half-faded circle is
        // ever left on screen.
        if (t >= 0f && t < 1f) {
            ripple.setAlpha((int) (120 * (1f - t) * (1f - t)));
            ripple.setStrokeWidth(dp * (1.8f - 1.1f * t));
            canvas.drawCircle(centre, centre, ringPx + dp * (2f + 16f * t), ripple);
        }
    }

    @Override
    public boolean onTouchEvent(MotionEvent event) {
        return false; // never swallow a touch meant for the page underneath
    }
}
