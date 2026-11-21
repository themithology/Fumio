package com.fumio.app;

import android.app.Dialog;
import android.app.PictureInPictureParams;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.Network;
import android.content.ComponentCallbacks2;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Message;
import android.os.SystemClock;
import android.util.Log;
import android.util.Rational;
import android.view.View;
import android.view.Gravity;
import android.view.KeyEvent;
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
    private VerifyClient verifyClient;
    private final VerifyWall verifyWall = new VerifyWall();
    private volatile boolean verifyBusy;
    private boolean pendingPlay;
    private boolean waitingOnChrome;
    private String pendingPlayType;
    private String pendingPlayId;
    private String pendingPlaySeason;
    private String pendingPlayEpisode;
    private String pendingPlayServer;
    private String pendingPlayQuery;
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
    private boolean pipOpen;
    private volatile boolean suppressEmbedOpen = true;
    private long lastPlayerOpenAt;
    /** Polls the browse WebView for the site's SPA player route. */
    private Runnable playerRouteWatcher;
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
            playerOverlay = new FumioPlayerOverlay(this, this::onOverlayClosed);
            verifyClient = new VerifyClient(this);
            if (!TvMode.isTv(this)) {
                // A television never shows the wall (ensureUnlocked), so this
                // prefetch is a wasted request there.
                new Thread(
                    () -> {
                        try {
                            verifyClient.entitlement();
                        } catch (Exception ignored) {
                            // Prefetch only — Play will retry.
                        }
                    },
                    "ogpb-verify"
                ).start();
            }
            installClients(webView, bridge);
            installCrashTrail();
            // TELEVISION ONLY. On a phone this call returns immediately.
            TvUi.install(this, webView);
            LiveServers.load(this);
            LiveServers.refresh(this, webView);
            SystemBars.browse(getWindow(), webView);
            webView.post(() -> SystemBars.browse(getWindow(), webView));
            installBackHandler();
            handleAuthIntent(getIntent());
            armLoadWatchdog();
            watchNetwork();
            // The update check itself is cheap and silent, but its DIALOG must
            // not be shown from onCreate: the window has no token yet and
            // AlertDialog.show() then throws BadTokenException — one of the
            // reported crash types. It waits for the first resume instead.
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

    /**
     * The network came back. If the offline screen is up because there was no
     * connection, waiting for someone to press "Try again" is silly — the app
     * can see the connection return. Costs nothing while all is well: the
     * callback only does work while that screen is showing.
     */
    private ConnectivityManager.NetworkCallback networkCallback;

    private void watchNetwork() {
        try {
            ConnectivityManager manager =
                (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
            if (manager == null) return;
            networkCallback =
                new ConnectivityManager.NetworkCallback() {
                    @Override
                    public void onAvailable(Network network) {
                        runOnUiThread(
                            () -> {
                                if (!OfflineScreen.isShowing()) return;
                                if (playerActive) return;
                                retryLiveSite();
                            }
                        );
                    }
                };
            manager.registerDefaultNetworkCallback(networkCallback);
        } catch (Throwable ignored) {
            // A missing callback is an inconvenience, not a failure.
        }
    }

    private void stopWatchingNetwork() {
        if (networkCallback == null) return;
        try {
            ConnectivityManager manager =
                (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
            if (manager != null) manager.unregisterNetworkCallback(networkCallback);
        } catch (Throwable ignored) {
            // already gone
        }
        networkCallback = null;
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) return;
        try {
            // Losing the window means the app is behind something — another app,
            // the launcher, a system dialog. A held direction or an open hover
            // menu must not survive that: its key-up arrives at a screen that is
            // not there, and the ring glides on its own when the app returns.
            // (onPause is final in BridgeActivity, so this is the hook.)
            TvPointer.onPause();
        } catch (Throwable ignored) {
            // Never let the TV layer break a normal lifecycle call.
        }
    }

    /** The update prompt is shown once the window really exists. */
    private boolean updateChecked;

    @Override
    public void onResume() {
        super.onResume();
        if (!updateChecked && !isFinishing() && !isDestroyed()) {
            updateChecked = true;
            // One frame after the window is attached, so the dialog has a token.
            getWindow().getDecorView().post(() -> {
                try {
                    Updater.checkAndPrompt(MainActivity.this);
                } catch (Throwable ignored) {
                    // An update check must never be able to crash a launch.
                }
            });
        }
        if (pipOpen) return;
        if (!playerActive) {
            Bridge bridge = getBridge();
            SystemBars.browse(getWindow(), bridge != null ? bridge.getWebView() : null);
        }
        if (waitingOnChrome || verifyWall.isShowing()) refreshUnlock(false);
    }

    @Override
    public void onUserLeaveHint() {
        super.onUserLeaveHint();
        if (playerActive) enterPip();
    }

    @Override
    public void onPictureInPictureModeChanged(boolean inPip, Configuration config) {
        super.onPictureInPictureModeChanged(inPip, config);
        pipOpen = inPip;
        if (inPip) {
            SystemBars.hide(getWindow());
            return;
        }
        if (playerActive) {
            SystemBars.hide(getWindow(), liveWebView());
        }
    }

    /**
     * The remote, on a TV. Dialogs (verify wall, updater) live in their own
     * window and never reach this method, so a D-pad press inside a dialog
     * stays a dialog press.
     */
    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        try {
            if (TvUi.handleKey(this, keyTarget(), event)) return true;
        } catch (Exception ignored) {
            // Fall through to the normal dispatch: a broken key path must not
            // make the remote dead.
        }
        return super.dispatchKeyEvent(event);
    }

    // ─── when the renderer dies ──────────────────────────────────────────────

    /**
     * The WebView's renderer was killed (out of memory, or a GPU crash). The
     * only safe move is to throw the dead WebView away and build a new one:
     * touching a WebView whose renderer is gone throws from every call.
     *
     * What the viewer sees: the site reloads where they were, rather than the
     * app disappearing. If they were watching, the player is closed first —
     * a dead player cannot keep playing, and pretending otherwise loses the
     * resume point.
     */
    private boolean recoverFromDeadRenderer(WebView dead, RenderProcessGoneDetail detail) {
        Log.w("FumioCrash", "WebView renderer gone (crashed=" + (detail != null && detail.didCrash()) + ")");
        if (isFinishing() || isDestroyed()) return true;

        String lastUrl = lastGoodUrl;
        try {
            if (playerActive) closeAppPlayer();
        } catch (Throwable ignored) {
            // The player is dead either way.
        }
        try {
            dismissPopup();
        } catch (Throwable ignored) {
            // Popup is dead either way.
        }

        // Rebuild the browse WebView on a clean slate.
        try {
            if (dead != null && dead.getParent() instanceof ViewGroup) {
                ((ViewGroup) dead.getParent()).removeView(dead);
            }
            if (dead != null) dead.destroy();
        } catch (Throwable ignored) {
            // A dead WebView often refuses to be destroyed; nothing to do.
        }
        // recreate() rebuilds the activity, the bridge and a fresh WebView. It
        // starts at the site's home rather than the page they were on: a
        // remembered URL is not worth restoring state the site no longer has,
        // and a wrong page on a television is harder to get out of than home.
        if (lastUrl != null) Log.i("FumioCrash", "was at " + lastUrl);
        try {
            recreate();
        } catch (Throwable error) {
            Log.w("FumioCrash", "recreate failed: " + error.getMessage());
        }
        return true;
    }

    // ─── when the site will not load ─────────────────────────────────────────

    /** How long the live site gets to paint before we stop waiting politely. */
    private static final long LOAD_TIMEOUT_MS = 30000L;

    private Runnable loadWatchdog;

    /** The last thing that went wrong, verbatim — shown small on the screen. */
    private String failureReason = "";

    private void showOfflineScreen() {
        if (isFinishing() || isDestroyed()) return;
        if (playerActive) return; // a video is playing: never cover it
        OfflineScreen.show(
            this,
            liveWebView(),
            this::retryLiveSite,
            this::browseBundledCopy,
            localAppUrl != null && !localAppUrl.isEmpty(),
            failureReason
        );
    }

    /**
     * A user's screenshot is the only diagnostic we ever get, and "can't connect"
     * tells us nothing: DNS, TLS, a captive portal, an ISP block, a 502 and a
     * timeout all look identical on a black screen. The reason is printed on the
     * offline screen, so the next screenshot IS the bug report.
     */
    private void noteFailure(String reason) {
        failureReason = reason == null ? "" : reason;
    }

    /** Turn a WebResourceError into something a human can act on. */
    private static String describeError(WebResourceError error) {
        if (error == null) return "Load failed";
        String text = "";
        try {
            CharSequence description = error.getDescription();
            text = description == null ? "" : description.toString();
        } catch (Exception ignored) {
            // an old WebView without getDescription
        }
        int code = 0;
        try {
            code = error.getErrorCode();
        } catch (Exception ignored) {
            // same
        }
        // The ones that actually happen, named plainly.
        switch (code) {
            case WebViewClient.ERROR_HOST_LOOKUP:
                return "DNS lookup failed - the domain did not resolve";
            case WebViewClient.ERROR_CONNECT:
                return "Connection refused - nothing answered at that address";
            case WebViewClient.ERROR_TIMEOUT:
                return "Timed out - the server did not answer";
            case WebViewClient.ERROR_FAILED_SSL_HANDSHAKE:
                return "TLS handshake failed";
            case WebViewClient.ERROR_UNSUPPORTED_SCHEME:
                return "Unsupported URL scheme";
            default:
                break;
        }
        if (text.isEmpty()) return "Load failed (error " + code + ")";
        return text + " (" + code + ")";
    }

    /** "Try again": the live site, from the top, with a fresh clock. */
    private void retryLiveSite() {
        liveFailed = false;
        openedLive = true;
        armLoadWatchdog();
        WebView page = liveWebView();
        if (page != null) page.loadUrl(LIVE_ORIGIN + "/");
    }

    /** "Browse offline": the copy of the site that ships inside the app. */
    private void browseBundledCopy() {
        WebView page = liveWebView();
        if (page == null || localAppUrl == null || localAppUrl.isEmpty()) return;
        liveFailed = true; // do not bounce straight back to the live site
        openedLive = true;
        page.loadUrl(localAppUrl + "/");
    }

    private void armLoadWatchdog() {
        cancelLoadWatchdog();
        WebView page = liveWebView();
        if (page == null) return;
        loadWatchdog = () -> {
            loadWatchdog = null;
            if (playerActive) return;
            if (OfflineScreen.isShowing()) return;
            liveFailed = true;
            openedLive = true;
            noteFailure("No answer within 30 seconds");
            showOfflineScreen();
        };
        page.postDelayed(loadWatchdog, LOAD_TIMEOUT_MS);
    }

    private void cancelLoadWatchdog() {
        if (loadWatchdog == null) return;
        WebView page = liveWebView();
        if (page != null) page.removeCallbacks(loadWatchdog);
        loadWatchdog = null;
    }

    /** Whichever WebView the viewer is actually looking at. */
    private WebView keyTarget() {
        if (OfflineScreen.isShowing()) {
            // The "join our socials" screen is a page too: the arrow must press
            // ITS buttons instead of tapping the dead site behind it.
            WebView offline = OfflineScreen.webView();
            if (offline != null) return offline;
        }
        if (playerActive && playerOverlay != null) {
            WebView player = playerOverlay.playerWebView();
            if (player != null) return player;
        }
        return liveWebView();
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
        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) ->
            Downloader.start(this, webView, url, userAgent, contentDisposition, mimeType)
        );
        String ua = settings.getUserAgentString();
        if (ua != null) {
            settings.setUserAgentString(ua.replace("; wv", "").replace("Version/4.0 ", ""));
        }
    }

    public class NativeBridge {
        /** tv-cursor.js publishes the scrollable strip under the cursor. */
        @JavascriptInterface
        public void tvScrollZone(String payload) {
            TvPointer.setScrollZone(payload);
        }

        /**
         * tv-cursor.js publishes where a tap should land (the outlined target's
         * centre, as fractions of the viewport) every time the target changes —
         * so a click needs no round trip and can never use a stale point.
         */
        @JavascriptInterface
        public void tvTarget(String point) {
            TvPointer.setTapTarget(point);
        }

        /** tv-cursor.js tells us when the remote belongs to a text field. */
        @JavascriptInterface
        public void tvInputFocused(boolean typing) {
            TvUi.setInputFocused(typing);
        }



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
        public void openDownloads() {
            runOnUiThread(
                () -> {
                    try {
                        startActivity(new Intent(MainActivity.this, DownloadsActivity.class));
                    } catch (Exception ignored) {
                        // Nothing to show if the activity cannot start.
                    }
                }
            );
        }

        @JavascriptInterface
        public void playDownloaded(String uri, String title) {
            if (uri == null || uri.isEmpty()) return;
            runOnUiThread(
                () -> {
                    try {
                        startActivity(
                            OfflinePlayerActivity.intentFor(
                                MainActivity.this,
                                Uri.parse(uri),
                                title == null ? "" : title
                            )
                        );
                    } catch (Exception ignored) {
                        // Unplayable file: the list stays as it was.
                    }
                }
            );
        }

        @JavascriptInterface
        public void openWatch(String type, String id, String season, String episode) {
            runOnUiThread(() -> openAppPlayer(type, id, season, episode));
        }

        @JavascriptInterface
        public void openWatchServer(String type, String id, String season, String episode, String server) {
            runOnUiThread(() -> openAppPlayer(type, id, season, episode, server));
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
                "ogpb-http"
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
        String host = data.getHost();
        if (host != null && host.equalsIgnoreCase("verify")) {
            onVerifyReturn(data.getQueryParameter("code"));
            return;
        }
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

    /** The last URL the live WebView actually finished loading. */
    private String lastGoodUrl;
    private long lastTrimAt;

    private class TrustedWebViewClient extends BridgeWebViewClient {
        TrustedWebViewClient(Bridge bridge) {
            super(bridge);
        }

        /**
         * THE CRASH THAT KILLED TVs.
         *
         * On Android 8+, if the WebView's renderer process is killed — and a TV
         * box does that constantly, because the renderer is the biggest thing
         * in the process and the system is always short of RAM — the default
         * behaviour is to crash the WHOLE APP. Not "the page failed": a hard
         * crash, no dialog, straight to the TV home screen. Every other WebView
         * in this app is short-lived; this one is the app.
         *
         * @return true = we handled it, the app stays alive.
         */
        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            try {
                return recoverFromDeadRenderer(view, detail);
            } catch (Throwable ignored) {
                // Never let the recovery path itself crash.
                return true;
            }
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
            if (isDownloadPath(url)) {
                // The site's /download window is a real page (TG + vidsrc
                // pools). It used to be swallowed here, which is exactly why
                // the download button did nothing in the app; the file links
                // inside it now reach DownloadManager through the listener
                // installed in installClients().
                return !(isLiveSite(url) || isOwnOrigin(url));
            }
            if (mainFrame && Downloader.looksLikeFile(url.toString())) {
                // A direct file link (the download pools' final hop). Hand it
                // to DownloadManager instead of letting the WebView try to
                // render an .mkv.
                Bridge bridge = getBridge();
                Downloader.start(
                    MainActivity.this,
                    bridge == null ? null : bridge.getWebView(),
                    url.toString(),
                    null,
                    null,
                    null
                );
                return true;
            }
            if (isPlayerEmbed(url)) {
                openAppPlayerFromEmbed(url);
                return true;
            }
            if (isLiveSite(url)) {
                // The app's offline library. The website has no /my-downloads
                // route, so this URL is the portable way to reach the files
                // already on the phone (and a link the site can point at).
                String livePathRaw = url.getPath();
                if (livePathRaw != null && livePathRaw.toLowerCase(Locale.US).startsWith("/my-downloads")) {
                    runOnUiThread(
                        () -> {
                            try {
                                startActivity(new Intent(MainActivity.this, DownloadsActivity.class));
                            } catch (Exception ignored) {
                                // Stay where we are.
                            }
                        }
                    );
                    return true;
                }
                if (isVerifyPath(url)) {
                    openVerifyInChrome(url.toString());
                    return true;
                }
                if (mainFrame && isWatchPath(url)) {
                    openAppPlayerFromWatch(url);
                    return true;
                }
                String livePath = url.getPath();
                if (livePath != null && livePath.toLowerCase(Locale.US).contains("watch-party")) return true;
                return false;
            }
            if (isOwnOrigin(url)) {
                if (mainFrame && isWatchPath(url)) {
                    openAppPlayerFromWatch(url);
                    return true;
                }
                if (googleRedirectActive && mainFrame) stayOnApp();
                return null;
            }
            if (!mainFrame) return false;
            if (isSocial(url)) {
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
            // Everything else that wants to leave the page is an ad, a
            // smartlink or a popunder: swallow it. A window or tab opening
            // over the film is the single thing that makes the app feel cheap,
            // and there is no legitimate foreign http(s) navigation from the
            // site's own pages — the links it MEANS to open (socials, help)
            // come through FumioNative.openBrowser, which is untouched.
            //
            // mailto:/tel:/sms: are not ads and belong to the phone.
            String foreignScheme = url.getScheme();
            if (foreignScheme != null && !foreignScheme.toLowerCase(Locale.US).startsWith("http")) {
                if (isLaunchableUri(url)) openExternal(url);
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
            if (uri != null) lastGoodUrl = url;
            showDiagnosticsIfAsked(view, url);
            if (isOwnOrigin(uri)) rememberLocalAppUrl();
            if (!openedLive && !liveFailed && isOwnOrigin(uri)) {
                openedLive = true;
                // The live site gets 30 s to show something. If it cannot, the
                // viewer gets a page with the socials instead of a blank white
                // window that never explains itself.
                armLoadWatchdog();
                view.post(() -> view.loadUrl(LIVE_ORIGIN + "/"));
                return;
            }
            if (isOwnOrigin(uri) && openedLive) {
                // The bundled build (the fallback when the site is down) is our
                // own page: pointer helper only, no viewport rewrite. Without
                // this the cursor had no target resolution on the fallback and
                // every press landed blind.
                TvUi.onOwnPageFinished(MainActivity.this, view);
                return;
            }
            if (isLiveSite(uri)) {
                liveFailed = false;
                cancelLoadWatchdog();
                OfflineScreen.onPageLoaded();
                noteBrowsePage(uri);
                if (!liveHistoryCleared) {
                    liveHistoryCleared = true;
                    view.clearHistory();
                }
                injectPlayerScript(view);
                TvUi.onLivePageFinished(MainActivity.this, view);
                startPlayerRouteWatcher(view);
            }
            deliverPendingAuthToken();
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (!playerActive && request != null && request.isForMainFrame()) {
                Uri failed = request.getUrl();
                if (isLiveSite(failed)) {
                    liveFailed = true;
                    openedLive = true;
                    rememberLocalAppUrl();
                    cancelLoadWatchdog();
                    noteFailure(describeError(error));
                    // The site is down. The bundled copy used to load silently
                    // here, which on a dead network is a worse lie than saying
                    // so: the API is unreachable and every rail is empty. The
                    // screen says what happened and offers the copy as a choice.
                    view.post(MainActivity.this::showOfflineScreen);
                } else if (openedLive && isOwnOrigin(failed)) {
                    // Even the built-in copy did not paint.
                    cancelLoadWatchdog();
                    noteFailure(describeError(error) + " (bundled copy)");
                    view.post(MainActivity.this::showOfflineScreen);
                }
            }
            super.onReceivedError(view, request, error);
        }

        /**
         * The site answered, and the answer was "I am broken" (502/503/504 from
         * a dead backend is the common one). onReceivedError never fires for
         * that — the load succeeded — so it is caught here.
         */
        @Override
        public void onReceivedHttpError(
            WebView view,
            WebResourceRequest request,
            WebResourceResponse response
        ) {
            try {
                if (
                    !playerActive &&
                    request != null &&
                    request.isForMainFrame() &&
                    isLiveSite(request.getUrl()) &&
                    response != null &&
                    response.getStatusCode() >= 500
                ) {
                    liveFailed = true;
                    openedLive = true;
                    cancelLoadWatchdog();
                    noteFailure("Server returned HTTP " + response.getStatusCode());
                    view.post(MainActivity.this::showOfflineScreen);
                }
            } catch (Exception ignored) {
                // A status code is not worth a crash.
            }
            super.onReceivedHttpError(view, request, response);
        }
    }

    private class PopupChromeClient extends WebChromeClient {
        private final WebChromeClient delegate;

        PopupChromeClient(WebChromeClient delegate) {
            this.delegate = delegate;
        }

        /**
         * Every user-gesture popup gets a real window, and {@link #handlePopupUrl}
         * decides what it is on the popup's FIRST load.
         *
         * Why not decide here: the page calls window.open() and only THEN gives
         * the window its URL, so at this point there usually is no URL to look
         * at. The old code asked the anchor under the cursor, which is empty for
         * window.open() — so a download button did nothing at all (the reported
         * "downloads won't open"), while a target=_blank ad was still launched
         * into Chrome. One window, one decision, at the moment the URL exists.
         */
        @Override
        public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
            if (!isUserGesture || resultMsg == null || !(resultMsg.obj instanceof WebView.WebViewTransport)) {
                return false;
            }
            Uri hitUrl = hitTestUri(view);
            if (isSocial(hitUrl)) {
                openExternal(hitUrl);
                return false;
            }
            try {
                final WebView popup = createPopupWebView();
                // Attached, but 2x2 and INVISIBLE: a WebView can only load a
                // popup once it is in a window, and nothing may appear on
                // screen before we know what the window is FOR. An ad popunder
                // that never navigates would otherwise leave a blank black
                // dialog over the whole app with no way out.
                ViewGroup root = findViewById(android.R.id.content);
                if (root != null) {
                    FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(2, 2);
                    lp.gravity = Gravity.BOTTOM | Gravity.END;
                    popup.setLayoutParams(lp);
                    popup.setVisibility(View.INVISIBLE);
                    root.addView(popup);
                }
                popupView = popup;
                ((WebView.WebViewTransport) resultMsg.obj).setWebView(popup);
                resultMsg.sendToTarget();
                // Nothing decided in a second and a half: it was an ad that
                // never went anywhere. Drop it.
                popup.postDelayed(
                    () -> {
                        if (popupView == popup && popupDialog == null) dismissPopup();
                    },
                    1500
                );
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
        popup.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) ->
            Downloader.start(this, popup, url, userAgent, contentDisposition, mimeType)
        );
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

    /**
     * What the popup turned out to be. Runs on the popup's FIRST navigation,
     * which is the first moment a URL exists at all.
     *
     * @return true to keep the navigation out of the popup (we handled it),
     *         false to let the popup load the URL.
     */
    private boolean handlePopupUrl(Uri url) {
        if (url == null) {
            dismissPopup();
            return true;
        }

        // A link the site means to open: the browser, not the app.
        if (isSocial(url)) {
            openExternal(url);
            dismissPopup();
            return true;
        }

        // The last hop of a download pool is a direct file, not a page: nothing
        // loads it, so the popup's DownloadManager listener would never fire.
        if (Downloader.looksLikeFile(url.toString())) {
            Downloader.start(this, liveWebView(), url.toString(), null, null, null);
            dismissPopup();
            return true;
        }

        // The app's own download library is a native screen, not a web route.
        String path = url.getPath() == null ? "" : url.getPath().toLowerCase(Locale.US);
        if (isLiveSite(url) && path.startsWith("/my-downloads")) {
            dismissPopup();
            try {
                startActivity(new Intent(this, DownloadsActivity.class));
            } catch (Exception ignored) {
                // Stay where we are.
            }
            return true;
        }

        // A Play button that opens the site's player in a new window: hand it
        // to the APP's player instead of showing a web page.
        if (isLiveSite(url) && isWatchPath(url) && !playerActive) {
            dismissPopup();
            openAppPlayerFromWatch(url);
            return true;
        }

        // A download portal — or any page of our own site. It is a real page,
        // so it belongs in the main window, where BACK and the site's own
        // header work. This is the fix for "downloads won't open": it used to
        // be dropped here because there was no anchor to ask.
        if (isDownloadPath(url) || isDownloadHost(url) || isLiveSite(url)) {
            dismissPopup();
            WebView live = liveWebView();
            if (live != null) live.loadUrl(url.toString());
            return true;
        }

        // Sign-in keeps its own window and never goes to Chrome.
        if (isAuthProvider(url) || isBenignPopupUrl(url)) {
            if (popupDialog == null && popupView != null) showPopup(popupView);
            return false;
        }

        // Smartlink, ad tab, popunder: gone. This is the ad block, and it sits
        // on every server's play button because every server uses this path.
        dismissPopup();
        return true;
    }

    private void showPopup(WebView popup) {
        if (isFinishing()) {
            popup.destroy();
            return;
        }
        // A popup is created as a 2x2 invisible probe (see onCreateWindow), so
        // detach it before the dialog adopts it, and clear popupView first or
        // dismissPopup() would destroy the very view we are about to show.
        if (popup.getParent() instanceof ViewGroup) {
            ((ViewGroup) popup.getParent()).removeView(popup);
        }
        popupView = null;
        dismissPopup();
        popup.setVisibility(View.VISIBLE);
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

    /**
     * The site is a single-page app: its Play button calls history.pushState,
     * which the WebView never reports through shouldOverrideUrlLoading —
     * so the site's /player page used to load INSIDE the browse WebView.
     *
     * This watches the live WebView's location while the app player is closed
     * and, the moment it lands on the player route, opens the APP's player and
     * puts the browse page back where the viewer was. Deterministic: it does
     * not depend on our injected script winning a race with the site's bundle.
     */
    /**
     * The route watcher is a safety net for SPA navigation our injected
     * pushState/replaceState patch did not see (older WebViews, a framework that
     * keeps its own history object). It is an evaluateJavascript round trip on
     * the UI thread, so it runs at 400 ms only just after a page load and then
     * backs off to 2.5 s: fast where a click is about to happen, quiet after.
     */
    private static final long ROUTE_POLL_FAST_MS = 400L;
    private static final long ROUTE_POLL_SLOW_MS = 2500L;
    private int routePolls;

    private void startPlayerRouteWatcher(WebView view) {
        if (view == null) return;
        stopPlayerRouteWatcher();
        routePolls = 0;
        playerRouteWatcher =
            new Runnable() {
                @Override
                public void run() {
                    Bridge bridge = getBridge();
                    WebView live = bridge == null ? null : bridge.getWebView();
                    if (live == null || playerActive || isFinishing() || isDestroyed()) return;
                    live.evaluateJavascript(
                        "(function(){try{return location.pathname+location.search;}catch(e){return '';}})()",
                        value -> {
                            String raw = value == null ? "" : value;
                            if (raw.startsWith("\"") && raw.endsWith("\"") && raw.length() > 1) {
                                raw = raw.substring(1, raw.length() - 1);
                            }
                            raw = raw.replace("\\/", "/");
                            if (raw.isEmpty() || playerActive) return;
                            Uri target = Uri.parse(LIVE_ORIGIN + (raw.startsWith("/") ? raw : "/" + raw));
                            if (!isWatchPath(target)) return;
                            stopPlayerRouteWatcher();
                            openAppPlayerFromWatch(target);
                            // Put the browse page back so closing the player
                            // lands on the details page, not on /player.
                            live.post(
                                () ->
                                    live.evaluateJavascript(
                                        "(function(){try{history.back();}catch(e){}})()",
                                        null
                                    )
                            );
                        }
                    );
                    routePolls += 1;
                    view.postDelayed(
                        this,
                        routePolls > 50 ? ROUTE_POLL_SLOW_MS : ROUTE_POLL_FAST_MS
                    );
                }
            };
        view.postDelayed(playerRouteWatcher, 400);
    }

    private void stopPlayerRouteWatcher() {
        Runnable watcher = playerRouteWatcher;
        playerRouteWatcher = null;
        if (watcher == null) return;
        try {
            Bridge bridge = getBridge();
            WebView live = bridge == null ? null : bridge.getWebView();
            if (live != null) live.removeCallbacks(watcher);
        } catch (Exception ignored) {
            /* activity going away */
        }
    }

    private void injectPlayerScript(WebView view) {
        if (view == null || playerScript == null || playerScript.isEmpty()) return;
        view.evaluateJavascript(playerScript, null);
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
        // The site's player is /player?id=…&type=…&season=…&episode=…&server=…
        // `server` (slot index or stable key) is the viewer's choice and must
        // survive the hand-off to the in-app player.
        String server = firstQuery(url, "server", null);
        // The whole query travels with the link: whatever the site puts in a
        // /player URL reaches the live player untouched, so a new parameter
        // never needs an app release again.
        String query = url.getEncodedQuery();
        if (path.toLowerCase(Locale.US).startsWith("/player")) {
            openAppPlayer(
                firstQuery(url, "type", "movie"),
                firstQuery(url, "id", null),
                firstQuery(url, "season", "1"),
                firstQuery(url, "episode", "1"),
                server,
                query
            );
            return;
        }
        Matcher match = EMBED_TITLE.matcher(path);
        if (!match.find()) return;
        openAppPlayer(
            match.group(1),
            match.group(2),
            firstQuery(url, "season", match.group(3)),
            firstQuery(url, "episode", match.group(4)),
            server,
            query
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
        openAppPlayer(type, id, season, episode, null);
    }

    private void openAppPlayer(String type, String id, String season, String episode, String server) {
        openAppPlayer(type, id, season, episode, server, null);
    }

    private void openAppPlayer(
        String type,
        String id,
        String season,
        String episode,
        String server,
        String sourceQuery
    ) {
        if (id == null || id.isEmpty()) return;
        if (playerActive) return;
        pendingPlayType = type;
        pendingPlayId = id;
        pendingPlaySeason = season;
        pendingPlayEpisode = episode;
        pendingPlayServer = server;
        pendingPlayQuery = sourceQuery;
        pendingPlay = true;
        ensureUnlocked(this::openPendingPlayer);
    }

    private void openPendingPlayer() {
        if (!pendingPlay) return;
        String type = pendingPlayType;
        String id = pendingPlayId;
        String season = pendingPlaySeason;
        String episode = pendingPlayEpisode;
        String server = pendingPlayServer;
        String sourceQuery = pendingPlayQuery;
        pendingPlayServer = null;
        pendingPlayQuery = null;
        pendingPlay = false;
        if (id == null || id.isEmpty()) return;
        if (playerActive) return;
        playerActive = true;
        stopPlayerRouteWatcher();
        lastPlayerOpenAt = System.currentTimeMillis();
        freezeLiveWebView(true, true);
        SystemBars.hide(getWindow(), liveWebView());
        setPipAutoEnter(true);
        if (playerOverlay == null) {
            playerOverlay = new FumioPlayerOverlay(this, this::onOverlayClosed);
        }
        snapshotLiveSession((seed) -> {
            if (isFinishing() || isDestroyed()) {
                onOverlayClosed(null);
                return;
            }
            playerOverlay.open(type, id, season, episode, seed, server, sourceQuery);
            // The overlay is a new child of the same content frame, so it is
            // above the cursor view: without this the ring vanishes the moment
            // a video starts, while every press still goes to the player.
            if (TvMode.isTv(this)) TvPointer.raise();
        });
    }

    private void closeAppPlayer() {
        if (playerOverlay != null && playerOverlay.isShowing()) playerOverlay.close();
        else onOverlayClosed(null);
    }

    private void onOverlayClosed(String continueWatching) {
        playerActive = false;
        // The cursor was talking to the player's WebView; the viewer is back on
        // the browse page, so the target must follow them or every click and
        // hover would go to a hidden view.
        if (TvMode.isTv(this)) {
            TvPointer.retarget(liveWebView());
            TvPointer.raise();
        }
        Bridge afterBridge = getBridge();
        if (afterBridge != null && afterBridge.getWebView() != null) {
            startPlayerRouteWatcher(afterBridge.getWebView());
        }
        pipOpen = false;
        setPipAutoEnter(false);
        freezeLiveWebView(false, true);
        SystemBars.browse(getWindow(), liveWebView());
        applyContinueWatchingToLiveSite(continueWatching);
    }

    private WebView liveWebView() {
        Bridge bridge = getBridge();
        return bridge != null ? bridge.getWebView() : null;
    }

    private void freezeLiveWebView(boolean freeze) {
        freezeLiveWebView(freeze, false);
    }

    private void freezeLiveWebView(boolean freeze, boolean hide) {
        WebView live = liveWebView();
        if (live == null) return;
        try {
            if (freeze) {
                live.evaluateJavascript(PAUSE_TRAILERS, null);
                if (hide) live.setVisibility(View.INVISIBLE);
            } else {
                live.setVisibility(View.VISIBLE);
                live.evaluateJavascript(RESTORE_TRAILERS, null);
            }
        } catch (Exception ignored) {
            /* webview already gone */
        }
    }

    private static final String PAUSE_TRAILERS =
        "(function(){try{"
            + "document.querySelectorAll('video').forEach(function(v){try{v.pause();v.muted=true;}catch(e){}});"
            + "document.querySelectorAll('iframe').forEach(function(f){"
            + "var s=f.getAttribute('src')||'';"
            + "if(!/youtube|youtu\\.be/i.test(s))return;"
            + "if(!f.getAttribute('data-fumio-yt'))f.setAttribute('data-fumio-yt',s);"
            + "f.setAttribute('src','about:blank');"
            + "});"
            + "}catch(e){}})()";

    private static final String RESTORE_TRAILERS =
        "(function(){try{"
            + "document.querySelectorAll('iframe[data-fumio-yt]').forEach(function(f){"
            + "var s=f.getAttribute('data-fumio-yt')||'';"
            + "s=s.replace(/autoplay=1/gi,'autoplay=0').replace(/autoplay=true/gi,'autoplay=0');"
            + "f.removeAttribute('data-fumio-yt');"
            + "f.setAttribute('src',s);"
            + "});"
            + "}catch(e){}})()";

    private void enterPip() {
        if (Build.VERSION.SDK_INT < 26) return;
        if (!playerActive || pipOpen) return;
        try {
            enterPictureInPictureMode(
                new PictureInPictureParams.Builder().setAspectRatio(new Rational(16, 9)).build()
            );
        } catch (Exception ignored) {
            /* device declined PiP */
        }
    }

    private void setPipAutoEnter(boolean enable) {
        if (Build.VERSION.SDK_INT < 31) return;
        try {
            setPictureInPictureParams(
                new PictureInPictureParams.Builder()
                    .setAspectRatio(new Rational(16, 9))
                    .setAutoEnterEnabled(enable)
                    .setSeamlessResizeEnabled(true)
                    .build()
            );
        } catch (Exception ignored) {
            /* older webview / no PiP */
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
        if (
            host.contains("vidsrc") ||
            host.contains("videasy") ||
            host.contains("vidfast") ||
            host.contains("vidlink") ||
            host.contains("vidstuck") ||
            host.contains("zxcstream")
        ) {
            return true;
        }
        return hostMatches(
            url,
            "vidstuck.xyz",
            "vidstuck.cc",
            "bingr.one",
            "zxcstream.xyz",
            "zxcstream.cc",
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
                    if (OfflineScreen.isShowing()) {
                        OfflineScreen.hide();
                        return;
                    }
                    if (verifyWall.isShowing()) {
                        hideVerifyWall();
                        return;
                    }
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

    /** Anything the site links to on purpose: Discord, Telegram, Instagram. */
    private boolean isSocial(Uri url) {
        if (isDiscord(url)) return true;
        return hostMatches(url, "t.me", "telegram.me", "telegram.org", "instagram.com", "instagr.am");
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

    private boolean isVerifyPath(Uri url) {
        if (url == null) return false;
        String path = url.getPath();
        return path != null && path.toLowerCase(Locale.US).startsWith("/verify");
    }

    private void ensureUnlocked(Runnable onUnlocked) {
        // TELEVISION: no ad wall. A 10-foot screen is a family screen — a
        // 12-hour unlock card in front of a film is the worst thing we could
        // put on it. This is the ONLY place the decision is made, so the phone
        // path is byte-for-byte what it was: verify wall, desktop Chrome
        // hand-off and entitlement cache all still run there.
        if (TvMode.isTv(this)) {
            onUnlocked.run();
            return;
        }
        if (verifyClient != null && verifyClient.isLocallyUnlocked()) {
            onUnlocked.run();
            return;
        }
        showVerifyWall();
    }

    private void showVerifyWall() {
        verifyWall.attach(
            this,
            new VerifyWall.Callbacks() {
                @Override
                public void onClickHere() {
                    launchVerifyChrome();
                }

                @Override
                public void onReload() {
                    refreshUnlock(true);
                }

                @Override
                public void onDismiss() {
                    hideVerifyWall();
                }
            }
        );
        verifyWall.setStatus("One ad wall in Chrome every 12 hours.");
        verifyWall.setBusy(false);
        verifyWall.show();
        freezeLiveWebView(true);
    }

    private void hideVerifyWall() {
        waitingOnChrome = false;
        pendingPlay = false;
        verifyWall.hide();
        verifyWall.setBusy(false);
        if (!playerActive) freezeLiveWebView(false);
    }

    private void launchVerifyChrome() {
        if (verifyBusy) return;
        if (verifyClient != null && verifyClient.isLocallyUnlocked()) {
            finishVerifyAndPlay();
            return;
        }
        String existing = verifyClient != null ? verifyClient.pendingVerifyUrl() : null;
        if (existing != null) {
            waitingOnChrome = true;
            verifyWall.setStatus("Finish in Chrome, then come back and tap Reload.");
            openVerifyInChrome(existing);
            return;
        }
        verifyBusy = true;
        verifyWall.setBusy(true);
        verifyWall.setStatus("Opening Chrome…");
        new Thread(
            () -> {
                VerifyClient.Result result;
                try {
                    result = verifyClient.start();
                } catch (Exception error) {
                    result = new VerifyClient.Result();
                    result.message = "Can't reach the server. Try Reload.";
                }
                final VerifyClient.Result done = result;
                runOnUiThread(() -> {
                    verifyBusy = false;
                    verifyWall.setBusy(false);
                    if (isFinishing() || isDestroyed()) return;
                    if (done.unlocked) {
                        finishVerifyAndPlay();
                        return;
                    }
                    String url = done.verifyUrl;
                    if (url == null && verifyClient != null) url = verifyClient.pendingVerifyUrl();
                    if (url != null) {
                        waitingOnChrome = true;
                        verifyWall.setStatus("Finish in Chrome, then come back and tap Reload.");
                        openVerifyInChrome(url);
                        return;
                    }
                    verifyWall.setStatus(
                        done.message == null
                            ? "Couldn't start verification. Tap Reload."
                            : done.message
                    );
                });
            },
            "ogpb-verify"
        ).start();
    }

    private void refreshUnlock(boolean fromReload) {
        if (verifyClient != null && verifyClient.isLocallyUnlocked()) {
            finishVerifyAndPlay();
            return;
        }
        if (!pendingPlay && !verifyWall.isShowing()) return;
        if (verifyBusy) return;
        verifyBusy = true;
        if (fromReload) verifyWall.setStatus("One moment…");
        new Thread(
            () -> {
                VerifyClient.Result result;
                try {
                    result = verifyClient.entitlement();
                } catch (Exception error) {
                    result = new VerifyClient.Result();
                    result.message = "Can't reach the server. Try Reload.";
                }
                final VerifyClient.Result done = result;
                runOnUiThread(() -> {
                    verifyBusy = false;
                    if (isFinishing() || isDestroyed()) return;
                    if (done.unlocked) {
                        finishVerifyAndPlay();
                        return;
                    }
                    if (verifyWall.isShowing()) {
                        verifyWall.setStatus(
                            waitingOnChrome
                                ? "Still locked. Finish in Chrome, then tap Reload."
                                : "Tap Click Here to continue."
                        );
                    }
                });
            },
            "ogpb-verify"
        ).start();
    }

    private void onVerifyReturn(String code) {
        waitingOnChrome = true;
        if (!verifyWall.isShowing()) showVerifyWall();
        if (code != null && !code.isEmpty()) {
            if (verifyBusy) return;
            verifyBusy = true;
            verifyWall.setStatus("Unlocking…");
            new Thread(
                () -> {
                    VerifyClient.Result result = verifyClient.redeem(code);
                    runOnUiThread(() -> {
                        verifyBusy = false;
                        if (result.unlocked) finishVerifyAndPlay();
                        else refreshUnlock(true);
                    });
                },
                "ogpb-verify"
            ).start();
            return;
        }
        refreshUnlock(true);
    }

    private void finishVerifyAndPlay() {
        waitingOnChrome = false;
        verifyWall.hide();
        verifyWall.setBusy(false);
        if (pendingPlay) openPendingPlayer();
        else if (!playerActive) freezeLiveWebView(false);
    }

    private void openVerifyInChrome(String url) {
        if (url == null || url.isEmpty()) return;
        Uri uri = Uri.parse(url);
        if (!isLaunchableUri(uri)) return;
        String[] browsers = {
            "com.android.chrome",
            "com.chrome.beta",
            "com.chrome.dev",
            "com.google.android.apps.chrome",
            "com.sec.android.app.sbrowser",
            "org.mozilla.firefox"
        };
        for (String pkg : browsers) {
            Intent chrome = new Intent(Intent.ACTION_VIEW, uri);
            chrome.addCategory(Intent.CATEGORY_BROWSABLE);
            chrome.setPackage(pkg);
            chrome.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            chrome.putExtra(android.provider.Browser.EXTRA_APPLICATION_ID, pkg);
            chrome.putExtra(android.provider.Browser.EXTRA_CREATE_NEW_TAB, true);
            try {
                startActivity(chrome);
                return;
            } catch (Exception ignored) {
                // Try the next browser.
            }
        }
        try {
            Intent any = new Intent(Intent.ACTION_VIEW, uri);
            any.addCategory(Intent.CATEGORY_BROWSABLE);
            any.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            any.setSelector(new Intent(Intent.ACTION_VIEW, Uri.parse("https://")));
            startActivity(any);
        } catch (Exception ignored) {
            openExternal(uri);
        }
    }

    /**
     * A television tells us when it is short of memory — and it does, often,
     * while a 4K stream is decoding. This is where the app gives memory back
     * BEFORE the system decides the cheaper fix is to kill the process.
     *
     * Two things only: let go of what is behind us, and let go of the renderer
     * caches. Nothing visible changes, and no page state is lost — the cache
     * is re-fetched from the network on the next load.
     */
    /**
     * The crash trail.
     *
     * A crash on a television is otherwise invisible: no adb, no DevTools, just
     * the home screen. This records the last uncaught exception — class, line
     * and message — on disk, and {@code #diagnostics} at the end of the app's
     * address shows it. WebView renderer deaths are handled (they do not reach
     * here); this is for everything else, including OOM.
     *
     * Nothing is uploaded and nothing leaves the device.
     */
    private void installCrashTrail() {
        final Thread.UncaughtExceptionHandler previous = Thread.getDefaultUncaughtExceptionHandler();
        if (previous instanceof CrashTrail) return;
        Thread.setDefaultUncaughtExceptionHandler(new CrashTrail(previous));
    }

    private class CrashTrail implements Thread.UncaughtExceptionHandler {
        private final Thread.UncaughtExceptionHandler previous;

        CrashTrail(Thread.UncaughtExceptionHandler previous) {
            this.previous = previous;
        }

        @Override
        public void uncaughtException(Thread thread, Throwable error) {
            try {
                StackTraceElement[] frames = error.getStackTrace();
                StackTraceElement top = frames != null && frames.length > 0 ? frames[0] : null;
                String text =
                    error.getClass().getName() +
                    "\n" +
                    (top == null ? "?" : top.toString()) +
                    "\n" +
                    (error.getMessage() == null ? "" : error.getMessage());
                java.io.FileOutputStream out =
                    openFileOutput("last-crash.txt", MODE_PRIVATE);
                out.write(text.getBytes(StandardCharsets.UTF_8));
                out.close();
            } catch (Throwable ignored) {
                // A crash reporter that crashes is worse than none.
            } finally {
                if (previous != null) previous.uncaughtException(thread, error);
            }
        }
    }

    /** The diagnostics panel, as text. Empty when nothing has gone wrong. */
    private String diagnostics() {
        StringBuilder out = new StringBuilder();
        try {
            out.append("Fumio ").append(getPackageManager().getPackageInfo(getPackageName(), 0).versionName);
            out.append(" (").append(Build.VERSION.RELEASE).append(")\n");
            out.append("TV: ").append(TvMode.isTv(this)).append("\n");
            out.append("heap: ")
                .append(Runtime.getRuntime().totalMemory() / (1024 * 1024))
                .append("/")
                .append(Runtime.getRuntime().maxMemory() / (1024 * 1024))
                .append(" MB\n");
        } catch (Throwable ignored) {
            // Best effort only.
        }
        try {
            java.io.File file = new java.io.File(getFilesDir(), "last-crash.txt");
            if (file.exists()) {
                java.io.BufferedReader reader =
                    new java.io.BufferedReader(new java.io.InputStreamReader(new java.io.FileInputStream(file), StandardCharsets.UTF_8));
                String line;
                out.append("\nlast crash:\n");
                while ((line = reader.readLine()) != null) out.append(line).append("\n");
                reader.close();
            } else {
                out.append("\nno crash recorded");
            }
        } catch (Throwable ignored) {
            out.append("\ncrash log unreadable");
        }
        return out.toString();
    }

    /** {@code #diagnostics} anywhere in the app's address. */
    private boolean showDiagnosticsIfAsked(WebView view, String url) {
        if (url == null || !url.contains("#diagnostics")) return false;
        String text = diagnostics();
        String script =
            "(function(t){var p=document.getElementById('fumio-diag');"
                + "if(!p){p=document.createElement('pre');p.id='fumio-diag';"
                + "p.style.cssText='position:fixed;inset:0;margin:0;padding:24px;z-index:2147483647;"
                + "background:#000;color:#fff;font-size:16px;white-space:pre-wrap;overflow:auto';"
                + "document.body.appendChild(p);p.onclick=function(){p.remove();};}"
                + "p.textContent=t;})(" + JSONObject.quote(text) + ");";
        try {
            view.evaluateJavascript(script, null);
        } catch (Throwable ignored) {
            // Nothing to show.
        }
        return true;
    }

    @Override
    public void onTrimMemory(int level) {
        super.onTrimMemory(level);
        try {
            if (level < ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW) return;
            long now = SystemClock.uptimeMillis();
            // Bounded: this is a cache clear, not something to do per frame.
            if (now - lastTrimAt < 15000L) return;
            lastTrimAt = now;
            WebView live = liveWebView();
            if (live == null) return;
            if (level >= ComponentCallbacks2.TRIM_MEMORY_COMPLETE) {
                // The next thing the system does is kill this process.
                live.clearCache(true);
                live.freeMemory();
            } else if (level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL) {
                live.freeMemory();
            }
        } catch (Throwable ignored) {
            // Trimming is best-effort by definition.
        }
    }

    @Override
    public void onDestroy() {
        try {
            exitFullscreen();
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
            if (playerOverlay != null && playerOverlay.isShowing()) playerOverlay.close();
            inAppGoogleAuth.dismiss();
            dismissPopup();
            verifyWall.hide();
        } catch (Exception ignored) {
            // Activity is already going away.
        }
        try {
            stopWatchingNetwork();
        } catch (Throwable ignored) {
            // nothing registered
        }
        try {
            OfflineScreen.hide();
        } catch (Throwable ignored) {
            // Nothing on screen.
        }
        try {
            // The TV cursor is a real View on this activity's content frame.
            TvPointer.release();
        } catch (Throwable ignored) {
            // Nothing to release, or no TV overlay at all.
        }
        super.onDestroy();
    }
}
