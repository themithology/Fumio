package com.fumio.app;

import android.app.Dialog;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Message;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONObject;

/**
 * Keep Capacitor's own Chrome client (file pickers, fullscreen video, JS
 * dialogs). Only layer two behaviors on top:
 *
 *  1. Discord links leave the app via the system browser / Discord app.
 *  2. A user-gesture window.open() from Google/Firebase Auth gets a real
 *     popup WebView. Unknown embed popups are still dropped.
 *
 * Do not construct a second BridgeWebChromeClient — that registers activity
 * result launchers and crashes if it happens after onStart.
 */
public class MainActivity extends BridgeActivity {

    private static final String LIVE_ORIGIN = "https://theogpiratebot.online";
    private Dialog popupDialog;
    private WebView popupView;
    private String pendingAuthToken;
    private volatile boolean googleRedirectActive;
    private final InAppGoogleAuth inAppGoogleAuth = new InAppGoogleAuth();
    private FumioPlayerOverlay playerOverlay;
    private static final Pattern EMBED_TITLE = Pattern.compile(
        "(?i)/(movie|tv|anime)/(\\d+)(?:/(\\d+)(?:/(\\d+))?)?"
    );
    private String playerScript = "";
    private String localAppUrl = "";
    private String liveReturnUrl = "";
    private boolean openedLive;
    private boolean liveHistoryCleared;
    private boolean liveFailed;
    private volatile boolean playerActive;
    private volatile boolean suppressEmbedOpen = true;
    private long lastPlayerOpenAt;
    private String vastUrl = "";
    private int vastSkipAfter = 5;
    private View fullscreenView;
    private WebChromeClient.CustomViewCallback fullscreenCallback;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        try {
            Bridge bridge = getBridge();
            if (bridge == null) return;
            WebView webView = bridge.getWebView();
            if (webView == null) return;
            playerScript = readAsset("fumio-player.js");
            try {
                JSONObject ads = new JSONObject(readAsset("fumio-ads.json"));
                vastUrl = ads.optString("vastUrl", "");
                vastSkipAfter = ads.optInt("skipAfterSeconds", 5);
            } catch (Exception ignored) {
                vastUrl = "";
            }
            playerOverlay = new FumioPlayerOverlay(this, this::onOverlayClosed);
            installClients(webView, bridge);
            installBackHandler();
            handleAuthIntent(getIntent());
        } catch (Exception ignored) {
            // Prefer a running Capacitor shell over a crash loop.
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleAuthIntent(intent);
    }

    private void installClients(WebView webView, Bridge bridge) {
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);

        webView.addJavascriptInterface(new NativeBridge(), "FumioNative");
        webView.setWebViewClient(new TrustedWebViewClient(bridge));

        WebChromeClient existing = readChromeClient(webView);
        if (!(existing instanceof PopupChromeClient)) {
            webView.setWebChromeClient(new PopupChromeClient(existing));
        }

