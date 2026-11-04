package com.fumio.app;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.os.SystemClock;
import android.view.MotionEvent;
import android.view.View;

/**
 * The pointer. A plain, ordinary arrow — white body, thin dark edge, a tight
 * shadow. Nothing else.
 *
 * It exists because a website is allowed to have things a D-pad cannot reach: a
 * card the site never made focusable, a drag handle, a hover menu, a slider.
 * Rather than fail there, the remote becomes a mouse, and clicks are synthesised
 * into the WebView as real touch events — which is exactly what the page already
 * knows how to handle.
 *
 * DESIGN NOTES, because the first version got this wrong.
 *
 * A glow, orbiting sparkles and an idle bob made the cursor look generated and,
 * worse, noisy: it competed with the poster art underneath, which is the actual
 * content. What a pointer needs is to be found instantly and then ignored.
 *
 *   - Shape: the classic arrow. 20 dp wide, 29 dp tall, sharp tip. Recognised
 *     without being learned.
 *   - Edge: 1.6 dp of near-black. Not decoration — on a bright poster a pure
 *     white arrow vanishes, and a dark edge is what keeps it visible there
 *     (see the white chip in docs/cursor-styles.png).
 *   - Shadow: one tight, low-alpha offset. Enough to lift it off the art; not
 *     enough to read as a halo.
 *   - Motion: none at rest. A short squash on click, and that is all — a cursor
 *     that moves while you are aiming is a cursor you cannot aim.
 *
 * A consequence worth keeping: with no idle animation there is no continuous
 * repaint, so the view costs nothing while the viewer is reading the screen.
 */
final class TvCursorView extends View {

    /** Movement step for one D-pad press, in dp (accelerated on key repeat). */
    static final float STEP_DP = 26f;

    private static final int INK = 0xFF0C0C10;
    private static final int BODY = 0xFFFFFFFF;
    private static final long CLICK_MS = 110;

    private final float dp;
    private final Paint body = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint edge = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint shadowNear = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint shadowFar = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint hintText = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint hintBox = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Path arrow = new Path();
    private final RectF box = new RectF();

    /** Cursor position in WINDOW coordinates (see TvPointer). */
    private float windowX;
    private float windowY;
    private boolean arrowVisible;
    private long clickAt = -1;
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

        body.setStyle(Paint.Style.FILL);
        body.setColor(BODY);

        // Fill AND stroke in one pass: the edge sits exactly on the silhouette,
        // so the shape stays sharp at 4K instead of gaining a fuzzy ring.
        edge.setStyle(Paint.Style.FILL_AND_STROKE);
        edge.setColor(INK);
        edge.setStrokeWidth(dp * 1.6f);
        edge.setStrokeJoin(Paint.Join.ROUND);
        edge.setStrokeCap(Paint.Cap.ROUND);

        // Two offset silhouettes emulate a soft shadow without a blur pass.
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

        // The arrow: tip at the origin, 20 x 29 dp, classic proportions.
        arrow.moveTo(0, 0);
        arrow.lineTo(dp * 0.2f, dp * 27.4f);
        arrow.lineTo(dp * 7.3f, dp * 20.8f);
        arrow.lineTo(dp * 11.3f, dp * 29.0f);
        arrow.lineTo(dp * 15.7f, dp * 27.1f);
        arrow.lineTo(dp * 11.7f, dp * 19.0f);
        arrow.lineTo(dp * 19.4f, dp * 18.4f);
        arrow.close();
    }

    // ─── state set from TvPointer ───────────────────────────────────────────

    void moveToWindow(float x, float y) {
        if (x == windowX && y == windowY) return;
        windowX = x;
        windowY = y;
        invalidate();
    }

    void setArrowVisible(boolean visible) {
        if (arrowVisible == visible) return;
        arrowVisible = visible;
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

        // The only two things that animate: the click squash (110 ms) and the
        // hint fading out. At rest the view does not ask for another frame.
        boolean animating = (clickAt > 0 && now - clickAt < CLICK_MS) || hintUntil > now;
        if (!animating || !isShown()) return;

        RectF dirty = dirtyArea(x, y);
        dirty.union(lastDirty);
        lastDirty.set(dirtyArea(x, y));
        postInvalidateDelayed(
            50,
            (int) dirty.left,
            (int) dirty.top,
            (int) dirty.right,
            (int) dirty.bottom
        );
    }

    /** Everything a frame may touch: the arrow, its shadow, the hint pill. */
    private RectF dirtyArea(float x, float y) {
        float spread = dp * 34f;
        RectF area = new RectF(x - spread, y - spread, x + spread, y + spread + dp * 20f);
        if (hintUntil > SystemClock.uptimeMillis() && !hint.isEmpty()) {
            float w = hintText.measureText(hint) + dp * 40f;
            float cx = getWidth() / 2f;
            area.union(cx - w / 2, dp * 18f, cx + w / 2, dp * 71f);
        }
        return area;
    }

    private void drawPointer(Canvas canvas, float x, float y, long now) {
        // Squash while clicked: 1.0 → 0.93 → 1.0 over 110 ms. Scaled about the
        // tip, so the point of aim never moves — the click lands where the
        // viewer was pointing, not a few pixels off.
        float scale = 1f;
        if (clickAt > 0) {
            float t = (now - clickAt) / (float) CLICK_MS;
            if (t < 1f) scale = 1f - 0.07f * (float) Math.sin(t * Math.PI);
        }

        canvas.save();
        canvas.translate(x, y);
        canvas.scale(scale, scale);

        // Far shadow (wide, very soft), then near shadow, then edge, then body.
        canvas.save();
        canvas.translate(dp * 2.1f, dp * 3.9f);
        canvas.scale(1.015f, 1.02f);
        canvas.drawPath(arrow, shadowFar);
        canvas.restore();

        canvas.save();
        canvas.translate(dp * 1.2f, dp * 2.2f);
        canvas.drawPath(arrow, shadowNear);
        canvas.restore();

        canvas.drawPath(arrow, edge); // FILL_AND_STROKE: silhouette + outline
        body.setColor(BODY);
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
