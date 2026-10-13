package com.fumio.app;

import android.app.Activity;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;

/** Full-screen support wall. Ads themselves never run here — Chrome does. */
final class VerifyWall {

    interface Callbacks {
        void onClickHere();
        void onReload();
        void onDismiss();
    }

    private View root;
    private TextView status;
    private View cta;
    private TextView ctaTitle;

    void attach(Activity activity, Callbacks callbacks) {
        if (root != null) return;
        ViewGroup content = activity.findViewById(android.R.id.content);
        if (content == null) return;
        root = LayoutInflater.from(activity).inflate(R.layout.verify_wall, content, false);
        status = root.findViewById(R.id.verify_status);
        cta = root.findViewById(R.id.verify_cta);
        ctaTitle = root.findViewById(R.id.verify_cta_title);
        cta.setOnClickListener(v -> callbacks.onClickHere());
        root.findViewById(R.id.verify_reload).setOnClickListener(v -> callbacks.onReload());
        root.findViewById(R.id.verify_close).setOnClickListener(v -> callbacks.onDismiss());
        content.addView(
            root,
            new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        );
    }

    boolean isShowing() {
        return root != null && root.getVisibility() == View.VISIBLE && root.getParent() != null;
    }

    void show() {
        if (root != null) root.setVisibility(View.VISIBLE);
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
}
