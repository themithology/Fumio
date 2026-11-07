package com.fumio.app;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.os.SystemClock;
import android.view.Choreographer;
import android.view.MotionEvent;
import android.view.View;

/**
 * The pointer: a SMALL view that is moved, never redrawn.
 *
 * This is the rewrite that fixed the jitter, and the reason is architectural
 * rather than numeric. The first version was a MATCH_PARENT view drawn on top of
 * the WebView and repainted every frame. Two consequences, both bad:
 *
 *   1. every dirty rectangle it invalidated was a hole punched in the window, so
 *      the WebView underneath had to be recomposited with it — on a television's
 *      GPU that is paid for in dropped frames of the page itself, which is
 *      exactly the "the app is laggy but the site in Chrome is fine" report;
 *   2. redrawing a full-screen overlay 60 times a second while a video is
 *      playing is how you make a cursor feel like it is dragging a bag of sand.
 *
 * Now the view is 132 dp square, contains the arrow at a fixed local position,
 * and is animated with translation only. A translation is a compositor
 * operation: no layout, no redraw, no invalidation, no damage to the WebView's
 * layer. The arrow is rasterised once and simply moves. That is what "smooth"
 * actually is on this hardware.
 *
 * The frame loop is still here (Choreographer, vsync-aligned, stops when
 * parked), because the aim has to be advanced and the drawn position eased —
 * but its output is now two floats handed to setTranslationX/Y.
 */
final class TvCursorView extends View {

    /** What the input layer gives the animation loop. */
    interface Driver {
        void onFrame(long dtMs);
        boolean wantsFrames();
        void onRendered();
    }

    private static final float TAU_MS = 32f;
    private static final float SETTLED_PX = 0.4f;
    private static final long MAX_FRAME_MS = 34L;
    private static final long CLICK_MS = 110;

    /** Arrow box (20 x 29 dp) plus room for the shadow and the click ring. */
    private static final float BOX_DP = 132f;
    /** Where the arrow's tip sits inside the box, in dp. */
    private static final float PAD_DP = 44f;

    private static final int INK = 0xFF0C0C10;
    private static final int BODY = 0xFFFFFFFF;

    private final float dp;
    private final float padPx;
    private final Paint body = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint edge = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint shadowNear = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint shadowFar = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint ring = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Path arrow = new Path();

    /** Window coordinates: where the input wants to be, and where we are drawn. */
    private float aimX;
    private float aimY;
    private float renderX;
    private float renderY;

    private Driver driver;
    private boolean running;
    private long lastFrameAt;
    private boolean arrowVisible;
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
        padPx = PAD_DP * dp;
        float size = BOX_DP * dp;

        // Fixed, small, and never laid out again.
        setLayoutParams(
            new android.widget.FrameLayout.LayoutParams((int) size, (int) size)
        );
        setFocusable(false);
        setClickable(false);
        setWillNotDraw(false);

        // A hardware layer means the transform is done by the compositor and the
        // arrow is rasterised once instead of per frame.
        setLayerType(LAYER_TYPE_HARDWARE, null);

        body.setStyle(Paint.Style.FILL);
        body.setColor(BODY);

        edge.setStyle(Paint.Style.FILL_AND_STROKE);
        edge.setColor(INK);
        edge.setStrokeWidth(dp * 1.6f);
        edge.setStrokeJoin(Paint.Join.ROUND);
        edge.setStrokeCap(Paint.Cap.ROUND);

        shadowNear.setStyle(Paint.Style.FILL);
        shadowNear.setColor(0x55000000);
        shadowFar.setStyle(Paint.Style.FILL);
        shadowFar.setColor(0x26000000);

        ring.setStyle(Paint.Style.STROKE);
        ring.setColor(0xB3FFFFFF);

        // Tip at local (pad, pad), 20 x 29 dp.
        arrow.moveTo(padPx, padPx);
        arrow.lineTo(padPx + dp * 0.2f, padPx + dp * 27.4f);
        arrow.lineTo(padPx + dp * 7.3f, padPx + dp * 20.8f);
        arrow.lineTo(padPx + dp * 11.3f, padPx + dp * 29.0f);
        arrow.lineTo(padPx + dp * 15.7f, padPx + dp * 27.1f);
        arrow.lineTo(padPx + dp * 11.7f, padPx + dp * 19.0f);
        arrow.lineTo(padPx + dp * 19.4f, padPx + dp * 18.4f);
        arrow.close();
    }

    // ─── state, set from TvPointer ──────────────────────────────────────────

    void setDriver(Driver value) {
        driver = value;
    }

    /** Move the target. The view follows on its next frame; nothing is redrawn. */
    void setAim(float x, float y) {
        aimX = x;
        aimY = y;
        startGlide();
    }

    /** Place aim and view at once (first appearance, page change). */
    void snapTo(float x, float y) {
        aimX = x;
        aimY = y;
        renderX = x;
        renderY = y;
        place(x, y);
    }

    float viewX() {
        return renderX;
    }

    float viewY() {
        return renderY;
    }

    void setArrowVisible(boolean visible) {
        arrowVisible = visible;
        if (getVisibility() != (visible ? VISIBLE : GONE)) {
            setVisibility(visible ? VISIBLE : GONE);
        }
    }

    boolean isArrowVisible() {
        return arrowVisible;
    }

    void pulse() {
        clickAt = SystemClock.uptimeMillis();
        invalidate();
        // The ring is an animation: without a running loop it would be one
        // frozen frame. The loop keeps posting while clickAt is recent.
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

    /** Translation only: no layout pass, no invalidate, no damage to the WebView. */
    private void place(float x, float y) {
        float left = x - padPx;
        float top = y - padPx;
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

    // ─── drawing (only for the click pulse) ────────────────────────────────

    @Override
    protected void onDraw(Canvas canvas) {
        long now = SystemClock.uptimeMillis();
        float scale = 1f;
        if (clickAt > 0) {
            float t = (now - clickAt) / (float) CLICK_MS;
            if (t < 1f) {
                scale = 1f - 0.07f * (float) Math.sin(t * Math.PI);
                clickDrawn = true;
            }
        }

        canvas.save();
        canvas.translate(padPx, padPx);
        canvas.scale(scale, scale);

        canvas.save();
        canvas.translate(dp * 2.1f, dp * 3.9f);
        canvas.scale(1.015f, 1.02f);
        canvas.drawPath(arrow, shadowFar);
        canvas.restore();

        canvas.save();
        canvas.translate(dp * 1.2f, dp * 2.2f);
        canvas.drawPath(arrow, shadowNear);
        canvas.restore();

        canvas.drawPath(arrow, edge);
        canvas.drawPath(arrow, body);
        canvas.restore();

        if (clickAt > 0) {
            // Same window as the shrink: when the loop parks at CLICK_MS the
            // ring is already gone, so no half-faded circle is left on screen.
            float t = (now - clickAt) / (float) CLICK_MS;
            if (t < 1f) {
                ring.setAlpha((int) (170 * (1f - t)));
                ring.setStrokeWidth(dp * (2.5f - 1.5f * t));
                canvas.drawCircle(padPx, padPx + dp * 10f, dp * (12f + 34f * t), ring);
            }
        }
    }

    @Override
    public boolean onTouchEvent(MotionEvent event) {
        return false; // never swallow a touch meant for the page underneath
    }
}
