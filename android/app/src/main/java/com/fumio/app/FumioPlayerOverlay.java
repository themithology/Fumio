package com.fumio.app;

import android.app.Activity;
import android.app.Dialog;
import android.content.pm.ActivityInfo;
import android.content.res.AssetManager;
import android.net.Uri;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import androidx.webkit.WebViewAssetLoader;
import java.io.InputStream;

/** Fullscreen copy of the bundled Fumio player — the live site WebView stays put. */
final class FumioPlayerOverlay {

    interface Host {
        void onPlayerClosed();
    }

    private final Activity activity;
    private final Host host;
    private Dialog dialog;
    private WebView webView;
    private int previousOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;

    FumioPlayerOverlay(Activity activity, Host host) {
        this.activity = activity;
        this.host = host;
    }

    boolean isShowing() {
        return dialog != null && dialog.isShowing();
    }

    void open(String type, String id, String season, String episode) {
        if (id == null || id.isEmpty()) return;
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
            dialog.setContentView(webView);
            dialog.setOnCancelListener((d) -> close());
        }
        if (!dialog.isShowing()) dialog.show();
        webView.loadUrl("https://localhost" + path);
    }

    void close() {
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
        host.onPlayerClosed();
    }

    private void destroyView() {
        WebView view = webView;
        webView = null;
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
        WebView view = new WebView(activity);
        view.setLayoutParams(
            new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        );
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setSupportMultipleWindows(false);
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
            }
        );
        view.addJavascriptInterface(new Bridge(), "FumioNative");
        return view;
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
    }
}
