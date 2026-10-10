package com.fumio.app;

import android.app.Activity;
import android.app.Dialog;
import android.net.Uri;
import android.os.Build;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import org.json.JSONObject;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Google sign-in that never leaves the app and never opens Firebase's
 * handler as a cold page. The in-app WebView runs Google's OAuth screen;
 * we read the ID token off the redirect and hand it to Firebase JS.
 */
final class InAppGoogleAuth {

    interface Result {
        void onIdToken(String idToken);

        void onError(String message);
    }

    private static final String API_KEY = "AIzaSyDapNgnKdO8l_t7BJPCO8IsbL73aILA1cI";
    private static final String REDIRECT = "https://ogpb-331d5.firebaseapp.com/__/auth/handler";
    private static final Pattern CLIENT_ID =
        Pattern.compile("(\\d+-[A-Za-z0-9]+\\.apps\\.googleusercontent\\.com)");

    private Dialog dialog;
    private WebView webView;
    private boolean finished;

    void start(Activity activity, Result result) {
        new Thread(() -> {
            try {
                String clientId = fetchWebClientId();
                if (clientId == null || clientId.isEmpty()) {
                    activity.runOnUiThread(() -> result.onError("Google sign-in is not configured for this app."));
                    return;
                }
                String nonce = UUID.randomUUID().toString();
                String url =
                    "https://accounts.google.com/o/oauth2/v2/auth" +
                    "?client_id=" + urlEnc(clientId) +
                    "&redirect_uri=" + urlEnc(REDIRECT) +
                    "&response_type=id_token" +
                    "&scope=" + urlEnc("openid email profile") +
                    "&nonce=" + urlEnc(nonce) +
                    "&include_granted_scopes=true";
                activity.runOnUiThread(() -> show(activity, url, result));
            } catch (Exception error) {
                activity.runOnUiThread(() -> result.onError(error.getMessage() != null ? error.getMessage() : "Google sign-in failed."));
            }
        }, "fumio-google-oauth").start();
    }

    void dismiss() {
        Dialog open = dialog;
        dialog = null;
        WebView view = webView;
        webView = null;
        if (open != null) {
            try {
                if (open.isShowing()) open.dismiss();
            } catch (Exception ignored) {
                destroy(view);
            }
        } else {
            destroy(view);
        }
    }

