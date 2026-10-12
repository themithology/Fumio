package com.fumio.app;

import android.app.Activity;
import android.app.Dialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.ViewGroup;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * One packed ads screen (banners + native). After the user views it, play is
 * ad-free for an hour. Ads stay in this overlay — no pop-unders.
 */
final class FumioAds {

    private static final String PREFS = "fumio-ads";
    private static final String AD_FREE_UNTIL = "adFreeUntil";
    private static final String BASE = "https://theogpiratebot.online/fumio-ads";

    private final Activity activity;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final SharedPreferences prefs;
    private JSONObject config = new JSONObject();
    private Dialog dialog;
    private boolean showing;

    FumioAds(Activity activity, String configJson) {
        this.activity = activity;
        this.prefs = activity.getSharedPreferences(PREFS, Activity.MODE_PRIVATE);
        try {
            if (configJson != null && !configJson.isEmpty()) config = new JSONObject(configJson);
        } catch (Exception ignored) {
            config = new JSONObject();
        }
    }

    boolean isAdFree() {
        return prefs.getLong(AD_FREE_UNTIL, 0) > System.currentTimeMillis();
    }

    String nativeCardsJson() {
        if (isAdFree()) return "[]";
        return "[{\"label\":\"Sponsored\",\"title\":\"1 hour ad-free\",\"subtitle\":\"View one ads page, then watch in peace.\",\"cta\":\"View ads\",\"reward\":true}]";
    }

    String supportUrl() {
        return config.optString("supportUrl", "https://theogpiratebot.online/support");
    }

    void showIntro(Runnable then) {
        showIntro(then, null);
    }

    void showIntro(Runnable then, Runnable onCancel) {
        if (then == null) return;
        if (isAdFree()) {
            then.run();
            return;
        }
        showPack(true, then, null, onCancel);
    }

    void showRewarded(Runnable onReward) {
        if (isAdFree()) {
            if (onReward != null) onReward.run();
            return;
        }
        showPack(true, () -> {}, onReward, null);
    }

    void dismiss() {
        showing = false;
        handler.removeCallbacksAndMessages(null);
        try {
            if (dialog != null && dialog.isShowing()) dialog.dismiss();
        } catch (Exception ignored) {
            /* already gone */
        }
        dialog = null;
    }

    private void grantReward() {
        long adFree = System.currentTimeMillis() + Math.max(5, config.optInt("adFreeMinutes", 60)) * 60_000L;
        prefs.edit().putLong(AD_FREE_UNTIL, adFree).apply();
    }

