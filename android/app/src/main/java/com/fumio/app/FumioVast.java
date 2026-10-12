package com.fumio.app;

import android.app.Activity;
import android.app.Dialog;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.TextView;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Contained VAST preroll. Fetch XML, play the mp4 in a WebView, skip after a
 * few seconds, then the Fumio player. Clicks open Chrome. No extra windows.
 */
final class FumioVast {

    private static final int MAX_WRAPPERS = 2;
    private static final int FETCH_MS = 4000;
    private static final String UA =
        "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36";
    private static final String REFERER = "https://theogpiratebot.online/";
    private static final Pattern MEDIA_FILE = Pattern.compile(
        "(?is)<MediaFile([^>]*)>\\s*(?:<!\\[CDATA\\[)?\\s*(https?://[^\\s\\]<]+)"
    );
    private static final Pattern WRAPPER = Pattern.compile(
        "(?is)<VASTAdTagURI[^>]*>\\s*(?:<!\\[CDATA\\[)?\\s*(https?://[^\\s\\]<]+)"
    );
    private static final Pattern IMPRESSION = Pattern.compile(
        "(?is)<Impression[^>]*>\\s*(?:<!\\[CDATA\\[)?\\s*(https?://[^\\s\\]<]+)"
    );
    private static final Pattern CLICK = Pattern.compile(
        "(?is)<ClickThrough[^>]*>\\s*(?:<!\\[CDATA\\[)?\\s*(https?://[^\\s\\]<]+)"
    );

    static void play(Activity activity, String vastUrl, int skipAfterSec, Runnable then, Runnable onCancel) {
        if (then == null) return;
        if (vastUrl == null || !vastUrl.startsWith("http")) {
            then.run();
            return;
        }
        Handler main = new Handler(Looper.getMainLooper());
        new Thread(
            () -> {
                Creative ad = resolve(bust(vastUrl), 0);
                main.post(() -> {
                    if (activity.isFinishing() || activity.isDestroyed()) return;
                    if (ad == null || ad.mediaUrl == null || ad.mediaUrl.isEmpty()) {
                        then.run();
                        return;
                    }
                    show(activity, ad, Math.max(3, skipAfterSec), then, onCancel);
                });
            },
            "fumio-vast"
        ).start();
    }

    private static void show(
        Activity activity,
        Creative ad,
        int skipAfter,
        Runnable then,
        Runnable onCancel
    ) {
        FrameLayout root = new FrameLayout(activity);
        root.setBackgroundColor(Color.BLACK);

        WebView web = new WebView(activity);
        web.setBackgroundColor(Color.BLACK);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setUserAgentString(UA);
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(
            new WebViewClient() {
                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    if (request == null || request.getUrl() == null) return true;
                    if (!request.isForMainFrame()) return false;
                    openChrome(activity, request.getUrl().toString());
                    return true;
                }
            }
        );