    private void show(Activity activity, String url, Result result) {
        if (activity.isFinishing()) {
            result.onError("Google sign-in failed.");
            return;
        }
        dismiss();
        finished = false;
        WebView view = new WebView(activity);
        view.setLayoutParams(
            new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        );
        tune(view);
        view.setWebViewClient(
            new WebViewClient() {
                @Override
                public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest request) {
                    return capture(request.getUrl(), v, result);
                }

                @Override
                @SuppressWarnings("deprecation")
                public boolean shouldOverrideUrlLoading(WebView v, String href) {
                    return capture(Uri.parse(href), v, result);
                }

                @Override
                public void onPageFinished(WebView v, String href) {
                    capture(Uri.parse(href), v, result);
                    v.evaluateJavascript(
                        "(function(){return location.href})()",
                        (value) -> {
                            String hrefJs = jsString(value);
                            if (hrefJs != null) capture(Uri.parse(hrefJs), v, result);
                        }
                    );
                }
            }
        );
        webView = view;
        dialog = new Dialog(activity, android.R.style.Theme_Black_NoTitleBar_Fullscreen);
        dialog.setContentView(view);
        dialog.setOnCancelListener((d) -> {
            if (!finished) result.onError("Google sign-in was closed.");
            destroy(webView);
            webView = null;
            dialog = null;
        });
        dialog.show();
        view.loadUrl(url);
    }

    private boolean capture(Uri uri, WebView view, Result result) {
        if (finished || uri == null) return false;
        String href = uri.toString();
        if (href.contains("id_token=")) {
            String token = tokenFrom(href);
            if (token != null && !token.isEmpty()) {
                finished = true;
                result.onIdToken(token);
                dismiss();
                return true;
            }
        }
        if (href.contains("error=")) {
            String err = uri.getQueryParameter("error");
            if (err == null) err = Uri.parse(href.replace("#", "?")).getQueryParameter("error");
            finished = true;
            result.onError(err == null || err.isEmpty() ? "Google sign-in failed." : err.replace('_', ' '));
            dismiss();
            return true;
        }
        if (isHandler(uri) && view != null) {
            // Stay in this WebView until the fragment lands; do not bounce out.
            return false;
        }
        return false;
    }

    private static boolean isHandler(Uri uri) {
        String host = uri.getHost();
        String path = uri.getPath();
        return host != null && host.endsWith("firebaseapp.com") && path != null && path.contains("/__/auth/handler");
    }

    private static String tokenFrom(String href) {
        String working = href.replace("#", "?");
        try {
            String token = Uri.parse(working).getQueryParameter("id_token");
            if (token != null && !token.isEmpty()) return token;
        } catch (Exception ignored) {
            // Fall through to a manual split.
        }
        int at = href.indexOf("id_token=");
        if (at < 0) return null;
        String rest = href.substring(at + "id_token=".length());
        int end = rest.indexOf('&');
        if (end >= 0) rest = rest.substring(0, end);
        return Uri.decode(rest);
    }

    private static void tune(WebView view) {
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        String ua = settings.getUserAgentString();
        if (ua != null) {
            settings.setUserAgentString(ua.replace("; wv", "").replace("Version/4.0 ", ""));
        }
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(view, true);
        if (Build.VERSION.SDK_INT >= 21) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        }
        try {
            Class<?> feature = Class.forName("androidx.webkit.WebViewFeature");
            Object ok = feature.getMethod("isFeatureSupported", String.class)
                .invoke(null, "REQUESTED_WITH_HEADER_ALLOW_LIST");
            if (Boolean.TRUE.equals(ok)) {
                Class.forName("androidx.webkit.WebSettingsCompat")
                    .getMethod("setRequestedWithHeaderOriginAllowList", WebSettings.class, java.util.Set.class)
                    .invoke(null, settings, java.util.Collections.emptySet());
            }
        } catch (Throwable ignored) {
            // Older WebView: Google still works if the UA is not tagged as WebView.
        }
    }

    private static String fetchWebClientId() throws Exception {
        String[] endpoints = {
            "https://www.googleapis.com/identitytoolkit/v3/relyingparty/getProjectConfig?key=" + API_KEY,
            "https://ogpb-331d5.firebaseapp.com/__/firebase/init.json",
        };
        for (String endpoint : endpoints) {
            String found = clientIdFrom(endpoint);
            if (found != null) return found;
        }
        return null;
    }

    private static String clientIdFrom(String endpoint) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(endpoint).openConnection();
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(10000);
            conn.setRequestMethod("GET");
            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) return null;
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8))) {
                StringBuilder body = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) body.append(line);
                Matcher matcher = CLIENT_ID.matcher(body);
                if (matcher.find()) return matcher.group(1);
            }
        } catch (Exception ignored) {
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
        return null;
    }

    private static String jsString(String value) {
        if (value == null || value.equals("null") || value.length() < 2) return null;
        try {
            return new JSONObject("{\"u\":" + value + "}").getString("u");
        } catch (Exception ignored) {
            return null;
        }
    }

    private static String urlEnc(String value) throws Exception {
        return URLEncoder.encode(value, "UTF-8");
    }

    private static void destroy(WebView view) {
        if (view == null) return;
        try {
            if (view.getParent() instanceof ViewGroup) {
                ((ViewGroup) view.getParent()).removeView(view);
            }
            view.destroy();
        } catch (Exception ignored) {
            // Overlay already gone.
        }
    }
}
