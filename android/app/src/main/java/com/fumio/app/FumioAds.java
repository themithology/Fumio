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
import android.webkit.CookieManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
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
        return "[{\"label\":\"Sponsored\",\"title\":\"Want an hour ad-free?\",\"subtitle\":\"One short page, then enjoy the show.\",\"cta\":\"Let's go\",\"reward\":true}]";
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
        int total = Math.max(3, config.optInt("viewSeconds", 6));

        LinearLayout root = new LinearLayout(activity);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(0xFF0B0B0B);
        int pad = dp(12);
        root.setPadding(pad, dp(10), pad, dp(8));

        TextView badge = text("Quick pause", 10, 0xFFB8B8B8, true);
        badge.setLetterSpacing(0.08f);
        root.addView(badge);

        TextView msg = text("Thanks for this — then enjoy an hour ad-free.", 14, 0xFFFFFFFF, true);
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
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);
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
        go.setText("Just a second…");
        go.setTextColor(0xFFA1A1AA);
        go.setBackgroundColor(0xFF3F3F46);
        LinearLayout.LayoutParams goLp = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(44)
        );
        goLp.topMargin = dp(6);
        root.addView(go, goLp);

        TextView support = text("Or leave a tip", 12, 0xFFA1A1AA, false);
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
                    timer.setText("You're good");
                    go.setEnabled(true);
                    go.setText("Enjoy your ad-free hour");
                    go.setBackgroundColor(0xFFFFFFFF);
                    go.setTextColor(0xFF111111);
                    return;
                }
                timer.setText(remain + "s");
                go.setText("Hang on…");
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
        try (InputStream stream = activity.getAssets().open("fumio-ads.html");
             BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            StringBuilder html = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) html.append(line).append('\n');
            if (html.length() > 0) return html.toString();
        } catch (Exception ignored) {
            /* fall through */
        }
        return "<!doctype html><html><body style=\"background:#0b0b0b;color:#fff;font-family:sans-serif;padding:24px\">Thanks for waiting.</body></html>";
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
