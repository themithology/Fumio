package com.fumio.app;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.os.SystemClock;
import android.view.Choreographer;
import android.view.MotionEvent;
import android.view.View;

/**
 * The pointer, drawn smoothly.
 *
 * TWO POSITIONS, not one. `aimX/aimY` is where the input layer thinks the
 * cursor is — that is what OK clicks and what the page is asked about. The
 * drawn arrow lives at `renderX/renderY` and eases toward the aim every frame.
 * That single indirection is the difference between a cursor that teleports in
 * 20 dp steps (which reads as broken) and one that glides.
 *
 * The easing is exponential with a ~50 ms time constant, computed from the real
 * frame delta:
 *
 *     k = 1 - exp(-dt / TAU)      render += (aim - render) * k
 *
 * Frame-rate independent by construction: the same motion at 30, 60 or 120 Hz,
 * and no accumulated drift because it is a fixed-target interpolation rather
 * than a simulation. TAU is the whole feel of the thing — larger is floatier,
 * smaller is snappier — and it lives in one constant.
 *
 * The loop runs on {@link Choreographer}, so frames are vsync-aligned instead of
 * landing on arbitrary postDelayed timers, and it STOPS when the cursor is
 * parked. At rest this view asks for no frames at all, which matters because it
 * sits on top of video.
 */
final class TvCursorView extends View {

    /** What the input layer gives the animation loop. */
    interface Driver {
        /** Advance the aim by one frame; {@code dtMs} is the real frame delta. */
        void onFrame(long dtMs);
        /** True while a direction is held, so the loop must keep running. */
        boolean wantsFrames();
        /** Called once the drawn position has advanced, for hover work. */
        void onRendered();
    }

    /** Catch-up time constant. 50 ms ≈ 150 ms to visually arrive. */
    private static final float TAU_MS = 50f;
    /** Closer than this and the cursor is parked. */
    private static final float SETTLED_PX = 0.4f;
    /** Longest frame we integrate (a stall must not teleport the cursor). */
    private static final long MAX_FRAME_MS = 50L;
    private static final long CLICK_MS = 110;

    private static final int INK = 0xFF0C0C10;
    private static final int BODY = 0xFFFFFFFF;

    private final float dp;
    private final Paint body = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint edge = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint shadowNear = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint shadowFar = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint hintText = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint hintBox = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Path arrow = new Path();
    private final RectF box = new RectF();

    /** Window coordinates: where the input wants to be, and where we draw. */
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
    private String hint = "";
    private long hintUntil = -1;
    private boolean hintDrawn;

    private final int[] loc = new int[2];

    private final Choreographer.FrameCallback frameCallback =
        new Choreographer.FrameCallback() {
            @Override
            public void doFrame(long frameTimeNanos) {
                long now = SystemClock.uptimeMillis();
                long dt = lastFrameAt == 0 ? 16L : Math.max(1L, Math.min(MAX_FRAME_MS, now - lastFrameAt));
                lastFrameAt = now;

                // 1. Let the input layer move the aim (held direction, ramp).
                if (driver != null) driver.onFrame(dt);

                // 2. Ease the drawn position toward it. Frame-rate independent.
                float beforeX = renderX;
                float beforeY = renderY;
                float k = 1f - (float) Math.exp(-dt / TAU_MS);
                renderX += (aimX - renderX) * k;
                renderY += (aimY - renderY) * k;
                boolean settled =
                    Math.abs(aimX - renderX) < SETTLED_PX && Math.abs(aimY - renderY) < SETTLED_PX;
                if (settled) {
                    renderX = aimX;
                    renderY = aimY;
                }
                if (beforeX != renderX || beforeY != renderY) {
                    invalidateAround(beforeX, beforeY, renderX, renderY);
                } else if (hintUntil > now) {
                    // The pill fades on its own clock, in its own corner of the
                    // screen: invalidating only around the cursor left a ghost
                    // of the previous frame behind.
                    invalidateHint();
                }

                // 3. Tell the input layer where the arrow actually is, so hover
                //    follows the visible tip rather than the theoretical aim.
                if (driver != null) driver.onRendered();

                boolean held = driver != null && driver.wantsFrames();
                boolean hinting = hintUntil > now;
                boolean clicking = clickAt > 0 && now - clickAt < CLICK_MS;
                if (held || !settled || hinting || clicking) {
                    Choreographer.getInstance().postFrameCallback(this);
                    return;
                }

                // Everything has come to rest: one last frame to clear the pill,
                // then the loop stops. This is why the overlay costs nothing
                // while a viewer is reading the screen.
                running = false;
                lastFrameAt = 0;
                if (hintDrawn) {
                    hintDrawn = false;
                    invalidateHint();
                }
                if (clickDrawn) {
                    clickDrawn = false;
                    invalidate();
                }
            }
        };

