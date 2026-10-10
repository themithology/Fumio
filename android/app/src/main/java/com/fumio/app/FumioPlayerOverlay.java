package com.fumio.app;

import android.app.Activity;
import android.app.Dialog;
import android.content.pm.ActivityInfo;
import android.content.res.AssetManager;
import android.net.Uri;
import android.os.Build;
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

/** Fullscreen copy of the bundled Fumio player — the live site WebView stays put. */
final class FumioPlayerOverlay {

    interface Host {
        void onPlayerClosed();
    }

    private final Activity activity;
    private final Host host;
    private Dialog dialog;
    private FrameLayout root;
    private WebView webView;
    private View customView;
    private WebChromeClient.CustomViewCallback customCallback;
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
        }
        if (!dialog.isShowing()) dialog.show();
        hideSystemUi();
        webView.loadUrl("https://localhost" + path);
    }

    void close() {
        hideCustomView();
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
            }
        );
        view.setWebChromeClient(
            new WebChromeClient() {
                @Override
                public void onShowCustomView(View video, CustomViewCallback callback) {
                    if (customView != null) {
                        callback.onCustomViewHidden();
                        return;
                    }
                    customView = video;
                    customCallback = callback;
                    video.setBackgroundColor(0xFF000000);
                    root.addView(
                        video,
                        new FrameLayout.LayoutParams(
                            ViewGroup.LayoutParams.MATCH_PARENT,
                            ViewGroup.LayoutParams.MATCH_PARENT
                        )
                    );
                    webView.setVisibility(View.GONE);
                    hideSystemUi();
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

    private void hideCustomView() {
        if (customView == null) return;
        try {
            root.removeView(customView);
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
