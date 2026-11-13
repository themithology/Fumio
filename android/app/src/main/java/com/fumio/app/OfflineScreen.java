package com.fumio.app;

import android.app.Activity;
import android.content.Context;
import android.content.ContextWrapper;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import java.lang.ref.WeakReference;

/**
 * "Something went wrong — join our socials."
 *
 * A page cannot show this itself: the whole point is that the page did not load.
 * So the screen is a bundled asset ({@code offline.html}: dark card layout, the
 * three official brand marks, Try again / Browse offline) inside a WebView that
 * lives on top of the activity's content frame.
 *
 * A WebView, and not native views, for one reason: on a television the remote
 * reaches the screen through {@link TvPointer}, and TvPointer taps whatever
 * WebView it is aimed at. A page made of buttons is therefore clickable with the
 * arrow exactly like the website is, with no second input path to keep alive.
 *
 * It needs no network: the asset is in the APK, network loads are blocked while
 * it is up, and the social links are handed to the system browser instead of
 * being opened inside it (a WebView would land on "site can't be reached").
 */
final class OfflineScreen {

    private static final String TAG = "FumioOffline";
    private static final String ASSET = "file:///android_asset/offline.html";
    private static final int BG = 0xFF08080B;

    private static final Handler MAIN = new Handler(Looper.getMainLooper());

    private static FrameLayout layer;
    private static WebView web;
    private static WeakReference<WebView> browse;
    private static Runnable onRetry;
    private static Runnable onBrowse;
    private static boolean canBrowse;
    /** What actually failed, shown in small type for the next bug report. */
    private static String reason = "";

    private OfflineScreen() {}

    static boolean isShowing() {
        return layer != null && layer.getParent() != null;
    }

    /** The WebView the remote should be aiming at while this screen is up. */
    static WebView webView() {
        return web;
    }

    /**
     * @param browseWebView the page to go back to when this screen closes.
     * @param retryAction   called when the viewer presses "Try again".
     * @param browseAction  called when the viewer presses "Browse offline".
     * @param bundleExists  whether the built-in copy of the site is available.
     * @param why           the failure in plain words (DNS, TLS, timeout, HTTP 5xx).
     */
    static void show(
        Activity activity,
        WebView browseWebView,
        Runnable retryAction,
        Runnable browseAction,
        boolean bundleExists,
        String why
    ) {
        if (activity == null || activity.isFinishing() || activity.isDestroyed()) return;
        onRetry = retryAction;
        onBrowse = browseAction;
        canBrowse = bundleExists;
        reason = why == null ? "" : why;
        if (browseWebView != null) browse = new WeakReference<>(browseWebView);
        if (isShowing()) {
            // Already up: the new callbacks and reason are enough, no reload.
            if (web != null && !reason.isEmpty()) {
                final String script = reasonScript(reason);
                web.post(() -> web.evaluateJavascript(script, null));
            }
            return;
        }
        try {
            ViewGroup root = activity.findViewById(android.R.id.content);
            if (root == null) return;

            FrameLayout frame = new FrameLayout(activity);
            frame.setBackgroundColor(BG);
            frame.setClickable(true);
            frame.setFocusable(true);

            WebView view = new WebView(activity);
            view.setBackgroundColor(BG);
            view.setVerticalScrollBarEnabled(false);
            view.setHorizontalScrollBarEnabled(false);
            view.setOverScrollMode(View.OVER_SCROLL_NEVER);
            view.setLongClickable(false);
            WebSettings settings = view.getSettings();
            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(false);
            settings.setAllowFileAccess(true);
            settings.setBuiltInZoomControls(false);
            settings.setDisplayZoomControls(false);
            settings.setSupportZoom(false);
            settings.setMediaPlaybackRequiresUserGesture(true);
            try {
                // Nothing on this screen may touch the network: the screen is
                // shown precisely when the network has failed.
                settings.setBlockNetworkLoads(true);
            } catch (Throwable ignored) {
                /* INTERNET permission missing — then there is nothing to block */
            }

            view.addJavascriptInterface(new Bridge(), "FumioOffline");
            view.setWebViewClient(
                new WebViewClient() {
                    @Override
                    public void onPageFinished(WebView v, String url) {
                        super.onPageFinished(v, url);
                        if (!isShowing()) return;
                        // The pointer helper outlines the card under the arrow,
                        // and retarget() makes the remote press THIS page.
                        TvUi.onOwnPageFinished(activity, v);
                        TvPointer.retarget(v);
                        if (!reason.isEmpty()) {
                            v.evaluateJavascript(reasonScript(reason), null);
                        }
                    }
                }
            );

            FrameLayout.LayoutParams fill = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            );
            frame.addView(view, fill);
            frame.setLayoutParams(
                new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
                )
            );
            root.addView(frame);