        Button skip = new Button(activity);
        skip.setAllCaps(false);
        skip.setEnabled(false);
        skip.setText("Skip in " + skipAfter + "s");
        skip.setTextColor(0xFFA1A1AA);
        skip.setBackgroundColor(0xCC27272A);
        FrameLayout.LayoutParams skipLp = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            dp(activity, 40),
            Gravity.TOP | Gravity.END
        );
        skipLp.topMargin = dp(activity, 10);
        skipLp.rightMargin = dp(activity, 10);

        TextView badge = new TextView(activity);
        badge.setText("Ad");
        badge.setTextColor(0xFFD4D4D8);
        badge.setTextSize(11);
        badge.setTypeface(Typeface.SANS_SERIF, Typeface.BOLD);
        badge.setPadding(dp(activity, 14), dp(activity, 12), dp(activity, 14), dp(activity, 8));

        Dialog dialog = new Dialog(activity, android.R.style.Theme_Black_NoTitleBar_Fullscreen);
        Window window = dialog.getWindow();
        if (window != null) SystemBars.hide(window);
        SystemBars.hide(activity.getWindow());
        dialog.setContentView(root);
        dialog.setCancelable(true);

        final boolean[] done = { false };
        Handler handler = new Handler(Looper.getMainLooper());
        Runnable finish = () -> {
            if (done[0]) return;
            done[0] = true;
            handler.removeCallbacksAndMessages(null);
            try {
                web.loadUrl("about:blank");
                web.destroy();
            } catch (Exception ignored) {
                /* already gone */
            }
            try {
                if (dialog.isShowing()) dialog.dismiss();
            } catch (Exception ignored) {
                /* already gone */
            }
            then.run();
        };
        Runnable cancel = () -> {
            if (done[0]) return;
            done[0] = true;
            handler.removeCallbacksAndMessages(null);
            try {
                web.loadUrl("about:blank");
                web.destroy();
            } catch (Exception ignored) {
                /* already gone */
            }
            try {
                if (dialog.isShowing()) dialog.dismiss();
            } catch (Exception ignored) {
                /* already gone */
            }
            if (onCancel != null) onCancel.run();
        };

        web.addJavascriptInterface(
            new Object() {
                @JavascriptInterface
                public void ended() {
                    handler.post(finish);
                }

                @JavascriptInterface
                public void failed() {
                    handler.post(finish);
                }

                @JavascriptInterface
                public void click() {
                    handler.post(() -> openChrome(activity, ad.clickThrough));
                }
            },
            "Fumio"
        );

        dialog.setOnCancelListener((d) -> cancel.run());
        skip.setOnClickListener((v) -> {
            if (skip.isEnabled()) finish.run();
        });

        final int[] left = { skipAfter };
        Runnable tick = new Runnable() {
            @Override
            public void run() {
                if (done[0]) return;
                if (left[0] <= 0) {
                    skip.setEnabled(true);
                    skip.setText("Skip ad");
                    skip.setTextColor(0xFFFFFFFF);
                    skip.setBackgroundColor(0xCC52525B);
                    return;
                }
                skip.setText("Skip in " + left[0] + "s");
                left[0] -= 1;
                handler.postDelayed(this, 1000);
            }
        };

        root.addView(
            web,
            new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        );
        root.addView(
            badge,
            new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
                Gravity.TOP | Gravity.START
            )
        );
        root.addView(skip, skipLp);

        try {
            dialog.show();
            web.loadDataWithBaseURL(REFERER, playerHtml(ad.mediaUrl), "text/html", "utf-8", null);
            fire(ad.impressions);
            tick.run();
            handler.postDelayed(finish, 12_000);
        } catch (Exception ignored) {
            finish.run();
        }
    }

    private static String playerHtml(String src) {
        return "<!doctype html><html><head><meta charset=\"utf-8\">"
            + "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
            + "<style>html,body{margin:0;background:#000;height:100%;overflow:hidden}"
            + "video{width:100%;height:100%;object-fit:contain;background:#000}</style></head>"
            + "<body><video id=\"v\" autoplay playsinline webkit-playsinline></video>"
            + "<script>(function(){var v=document.getElementById('v');"
            + "v.src="
            + json(src)
            + ";"
            + "v.addEventListener('ended',function(){try{Fumio.ended()}catch(e){}});"
            + "v.addEventListener('error',function(){try{Fumio.failed()}catch(e){}});"
            + "v.addEventListener('click',function(){try{Fumio.click()}catch(e){}});"
            + "var p=v.play();if(p&&p.catch)p.catch(function(){try{Fumio.failed()}catch(e){}});"
            + "})();</script></body></html>";
    }

    private static String json(String value) {
        if (value == null) return "\"\"";
        return "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
    }

    private static Creative resolve(String url, int depth) {
        if (url == null || url.isEmpty() || depth > MAX_WRAPPERS) return null;
        String xml = get(url);
        if (xml == null || xml.isEmpty() || !xml.contains("VAST")) return null;
        Creative parsed = parse(xml);
        if (parsed.wrapperUrl != null && !parsed.wrapperUrl.isEmpty()) {
            Creative inner = resolve(parsed.wrapperUrl, depth + 1);
            if (inner == null) return parsed.mediaUrl == null ? null : parsed;
            inner.impressions.addAll(0, parsed.impressions);
            if (inner.clickThrough == null || inner.clickThrough.isEmpty()) {
                inner.clickThrough = parsed.clickThrough;
            }
            return inner;
        }
        return parsed.mediaUrl == null || parsed.mediaUrl.isEmpty() ? null : parsed;
    }

    private static Creative parse(String xml) {
        Creative out = new Creative();
        Matcher wrap = WRAPPER.matcher(xml);
        if (wrap.find()) out.wrapperUrl = clean(wrap.group(1));
        Matcher click = CLICK.matcher(xml);
        if (click.find()) out.clickThrough = clean(click.group(1));
        Matcher imp = IMPRESSION.matcher(xml);
        while (imp.find()) {
            String href = clean(imp.group(1));
            if (href.startsWith("http")) out.impressions.add(href);
        }
        Matcher media = MEDIA_FILE.matcher(xml);
        int best = -1;
        while (media.find()) {
            String attrs = media.group(1) == null ? "" : media.group(1).toLowerCase();
            String src = clean(media.group(2));
            if (src.isEmpty() || attrs.contains("vpaid") || attrs.contains("javascript")) continue;
            if (!looksLikeVideo(attrs, src)) continue;
            int height = 0;
            Matcher h = Pattern.compile("height\\s*=\\s*\"(\\d+)\"").matcher(attrs);
            if (h.find()) {
                try {
                    height = Integer.parseInt(h.group(1));
                } catch (Exception ignored) {
                    height = 0;
                }
            }
            boolean mp4 = attrs.contains("mp4") || src.toLowerCase().contains(".mp4");
            int score = height + (mp4 ? 10000 : 0);
            if (score >= best) {
                best = score;
                out.mediaUrl = src;
            }
        }
        return out;
    }

    private static boolean looksLikeVideo(String attrs, String src) {
        String a = attrs == null ? "" : attrs;
        String s = src == null ? "" : src.toLowerCase();
        if (a.contains("javascript") || a.contains("vpaid") || s.contains("vpaid")) return false;
        if (a.contains("video/") || s.contains(".mp4") || s.contains(".webm") || s.contains(".m3u8")) {
            return true;
        }
        return s.startsWith("http") && !s.contains(".js");
    }

    private static String clean(String value) {
        if (value == null) return "";
        return value.replace("]]>", "").trim();
    }

    private static String bust(String url) {
        if (url.contains("cb=")) return url;
        return url + (url.contains("?") ? "&" : "?") + "cb=" + System.currentTimeMillis();
    }

    private static String get(String url) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setConnectTimeout(FETCH_MS);
            conn.setReadTimeout(FETCH_MS);
            conn.setInstanceFollowRedirects(true);
            conn.setRequestProperty("User-Agent", UA);
            conn.setRequestProperty("Accept", "application/xml,text/xml,application/vast+xml,*/*");
            conn.setRequestProperty("Accept-Encoding", "identity");
            conn.setRequestProperty("Referer", REFERER);
            int code = conn.getResponseCode();
            InputStream stream = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
            if (stream == null || code >= 400) return null;
            BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8));
            StringBuilder body = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) body.append(line).append('\n');
            return body.toString();
        } catch (Exception ignored) {
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static void fire(List<String> urls) {
        if (urls == null) return;
        for (String url : urls) {
            if (url == null || !url.startsWith("http")) continue;
            new Thread(() -> get(url), "fumio-vast-imp").start();
        }
    }

    private static void openChrome(Activity activity, String url) {
        if (url == null || !url.startsWith("http")) return;
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity.startActivity(intent);
        } catch (Exception ignored) {
            /* no browser */
        }
    }

    private static int dp(Activity activity, int value) {
        return Math.round(value * activity.getResources().getDisplayMetrics().density);
    }

    private static final class Creative {
        String mediaUrl;
        String clickThrough;
        String wrapperUrl;
        final List<String> impressions = new ArrayList<>();
    }
}