    TvCursorView(Context context) {
        super(context);
        dp = context.getResources().getDisplayMetrics().density;
        setFocusable(false);
        setClickable(false);
        setWillNotDraw(false);

        body.setStyle(Paint.Style.FILL);
        body.setColor(BODY);

        // Fill and stroke in one pass, so the edge sits exactly on the
        // silhouette and stays sharp at 4K.
        edge.setStyle(Paint.Style.FILL_AND_STROKE);
        edge.setColor(INK);
        edge.setStrokeWidth(dp * 1.6f);
        edge.setStrokeJoin(Paint.Join.ROUND);
        edge.setStrokeCap(Paint.Cap.ROUND);

        shadowNear.setStyle(Paint.Style.FILL);
        shadowNear.setColor(0x55000000);
        shadowFar.setStyle(Paint.Style.FILL);
        shadowFar.setColor(0x26000000);

        hintBox.setStyle(Paint.Style.FILL);
        hintBox.setColor(0xD9121216);

        hintText.setColor(Color.WHITE);
        hintText.setTextSize(dp * 14f);
        hintText.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        hintText.setAntiAlias(true);

        // Tip at the origin, 20 x 29 dp.
        arrow.moveTo(0, 0);
        arrow.lineTo(dp * 0.2f, dp * 27.4f);
        arrow.lineTo(dp * 7.3f, dp * 20.8f);
        arrow.lineTo(dp * 11.3f, dp * 29.0f);
        arrow.lineTo(dp * 15.7f, dp * 27.1f);
        arrow.lineTo(dp * 11.7f, dp * 19.0f);
        arrow.lineTo(dp * 19.4f, dp * 18.4f);
        arrow.close();
    }

    // ─── state, set from TvPointer ──────────────────────────────────────────

    void setDriver(Driver value) {
        driver = value;
    }

    /** Move the target. The drawn arrow will glide to it. */
    void setAim(float x, float y) {
        aimX = x;
        aimY = y;
        startGlide();
    }

    /** Place both aim and drawing at once — used when the mode changes. */
    void snapTo(float x, float y) {
        aimX = x;
        aimY = y;
        renderX = x;
        renderY = y;
        invalidate();
    }

    float viewX() {
        return renderX;
    }

    float viewY() {
        return renderY;
    }

    void setArrowVisible(boolean visible) {
        if (arrowVisible == visible) return;
        arrowVisible = visible;
        invalidate();
    }

    void pulse() {
        clickAt = SystemClock.uptimeMillis();
        startGlide();
    }

    void showHint(String text, long millis) {
        hint = text == null ? "" : text;
        hintUntil = SystemClock.uptimeMillis() + millis;
        startGlide();
    }

    void startGlide() {
        if (running) return;
        if (!isAttachedToWindow()) return;
        running = true;
        lastFrameAt = 0;
        Choreographer.getInstance().postFrameCallback(frameCallback);
    }

    @Override
    protected void onAttachedToWindow() {
        super.onAttachedToWindow();
        if (aimX != renderX || aimY != renderY || hintUntil > SystemClock.uptimeMillis()) {
            startGlide();
        }
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

    // ─── drawing ────────────────────────────────────────────────────────────

    @Override
    protected void onDraw(Canvas canvas) {
        long now = SystemClock.uptimeMillis();
        getLocationInWindow(loc);
        float x = renderX - loc[0];
        float y = renderY - loc[1];

        if (arrowVisible) drawPointer(canvas, x, y, now);
        if (hintUntil > now && !hint.isEmpty()) {
            hintDrawn = true;
            drawHint(canvas, now);
        }
    }

    /** The pill's own dirty region (it is drawn at the top centre). */
    private void invalidateHint() {
        if (hint.isEmpty()) {
            invalidate();
            return;
        }
        float w = hintText.measureText(hint) + dp * 40f;
        float cx = getWidth() / 2f;
        invalidate(
            (int) (cx - w / 2) - 4,
            (int) (dp * 20f),
            (int) (cx + w / 2) + 4,
            (int) (dp * 24f + dp * 38f) + 4
        );
    }

    private void invalidateAround(float fromX, float fromY, float toX, float toY) {
        getLocationInWindow(loc);
        float spread = dp * 34f;
        float left = Math.min(fromX, toX) - loc[0] - spread;
        float top = Math.min(fromY, toY) - loc[1] - spread;
        float right = Math.max(fromX, toX) - loc[0] + spread;
        float bottom = Math.max(fromY, toY) - loc[1] + spread + dp * 24f;
        invalidate((int) left, (int) top, (int) right, (int) bottom);
    }

    private void drawPointer(Canvas canvas, float x, float y, long now) {
        // A 7 % squash while clicked, scaled about the tip so the point of aim
        // never moves: the click lands where the viewer was pointing.
        float scale = 1f;
        if (clickAt > 0) {
            float t = (now - clickAt) / (float) CLICK_MS;
            if (t < 1f) {
                scale = 1f - 0.07f * (float) Math.sin(t * Math.PI);
                clickDrawn = true;
            }
        }

        canvas.save();
        canvas.translate(x, y);
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
    }

    private void drawHint(Canvas canvas, long now) {
        float pad = dp * 14f;
        float textWidth = hintText.measureText(hint);
        float h = dp * 38f;
        float w = textWidth + pad * 2;
        float cx = getWidth() / 2f;
        float top = dp * 24f;
        float fade = Math.min(1f, (hintUntil - now) / 400f);

        hintBox.setAlpha((int) (205 * fade));
        box.set(cx - w / 2, top, cx + w / 2, top + h);
        canvas.drawRoundRect(box, h / 2, h / 2, hintBox);

        hintText.setAlpha((int) (255 * fade));
        Paint.FontMetrics fm = hintText.getFontMetrics();
        float baseline = top + h / 2f - (fm.ascent + fm.descent) / 2f;
        canvas.drawText(hint, cx - textWidth / 2f, baseline, hintText);
    }

    @Override
    public boolean onTouchEvent(MotionEvent event) {
        // Never swallow a touch meant for the page underneath.
        return false;
    }
}
