package com.fumio.app;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.webkit.WebView;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.lang.ref.WeakReference;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONObject;

/**
 * Pull current embed hosts from the live site so a TLD change
 * (vidstuck.xyz → vidstuck.cc) does not need a new APK.
 *
 * Since 2026-10-28 the player itself loads the live site
 * (FumioPlayerOverlay.LIVE_ORIGIN), so this is no longer the only update
 * path — it keeps the BUNDLED / OFFLINE player pointing at living hosts, and
 * it is the one thing that still works when the site cannot be reached at
 * player-open time but was reachable earlier.
 */
final class LiveServers {

    private static final String SITE = "https://theogpiratebot.online/";
    private static final String PREFS = "ogpb_live_hosts";
    // Every host family the player can name. The live player is the default
    // now (FumioPlayerOverlay), so this scrape only feeds the OFFLINE copy —
    // but that copy is what a plane or a site outage falls back to, so a TLD
    // move must still reach it without a new APK.
    private static final Pattern HOST_IN_URL = Pattern.compile(
        "https?://(?:www\\.)?(vidstuck|zxcstream|vidfast|bingr|nxsha|tgvid|tgfrost|toonstream|megaplay|zokoanime|vidsrc|videasy|vidlink)\\.[A-Za-z0-9.-]+",
        Pattern.CASE_INSENSITIVE
    );
    private static final Pattern HOST_IN_QUOTES = Pattern.compile(
        "[\"'`]((?:www\\.)?(vidstuck|zxcstream|vidfast|bingr|nxsha|tgvid|tgfrost|toonstream|megaplay|zokoanime|vidsrc|videasy|vidlink)\\.[A-Za-z0-9.-]+)[\"'`]",
        Pattern.CASE_INSENSITIVE
    );
    private static final Pattern SCRIPT_SRC = Pattern.compile(
        "(?:src|href)=[\"'](/assets/[^\"']+\\.(?:js|mjs))[\"']",
        Pattern.CASE_INSENSITIVE
    );

    private static final JSONObject DEFAULTS = defaults();
    private static volatile JSONObject hosts = defaults();
    private static WeakReference<WebView> playerView;

    private LiveServers() {}

    static void load(Context context) {
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            String raw = prefs.getString("hosts", "");
            if (raw != null && raw.startsWith("{")) {
                JSONObject saved = new JSONObject(raw);
                merge(saved);
            }
        } catch (Exception ignored) {
            hosts = defaults();
        }
    }

    static void refresh(Activity activity, WebView live) {
        new Thread(
            () -> {
                try {
                    JSONObject found = scrape();
                    if (found != null && found.length() > 0) merge(found);
                    activity
                        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                        .edit()
                        .putString("hosts", hosts.toString())
                        .apply();
                } catch (Exception ignored) {
                    /* keep last known / defaults */
                }
                activity.runOnUiThread(() -> injectAll(live));
            },
            "ogpb-hosts"
        ).start();
    }

    static void bindPlayer(WebView view) {
        playerView = view == null ? null : new WeakReference<>(view);
        inject(view);
    }

    static void injectAll(WebView live) {
        inject(live);
        WeakReference<WebView> ref = playerView;
        inject(ref == null ? null : ref.get());
    }

    static void inject(WebView view) {
        if (view == null) return;
        String payload = hosts != null ? hosts.toString() : DEFAULTS.toString();
        view.evaluateJavascript(
            "(function(h){try{window.__fumioLiveHosts=h;window.dispatchEvent(new Event('fumio-live-hosts'));}catch(e){}})("
                + payload
                + ")",
            null
        );
    }

    private static JSONObject scrape() {
        JSONObject found = new JSONObject();
        String html = get(SITE);
        if (html == null || html.isEmpty()) return found;
        harvest(html, found);
        List<String> scripts = scriptUrls(html);
        int n = 0;
        for (String script : scripts) {
            if (n >= 6) break;
            String body = get(script);
            if (body == null || body.isEmpty()) continue;
            harvest(body, found);
            n += 1;
        }
        return found;
    }

    private static void harvest(String text, JSONObject found) {
        if (text == null) return;
        Matcher urls = HOST_IN_URL.matcher(text);
        while (urls.find()) remember(found, urls.group());
        Matcher quoted = HOST_IN_QUOTES.matcher(text);
        while (quoted.find()) remember(found, quoted.group(1));
    }

    private static void remember(JSONObject found, String raw) {
        if (raw == null) return;
        String host = raw.trim().toLowerCase(Locale.US);
        host = host.replace("https://", "").replace("http://", "");
        int slash = host.indexOf('/');
        if (slash >= 0) host = host.substring(0, slash);
        if (host.startsWith("www.")) host = host.substring(4);
        int dot = host.indexOf('.');
        if (dot <= 0) return;
        String family = host.substring(0, dot);
        try {
            found.put(family, host);
        } catch (Exception ignored) {
            /* JSONObject put of strings cannot fail */
        }
    }

    private static List<String> scriptUrls(String html) {
        List<String> out = new ArrayList<>();
        Matcher match = SCRIPT_SRC.matcher(html);
        while (match.find()) {
            String path = match.group(1);
            if (path == null) continue;
            out.add("https://theogpiratebot.online" + path);
        }
        return out;
    }

    private static String get(String url) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setInstanceFollowRedirects(true);
            conn.setConnectTimeout(12000);
            conn.setReadTimeout(18000);
            conn.setRequestMethod("GET");
            conn.setRequestProperty(
                "User-Agent",
                "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 TheOGPirateBot"
            );
            conn.setRequestProperty("Accept", "*/*");
            int code = conn.getResponseCode();
            InputStream stream = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
            if (stream == null || code >= 400) return "";
            StringBuilder body = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
                String line;
                int max = 1_500_000;
                while ((line = reader.readLine()) != null) {
                    if (body.length() > max) break;
                    body.append(line).append('\n');
                }
            }
            return body.toString();
        } catch (Exception ignored) {
            return "";
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static void merge(JSONObject extra) {
        if (extra == null) return;
        JSONObject next = defaults();
        copyInto(hosts, next);
        copyInto(extra, next);
        hosts = next;
    }

    private static void copyInto(JSONObject from, JSONObject into) {
        if (from == null) return;
        java.util.Iterator<String> keys = from.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            try {
                String value = from.optString(key, "");
                if (value != null && !value.isEmpty()) into.put(key, value);
            } catch (Exception ignored) {
                /* skip */
            }
        }
    }

    private static JSONObject defaults() {
        JSONObject out = new JSONObject();
        try {
            out.put("vidstuck", "vidstuck.cc");
            out.put("zxcstream", "zxcstream.cc");
        } catch (Exception ignored) {
            /* defaults */
        }
        return out;
    }
}
