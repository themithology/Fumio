package com.fumio.app;

import android.net.Uri;
import android.os.Bundle;
import android.os.Message;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import com.getcapacitor.BridgeWebViewClient;

/**
 * TheOGPirateBot plays its titles through a handful of third-party video
 * embeds loaded in an {@code <iframe>} (see src/providers/sources.js) —
 * domains we don't control and that are known to run popup/popunder and
 * forced-redirect ad scripts. This activity layers two extra guards on top
 * of the WebView Capacitor already sets up:
 *
 *  1. {@link android.webkit.WebChromeClient#onCreateWindow} always returns
 *     false, so a `window.open(...)` call from inside an embed — the
 *     classic popup/popunder trigger — never spawns a second WebView
 *     window. (Capacitor's BridgeWebChromeClient doesn't override this, so
 *     the WebChromeClient default of returning false already applies; we
 *     pin it explicitly so it can't silently change if multi-window
 *     support is ever turned on for some other reason.)
 *
 *  2. {@link android.webkit.WebViewClient#shouldOverrideUrlLoading} blocks
 *     every top-level navigation that isn't to our own bundled app origin.
 *     Capacitor's default client (Bridge#launchIntent) already stops
 *     out-of-origin URLs from hijacking the WebView in place, but it still
 *     forwards them to an external Intent (typically the system browser),
 *     which is itself the "popunder" experience users see — the app
 *     backgrounds and a browser tab appears. We skip that hand-off and
 *     just drop anything that isn't our own origin. This only affects the
 *     *top-level* frame: the provider iframes keep loading normally, since
 *     iframe (sub-frame) navigation doesn't route through this hook.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Bridge bridge = getBridge();
        if (bridge == null) return;

        WebView webView = bridge.getWebView();
        if (webView == null) return;

        webView.setWebChromeClient(
            new BridgeWebChromeClient(bridge) {
                @Override
                public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
                    // Never let an embed spawn a second WebView window.
                    return false;
                }
            }
        );

        webView.setWebViewClient(
            new BridgeWebViewClient(bridge) {
                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    if (isOwnOrigin(request.getUrl())) {
                        return super.shouldOverrideUrlLoading(view, request);
                    }
                    return true; // block: no WebView navigation, no external Intent hand-off
                }

                @Override
                @SuppressWarnings("deprecation")
                public boolean shouldOverrideUrlLoading(WebView view, String url) {
                    Uri uri = Uri.parse(url);
                    if (isOwnOrigin(uri)) {
                        return super.shouldOverrideUrlLoading(view, url);
                    }
                    return true;
                }

                private boolean isOwnOrigin(Uri url) {
                    Uri appUri = Uri.parse(getBridge().getAppUrl());
                    String appHost = appUri.getHost();
                    String appScheme = appUri.getScheme();
                    return appHost != null && appHost.equals(url.getHost()) && appScheme != null && appScheme.equals(url.getScheme());
                }
            }
        );
    }
}
