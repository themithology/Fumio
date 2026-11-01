package com.fumio.app;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The LIVE server list — the whole point of the app's player.
 *
 * The player surface is the app's own (bundled UI: its iframe, its picker, its
 * look). What must never be hardcoded is WHICH servers exist, what they are
 * called, in what order, and what embed URL each one uses. Those live in the
 * website, because that is the thing the owner updates.
 *
 * Two ways to get them, in order of cost:
 *
 *   1. GET /api/players?id=&type=&season=&episode=   (the cheap path)
 *      A tiny JSON contract the site can add at any time. When it answers,
 *      nothing else runs — one request, ~50 ms.
 *
 *   2. HARVEST the site's own player page (the path that works TODAY)
 *      A hidden WebView opens /player?…, waits for React, then clicks each
 *      "Server N (…)" button and records the iframe URL that appears. What it
 *      collects IS what the website would play, names included — so a rename,
 *      a reorder, a new host or a removed server all show up in the app
 *      without an APK release.
 *
 * Results are cached per title+episode (CACHE_TTL_MS) so opening the same
 * episode twice costs nothing, and a failed fetch never blocks playback: the
 * caller falls back to the bundled list exactly as before.
 */
final class LiveSourceSync {

    interface Callback {
        /** Normalised JSON array, or null when nothing could be fetched. */
        void onSources(String json);
    }

    /** The site's optional cheap contract (see docs/iris-players-endpoint.md). */
    private static final String ENDPOINT = "https://theogpiratebot.online/api/players";
    private static final String PLAYER_PAGE = "https://theogpiratebot.online/player";

    private static final String PREFS = "ogpb_live_sources";
    private static final long CACHE_TTL_MS = 6 * 60 * 60 * 1000L;
    private static final long ENDPOINT_TIMEOUT_MS = 4000;
    private static final long HARVEST_TIMEOUT_MS = 22000;

    private static final Handler MAIN = new Handler(Looper.getMainLooper());

    private LiveSourceSync() {}

    // ─── public entry point ──────────────────────────────────────────────────

    static void fetch(
        Activity activity,
        String id,
        String type,
        String season,
        String episode,
        Callback callback
    ) {
        if (id == null || id.isEmpty()) {
            callback.onSources(null);
            return;
        }
        String key = cacheKey(id, type, season, episode);
        String cached = readCache(activity, key);
        if (cached != null) {
            callback.onSources(cached);
            return;
        }
        // 1) the cheap endpoint, off the UI thread
        new Thread(
            () -> {
                String json = fromEndpoint(id, type, season, episode);
                if (json != null) {
                    writeCache(activity, key, json);
                    MAIN.post(() -> callback.onSources(json));
                    return;
                }
                // 2) harvest the site's own player page
                MAIN.post(() -> harvest(activity, id, type, season, episode, key, callback));
            },
            "ogpb-sources"
        ).start();
    }

    /** The last successful harvest for any episode of this title (instant start). */
    static String cachedFor(Context context, String id, String type, String season, String episode) {
        return readCache(context, cacheKey(id, type, season, episode));
    }

    private static String cacheKey(String id, String type, String season, String episode) {
        return (type == null ? "tv" : type) + "|" + id + "|" + (season == null ? "1" : season) + "|" + (episode == null ? "1" : episode);
    }

    // ─── 1. the endpoint ─────────────────────────────────────────────────────

    /**
     * Accepts either
     *   { "servers": [{ "key", "label", "url" }, …] }
     * or a bare array of the same objects. Anything else is "no answer".
     */
    private static String fromEndpoint(String id, String type, String season, String episode) {
        try {
            String url = ENDPOINT
                + "?id=" + android.net.Uri.encode(id)
                + "&type=" + android.net.Uri.encode(type == null ? "tv" : type)
                + "&season=" + android.net.Uri.encode(season == null ? "1" : season)
                + "&episode=" + android.net.Uri.encode(episode == null ? "1" : episode);
            JSONObject result = NativeHttp.execute("GET", url, "{\"Accept\":\"application/json\"}", null);
            if (result == null || !result.optBoolean("ok", false)) return null;
            Object data = result.opt("data");
            JSONArray servers = null;
            if (data instanceof JSONObject) servers = ((JSONObject) data).optJSONArray("servers");
            else if (data instanceof JSONArray) servers = (JSONArray) data;
            if (servers == null) return null;
            return normalise(servers);
        } catch (Exception ignored) {
            return null;
        }
    }

