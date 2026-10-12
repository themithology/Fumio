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
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Contained ads only: a short skippable intro before play, an optional rewarded
 * unlock, and labeled native cards on Home. Never pop-unders or extra windows.
 */
final class FumioAds {



    private static final String PREFS = "fumio-ads";
    private static final String AD_FREE_UNTIL = "adFreeUntil";
    private static final String DOWNLOADS_UNTIL = "downloadsUntil";
    private static final String LAST_INTRO = "lastIntroAt";

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

    boolean downloadsUnlocked() {
        return prefs.getLong(DOWNLOADS_UNTIL, 0) > System.currentTimeMillis();
    }

    String nativeCardsJson() {
        JSONArray cards = config.optJSONArray("nativeCards");
        return cards == null ? "[]" : cards.toString();
    }

    String supportUrl() {
        return config.optString("supportUrl", "https://theogpiratebot.online/support");
    }

    void showIntro(Runnable then) {
        if (then == null) return;
        if (isAdFree() || !dueForIntro()) {
            then.run();
            return;
        }
        prefs.edit().putLong(LAST_INTRO, System.currentTimeMillis()).apply();
        showSheet(
            false,
            config.optInt("introSeconds", 8),
            config.optInt("skipAfterSeconds", 5),
            config.optString("introUrl", ""),
            "Ad",
            "A short pause keeps TheOGPirateBot free.",
            "Skip",
            then,
            null
        );
    }

    void showRewarded(Runnable onReward) {
        showSheet(
            true,
            config.optInt("rewardSeconds", 15),
            config.optInt("rewardSeconds", 15),
            config.optString("rewardUrl", ""),
            "Rewarded ad",
            "Watch this to skip intro ads for 1 hour and unlock downloads.",
            "Unlock after the ad",
            () -> {},
            onReward
        );
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

    private boolean dueForIntro() {
        long every = Math.max(1, config.optInt("introEveryMinutes", 12)) * 60_000L;
        return System.currentTimeMillis() - prefs.getLong(LAST_INTRO, 0) >= every;
    }

    private void grantReward() {
        long now = System.currentTimeMillis();
        long adFree = now + Math.max(5, config.optInt("adFreeMinutes", 60)) * 60_000L;
        long downloads = now + Math.max(5, config.optInt("downloadUnlockMinutes", 60)) * 60_000L;
        prefs.edit().putLong(AD_FREE_UNTIL, adFree).putLong(DOWNLOADS_UNTIL, downloads).apply();
    }

    private void showSheet(
        boolean reward,
        int totalSec,
        int skipAfterSec,
        String url,
        String badge,
        String message,
        String skipLabel,
        Runnable onClose,
        Runnable onReward
    ) {
        dismiss();
        showing = true;
        int total = Math.max(3, totalSec);
        int skipAfter = Math.min(total, Math.max(0, skipAfterSec));

        LinearLayout root = new LinearLayout(activity);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(0xFF0B0B0B);
        int pad = dp(20);
        root.setPadding(pad, dp(36), pad, pad);

        TextView badgeView = text(badge.toUpperCase(), 11, 0xFFB8B8B8, true);
        badgeView.setLetterSpacing(0.12f);
        root.addView(badgeView);

        TextView msg = text(message, 18, 0xFFFFFFFF, true);
        LinearLayout.LayoutParams msgLp = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        msgLp.topMargin = dp(10);
        root.addView(msg, msgLp);

        LinearLayout.LayoutParams slotLp = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            0,
            1f
        );
        slotLp.topMargin = dp(16);
        slotLp.bottomMargin = dp(16);
        if (url != null && url.startsWith("http")) {
            WebView web = new WebView(activity);
            web.setBackgroundColor(0xFF111111);
            WebSettings settings = web.getSettings();
            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(true);
            web.setWebViewClient(new WebViewClient());
            web.loadUrl(url);
            root.addView(web, slotLp);
        } else {
            LinearLayout card = new LinearLayout(activity);
            card.setOrientation(LinearLayout.VERTICAL);
            card.setGravity(Gravity.CENTER);
            card.setBackgroundColor(0xFF161616);
            card.setPadding(pad, pad, pad, pad);
            card.addView(text("TheOGPirateBot", 22, 0xFFFFFFFF, true));
            TextView sub = text("Free movies, TV and anime. Ads stay in this screen.", 14, 0xFFA1A1AA, false);
            sub.setGravity(Gravity.CENTER);
            LinearLayout.LayoutParams subLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            );
            subLp.topMargin = dp(8);
            card.addView(sub, subLp);
            root.addView(card, slotLp);
        }

        TextView timer = text("", 13, 0xFFA1A1AA, false);
        root.addView(timer);

        Button skip = new Button(activity);
        skip.setText(skipAfter == 0 ? skipLabel : "Skip in " + skipAfter + "s");
        skip.setAllCaps(false);
        skip.setEnabled(skipAfter == 0);
        skip.setTextColor(0xFF111111);
        skip.setBackgroundColor(skipAfter == 0 ? 0xFFFFFFFF : 0xFF3F3F46);
        LinearLayout.LayoutParams skipLp = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(48)
        );
        skipLp.topMargin = dp(12);
        root.addView(skip, skipLp);

        Button support = new Button(activity);
        support.setText("Support instead");
        support.setAllCaps(false);
        support.setTextColor(0xFFFFFFFF);
        support.setBackgroundColor(0x00000000);
        root.addView(support);

        Dialog next = new Dialog(activity, android.R.style.Theme_Black_NoTitleBar_Fullscreen);
        next.setContentView(root);
        next.setCancelable(true);
        next.setOnCancelListener((d) -> finish(false, onClose, onReward));
        dialog = next;
        try {
            next.show();
        } catch (Exception ignored) {
            finish(false, onClose, onReward);
            return;
        }

        final int[] left = { total };
        Runnable tick = new Runnable() {
            @Override
            public void run() {
                if (!showing) return;
                int remain = left[0];
                int untilSkip = Math.max(0, skipAfter - (total - remain));
                timer.setText(remain + "s");
                if (untilSkip <= 0) {
                    skip.setEnabled(true);
                    skip.setText(skipLabel);
                    skip.setBackgroundColor(0xFFFFFFFF);
                    skip.setTextColor(0xFF111111);
                } else {
                    skip.setText("Skip in " + untilSkip + "s");
                }
                if (remain <= 0) {
                    finish(reward, onClose, onReward);
                    return;
                }
                left[0] = remain - 1;
                handler.postDelayed(this, 1000);
            }
        };
        tick.run();

        skip.setOnClickListener((v) -> {
            if (!skip.isEnabled()) return;
            finish(reward, onClose, onReward);
        });
        support.setOnClickListener((v) -> openSupport());
    }

    private void finish(boolean reward, Runnable onClose, Runnable onReward) {
        if (!showing) return;
        showing = false;
        handler.removeCallbacksAndMessages(null);
        try {
            if (dialog != null && dialog.isShowing()) dialog.dismiss();
        } catch (Exception ignored) {
            /* already gone */
        }
        dialog = null;
        if (reward) {
            grantReward();
            if (onReward != null) onReward.run();
        }
        if (onClose != null) onClose.run();
    }

    private void openSupport() {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(supportUrl()));
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
