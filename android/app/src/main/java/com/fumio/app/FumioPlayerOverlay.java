package com.fumio.app;

import android.app.Activity;
import android.app.Dialog;
import android.content.pm.ActivityInfo;
import android.content.res.AssetManager;
import android.net.Uri;
import android.os.Build;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import androidx.webkit.WebViewAssetLoader;
import java.io.InputStream;
import org.json.JSONObject;
import org.json.JSONTokener;

/** Fullscreen copy of the bundled Fumio player — the live site WebView stays put. */
final class FumioPlayerOverlay {

    interface Host {
        void onPlayerClosed(String continueWatching);
    }

    private static final String AUTH_KEY = "firebase:authUser:AIzaSyDapNgnKdO8l_t7BJPCO8IsbL73aILA1cI:[DEFAULT]";

    private final Activity activity;
    private final Host host;
    private Dialog dialog;
    private FrameLayout root;
    private WebView webView;
    private View customView;
    private WebChromeClient.CustomViewCallback customCallback;
    private int previousOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;
    private String pendingSeed;
    private boolean closing;
    private boolean closedOut;

    FumioPlayerOverlay(Activity activity, Host host) {
        this.activity = activity;
        this.host = host;
    }

    boolean isShowing() {
        return dialog != null && dialog.isShowing();
    }

    void open(String type, String id, String season, String episode) {
        open(type, id, season, episode, null);
    }

    void open(String type, String id, String season, String episode, String seed) {
        if (id == null || id.isEmpty()) return;
        closing = false;
        closedOut = false;
        pendingSeed = seed;
        String media = "movie".equalsIgnoreCase(type) ? "movie" : "tv";
        StringBuilder path = new StringBuilder("/watch/").append(media).append("/").append(id);
        if (!"movie".equals(media)) {
            path.append("?season=").append(empty(season) ? "1" : season);
            path.append("&episode=").append(empty(episode) ? "1" : episode);
        }
        previousOrientation = activity.getRequestedOrientation();
        activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
        if (webView == null) webView = buildPlayerView();
        if (dialog == null) {
            dialog = new Dialog(activity, android.R.style.Theme_Black_NoTitleBar_Fullscreen);
            Window window = dialog.getWindow();
            if (window != null) {
                window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                window.setFlags(
                    WindowManager.LayoutParams.FLAG_FULLSCREEN,
                    WindowManager.LayoutParams.FLAG_FULLSCREEN
                );
                if (Build.VERSION.SDK_INT >= 28) {
                    window.getAttributes().layoutInDisplayCutoutMode =
                        WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
                }
            }
            dialog.setContentView(root);
            dialog.setOnCancelListener((d) -> close());
            dialog.setOnKeyListener((d, keyCode, event) -> {
                if (keyCode != KeyEvent.KEYCODE_BACK || event.getAction() != KeyEvent.ACTION_UP) return false;
                if (hideFullscreen()) return true;
                close();
                return true;
            });
        }
        if (!dialog.isShowing()) dialog.show();
        hideSystemUi();
        webView.loadUrl("https://localhost" + path);
    }

    boolean hideFullscreen() {
        if (customView == null) return false;
        hideCustomView();
        return true;
    }

    void close() {
        if (closing) return;
        closing = true;
        hideCustomView();
        WebView view = webView;
        if (view != null) {
            view.evaluateJavascript(
                "(function(){try{return localStorage.getItem('continueWatching')||'[]';}catch(e){return '[]';}})()",
                (value) -> finishClose(jsString(value))
            );
            view.postDelayed(() -> {
                if (!closedOut) finishClose(null);
            }, 600);
            return;
        }
        finishClose(null);
    }

    private void finishClose(String continueWatching) {
        if (closedOut) return;
        closedOut = true;
        try {
            if (dialog != null && dialog.isShowing()) dialog.dismiss();
        } catch (Exception ignored) {
            /* already gone */
        }
        dialog = null;
        destroyView();
        try {
            activity.setRequestedOrientation(previousOrientation);
        } catch (Exception ignored) {
            activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
        }
        host.onPlayerClosed(continueWatching);
        closing = false;
    }

    private void destroyView() {
        WebView view = webView;
        webView = null;
        root = null;
        customView = null;
        customCallback = null;
        if (view == null) return;
        try {
            if (view.getParent() instanceof ViewGroup) {
                ((ViewGroup) view.getParent()).removeView(view);
            }
            view.destroy();
        } catch (Exception ignored) {
            /* overlay already torn down */
        }
    }