            layer = frame;
            web = view;
            view.loadUrl(ASSET);
        } catch (Throwable error) {
            Log.w(TAG, "offline screen unavailable: " + error.getMessage());
            layer = null;
            web = null;
        }
    }

    /** The page's hook for the diagnosis line; the reason is escaped for JS. */
    private static String reasonScript(String text) {
        StringBuilder out = new StringBuilder("window.FumioOfflineReason&&window.FumioOfflineReason(\"");
        for (int i = 0; i < text.length(); i += 1) {
            char c = text.charAt(i);
            if (c == '"') out.append("\\\"");
            else if (c == '\\') out.append("\\\\");
            else if (c == '\n') out.append("\\n");
            else if (c == '\r') continue;
            else if (c < 0x20) out.append(' ');
            else out.append(c);
        }
        return out.append("\");").toString();
    }

    /** Take the screen down. Safe to call when it is not up. */
    static void hide() {
        boolean wasShowing = layer != null;
        FrameLayout frame = layer;
        WebView view = web;
        layer = null;
        web = null;
        onRetry = null;
        onBrowse = null;
        reason = "";

        if (frame != null) {
            try {
                ViewGroup parent = (ViewGroup) frame.getParent();
                if (parent != null) parent.removeView(frame);
            } catch (Throwable ignored) {
                /* already detached */
            }
            try {
                frame.removeAllViews();
            } catch (Throwable ignored) {
                /* nothing left in it */
            }
        }
        if (view != null) {
            try {
                view.stopLoading();
                view.loadUrl("about:blank");
                view.destroy();
            } catch (Throwable ignored) {
                /* a destroyed WebView is the goal */
            }
        }
        if (wasShowing) {
            // The browse page is the surface again; the remote follows it.
            WebView page = browse == null ? null : browse.get();
            browse = null;
            if (page != null) TvPointer.retarget(page);
        }
    }

    /** The live site painted: whatever reason we had to be up is gone. */
    static void onPageLoaded() {
        if (isShowing()) hide();
    }

    // ─── the page's buttons ──────────────────────────────────────────────────

    private static final class Bridge {

        @JavascriptInterface
        public boolean canBrowse() {
            return canBrowse;
        }

        @JavascriptInterface
        public void retry() {
            final Runnable action = onRetry;
            MAIN.post(
                () -> {
                    Activity owner = owner();
                    if (owner == null) return;
                    hide();
                    if (action != null) {
                        try {
                            action.run();
                        } catch (Throwable ignored) {
                            /* the screen exists because things fail */
                        }
                    }
                }
            );
        }

        @JavascriptInterface
        public void browse() {
            final Runnable action = onBrowse;
            MAIN.post(
                () -> {
                    Activity owner = owner();
                    if (owner == null) return;
                    hide();
                    if (action != null) {
                        try {
                            action.run();
                        } catch (Throwable ignored) {
                            /* nothing else to offer */
                        }
                    }
                }
            );
        }

        /** Social links leave the app: the browser (or the app) knows them. */
        @JavascriptInterface
        public void open(String url) {
            if (url == null) return;
            final String target = url.trim();
            if (!target.startsWith("https://")) return;
            MAIN.post(
                () -> {
                    Activity owner = owner();
                    if (owner == null) return;
                    try {
                        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(target));
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        owner.startActivity(intent);
                    } catch (Throwable ignored) {
                        // No browser and no app: the link simply does nothing.
                    }
                }
            );
        }

        /** The activity the screen belongs to (the WebView's context chain). */
        private static Activity owner() {
            WebView view = web;
            if (view == null) return null;
            Context context = view.getContext();
            while (context instanceof ContextWrapper) {
                if (context instanceof Activity) return (Activity) context;
                context = ((ContextWrapper) context).getBaseContext();
            }
            return null;
        }
    }
}
