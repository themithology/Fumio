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
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Google account picker inside the app. We ask Firebase for the web client ID,
 * run Google's OAuth page in a WebView, then read the ID token off the redirect
 * — never a cold Firebase handler, never Chrome.
 */
final class InAppGoogleAuth {

    interface Result {
        void onIdToken(String idToken);

        void onError(String message);
    }

    private static final String API_KEY = "AIzaSyDapNgnKdO8l_t7BJPCO8IsbL73aILA1cI";
    private static final String REDIRECT = "https://ogpb-331d5.firebaseapp.com/__/auth/handler";
    private static final Pattern CLIENT_ID =
        Pattern.compile("([0-9]+-[A-Za-z0-9_-]+\\.apps\\.googleusercontent\\.com)");

    private Dialog dialog;
    private WebView webView;
    private boolean finished;

    void start(Activity activity, Result result) {
        new Thread(
            () -> {
                try {
                    String clientId = fetchWebClientId();
                    if (clientId == null || clientId.isEmpty()) {
                        activity.runOnUiThread(() -> result.onError("Could not start Google sign-in. Check your connection and try again."));
                        return;
                    }
                    String nonce = UUID.randomUUID().toString();
                    String url =
                        "https://accounts.google.com/o/oauth2/v2/auth" +
                        "?client_id=" + enc(clientId) +
                        "&redirect_uri=" + enc(REDIRECT) +
                        "&response_type=id_token" +
                        "&scope=" + enc("openid email profile") +
                        "&nonce=" + enc(nonce);
                    activity.runOnUiThread(() -> show(activity, url, result));
                } catch (Exception error) {
                    activity.runOnUiThread(
                        () -> result.onError(error.getMessage() != null ? error.getMessage() : "Google sign-in failed.")
                    );
                }
            },
            "ogpb-google-oauth"
        ).start();
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
            if (token != null && token.startsWith("eyJ")) {
                finished = true;
                result.onIdToken(token);
                dismiss();
                return true;
            }
        }
        if (href.contains("error=")) {
            String err = query(href, "error");
            finished = true;
            result.onError(err == null || err.isEmpty() ? "Google sign-in failed." : err.replace('_', ' '));
            dismiss();
            return true;
        }
        return false;
    }

    private static String tokenFrom(String href) {
        String token = query(href, "id_token");
        if (token != null && !token.isEmpty()) return token;
        int at = href.indexOf("id_token=");
        if (at < 0) return null;
        String rest = href.substring(at + "id_token=".length());
        int end = rest.indexOf('&');
        if (end >= 0) rest = rest.substring(0, end);
        return Uri.decode(rest);
    }

    private static String query(String href, String name) {
        try {
            return Uri.parse(href.replace("#", "?")).getQueryParameter(name);
        } catch (Exception ignored) {
            return null;
        }
    }

    private static void tune(WebView view) {
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setSupportMultipleWindows(false);
        String ua = settings.getUserAgentString();
        if (ua != null) {
            settings.setUserAgentString(ua.replace("; wv", "").replace("Version/4.0 ", ""));
        }
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(view, true);
        if (Build.VERSION.SDK_INT >= 21) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        }
    }

    private static String fetchWebClientId() {
        String[] continues = {
            "https://ogpb-331d5.firebaseapp.com/__/auth/handler",
            "https://theogpiratebot.online/account",
            "https://ogpb-331d5.firebaseapp.com",
        };
        for (String cont : continues) {
            String found = clientIdFromAuthUri(cont);
            if (found != null) return found;
        }
        String config = http(
            "GET",
            "https://www.googleapis.com/identitytoolkit/v3/relyingparty/getProjectConfig?key=" + API_KEY,
            null
        );
        return firstClientId(config);
    }

    private static String clientIdFromAuthUri(String continueUri) {
        try {
            JSONObject body = new JSONObject();
            body.put("providerId", "google.com");
            body.put("continueUri", continueUri);
            String response = http(
                "POST",
                "https://identitytoolkit.googleapis.com/v1/accounts:createAuthUri?key=" + API_KEY,
                body.toString()
            );
            return firstClientId(response);
        } catch (Exception ignored) {
            return null;
        }
    }

    private static String firstClientId(String body) {
        if (body == null) return null;
        Matcher matcher = CLIENT_ID.matcher(body);
        return matcher.find() ? matcher.group(1) : null;
    }

    private static String http(String method, String endpoint, String json) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(endpoint).openConnection();
            conn.setConnectTimeout(12000);
            conn.setReadTimeout(12000);
            conn.setRequestMethod(method);
            if (json != null) {
                conn.setDoOutput(true);
                conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
                conn.setFixedLengthStreamingMode(bytes.length);
                try (OutputStream out = conn.getOutputStream()) {
                    out.write(bytes);
                }
            }
            InputStream stream = conn.getResponseCode() >= 400 ? conn.getErrorStream() : conn.getInputStream();
            if (stream == null) return null;
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
                StringBuilder body = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) body.append(line);
                return body.toString();
            }
        } catch (Exception ignored) {
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static String jsString(String value) {
        if (value == null || value.equals("null") || value.length() < 2) return null;
        try {
            return new JSONObject("{\"u\":" + value + "}").getString("u");
        } catch (Exception ignored) {
            return null;
        }
    }

    private static String enc(String value) throws Exception {
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