        WebSettings settings = webView.getSettings();
        settings.setSupportMultipleWindows(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            /* Downloads are disabled in the Android app. */
        });
        String ua = settings.getUserAgentString();
        if (ua != null) {
            settings.setUserAgentString(ua.replace("; wv", "").replace("Version/4.0 ", ""));
        }
    }

    public class NativeBridge {
        @JavascriptInterface
        public void openBrowser(String url) {
            if (url == null) return;
            final Uri uri = Uri.parse(url);
            if (!isLaunchableUri(uri)) return;
            runOnUiThread(() -> openExternal(uri));
        }

        @JavascriptInterface
        public void signInWithGoogle() {
            inAppGoogleAuth.start(
                MainActivity.this,
                new InAppGoogleAuth.Result() {
                    @Override
                    public void onIdToken(String idToken) {
                        runOnUiThread(() -> acceptGoogleToken(idToken));
                    }

                    @Override
                    public void onError(String message) {
                        runOnUiThread(() -> emitGoogleError(message));
                    }
                }
            );
        }

        @JavascriptInterface
        public void beginGoogleRedirect() {
            googleRedirectActive = true;
        }

        @JavascriptInterface
        public void endGoogleRedirect() {
            googleRedirectActive = false;
            runOnUiThread(() -> {
                Bridge bridge = getBridge();
                if (bridge != null && bridge.getWebView() != null) {
                    bridge.getWebView().clearHistory();
                }
            });
        }

        @JavascriptInterface
        public void lockLandscape() {
            runOnUiThread(() -> setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE));
        }

        @JavascriptInterface
        public void unlockOrientation() {
            runOnUiThread(() -> setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED));
        }

        @JavascriptInterface
        public void openWatch(String type, String id, String season, String episode) {
            runOnUiThread(() -> openAppPlayer(type, id, season, episode));
        }

        @JavascriptInterface
        public void closePlayer() {
            runOnUiThread(() -> closeAppPlayer());
        }

        @JavascriptInterface
        public void requestJson(String method, String url, String headersJson, String body, String requestId) {
            final String id = requestId == null ? "" : requestId;
            new Thread(
                () -> {
                    JSONObject result = NativeHttp.execute(method, url, headersJson, body);
                    runOnUiThread(() -> deliverHttpResult(id, result));
                },
                "fumio-http"
            ).start();
        }
    }

    private void deliverHttpResult(String requestId, JSONObject result) {
        Bridge bridge = getBridge();
        if (bridge == null || bridge.getWebView() == null) return;
        try {
            String quotedId = JSONObject.quote(requestId == null ? "" : requestId);
            String payload = result == null ? "{}" : result.toString();
            bridge.getWebView().evaluateJavascript(
                "(function(id,r){try{window.dispatchEvent(new CustomEvent('fumio-native-http',{detail:{id:id,result:r}}));}catch(e){}})("
                    + quotedId
                    + ","
                    + payload
                    + ")",
                null
            );
        } catch (Exception ignored) {
            // Sync will retry.
        }
    }

    private void handleAuthIntent(Intent intent) {
        if (intent == null || intent.getData() == null) return;
        Uri data = intent.getData();
        if (data.getScheme() == null || !data.getScheme().equalsIgnoreCase("com.fumio.app")) return;
        String token = data.getQueryParameter("idToken");
        acceptGoogleToken(token);
    }

    private void emitGoogleError(String message) {
        Bridge bridge = getBridge();
        if (bridge == null || bridge.getWebView() == null) return;
        try {
            String quoted = JSONObject.quote(message == null || message.isEmpty() ? "Google sign-in failed." : message);
            bridge.getWebView().evaluateJavascript(
                "(function(m){try{window.dispatchEvent(new CustomEvent('fumio-native-auth-error',{detail:{message:m}}));}catch(e){}})(" + quoted + ")",
                null
            );
        } catch (Exception ignored) {
            // Form can be tried again.
        }
    }

    private void acceptGoogleToken(String token) {
        if (token == null || token.isEmpty()) return;
        pendingAuthToken = token;
        deliverPendingAuthToken();
        applyGoogleTokenToLiveSite(token);
        try {
            Intent bring = new Intent(this, MainActivity.class);
            bring.addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            startActivity(bring);
        } catch (Exception ignored) {
            // Token is already queued for the WebView.
        }
    }

    private void deliverPendingAuthToken() {
        if (pendingAuthToken == null) return;
        Bridge bridge = getBridge();
        if (bridge == null || bridge.getWebView() == null) return;
        final String token = pendingAuthToken;
        try {
            String quoted = JSONObject.quote(token);
            bridge.getWebView().evaluateJavascript(
                "(function(t){try{window.dispatchEvent(new CustomEvent('fumio-native-auth',{detail:{idToken:t}}));}catch(e){}})(" + quoted + ")",
                (value) -> pendingAuthToken = null
            );
        } catch (Exception ignored) {
            // WebView may not be ready yet; onPageFinished retries.
        }
    }

    private WebChromeClient readChromeClient(WebView webView) {
        if (Build.VERSION.SDK_INT >= 26) {
            try {
                return webView.getWebChromeClient();
            } catch (Exception ignored) {
                return null;
            }
        }
        return null;
    }

    private class TrustedWebViewClient extends BridgeWebViewClient {
        TrustedWebViewClient(Bridge bridge) {
            super(bridge);
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Boolean handled = handleExternalUrl(request.getUrl(), request.isForMainFrame());
            if (handled != null) return handled;
            return super.shouldOverrideUrlLoading(view, request);
        }

        @Override
        @SuppressWarnings("deprecation")
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            Boolean handled = handleExternalUrl(Uri.parse(url), true);
            if (handled != null) return handled;
            return super.shouldOverrideUrlLoading(view, url);
        }

        private Boolean handleExternalUrl(Uri url, boolean mainFrame) {
            if (url == null) return true;
            if (!mainFrame && (playerActive || isOwnOrigin(currentUri()) || isLiveTvPage(currentUri()))) {
                return false;
            }
            if (isDownloadPath(url)) return true;
            if (isPlayerEmbed(url)) {
                openAppPlayerFromEmbed(url);
                return true;
            }
            if (isLiveSite(url)) {
                if (mainFrame && isWatchPath(url)) {
                    openAppPlayerFromWatch(url);
                    return true;
                }
                String livePath = url.getPath();
                if (livePath != null && livePath.toLowerCase(Locale.US).contains("watch-party")) return true;
                return false;
            }
            if (isOwnOrigin(url)) {
                if (googleRedirectActive && mainFrame) stayOnApp();
                return null;
            }
            if (!mainFrame) return false;
            if (isDiscord(url)) {
                openExternal(url);
                return true;
            }
            if (isAuthProvider(url)) {
                // Browse mode: Google/Firebase stay inside this WebView (popup or
                // main frame). Never send them to Chrome. While the in-app player
                // is up, ignore auth URLs so a helper cannot replace playback.
                if (playerActive) return true;
                if (openedLive || googleRedirectActive) return false;
                return true;
            }
            if (isLaunchableUri(url)) {
                openExternal(url);
                return true;
            }
            return true;
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            try {
                if (
                    request != null &&
                    !request.isForMainFrame() &&
                    isPlayerEmbed(request.getUrl())
                ) {
                    if (!playerActive && !suppressEmbedOpen) {
                        final Uri embed = request.getUrl();
                        view.post(() -> openAppPlayerFromEmbed(embed));
                    }
                    return new WebResourceResponse(
                        "text/html",
                        "utf-8",
                        new ByteArrayInputStream(new byte[0])
                    );
                }
            } catch (Exception ignored) {
                // Never crash the WebView thread on a probe.
            }
            return super.shouldInterceptRequest(view, request);
        }

        @Override
        public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
            super.doUpdateVisitedHistory(view, url, isReload);
            Uri uri = url == null ? null : Uri.parse(url);
            noteBrowsePage(uri);
            if (!isLiveSite(uri) || !isWatchPath(uri) || playerActive) return;
            openAppPlayerFromWatch(uri);
            view.post(() -> {
                if (!playerActive) return;
                if (view.canGoBack()) view.goBack();
            });
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            Uri uri = url == null ? null : Uri.parse(url);
            if (isOwnOrigin(uri)) rememberLocalAppUrl();
            if (!openedLive && !liveFailed && isOwnOrigin(uri)) {
                openedLive = true;
                view.post(() -> view.loadUrl(LIVE_ORIGIN + "/"));
                return;
            }
            if (isOwnOrigin(uri) && openedLive) {
                return;
            }
            if (isLiveSite(uri)) {
                liveFailed = false;
                noteBrowsePage(uri);
                if (!liveHistoryCleared) {
                    liveHistoryCleared = true;
                    view.clearHistory();
                }
                injectPlayerScript(view);
            }
            deliverPendingAuthToken();
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (
                !playerActive &&
                !liveFailed &&
                request != null &&
                request.isForMainFrame() &&
                isLiveSite(request.getUrl())
            ) {
                liveFailed = true;
                openedLive = true;
                rememberLocalAppUrl();
                if (localAppUrl != null && !localAppUrl.isEmpty()) {
                    view.post(() -> view.loadUrl(localAppUrl + "/"));
                }
            }
            super.onReceivedError(view, request, error);
        }
    }

    private class PopupChromeClient extends WebChromeClient {
        private final WebChromeClient delegate;

        PopupChromeClient(WebChromeClient delegate) {
            this.delegate = delegate;
        }

        @Override
        public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
            if (!isUserGesture || resultMsg == null || !(resultMsg.obj instanceof WebView.WebViewTransport)) {
                return false;
            }
            try {
                Uri hitUrl = hitTestUri(view);
                if (isDiscord(hitUrl)) {
                    openExternal(hitUrl);
                    return false;
                }
                if (isDownloadPath(hitUrl)) return false;
                if (isAuthProvider(hitUrl) || googleRedirectActive) {
                    WebView popup = createPopupWebView();
                    ((WebView.WebViewTransport) resultMsg.obj).setWebView(popup);
                    resultMsg.sendToTarget();
                    showPopup(popup);
                    return true;
                }
                // Real target=_blank links (Donate, payments). Iframe popunders
                // have no anchor hit, so they stay blocked.
                if (hitUrl != null && !isPlayerEmbed(hitUrl) && !isWatchPath(hitUrl) && isLaunchableUri(hitUrl)) {
                    openExternal(hitUrl);
                    return false;
                }
                return false;
            } catch (Exception ignored) {
                return false;
            }
        }

        @Override
        public void onCloseWindow(WebView window) {
            dismissPopup();
            if (delegate != null) delegate.onCloseWindow(window);
            else super.onCloseWindow(window);
        }

        @Override
        public void onShowCustomView(View view, CustomViewCallback callback) {
            if (playerActive) {
                if (callback != null) callback.onCustomViewHidden();
                return;
            }
            enterFullscreen(view, callback);
        }

        @Override
        public void onHideCustomView() {
            exitFullscreen();
        }

        @Override
        public boolean onConsoleMessage(ConsoleMessage consoleMessage) {
            if (delegate != null) return delegate.onConsoleMessage(consoleMessage);
            return super.onConsoleMessage(consoleMessage);
        }

        @Override
        public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
            if (delegate != null) return delegate.onJsAlert(view, url, message, result);
            return super.onJsAlert(view, url, message, result);
        }

        @Override
        public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
            if (delegate != null) return delegate.onJsConfirm(view, url, message, result);
            return super.onJsConfirm(view, url, message, result);
        }

        @Override
        public boolean onJsPrompt(WebView view, String url, String message, String defaultValue, JsPromptResult result) {
            if (delegate != null) return delegate.onJsPrompt(view, url, message, defaultValue, result);
            return super.onJsPrompt(view, url, message, defaultValue, result);
        }

        @Override
        public void onPermissionRequest(PermissionRequest request) {
            if (delegate != null) delegate.onPermissionRequest(request);
            else super.onPermissionRequest(request);
        }

        @Override
        public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
            if (delegate != null) delegate.onGeolocationPermissionsShowPrompt(origin, callback);
            else super.onGeolocationPermissionsShowPrompt(origin, callback);
        }

        @Override
        public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback, FileChooserParams fileChooserParams) {
            if (delegate != null) return delegate.onShowFileChooser(webView, filePathCallback, fileChooserParams);
            return super.onShowFileChooser(webView, filePathCallback, fileChooserParams);
        }

        @Override
        public void onProgressChanged(WebView view, int newProgress) {
            if (delegate != null) delegate.onProgressChanged(view, newProgress);
            else super.onProgressChanged(view, newProgress);
        }
    }

    private WebView createPopupWebView() {
        WebView popup = new WebView(this);
        popup.setLayoutParams(
            new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        );
        WebSettings settings = popup.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        String ua = settings.getUserAgentString();
        if (ua != null) {
            settings.setUserAgentString(ua.replace("; wv", "").replace("Version/4.0 ", ""));
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(popup, true);
        popup.setWebChromeClient(
            new WebChromeClient() {
                @Override
                public void onCloseWindow(WebView window) {
                    dismissPopup();
                }
            }
        );
        popup.setWebViewClient(
            new WebViewClient() {
                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    return handlePopupUrl(request.getUrl());
                }

                @Override
                @SuppressWarnings("deprecation")
                public boolean shouldOverrideUrlLoading(WebView view, String url) {
                    return handlePopupUrl(Uri.parse(url));
                }
            }
        );
        return popup;
    }

    private void stayOnApp() {
        googleRedirectActive = false;
        Bridge bridge = getBridge();
        if (bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().clearHistory();
        }
    }

    private boolean handlePopupUrl(Uri url) {
        if (url == null) return true;
        // Google sign-in on the live site uses window.open(). Keep that popup
        // in-app: accounts.google.com, Firebase handler, then back to the site.
        if (isDownloadPath(url)) {
            dismissPopup();
            return true;
        }
        if (isBenignPopupUrl(url) || isAuthProvider(url) || isLiveSite(url)) return false;
        if (isDiscord(url)) {
            openExternal(url);
            dismissPopup();
            return true;
        }
        // Smartlink / extra ad tabs: drop them. File hosts still open from the
        // main WebView via handleExternalUrl.
        dismissPopup();
        return true;
    }

    private void showPopup(WebView popup) {
        if (isFinishing()) {
            popup.destroy();
            return;
        }
        dismissPopup();
        popupView = popup;
        popupDialog = new Dialog(this, android.R.style.Theme_Black_NoTitleBar_Fullscreen);
        popupDialog.setContentView(popup);
        popupDialog.setOnDismissListener((dialog) -> {
            popupDialog = null;
            destroyPopupView();
        });
        popupDialog.show();
    }

    private void dismissPopup() {
        Dialog dialog = popupDialog;
        popupDialog = null;
        if (dialog != null) {
            try {
                if (dialog.isShowing()) dialog.dismiss();
                else destroyPopupView();
            } catch (Exception ignored) {
                destroyPopupView();
            }
        } else {
            destroyPopupView();
        }
    }

    private void destroyPopupView() {
        WebView view = popupView;
        popupView = null;
        if (view == null) return;
        try {
            if (view.getParent() instanceof ViewGroup) {
                ((ViewGroup) view.getParent()).removeView(view);
            }
            view.destroy();
        } catch (Exception ignored) {
            // Already torn down with the activity.
        }
    }

    private boolean isLaunchableUri(Uri url) {
        if (url == null) return false;
        String scheme = url.getScheme();
        if (scheme == null) return false;
        scheme = scheme.toLowerCase(Locale.US);
        return scheme.equals("https")
            || scheme.equals("http")
            || scheme.equals("mailto")
            || scheme.equals("tel")
            || scheme.equals("sms")
            || scheme.equals("smsto");
    }

    private void openExternal(Uri url) {
        if (url == null || !isLaunchableUri(url)) return;
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, url);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
        } catch (Exception ignored) {
            // No handler — fail closed.
        }
    }

    private Uri hitTestUri(WebView view) {
        WebView.HitTestResult hit = view.getHitTestResult();
        if (hit == null) return null;
        int type = hit.getType();
        if (
            type != WebView.HitTestResult.SRC_ANCHOR_TYPE &&
            type != WebView.HitTestResult.SRC_IMAGE_ANCHOR_TYPE &&
            type != WebView.HitTestResult.ANCHOR_TYPE
        ) {
            return null;
        }
        String extra = hit.getExtra();
        if (extra == null || extra.isEmpty()) return null;
        return Uri.parse(extra);
    }

    private boolean isOwnOrigin(Uri url) {
        Bridge bridge = getBridge();
        if (bridge == null || url == null) return false;
        String appUrl = bridge.getAppUrl();
        if (appUrl == null || appUrl.isEmpty()) return false;
        Uri appUri = Uri.parse(appUrl);
        String appHost = appUri.getHost();
        String appScheme = appUri.getScheme();
        return appHost != null &&
            appHost.equalsIgnoreCase(url.getHost()) &&
            appScheme != null &&
            appScheme.equalsIgnoreCase(url.getScheme());
    }

    private void injectPlayerScript(WebView view) {
        if (view == null || playerScript == null || playerScript.isEmpty()) return;
        view.evaluateJavascript(playerScript, (v) -> notifyAdsChanged());
    }

    private void rememberLocalAppUrl() {
        if (localAppUrl != null && !localAppUrl.isEmpty()) return;
        Bridge bridge = getBridge();
        String app = bridge != null ? bridge.getAppUrl() : null;
        if (app == null || app.isEmpty()) return;
        localAppUrl = app.endsWith("/") ? app.substring(0, app.length() - 1) : app;
    }

    private void openAppPlayerFromWatch(Uri url) {
        if (url == null) return;
        String path = url.getPath() == null ? "" : url.getPath();
        if (path.toLowerCase(Locale.US).startsWith("/player")) {
            openAppPlayer(
                firstQuery(url, "type", "movie"),
                firstQuery(url, "id", null),
                firstQuery(url, "season", "1"),
                firstQuery(url, "episode", "1")
            );
            return;
        }
        Matcher match = EMBED_TITLE.matcher(path);
        if (!match.find()) return;
        openAppPlayer(
            match.group(1),
            match.group(2),
            firstQuery(url, "season", match.group(3)),
            firstQuery(url, "episode", match.group(4))
        );
    }

    private void openAppPlayerFromEmbed(Uri url) {
        if (url == null) return;
        String path = url.getPath() == null ? "" : url.getPath();
        Matcher match = EMBED_TITLE.matcher(path);
        if (!match.find()) return;
        openAppPlayer(match.group(1), match.group(2), match.group(3), match.group(4));
    }

    private String firstQuery(Uri url, String key, String fallback) {
        String value = url.getQueryParameter(key);
        if (value != null && !value.isEmpty()) return value;
        return fallback;
    }

    private void openAppPlayer(String type, String id, String season, String episode) {
        if (id == null || id.isEmpty()) return;
        if (playerActive) return;
        playerActive = true;
        lastPlayerOpenAt = System.currentTimeMillis();
        freezeLiveWebView(true);
        SystemBars.hide(getWindow());
        if (playerOverlay == null) {
            playerOverlay = new FumioPlayerOverlay(this, this::onOverlayClosed);
        }
        snapshotLiveSession((seed) -> {
            if (isFinishing() || isDestroyed()) return;
            Runnable play = () -> {
                if (isFinishing() || isDestroyed()) {
                    onOverlayClosed(null);
                    return;
                }
                playerOverlay.open(type, id, season, episode, seed);
            };
            FumioVast.play(
                this,
                vastUrl,
                vastSkipAfter,
                play,
                () -> onOverlayClosed(null)
            );
        });
    }

    private void notifyAdsChanged() {
        Bridge bridge = getBridge();
        if (bridge == null || bridge.getWebView() == null) return;
        bridge.getWebView().evaluateJavascript(
            "(function(){try{window.dispatchEvent(new Event('fumio-ads-updated'));}catch(e){}})()",
            null
        );
    }

    private void closeAppPlayer() {
        if (playerOverlay != null && playerOverlay.isShowing()) playerOverlay.close();
        else onOverlayClosed(null);
    }

    private void onOverlayClosed(String continueWatching) {
        playerActive = false;
        freezeLiveWebView(false);
        SystemBars.show(getWindow());
        applyContinueWatchingToLiveSite(continueWatching);
    }

    private void freezeLiveWebView(boolean freeze) {
        Bridge bridge = getBridge();
        if (bridge == null || bridge.getWebView() == null) return;
        try {
            if (freeze) bridge.getWebView().onPause();
            else bridge.getWebView().onResume();
        } catch (Exception ignored) {
            /* webview already gone */
        }
    }

    private void snapshotLiveSession(ValueCallback<String> done) {
        Bridge bridge = getBridge();
        if (bridge == null || bridge.getWebView() == null) {
            done.onReceiveValue(null);
            return;
        }
        bridge.getWebView().evaluateJavascript(
            "(function(){try{return JSON.stringify({a:localStorage.getItem('firebase:authUser:AIzaSyDapNgnKdO8l_t7BJPCO8IsbL73aILA1cI:[DEFAULT]')||'',c:localStorage.getItem('continueWatching')||''});}catch(e){return '{}';}})()",
            (value) -> done.onReceiveValue(jsString(value))
        );
    }

    private void applyContinueWatchingToLiveSite(String json) {
        if (json == null || json.isEmpty() || json.equals("[]") || json.equals("{}")) return;
        Bridge bridge = getBridge();
        if (bridge == null || bridge.getWebView() == null) return;
        String quoted = JSONObject.quote(json);
        bridge.getWebView().evaluateJavascript(
            "(function(c){try{if(!c)return;var incoming=JSON.parse(c);if(!Array.isArray(incoming))return;"
                + "var cur=[];try{cur=JSON.parse(localStorage.getItem('continueWatching')||'[]');}catch(e){}"
                + "if(!Array.isArray(cur))cur=[];var by={};function key(it){return (it.type||it.media_type||'movie')+'-'+it.id;}"
                + "cur.concat(incoming).forEach(function(it){if(!it||!it.id)return;var k=key(it);var prev=by[k];"
                + "if(!prev||Number(it.lastUpdated||0)>=Number(prev.lastUpdated||0))by[k]=it;});"
                + "var next=Object.keys(by).map(function(k){return by[k];});"
                + "next.sort(function(a,b){return Number(b.lastUpdated||0)-Number(a.lastUpdated||0);});"
                + "localStorage.setItem('continueWatching',JSON.stringify(next.slice(0,10)));"
                + "window.dispatchEvent(new Event('history-updated'));"
                + "window.dispatchEvent(new Event('history-progress'));"
                + "window.dispatchEvent(new Event('fumio-cw-updated'));}catch(e){}})("
                + quoted
                + ")",
            null
        );
    }

    private static String jsString(String value) {
        if (value == null || value.isEmpty() || value.equals("null")) return null;
        try {
            Object parsed = new org.json.JSONTokener(value).nextValue();
            return parsed instanceof String ? (String) parsed : value;
        } catch (Exception ignored) {
            return value;
        }
    }

    private void applyGoogleTokenToLiveSite(String token) {
        Bridge bridge = getBridge();
        if (bridge == null || bridge.getWebView() == null || token == null || token.isEmpty()) return;
        injectPlayerScript(bridge.getWebView());
        String quoted = JSONObject.quote(token);
        bridge.getWebView().evaluateJavascript(
            "(function(t){try{return window.__fumioApplyGoogleToken?window.__fumioApplyGoogleToken(t):false;}catch(e){return false;}})("
                + quoted
                + ")",
            null
        );
    }

    private Uri currentUri() {
        try {
            Bridge bridge = getBridge();
            if (bridge == null || bridge.getWebView() == null) return null;
            String url = bridge.getWebView().getUrl();
            return url == null || url.isEmpty() ? null : Uri.parse(url);
        } catch (Exception ignored) {
            return null;
        }
    }

    private boolean isLiveSite(Uri url) {
        return hostMatches(url, "theogpiratebot.online");
    }

    private void noteBrowsePage(Uri url) {
        suppressEmbedOpen = !isWatchPath(url);
    }

    private boolean isLiveTvPage(Uri url) {
        if (url == null) return false;
        String path = url.getPath();
        return path != null && path.toLowerCase(Locale.US).startsWith("/live-tv");
    }

    private boolean isWatchPath(Uri url) {
        if (url == null) return false;
        String path = url.getPath();
        if (path == null) return false;
        path = path.toLowerCase(Locale.US);
        if (path.equals("/player") || path.equals("/player/")) return true;
        return path.matches("(?i)^/watch/(movie|tv|anime)/[0-9]+.*");
    }

    private boolean isDownloadPath(Uri url) {
        if (url == null) return false;
        String path = url.getPath();
        return path != null && path.toLowerCase(Locale.US).startsWith("/download");
    }

    private boolean isDownloadHost(Uri url) {
        if (url == null) return false;
        String host = url.getHost();
        if (host == null) return false;
        host = host.toLowerCase(Locale.US);
        if (host.contains("vidsrc.party") || host.contains("tgdl.") || host.contains("hubcloud") || host.contains("filepress")) {
            return true;
        }
        return hostMatches(url, "tgdl.lovable.app", "vidsrc.party");
    }

    private boolean isPlayerEmbed(Uri url) {
        if (url == null || isDownloadHost(url)) return false;
        String host = url.getHost();
        if (host == null) return false;
        host = host.toLowerCase(Locale.US);
        if (host.contains("vidsrc") || host.contains("videasy") || host.contains("vidfast") || host.contains("vidlink")) {
            return true;
        }
        return hostMatches(
            url,
            "vidstuck.xyz",
            "bingr.one",
            "zxcstream.xyz",
            "2embed.cc",
            "2embed.skin",
            "multiembed.mov",
            "autoembed.cc",
            "smashystream.com",
            "embed.su",
            "111movies.com",
            "moviesapi.club",
            "tgvid.lovable.app",
            "megaplay.site",
            "zokoanime.com",
            "4animo.com"
        );
    }

    private String readAsset(String name) {
        StringBuilder out = new StringBuilder();
        try (InputStream in = getAssets().open(name);
            BufferedReader reader = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                out.append(line).append('\n');
            }
        } catch (Exception ignored) {
            return "";
        }
        return out.toString();
    }

    private void installBackHandler() {
        getOnBackPressedDispatcher().addCallback(
            this,
            new OnBackPressedCallback(true) {
                @Override
                public void handleOnBackPressed() {
                    if (fullscreenView != null) {
                        exitFullscreen();
                        return;
                    }
                    if (popupDialog != null && popupDialog.isShowing()) {
                        dismissPopup();
                        return;
                    }
                    if (playerActive) {
                        if (playerOverlay != null && playerOverlay.hideFullscreen()) return;
                        closeAppPlayer();
                        return;
                    }
                    Bridge bridge = getBridge();
                    WebView webView = bridge != null ? bridge.getWebView() : null;
                    if (webView == null) {
                        setEnabled(false);
                        getOnBackPressedDispatcher().onBackPressed();
                        return;
                    }
                    if (webView.canGoBack()) webView.goBack();
                    else {
                        setEnabled(false);
                        getOnBackPressedDispatcher().onBackPressed();
                    }
                }
            }
        );
    }

    private boolean isDiscord(Uri url) {
        return hostMatches(url, "discord.com", "discord.gg", "discordapp.com", "discordapp.net");
    }

    private boolean isAuthProvider(Uri url) {
        return hostMatches(
            url,
            "accounts.google.com",
            "accounts.youtube.com",
            "google.com",
            "googleapis.com",
            "gstatic.com",
            "googleusercontent.com",
            "g.co",
            "firebaseapp.com",
            "firebase.com",
            "identitytoolkit.googleapis.com",
            "recaptcha.net",
            "gstatic.cn"
        );
    }

    private boolean isBenignPopupUrl(Uri url) {
        if (url == null) return true;
        String scheme = url.getScheme();
        if (scheme == null) return true;
        scheme = scheme.toLowerCase(Locale.US);
        if (scheme.equals("about") || scheme.equals("javascript") || scheme.equals("data") || scheme.equals("blob")) {
            return true;
        }
        return isOwnOrigin(url) || isLiveSite(url) || isAuthProvider(url);
    }

    private boolean hostMatches(Uri url, String... allowed) {
        if (url == null) return false;
        String host = url.getHost();
        if (host == null) return false;
        host = host.toLowerCase(Locale.US);
        for (String candidate : allowed) {
            if (host.equals(candidate) || host.endsWith("." + candidate)) return true;
        }
        return false;
    }

    private void enterFullscreen(View view, WebChromeClient.CustomViewCallback callback) {
        if (fullscreenView != null) {
            if (callback != null) callback.onCustomViewHidden();
            return;
        }
        ViewGroup decor = (ViewGroup) getWindow().getDecorView();
        fullscreenView = view;
        fullscreenCallback = callback;
        view.setBackgroundColor(0xFF000000);
        decor.addView(
            view,
            new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        );
        decor.setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
        );
    }

    private void exitFullscreen() {
        if (fullscreenView == null) return;
        ViewGroup parent = (ViewGroup) fullscreenView.getParent();
        if (parent != null) parent.removeView(fullscreenView);
        fullscreenView = null;
        WebChromeClient.CustomViewCallback callback = fullscreenCallback;
        fullscreenCallback = null;
        if (callback != null) {
            try {
                callback.onCustomViewHidden();
            } catch (Exception ignored) {
                /* already left fullscreen */
            }
        }
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
    }

    @Override
    public void onDestroy() {
        try {
            exitFullscreen();
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
            if (playerOverlay != null && playerOverlay.isShowing()) playerOverlay.close();
            inAppGoogleAuth.dismiss();
            dismissPopup();
        } catch (Exception ignored) {
            // Activity is already going away.
        }
        super.onDestroy();
    }
}
