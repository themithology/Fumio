package com.fumio.app;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.graphics.Shader;
import android.graphics.Typeface;
import android.os.SystemClock;
import android.view.MotionEvent;
import android.view.View;

/**
 * The cartoony pointer. A hand-drawn arrow with a dark outline, a yellow glow,
 * three orbiting sparkles, a gentle idle bob and a squash-and-ring on click.
 *
 * It exists because a website is allowed to have things a D-pad cannot reach:
 * a card the site never made focusable, a drag handle, a hover menu, a slider.
 * Rather than fail there, the remote becomes a mouse — the cursor is drawn by
 * us (so it is on brand and unmistakably ours), and clicks are synthesised into
 * the WebView as real touch events, which is exactly what the page already
 * knows how to handle.
 *
 * Design rules: it must read at 3 m, so it is 30 dp wide with a 3 dp outline and
 * a shadow; it must feel like ours, so it uses the app's yellow; and it must
 * never look like a system arrow, so it bobs, sparkles and squashes.
 */
final class TvCursorView extends View {

    /** Movement step for one D-pad press, in dp (accelerated on key repeat). */
    static final float STEP_DP = 26f;

    private final float dp;
    private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint outline = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint glow = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint shadow = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint ring = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint sparkle = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint hintText = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint hintBox = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Path arrow = new Path();
    private final RectF box = new RectF();

    /** Cursor position in WINDOW coordinates (see TvPointer). */
    private float windowX;
    private float windowY;
    private boolean arrowVisible;
    private long clickAt = -1;
    private long bornAt = SystemClock.uptimeMillis();
    private String hint = "";
    private long hintUntil = -1;
    private final int[] loc = new int[2];
    private final RectF lastDirty = new RectF();

    TvCursorView(Context context) {
        super(context);
        dp = context.getResources().getDisplayMetrics().density;
        setFocusable(false);
        setClickable(false);
        setWillNotDraw(false);

        fill.setStyle(Paint.Style.FILL);
        fill.setColor(Color.WHITE);

        outline.setStyle(Paint.Style.STROKE);
        outline.setStrokeWidth(dp * 3f);
        outline.setStrokeJoin(Paint.Join.ROUND);
        outline.setStrokeCap(Paint.Cap.ROUND);
        outline.setColor(0xFF101014);

        glow.setStyle(Paint.Style.STROKE);
        glow.setStrokeWidth(dp * 7f);
        glow.setStrokeJoin(Paint.Join.ROUND);
        glow.setColor(0xAAFFD400);

        shadow.setStyle(Paint.Style.FILL);
        shadow.setShader(
            new LinearGradient(
                0,
                0,
                0,
                dp * 10,
                new int[] { 0x66000000, 0x00000000 },
                null,
                Shader.TileMode.CLAMP
            )
        );

        ring.setStyle(Paint.Style.STROKE);
        ring.setStrokeWidth(dp * 2.5f);
        ring.setColor(0xFFFFD400);

        sparkle.setStyle(Paint.Style.FILL);
        sparkle.setColor(0xFFFFD400);

        hintBox.setStyle(Paint.Style.FILL);
        hintBox.setColor(0xD9141418);

        hintText.setColor(Color.WHITE);
        hintText.setTextSize(dp * 15f);
        hintText.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        hintText.setAntiAlias(true);

        // A classic pointer, tip at the origin, ~20x28 dp.
        arrow.moveTo(0, 0);
        arrow.lineTo(0, dp * 26f);
        arrow.lineTo(dp * 6.4f, dp * 20f);
        arrow.lineTo(dp * 10.2f, dp * 28f);
        arrow.lineTo(dp * 14f, dp * 26.2f);
        arrow.lineTo(dp * 10.4f, dp * 18.4f);
        arrow.lineTo(dp * 18.4f, dp * 17.8f);
        arrow.close();
    }

    // ─── state set from TvPointer ───────────────────────────────────────────

    void moveToWindow(float x, float y) {
        windowX = x;
        windowY = y;
        invalidate();
    }

    void setArrowVisible(boolean visible) {
        if (arrowVisible != visible) {
            arrowVisible = visible;
            bornAt = SystemClock.uptimeMillis();
        }
        invalidate();
    }

    void pulse() {
        clickAt = SystemClock.uptimeMillis();
        invalidate();
    }

    void showHint(String text, long millis) {
        hint = text == null ? "" : text;
        hintUntil = SystemClock.uptimeMillis() + millis;
        invalidate();
    }

    // ─── drawing ────────────────────────────────────────────────────────────

