package com.togpb.app;

import android.app.DownloadManager;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

import java.util.List;

/**
 * The app's own Downloads screen — everything saved on THIS device.
 *
 * The site's /download window is about *finding* links; this is about the files
 * that already exist on the phone, which is what you need when the network is
 * off. Each row plays through {@link OfflinePlayerActivity} (MKV + multi-audio)
 * and can be deleted with its file.
 *
 * Look and feel is the website's: black page, white headings, zinc secondary
 * text, pill buttons — nothing new to learn.
 */
public class DownloadsActivity extends AppCompatActivity {

    private static final int ZINC_400 = 0xFFA1A1AA;
    private static final int ZINC_500 = 0xFF71717A;

    private LinearLayout list;
    private TextView empty;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setBackgroundColor(Color.BLACK);
        page.setPadding(0, 0, 0, dp(24));
        setContentView(page);

        page.addView(buildHeader());

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        page.addView(
            scroll,
            new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        );

        list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        list.setPadding(dp(16), dp(4), dp(16), dp(4));
        scroll.addView(
            list,
            new ScrollView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        );

        empty = new TextView(this);
        empty.setText("Nothing downloaded yet.\n\nOpen any title on the site and tap Download — the file lands here and plays offline.");
        empty.setTextColor(ZINC_500);
        empty.setTextSize(13);
        empty.setGravity(Gravity.CENTER);
        empty.setPadding(dp(24), dp(48), dp(24), dp(24));
        list.addView(empty);
    }

    @Override
    protected void onResume() {
        super.onResume();
        render();
    }

    private View buildHeader() {
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(16), dp(16), dp(16), dp(12));

        TextView back = new TextView(this);
        back.setText("‹");
        back.setTextColor(Color.WHITE);
        back.setTextSize(26);
        back.setGravity(Gravity.CENTER);
        back.setPadding(dp(8), 0, dp(12), 0);
        back.setOnClickListener(v -> finish());
        bar.addView(back);

        TextView title = new TextView(this);
        title.setText("Downloads");
        title.setTextColor(Color.WHITE);
        title.setTextSize(20);
        title.setTypeface(title.getTypeface(), android.graphics.Typeface.BOLD);
        bar.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        return bar;
    }

    private void render() {
        List<DownloadsLibrary.Item> items = DownloadsLibrary.list(this);
        list.removeAllViews();
        if (items.isEmpty()) {
            list.addView(empty);
            return;
        }
        for (DownloadsLibrary.Item item : items) {
            list.addView(buildRow(item));
        }
    }

    private View buildRow(DownloadsLibrary.Item item) {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(14), dp(12), dp(14), dp(12));

        GradientDrawable shape = new GradientDrawable();
        shape.setColor(0xFF101010);
        shape.setCornerRadius(dp(14));
        shape.setStroke(dp(1), 0x1FFFFFFF);
        card.setBackground(shape);

        LinearLayout.LayoutParams cardParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        cardParams.bottomMargin = dp(10);
        card.setLayoutParams(cardParams);

        TextView name = new TextView(this);
        name.setText(TextUtils.isEmpty(item.title) ? item.name : item.title);
        name.setTextColor(Color.WHITE);
        name.setTextSize(14);
        name.setSingleLine(true);
        name.setEllipsize(TextUtils.TruncateAt.END);
        card.addView(name);

        TextView meta = new TextView(this);
        meta.setTextColor(ZINC_500);
        meta.setTextSize(11);
        String detail = statusLine(item);
        meta.setText(detail);
        card.addView(meta);

        LinearLayout actions = new LinearLayout(this);
        actions.setOrientation(LinearLayout.HORIZONTAL);
        actions.setPadding(0, dp(10), 0, 0);
        card.addView(actions);

        if (item.isReady()) {
            TextView play = pill("Play", true);
            play.setOnClickListener(
                v -> startActivity(OfflinePlayerActivity.intentFor(this, item.uri, item.title))
            );
            actions.addView(play);
        }

        TextView open = pill("Saved file", false);
        open.setVisibility(View.GONE);
        if (item.isReady() && item.name != null && !item.name.isEmpty()) {
            open.setVisibility(View.VISIBLE);
            open.setText("In Downloads/");
            open.setOnClickListener(v -> toast("Saved as " + item.name + " in your Downloads folder"));
            actions.addView(open);
        }

        TextView remove = pill("Delete", false);
        remove.setOnClickListener(
            v -> {
                DownloadsLibrary.forget(this, item);
                toast("Deleted");
                render();
            }
        );
        actions.addView(remove);

        return card;
    }

    private String statusLine(DownloadsLibrary.Item item) {
        String size = DownloadsLibrary.humanSize(item.bytes);
        if (item.status == DownloadManager.STATUS_SUCCESSFUL) {
            return TextUtils.isEmpty(size) ? "Downloaded" : "Downloaded · " + size;
        }
        if (item.status == DownloadManager.STATUS_RUNNING || item.status == DownloadManager.STATUS_PENDING
            || item.status == DownloadManager.STATUS_PAUSED) {
            return TextUtils.isEmpty(size) ? "Downloading…" : "Downloading… · " + size;
        }
        if (item.status == DownloadManager.STATUS_FAILED) return "Download failed — tap Delete and try again";
        return TextUtils.isEmpty(item.name) ? "Not ready" : item.name;
    }

    private TextView pill(String label, boolean primary) {
        TextView view = new TextView(this);
        view.setText(label);
        view.setTextSize(11);
        view.setTextColor(primary ? Color.BLACK : Color.WHITE);
        view.setGravity(Gravity.CENTER);
        view.setPadding(dp(14), dp(8), dp(14), dp(8));
        GradientDrawable shape = new GradientDrawable();
        shape.setColor(primary ? Color.WHITE : 0x14FFFFFF);
        shape.setCornerRadius(dp(18));
        if (!primary) shape.setStroke(dp(1), 0x33FFFFFF);
        view.setBackground(shape);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        params.rightMargin = dp(8);
        view.setLayoutParams(params);
        return view;
    }

    private void toast(String message) {
        try {
            android.widget.Toast.makeText(this, message, android.widget.Toast.LENGTH_SHORT).show();
        } catch (Exception ignored) {
            /* no window */
        }
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