    private void showPack(boolean grant, Runnable onClose, Runnable onReward, Runnable onCancel) {
        dismiss();
        showing = true;
        int total = Math.max(8, config.optInt("viewSeconds", 15));

        LinearLayout root = new LinearLayout(activity);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(0xFF0B0B0B);
        int pad = dp(12);
        root.setPadding(pad, dp(10), pad, dp(8));

        TextView badge = text("ADS · THEN 1 HOUR AD-FREE", 10, 0xFFB8B8B8, true);
        badge.setLetterSpacing(0.08f);
        root.addView(badge);

        TextView msg = text("All ads on this page. Then you can watch.", 13, 0xFFFFFFFF, true);
        LinearLayout.LayoutParams msgLp = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        msgLp.topMargin = dp(4);
        msgLp.bottomMargin = dp(8);
        root.addView(msg, msgLp);

        WebView web = new WebView(activity);
        web.setBackgroundColor(0xFF0B0B0B);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (request == null || request.getUrl() == null) return true;
                if (!request.isForMainFrame()) return false;
                Uri uri = request.getUrl();
                String scheme = uri.getScheme() == null ? "" : uri.getScheme();
                if ("http".equals(scheme) || "https".equals(scheme)) {
                    openExternal(uri);
                    return true;
                }
                return true;
            }
        });
        web.loadDataWithBaseURL(BASE, adsPageHtml(), "text/html", "utf-8", null);
        LinearLayout.LayoutParams webLp = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            0,
            1f
        );
        root.addView(web, webLp);

        TextView timer = text(total + "s", 12, 0xFFA1A1AA, false);
        timer.setPadding(0, dp(6), 0, 0);
        root.addView(timer);

        Button go = new Button(activity);
        go.setAllCaps(false);
        go.setEnabled(false);
        go.setText("Start watching in " + total + "s");
        go.setTextColor(0xFFA1A1AA);
        go.setBackgroundColor(0xFF3F3F46);
        LinearLayout.LayoutParams goLp = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(44)
        );
        goLp.topMargin = dp(6);
        root.addView(go, goLp);

        TextView support = text("Support instead", 12, 0xFFA1A1AA, false);
        support.setGravity(Gravity.CENTER);
        support.setPadding(0, dp(8), 0, dp(2));
        root.addView(support);

        Dialog next = new Dialog(activity, android.R.style.Theme_Black_NoTitleBar_Fullscreen);
        next.setContentView(root);
        next.setCancelable(true);
        next.setOnCancelListener((d) -> finish(false, onClose, onReward, onCancel));
        dialog = next;
        try {
            next.show();
        } catch (Exception ignored) {
            finish(false, onClose, onReward, onCancel);
            return;
        }

        final int[] left = { total };
        Runnable tick = new Runnable() {
            @Override
            public void run() {
                if (!showing) return;
                int remain = left[0];
                if (remain <= 0) {
                    timer.setText("Ready");
                    go.setEnabled(true);
                    go.setText("Start watching · 1 hour ad-free");
                    go.setBackgroundColor(0xFFFFFFFF);
                    go.setTextColor(0xFF111111);
                    return;
                }
                timer.setText(remain + "s left on this page");
                go.setText("Start watching in " + remain + "s");
                left[0] = remain - 1;
                handler.postDelayed(this, 1000);
            }
        };
        tick.run();

        go.setOnClickListener((v) -> {
            if (!go.isEnabled()) return;
            finish(grant, onClose, onReward, onCancel);
        });
        support.setOnClickListener((v) -> openSupport());
    }

    private void finish(boolean grant, Runnable onClose, Runnable onReward, Runnable onCancel) {
        if (!showing) return;
        showing = false;
        handler.removeCallbacksAndMessages(null);
        try {
            if (dialog != null && dialog.isShowing()) dialog.dismiss();
        } catch (Exception ignored) {
            /* already gone */
        }
        dialog = null;
        if (grant) {
            grantReward();
            if (onReward != null) onReward.run();
            if (onClose != null) onClose.run();
        } else if (onCancel != null) {
            onCancel.run();
        }
    }

    private String adsPageHtml() {
        StringBuilder slots = new StringBuilder();
        JSONArray list = config.optJSONArray("slots");
        if (list == null || list.length() == 0) {
            slots.append(placeholder("native", "Native banner"));
            slots.append(placeholder("box", "300×250 banner"));
            slots.append(placeholder("banner", "320×50 banner"));
        } else {
            for (int i = 0; i < list.length(); i += 1) {
                JSONObject slot = list.optJSONObject(i);
                if (slot == null) continue;
                String kind = slot.optString("kind", "native");
                String label = slot.optString("label", "Ad");
                String html = slot.optString("html", "").trim();
                slots.append("<div class=\"slot ").append(esc(kind)).append("\">");
                if (html.isEmpty()) {
                    slots.append("<div class=\"ph\"><b>")
                        .append(esc(label))
                        .append("</b>Paste your Adsterra code in fumio-ads.json</div>");
                } else {
                    slots.append(html);
                }
                slots.append("</div>");
            }
        }
        return "<!doctype html><html><head><meta charset=\"utf-8\">"
            + "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1,maximum-scale=1\">"
            + "<style>"
            + "*{box-sizing:border-box}html,body{margin:0;background:#0b0b0b;color:#fff;"
            + "font-family:sans-serif;-webkit-text-size-adjust:100%}"
            + ".stack{display:flex;flex-direction:column;gap:8px;padding:0 0 12px}"
            + ".slot{width:100%;background:#161616;border:1px solid rgba(255,255,255,.08);"
            + "border-radius:10px;overflow:auto;display:flex;justify-content:center;align-items:center}"
            + ".slot.banner{min-height:50px}.slot.native{min-height:110px}.slot.box{min-height:250px}"
            + ".ph{padding:14px 10px;text-align:center;color:#a1a1aa;font-size:11px;line-height:1.35}"
            + ".ph b{display:block;color:#fff;font-size:12px;margin-bottom:4px}"
            + "iframe,ins,img{max-width:100%}"
            + "</style></head><body><div class=\"stack\">"
            + slots
            + "</div></body></html>";
    }

    private String placeholder(String kind, String label) {
        return "<div class=\"slot " + kind + "\"><div class=\"ph\"><b>"
            + esc(label)
            + "</b>Paste your Adsterra code in fumio-ads.json</div></div>";
    }

    private String esc(String value) {
        if (value == null) return "";
        return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
    }

    private void openSupport() {
        openExternal(Uri.parse(supportUrl()));
    }

    private void openExternal(Uri uri) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, uri);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity.startActivity(intent);
        } catch (Exception ignored) {
            /* no browser */
        }
    }

    private TextView text(String value, int sp, int color, boolean bold) {
        TextView view = new TextView(activity);
        view.setText(value);
        view.setTextColor(color);
        view.setTextSize(sp);
        view.setTypeface(Typeface.SANS_SERIF, bold ? Typeface.BOLD : Typeface.NORMAL);
        return view;
    }

    private int dp(int value) {
        return Math.round(value * activity.getResources().getDisplayMetrics().density);
    }
}