    @Override
    protected void onDraw(Canvas canvas) {
        long now = SystemClock.uptimeMillis();
        getLocationInWindow(loc);
        float x = windowX - loc[0];
        float y = windowY - loc[1];

        if (arrowVisible) drawPointer(canvas, x, y, now);
        if (hintUntil > now && !hint.isEmpty()) drawHint(canvas, now);

        boolean needsFrames =
            arrowVisible || (clickAt > 0 && now - clickAt < 420) || hintUntil > now;
        if (!needsFrames || !isShown()) return;

        // Only the pixels around the cursor are recomputed, and only ~16 times a
        // second: this view sits on top of video on cheap TV GPUs, so a
        // full-screen 60 fps repaint would be paid for in stutter.
        RectF dirty = dirtyArea(x, y);
        dirty.union(lastDirty);
        lastDirty.set(dirtyArea(x, y));
        postInvalidateDelayed(
            60,
            (int) dirty.left,
            (int) dirty.top,
            (int) dirty.right,
            (int) dirty.bottom
        );
    }

    /** Everything the next frame may touch: the pointer, its ring, the hint. */
    private RectF dirtyArea(float x, float y) {
        float spread = dp * 70f;
        RectF area = new RectF(x - spread, y - spread, x + spread, y + spread + dp * 60f);
        if (hintUntil > SystemClock.uptimeMillis() && !hint.isEmpty()) {
            float w = hintText.measureText(hint) + dp * 40f;
            float cx = getWidth() / 2f;
            area.union(cx - w / 2, dp * 20f, cx + w / 2, dp * 76f);
        }
        return area;
    }

    private void drawPointer(Canvas canvas, float x, float y, long now) {
        // Idle bob: a slow float, so the cursor reads as alive, not as a static
        // system artefact. Never enough to lose the exact aim point.
        float bobX = (float) Math.sin(now / 620.0) * dp * 1.2f;
        float bobY = (float) Math.cos(now / 480.0) * dp * 1.2f;
        // Squash on click, then back to full size in ~90 ms.
        float since = clickAt > 0 ? (now - clickAt) / 1000f : 99f;
        float squash = since < 0.09f ? 1f - (0.09f - since) * 1.6f : 1f;
        // A tiny entry pop when the pointer first appears.
        float pop = Math.min(1f, (now - bornAt) / 140f);

        canvas.save();
        canvas.translate(x + bobX, y + bobY);
        canvas.scale(squash * pop, squash * pop);

        // Glow, then the outline, then the white body: three passes so the
        // yellow reads as a light behind the arrow rather than a border.
        canvas.drawPath(arrow, glow);
        canvas.drawPath(arrow, fill);
        canvas.drawPath(arrow, outline);
        canvas.restore();

        // Shadow, drawn under the tip without the bob so it feels grounded.
        canvas.save();
        canvas.translate(x + dp * 3f, y + dp * 5f);
        box.set(-dp * 9f, -dp * 9f, dp * 18f, dp * 12f);
        canvas.drawOval(box, shadow);
        canvas.restore();

        // Three sparkles orbiting the tip, twinkling out of phase.
        for (int i = 0; i < 3; i += 1) {
            double phase = now / 900.0 + (i * 2.1);
            float radius = dp * (13f + i * 2.5f);
            float sx = x + bobX + (float) Math.cos(phase) * radius;
            float sy = y + bobY + (float) Math.sin(phase) * radius * 0.75f;
            sparkle.setAlpha((int) (90 + 90 * (0.5 + 0.5 * Math.sin(phase * 2.2))));
            float size = dp * (1.1f + 0.55f * i);
            canvas.drawCircle(sx, sy, size, sparkle);
        }

        // Click: an expanding ring that fades out.
        if (clickAt > 0) {
            float t = (now - clickAt) / 420f;
            if (t < 1f) {
                ring.setAlpha((int) (200 * (1f - t)));
                ring.setStrokeWidth(dp * (3f - 2f * t));
                canvas.drawCircle(x, y + dp * 8f, dp * (10f + 34f * t), ring);
            }
        }
    }

    private void drawHint(Canvas canvas, long now) {
        float pad = dp * 14f;
        float textWidth = hintText.measureText(hint);
        float h = dp * 40f;
        float w = textWidth + pad * 2;
        float cx = getWidth() / 2f;
        float top = dp * 28f;
        float fade = Math.min(1f, (hintUntil - now) / 400f);

        hintBox.setAlpha((int) (215 * fade));
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
