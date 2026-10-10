package com.fumio.app;

import android.net.Uri;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.json.JSONArray;
import org.json.JSONObject;

/** Same-process HTTPS for /api/db — the WebView origin cannot CORS to the site. */
public final class NativeHttp {
    private NativeHttp() {}

    public static JSONObject execute(String method, String url, String headersJson, String body) {
        JSONObject out = new JSONObject();
        try {
            if (url == null || url.isEmpty()) {
                out.put("ok", false);
                out.put("status", 0);
                out.put("error", "missing url");
                return out;
            }
            Uri uri = Uri.parse(url);
            String scheme = uri.getScheme();
            if (scheme == null || !scheme.equalsIgnoreCase("https")) {
                out.put("ok", false);
                out.put("status", 0);
                out.put("error", "https only");
                return out;
            }
            String verb = method == null || method.isEmpty() ? "GET" : method.toUpperCase();
            HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setInstanceFollowRedirects(true);
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(15000);
            conn.setRequestMethod(verb);
            conn.setRequestProperty("Accept", "application/json");
            if (headersJson != null && !headersJson.isEmpty()) {
                JSONObject headers = new JSONObject(headersJson);
                JSONArray names = headers.names();
                if (names != null) {
                    for (int i = 0; i < names.length(); i++) {
                        String key = names.getString(i);
                        conn.setRequestProperty(key, headers.optString(key, ""));
                    }
                }
            }
            if (body != null && !body.isEmpty() && !verb.equals("GET") && !verb.equals("HEAD")) {
                byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                conn.setDoOutput(true);
                conn.setRequestProperty("Content-Length", String.valueOf(bytes.length));
                try (OutputStream os = conn.getOutputStream()) {
                    os.write(bytes);
                }
            }
            int code = conn.getResponseCode();
            InputStream stream = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
            StringBuilder sb = new StringBuilder();
            if (stream != null) {
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = reader.readLine()) != null) sb.append(line);
                }
            }
            conn.disconnect();
            String text = sb.toString();
            out.put("ok", code >= 200 && code < 300);
            out.put("status", code);
            String trimmed = text.trim();
            if (trimmed.startsWith("{")) {
                try {
                    out.put("data", new JSONObject(trimmed));
                } catch (Exception ignored) {
                    out.put("data", text);
                }
            } else if (trimmed.startsWith("[")) {
                try {
                    out.put("data", new JSONArray(trimmed));
                } catch (Exception ignored) {
                    out.put("data", text);
                }
            } else {
                out.put("data", text);
            }
            return out;
        } catch (Exception error) {
            try {
                out.put("ok", false);
                out.put("status", 0);
                out.put("error", error.getMessage() == null ? "unavailable" : error.getMessage());
            } catch (Exception ignored) {
                // JSONObject put cannot fail for these types.
            }
            return out;
        }
    }
}
