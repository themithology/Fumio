package com.fumio.app;

import android.app.Activity;
import android.app.Dialog;
import android.content.Intent;
import android.graphics.Typeface;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.VideoView;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import org.xmlpull.v1.XmlPullParser;
import org.xmlpull.v1.XmlPullParserFactory;

/**
 * Contained VAST preroll. Plays one mp4, skip after a few seconds, then the
 * Fumio player. Clicks open Chrome. No extra windows, no reward unlock.
 */
final class FumioVast {

    private static final int MAX_WRAPPERS = 4;
    private static final int FETCH_MS = 8000;

    static void play(Activity activity, String vastUrl, int skipAfterSec, Runnable then, Runnable onCancel) {
        if (then == null) return;
        if (vastUrl == null || !vastUrl.startsWith("http")) {
            then.run();
            return;
        }
        Handler main = new Handler(Looper.getMainLooper());
        new Thread(
            () -> {
                Creative ad = resolve(vastUrl, 0);
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
        root.setBackgroundColor(0xFF000000);

        VideoView video = new VideoView(activity);
        FrameLayout.LayoutParams videoLp = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
            Gravity.CENTER
        );
        root.addView(video, videoLp);

        TextView badge = new TextView(activity);
        badge.setText("Ad");
        badge.setTextColor(0xFFD4D4D8);
        badge.setTextSize(11);
        badge.setTypeface(Typeface.SANS_SERIF, Typeface.BOLD);
        badge.setPadding(dp(activity, 14), dp(activity, 12), dp(activity, 14), dp(activity, 8));
        root.addView(
            badge,
            new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
                Gravity.TOP | Gravity.START
            )
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
        root.addView(skip, skipLp);

        Dialog dialog = new Dialog(activity, android.R.style.Theme_Black_NoTitleBar_Fullscreen);
        dialog.setContentView(root);
        dialog.setCancelable(true);

        final boolean[] done = { false };
        Handler handler = new Handler(Looper.getMainLooper());
        Runnable finish = () -> {
            if (done[0]) return;
            done[0] = true;
            handler.removeCallbacksAndMessages(null);
            try {
                video.stopPlayback();
            } catch (Exception ignored) {
                /* already stopped */
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
                video.stopPlayback();
            } catch (Exception ignored) {
                /* already stopped */
            }
            try {
                if (dialog.isShowing()) dialog.dismiss();
            } catch (Exception ignored) {
                /* already gone */
            }
            if (onCancel != null) onCancel.run();
        };

        dialog.setOnCancelListener((d) -> cancel.run());
        skip.setOnClickListener((v) -> {
            if (skip.isEnabled()) finish.run();
        });
        video.setOnClickListener((v) -> openChrome(activity, ad.clickThrough));

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

        video.setOnPreparedListener((MediaPlayer player) -> {
            try {
                player.setLooping(false);
                player.start();
            } catch (Exception ignored) {
                finish.run();
                return;
            }
            fire(ad.impressions);
            tick.run();
        });
        video.setOnCompletionListener((MediaPlayer player) -> finish.run());
        video.setOnErrorListener((mp, what, extra) -> {
            finish.run();
            return true;
        });

        try {
            dialog.show();
            video.setVideoURI(Uri.parse(ad.mediaUrl));
        } catch (Exception ignored) {
            if (done[0]) return;
            done[0] = true;
            try {
                if (dialog.isShowing()) dialog.dismiss();
            } catch (Exception ignored2) {
                /* already gone */
            }
            then.run();
        }
    }

    private static Creative resolve(String url, int depth) {
        if (url == null || url.isEmpty() || depth > MAX_WRAPPERS) return null;
        String xml = get(url);
        if (xml == null || xml.isEmpty()) return null;
        Creative parsed = parse(xml);
        if (parsed == null) return null;
        if (parsed.wrapperUrl != null && !parsed.wrapperUrl.isEmpty()) {
            Creative inner = resolve(parsed.wrapperUrl, depth + 1);
            if (inner == null) return null;
            inner.impressions.addAll(parsed.impressions);
            if (inner.clickThrough == null || inner.clickThrough.isEmpty()) {
                inner.clickThrough = parsed.clickThrough;
            }
            return inner;
        }
        return parsed.mediaUrl == null || parsed.mediaUrl.isEmpty() ? null : parsed;
    }

    private static Creative parse(String xml) {
        Creative out = new Creative();
        try {
            XmlPullParserFactory factory = XmlPullParserFactory.newInstance();
            factory.setNamespaceAware(false);
            XmlPullParser parser = factory.newPullParser();
            parser.setInput(new java.io.StringReader(xml));
            String tag = "";
            int bestH = -1;
            int event = parser.getEventType();
            while (event != XmlPullParser.END_DOCUMENT) {
                if (event == XmlPullParser.START_TAG) {
                    tag = parser.getName() == null ? "" : parser.getName();
                    if ("MediaFile".equalsIgnoreCase(tag)) {
                        String type = attr(parser, "type");
                        int height = intAttr(parser, "height");
                        String text = parser.nextText();
                        String src = text == null ? "" : text.trim();
                        if (isMp4(type, src) && height >= bestH) {
                            bestH = height;
                            out.mediaUrl = src;
                        }
                    }
                } else if (event == XmlPullParser.TEXT) {
                    String text = parser.getText() == null ? "" : parser.getText().trim();
                    if (!text.isEmpty()) {
                        if ("Impression".equalsIgnoreCase(tag) && text.startsWith("http")) {
                            out.impressions.add(text);
                        } else if ("ClickThrough".equalsIgnoreCase(tag) && text.startsWith("http")) {
                            out.clickThrough = text;
                        } else if ("VASTAdTagURI".equalsIgnoreCase(tag) && text.startsWith("http")) {
                            out.wrapperUrl = text;
                        }
                    }
                } else if (event == XmlPullParser.END_TAG) {
                    tag = "";
                }
                event = parser.next();
            }
        } catch (Exception ignored) {
            return out.mediaUrl == null && out.wrapperUrl == null ? null : out;
        }
        return out;
    }

    private static boolean isMp4(String type, String src) {
        String t = type == null ? "" : type.toLowerCase();
        String s = src == null ? "" : src.toLowerCase();
        if (t.contains("javascript") || t.contains("vpaid") || s.contains("vpaid")) return false;
        return t.contains("mp4") || s.contains(".mp4") || t.contains("webm") || s.contains(".webm");
    }

    private static String attr(XmlPullParser parser, String name) {
        String value = parser.getAttributeValue(null, name);
        return value == null ? "" : value;
    }

    private static int intAttr(XmlPullParser parser, String name) {
        try {
            return Integer.parseInt(attr(parser, name));
        } catch (Exception ignored) {
            return 0;
        }
    }

    private static String get(String url) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setConnectTimeout(FETCH_MS);
            conn.setReadTimeout(FETCH_MS);
            conn.setInstanceFollowRedirects(true);
            conn.setRequestProperty(
                "User-Agent",
                "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36"
            );
            conn.setRequestProperty("Accept", "application/xml,text/xml,*/*");
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
