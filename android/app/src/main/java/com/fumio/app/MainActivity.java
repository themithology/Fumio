package com.fumio.app;

import android.app.Dialog;
import android.content.Intent;
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
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import java.util.Locale;
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

    private Dialog popupDialog;
    private WebView popupView;
    private String pendingAuthToken;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        try {
            Bridge bridge = getBridge();
            if (bridge == null) return;
            WebView webView = bridge.getWebView();
            if (webView == null) return;
            installClients(webView, bridge);
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
    }

    public class NativeBridge {
        @JavascriptInterface
        public void openBrowser(String url) {
            if (url == null) return;
            final Uri uri = Uri.parse(url);
            String scheme = uri.getScheme();
            if (scheme == null) return;
            scheme = scheme.toLowerCase(Locale.US);
            if (!scheme.equals("https") && !scheme.equals("http")) return;
            runOnUiThread(() -> openExternal(uri));
        }
    }

    private void handleAuthIntent(Intent intent) {
        if (intent == null || intent.getData() == null) return;
        Uri data = intent.getData();
        if (data.getScheme() == null || !data.getScheme().equalsIgnoreCase("com.fumio.app")) return;
        String token = data.getQueryParameter("idToken");
        if (token == null || token.isEmpty()) return;
        pendingAuthToken = token;
        deliverPendingAuthToken();
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
            if (isOwnOrigin(url)) return null;
            if (!mainFrame) return false;
            if (isDiscord(url)) {
                openExternal(url);
                return true;
            }
            if (isAuthProvider(url)) return false;
            return true;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            deliverPendingAuthToken();
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
                WebView popup = createPopupWebView();
                ((WebView.WebViewTransport) resultMsg.obj).setWebView(popup);
                resultMsg.sendToTarget();
                showPopup(popup);
                return true;
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
            if (delegate != null) delegate.onShowCustomView(view, callback);
            else super.onShowCustomView(view, callback);
        }

        @Override
        public void onHideCustomView() {
            if (delegate != null) delegate.onHideCustomView();
            else super.onHideCustomView();
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

    private boolean handlePopupUrl(Uri url) {
        if (url == null || isBenignPopupUrl(url)) return false;
        if (isDiscord(url)) {
            openExternal(url);
            dismissPopup();
            return true;
        }
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

    private void openExternal(Uri url) {
        if (url == null) return;
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
        return isOwnOrigin(url) || isAuthProvider(url);
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

    @Override
    public void onDestroy() {
        try {
            dismissPopup();
        } catch (Exception ignored) {
            // Activity is already going away.
        }
        super.onDestroy();
    }
}