    /** {key,label,url} only — the shape the player UI understands. */
    private static String normalise(JSONArray raw) {
        JSONArray out = new JSONArray();
        for (int i = 0; i < raw.length(); i += 1) {
            JSONObject row = raw.optJSONObject(i);
            if (row == null) continue;
            String url = row.optString("url", "");
            if (url.isEmpty() || !url.startsWith("http")) continue;
            String key = row.optString("key", "");
            if (key.isEmpty()) key = "server-" + (i + 1);
            String label = row.optString("label", "");
            if (label.isEmpty()) label = row.optString("name", "");
            if (label.isEmpty()) label = "Server " + (i + 1);
            try {
                JSONObject clean = new JSONObject();
                clean.put("key", key);
                clean.put("label", label);
                clean.put("url", url);
                clean.put("quality", row.optString("quality", ""));
                clean.put("index", i);
                out.put(clean);
            } catch (Exception ignored) {
                /* one bad row must not lose the list */
            }
        }
        return out.length() == 0 ? null : out.toString();
    }

    // ─── 2. harvest the site's player page ───────────────────────────────────

    private static void harvest(
        Activity activity,
        String id,
        String type,
        String season,
        String episode,
        String key,
        Callback callback
    ) {
        if (activity == null || activity.isFinishing()) {
            callback.onSources(null);
            return;
        }
        final WebView view = new WebView(activity);
        final boolean[] settled = { false };

        FrameLayout holder = new FrameLayout(activity);
        holder.addView(
            view,
            new FrameLayout.LayoutParams(1, 1)
        );
        holder.setAlpha(0f);
        try {
            ViewGroup content = activity.findViewById(android.R.id.content);
            if (content != null) {
                content.addView(
                    holder,
                    new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                );
            }
        } catch (Exception ignored) {
            /* harvesting still works unattached on most devices */
        }

        final Runnable[] cleanup = new Runnable[1];
        cleanup[0] = () -> {
            try {
                if (holder.getParent() instanceof ViewGroup) {
                    ((ViewGroup) holder.getParent()).removeView(holder);
                }
                view.destroy();
            } catch (Exception ignored) {
                /* already gone */
            }
        };

        Runnable deliver = () -> {
            if (settled[0]) return;
            settled[0] = true;
            cleanup[0].run();
            callback.onSources(null);
        };
        Runnable timer = deliver;
        MAIN.postDelayed(timer, HARVEST_TIMEOUT_MS);

        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setUserAgentString(
            settings.getUserAgentString().replace("; wv", "").replace("Version/4.0 ", "")
        );

        view.setWebViewClient(
            new WebViewClient() {
                @Override
                public void onPageStarted(WebView v, String url, Bitmap favicon) {
                    /* nothing */
                }

                @Override
                public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest request) {
                    // Harvesting must never navigate away (ads, popunders).
                    return false;
                }

                @Override
                public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest request) {
                    return super.shouldInterceptRequest(v, request);
                }

                @Override
                public void onPageFinished(WebView v, String url) {
                    if (settled[0]) return;
                    v.evaluateJavascript(HARVEST_JS, null);
                }
            }
        );
        view.setWebChromeClient(
            new WebChromeClient() {
                @Override
                public boolean onCreateWindow(WebView v, boolean isDialog, boolean isUserGesture, android.os.Message resultMsg) {
                    // An ad trying to open a window during the harvest: drop it.
                    return false;
                }
            }
        );
        view.addJavascriptInterface(
            new Object() {
                @JavascriptInterface
                public void deliver(String raw) {
                    if (raw == null || raw.isEmpty()) {
                        MAIN.post(deliver);
                        return;
                    }
                    String normalised = null;
                    try {
                        normalised = normalise(new JSONArray(raw));
                    } catch (Exception ignored) {
                        normalised = null;
                    }
                    final String result = normalised;
                    MAIN.post(
                        () -> {
                            if (settled[0]) return;
                            settled[0] = true;
                            MAIN.removeCallbacks(timer);
                            cleanup[0].run();
                            if (result != null) writeCache(activity, key, result);
                            callback.onSources(result);
                        }
                    );
                }
            },
            "FumioHarvest"
        );

        view.loadUrl(
            PLAYER_PAGE
                + "?id=" + android.net.Uri.encode(id)
                + "&type=" + android.net.Uri.encode(type == null ? "tv" : type)
                + (("movie".equalsIgnoreCase(type)) ? "" : "&season=" + android.net.Uri.encode(season == null ? "1" : season)
                    + "&episode=" + android.net.Uri.encode(episode == null ? "1" : episode))
        );
    }

    /**
     * Runs inside the site's player page.
     *
     * It does not know any host or any slot: it finds the buttons the site
     * itself renders ("Server N (…)"), clicks each one, and records the iframe
     * URL the site then plays. Rename → label changes; reorder → index changes;
     * new host → URL changes. Nothing here needs updating when the site does.
     */
    private static final String HARVEST_JS =
        "(async function(){"
            + "var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms);});};"
            + "var report=function(list){try{FumioHarvest.deliver(JSON.stringify(list||[]));}catch(e){}};"
            + "var buttons=function(){var all=document.querySelectorAll('button');var out=[];"
            + "for(var i=0;i<all.length;i++){var t=(all[i].textContent||'').replace(/\\s+/g,' ').trim();"
            + "if(/^Server\\s+\\d+/i.test(t)&&!all[i].disabled)out.push(all[i]);}return out;};"
            + "var frame=function(){var f=document.querySelector('iframe[src]');return f?f.src:'';};"
            + "for(var w=0;w<60&&buttons().length===0;w++){await sleep(250);}"
            + "var first=buttons();"
            + "if(!first.length){report([]);return;}"
            + "var out=[];"
            + "for(var i=0;i<first.length;i++){"
            + "  var list=buttons();var b=list[i];if(!b)continue;"
            + "  var label=(b.textContent||'').replace(/\\s+/g,' ').trim();"
            + "  var before=frame();"
            + "  try{b.click();}catch(e){continue;}"
            + "  var src=before;"
            + "  for(var k=0;k<40;k++){await sleep(150);var now=frame();"
            + "    if(now&&now!==before){src=now;break;}"
            + "    if(k===20&&now&&!src){src=now;}}"
            + "  if(src&&src.indexOf('http')===0){"
            + "    var key=label.replace(/^Server\\s+\\d+\\s*/i,'').replace(/[()]/g,'').trim()||('server-'+i);"
            + "    out.push({key:key,label:label,url:src,index:i});}"
            + "}"
            + "report(out);"
            + "})();";

    // ─── cache ───────────────────────────────────────────────────────────────

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static String readCache(Context context, String key) {
        if (context == null) return null;
        try {
            String stamp = prefs(context).getString(key + ":at", "");
            long at = stamp.isEmpty() ? 0 : Long.parseLong(stamp);
            if (at <= 0 || System.currentTimeMillis() - at > CACHE_TTL_MS) return null;
            String json = prefs(context).getString(key, "");
            if (json == null || json.isEmpty() || json.equals("[]")) return null;
            return json;
        } catch (Exception ignored) {
            return null;
        }
    }

    private static void writeCache(Context context, String key, String json) {
        if (context == null || json == null || json.isEmpty()) return;
        try {
            prefs(context).edit()
                .putString(key, json)
                .putString(key + ":at", String.valueOf(System.currentTimeMillis()))
                .apply();
        } catch (Exception ignored) {
            /* playback still works */
        }
    }
}
