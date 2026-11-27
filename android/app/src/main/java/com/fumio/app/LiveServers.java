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
 * The embed hosts, learned from the site instead of compiled into the APK.
 *
 * The site renames providers constantly — vidstuck.xyz → vidstuck.cc →
 * 0vidads.top in three weeks, TGVID moved to tgvidx.lovable.app, and its Server
 * 1 is now our own embed at embed.theogpiratebot.to. Every one of those used to
 * need a new APK.
 *
 * There is a proper contract for this, so it is used first:
 *
 *   GET /api/players?type=movie&id=550   →   { servers: [{ key, label, url }] }
 *
 * `url` is the LIVE embed URL for that slot, which is what the app actually
 * needs to recognise a player when it sees one. This class harvests the host out
 * of each of those URLs and keeps them, so a provider that moves is a data
 * change on the web.
 *
 * The old HTML scrape stays as the SECOND tier, because it works before any
 * manifest exists (the first launch, and the offline player) and it is cheaper
 * than a manifest request per title. It is no longer the only source, and its
 * host families are no longer a hardcoded whitelist — anything shaped like a
 * provider host is remembered.
 */
final class LiveServers {

    private static final String SITE = "https://theogpiratebot.online/";
    private static final String PREFS = "ogpb_live_hosts";
    // Every host family the player can name. The live player is the default
    // now (FumioPlayerOverlay), so this scrape only feeds the OFFLINE copy —
    // but that copy is what a plane or a site outage falls back to, so a TLD
    // move must still reach it without a new APK.
    /*
     * SHAPE, NOT NAMES. These used to be a literal list of provider brands, so
     * a new one was invisible until an APK shipped. A provider host is now
     * recognised by where it appears (an embed path) rather than by what it is
     * called, which is the whole point of learning instead of hardcoding.
     */
    private static final Pattern HOST_IN_URL = Pattern.compile(
        "https?://(?:www\\.)?([a-z0-9-]+(?:\\.[a-z0-9-]+)+)(?::\\d+)?/(?:embed|player|watch|stream)/",
        Pattern.CASE_INSENSITIVE
    );
    private static final Pattern HOST_IN_QUOTES = Pattern.compile(
        "[\"'`](?:https?://)?((?:www\\.)?[a-z0-9-]+(?:\\.[a-z0-9-]+)+)(?::\\d+)?/(?:embed|player|watch|stream)/",
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

    /**
     * The canonical source, when it answers: the site's own player manifest.
     *
     * One request. Any id works — the route resolves the title itself, and the
     * host list is the same for every title, so this does not need to know what
     * the viewer is about to watch.
     */
    private static JSONObject manifest() {
        JSONObject found = new JSONObject();
        String body = get(SITE + "api/players?type=movie&id=550");
        if (body == null || body.isEmpty()) return found;
        try {
            JSONObject json = new JSONObject(body);
            org.json.JSONArray servers = json.optJSONArray("servers");
            if (servers == null) return found;
            for (int i = 0; i < servers.length(); i += 1) {
                JSONObject slot = servers.optJSONObject(i);
                if (slot == null) continue;
                rememberUrl(found, slot.optString("url", ""));
            }
        } catch (Exception notJson) {
            /* the scrape tier will try the same origin */
        }
        return found;
    }

    private static JSONObject scrape() {
        JSONObject found = manifest();
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

    /**
     * Remember the host of an embed URL the site handed us.
     *
     * Unlike {@link #remember}, this takes a whole URL rather than trusting the
     * caller to have extracted a host, and it keeps the FULL host — TGVID lives
     * at <name>.lovable.app, so keeping only the first label would record
     * "tgvidx" and match nothing.
     */
    private static void rememberUrl(JSONObject found, String raw) {
        if (raw == null) return;
        String host = raw.trim().toLowerCase(Locale.US);
        int scheme = host.indexOf("://");
        if (scheme >= 0) host = host.substring(scheme + 3);
        int slash = host.indexOf('/');
        if (slash >= 0) host = host.substring(0, slash);
        int colon = host.indexOf(':');
        if (colon >= 0) host = host.substring(0, colon);
        if (host.startsWith("www.")) host = host.substring(4);
        if (host.indexOf('.') <= 0) return;
        try {
            found.put(host, host);
        } catch (Exception ignored) {
            /* JSONObject put of strings cannot fail */
        }
    }

    /**
     * Is this host one the site has published an embed on?
     *
     * Matched as a SUFFIX of the host so a subdomain (cdn., www., a numbered
     * shard) still counts, and so the full host is what is stored.
     */
    static boolean isKnownHost(String host) {
        if (host == null || host.isEmpty()) return false;
        String target = host.toLowerCase(Locale.US);
        java.util.Iterator<String> keys = hosts.keys();
        while (keys.hasNext()) {
            String known = keys.next();
            if (known.isEmpty()) continue;
            if (target.equals(known) || target.endsWith("." + known)) return true;
        }
        // The bundle's own defaults are always trusted, even before any fetch.
        keys = DEFAULTS.keys();
        while (keys.hasNext()) {
            String known = keys.next();
            if (known.isEmpty()) continue;
            if (target.equals(known) || target.endsWith("." + known)) return true;
        }
        return false;
    }

    private static void remember(JSONObject found, String raw) {
        if (raw == null) return;
        String host = raw.trim().toLowerCase(Locale.US);
        host = host.replace("https://", "").replace("http://", "");
        int slash = host.indexOf('/');
        if (slash >= 0) host = host.substring(0, slash);
        if (host.startsWith("www.")) host = host.substring(4);
        if (host.indexOf('.') <= 0) return;
        try {
            found.put(host, host);
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

    /**
     * The only hosts known before any network call has ever succeeded.
     *
     * Kept to the two that a first launch genuinely needs: our own embed (Server
     * 1 in both lanes, and the one the app is most likely to meet first) and one
     * third-party, so the offline player has something to compare against.
     * Everything else is learned — see {@link #manifest()}.
     */
    private static JSONObject defaults() {
        JSONObject out = new JSONObject();
        try {
            out.put("embed.theogpiratebot.to", "embed.theogpiratebot.to");
            out.put("0vidads.top", "0vidads.top");
        } catch (Exception ignored) {
            /* defaults */
        }
        return out;
    }
}
