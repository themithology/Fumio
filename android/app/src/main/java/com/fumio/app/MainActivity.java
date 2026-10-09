package com.fumio.app;

import android.app.Dialog;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Message;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import com.getcapacitor.BridgeWebViewClient;
import java.util.Locale;

/**
 * TheOGPirateBot plays titles through third-party video embeds. Those iframes
 * are known to fire popup/popunder ads, so this activity still drops unknown
 * window.open() calls and unknown top-level hijacks.
 *
 * Trusted destinations are allowed:
 *  - Discord invite links open in the system browser / Discord app.
 *  - Google / Firebase Auth may use a user-gesture popup WebView so
 *    signInWithPopup can complete inside the app.
 */
public class MainActivity extends BridgeActivity {

    private Dialog popupDialog;
    private WebView popupView;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Bridge bridge = getBridge();
        if (bridge == null) return;

        WebView webView = bridge.getWebView();
        if (webView == null) return;

        applyTrustedNavigation(webView);
        webView.post(() -> applyTrustedNavigation(webView));
    }

    private void applyTrustedNavigation(WebView webView) {
        Bridge bridge = getBridge();
        if (bridge == null) return;

        WebSettings settings = webView.getSettings();
        settings.setSupportMultipleWindows(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);

        webView.setWebChromeClient(
            new BridgeWebChromeClient(bridge) {
                @Override
                public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
                    if (!isUserGesture || resultMsg == null || !(resultMsg.obj instanceof WebView.WebViewTransport)) {
                        return false;
                    }

                    Uri hitUrl = hitTestUri(view);
                    if (isDiscord(hitUrl)) {
                        openExternal(hitUrl);
                        return false;
                    }

                    WebView popup = createPopupWebView();
                    WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
                    transport.setWebView(popup);
                    resultMsg.sendToTarget();
                    showPopup(popup);
                    return true;
                }

                @Override
                public void onCloseWindow(WebView window) {
                    dismissPopup();
                    super.onCloseWindow(window);
                }
            }
        );

        webView.setWebViewClient(
            new BridgeWebViewClient(bridge) {
                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    Uri url = request.getUrl();
                    Boolean handled = handleExternalUrl(url, request.isForMainFrame());
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

                /**
                 * @return {@code null} when Capacitor should handle the URL,
                 *         otherwise whether the WebView should override loading.
                 */
                private Boolean handleExternalUrl(Uri url, boolean mainFrame) {
                    if (url == null) return true;
                    if (isOwnOrigin(url)) return null;
                    if (!mainFrame) return false;
                    if (isDiscord(url)) {
                        openExternal(url);
                        return true;
                    }
                    if (isAuthProvider(url)) {
                        // Keep Google/Firebase inside the WebView so the auth
                        // handler can return a session to this app origin.
                        return false;
                    }
                    // Unknown top-level hijack from an embed: drop it.
                    return true;
                }
            }
        );
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
        dismissPopup();
        popupView = popup;
        popupDialog = new Dialog(this, android.R.style.Theme_Black_NoTitleBar_Fullscreen);
        popupDialog.setContentView(popup);
        popupDialog.setOnDismissListener((dialog) -> destroyPopupView());
        popupDialog.show();
    }

    private void dismissPopup() {
        if (popupDialog != null) {
            Dialog dialog = popupDialog;
            popupDialog = null;
            if (dialog.isShowing()) dialog.dismiss();
            else destroyPopupView();
        } else {
            destroyPopupView();
        }
    }

    private void destroyPopupView() {
        if (popupView != null) {
            popupView.destroy();
            popupView = null;
        }
        popupDialog = null;
    }

    private void openExternal(Uri url) {
        if (url == null) return;
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, url);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
        } catch (Exception ignored) {
            // No browser available — fail closed rather than loading an ad.
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
        Uri appUri = Uri.parse(bridge.getAppUrl());
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
        dismissPopup();
        super.onDestroy();
    }
}