    private WebView buildPlayerView() {
        root = new FrameLayout(activity);
        root.setLayoutParams(
            new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        );
        root.setBackgroundColor(0xFF000000);
        WebView view = new WebView(activity);
        view.setLayoutParams(
            new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        );
        view.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setSupportMultipleWindows(false);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        String ua = settings.getUserAgentString();
        if (ua != null) {
            settings.setUserAgentString(ua.replace("; wv", "").replace("Version/4.0 ", ""));
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(view, true);
        final AssetManager assets = activity.getAssets();
        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
            .setDomain("localhost")
            .addPathHandler(
                "/",
                (path) -> {
                    String clean = path == null ? "" : path;
                    if (clean.startsWith("/")) clean = clean.substring(1);
                    int query = clean.indexOf('?');
                    if (query >= 0) clean = clean.substring(0, query);
                    if (isSpaRoute(clean)) clean = "index.html";
                    try {
                        InputStream stream = assets.open("public/" + clean);
                        return new WebResourceResponse(mime(clean), "utf-8", stream);
                    } catch (Exception missing) {
                        try {
                            return new WebResourceResponse("text/html", "utf-8", assets.open("public/index.html"));
                        } catch (Exception ignored) {
                            return null;
                        }
                    }
                }
            )
            .build();
        view.setWebViewClient(
            new WebViewClient() {
                @Override
                public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest request) {
                    Uri url = request.getUrl();
                    if (url != null && "localhost".equalsIgnoreCase(url.getHost())) {
                        return loader.shouldInterceptRequest(url);
                    }
                    return super.shouldInterceptRequest(v, request);
                }

                @Override
                public void onPageFinished(WebView v, String url) {
                    applySeed();
                }
            }
        );
        view.setWebChromeClient(
            new WebChromeClient() {
                @Override
                public void onShowCustomView(View video, CustomViewCallback callback) {
                    showCustomView(video, callback);
                }

                @Override
                @SuppressWarnings("deprecation")
                public void onShowCustomView(View video, int requestedOrientation, CustomViewCallback callback) {
                    showCustomView(video, callback);
                }

                @Override
                public void onHideCustomView() {
                    hideCustomView();
                }
            }
        );
        view.addJavascriptInterface(new Bridge(), "FumioNative");
        root.addView(view);
        return view;
    }

    private void applySeed() {
        String seed = pendingSeed;
        pendingSeed = null;
        if (webView == null || seed == null || seed.isEmpty()) return;
        String quoted = JSONObject.quote(seed);
        webView.evaluateJavascript(
            "(function(s){try{var d=JSON.parse(s);if(d.a)localStorage.setItem('"
                + AUTH_KEY
                + "',d.a);if(d.c)localStorage.setItem('continueWatching',d.c);}catch(e){}})("
                + quoted
                + ")",
            null
        );
    }

    private void showCustomView(View video, WebChromeClient.CustomViewCallback callback) {
        if (video == null) return;
        if (customView != null) {
            if (callback != null) callback.onCustomViewHidden();
            return;
        }
        customView = video;
        customCallback = callback;
        video.setBackgroundColor(0xFF000000);
        ViewGroup target = dialog != null && dialog.getWindow() != null
            ? (ViewGroup) dialog.getWindow().getDecorView()
            : root;
        target.addView(
            video,
            new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        );
        if (webView != null) webView.setVisibility(View.GONE);
        hideSystemUi();
    }

    private void hideCustomView() {
        if (customView == null) return;
        try {
            ViewGroup parent = (ViewGroup) customView.getParent();
            if (parent != null) parent.removeView(customView);
        } catch (Exception ignored) {
            /* already removed */
        }
        customView = null;
        if (webView != null) webView.setVisibility(View.VISIBLE);
        WebChromeClient.CustomViewCallback callback = customCallback;
        customCallback = null;
        if (callback != null) {
            try {
                callback.onCustomViewHidden();
            } catch (Exception ignored) {
                /* player already exited fullscreen */
            }
        }
        hideSystemUi();
    }

    private void hideSystemUi() {
        if (dialog == null || dialog.getWindow() == null) return;
        View decor = dialog.getWindow().getDecorView();
        decor.setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
        );
    }

    private void deliverHttpResult(String requestId, JSONObject result) {
        if (webView == null) return;
        try {
            String quotedId = JSONObject.quote(requestId == null ? "" : requestId);
            String payload = result == null ? "{}" : result.toString();
            webView.evaluateJavascript(
                "(function(id,r){try{window.dispatchEvent(new CustomEvent('fumio-native-http',{detail:{id:id,result:r}}));}catch(e){}})("
                    + quotedId
                    + ","
                    + payload
                    + ")",
                null
            );
        } catch (Exception ignored) {
            /* sync will retry */
        }
    }

    private static boolean isSpaRoute(String path) {
        if (path == null || path.isEmpty() || path.equals("index.html")) return true;
        int slash = path.lastIndexOf('/');
        String last = slash >= 0 ? path.substring(slash + 1) : path;
        return !last.contains(".");
    }

    private static String mime(String path) {
        String lower = path.toLowerCase();
        if (lower.endsWith(".js")) return "application/javascript";
        if (lower.endsWith(".css")) return "text/css";
        if (lower.endsWith(".html")) return "text/html";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".json")) return "application/json";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".woff2")) return "font/woff2";
        if (lower.endsWith(".ico")) return "image/x-icon";
        return "application/octet-stream";
    }

    private static boolean empty(String value) {
        return value == null || value.isEmpty();
    }

    private static String jsString(String value) {
        if (value == null || value.isEmpty() || value.equals("null")) return null;
        try {
            Object parsed = new JSONTokener(value).nextValue();
            return parsed instanceof String ? (String) parsed : value;
        } catch (Exception ignored) {
            return value;
        }
    }

    private class Bridge {
        @JavascriptInterface
        public void closePlayer() {
            activity.runOnUiThread(() -> close());
        }

        @JavascriptInterface
        public void lockLandscape() {
            activity.runOnUiThread(
                () -> activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE)
            );
        }

        @JavascriptInterface
        public void unlockOrientation() {
            activity.runOnUiThread(
                () -> activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED)
            );
        }

        @JavascriptInterface
        public void requestJson(String method, String url, String headersJson, String body, String requestId) {
            final String id = requestId == null ? "" : requestId;
            new Thread(
                () -> {
                    JSONObject result = NativeHttp.execute(method, url, headersJson, body);
                    activity.runOnUiThread(() -> deliverHttpResult(id, result));
                },
                "fumio-player-http"
            ).start();
        }
    }
}
