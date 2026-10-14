package com.fumio.app;

import android.app.Activity;
import android.util.TypedValue;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

/** Full-screen support wall. Ads themselves never run here — Chrome does. */
final class VerifyWall {

    interface Callbacks {
        void onClickHere();
        void onReload();
        void onDismiss();
    }

    private View root;
    private View content;
    private TextView status;
    private View cta;
    private TextView ctaTitle;
    private int padX;
    private int padY;

    void attach(Activity activity, Callbacks callbacks) {
        if (root != null) return;
        ViewGroup host = activity.findViewById(android.R.id.content);
        if (host == null) return;
        root = LayoutInflater.from(activity).inflate(R.layout.verify_wall, host, false);
        content = root.findViewById(R.id.verify_content);
        status = root.findViewById(R.id.verify_status);
        cta = root.findViewById(R.id.verify_cta);
        ctaTitle = root.findViewById(R.id.verify_cta_title);
        padX = dp(activity, 22);
        padY = dp(activity, 16);
        cta.setOnClickListener(v -> callbacks.onClickHere());
        root.findViewById(R.id.verify_reload).setOnClickListener(v -> callbacks.onReload());
        root.findViewById(R.id.verify_close).setOnClickListener(v -> callbacks.onDismiss());
        ViewCompat.setOnApplyWindowInsetsListener(
            root,
            (v, insets) -> {
                Insets bars =
                    insets.getInsets(
                        WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
                    );
                if (content != null) {
                    content.setPadding(
                        bars.left + padX,
                        bars.top + padY,
                        bars.right + padX,
                        bars.bottom + padY
                    );
                }
                return WindowInsetsCompat.CONSUMED;
            }
        );
        host.addView(
            root,
            new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        );
        ViewCompat.requestApplyInsets(root);
    }

    boolean isShowing() {
        return root != null && root.getVisibility() == View.VISIBLE && root.getParent() != null;
    }

    void show() {
        if (root != null) {
            root.setVisibility(View.VISIBLE);
            ViewCompat.requestApplyInsets(root);
        }
    }

    void hide() {
        if (root != null) root.setVisibility(View.GONE);
    }

    void setStatus(String text) {
        if (status != null && text != null) status.setText(text);
    }

    void setBusy(boolean busy) {
        if (cta != null) cta.setEnabled(!busy);
        if (ctaTitle != null) ctaTitle.setText(busy ? "Opening Chrome…" : "Click Here");
    }

    private static int dp(Activity activity, int value) {
        return Math.round(
            TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP,
                value,
                activity.getResources().getDisplayMetrics()
            )
        );
    }
}
