package com.fumio.app;

import android.content.Context;
import android.content.SharedPreferences;
import java.text.SimpleDateFormat;
import java.util.Locale;
import java.util.TimeZone;
import java.util.UUID;
import org.json.JSONObject;

/**
 * Talks to theogpiratebot.online /api/verify from native HTTPS (no Origin).
 * Unlock is 12 hours from a successful redeem, keyed by a stable installId.
 */
public final class VerifyClient {

    static final String BASE = "https://theogpiratebot.online";
    private static final String START = BASE + "/api/verify/start";
    private static final String REDEEM = BASE + "/api/verify/redeem";
    private static final String ENTITLEMENT = BASE + "/api/verify/entitlement";
    private static final String PREFS = "ogpb_verify";
    private static final String JSON_HEADERS = "{\"Content-Type\":\"application/json\"}";

    private final SharedPreferences prefs;

    public VerifyClient(Context context) {
        prefs = context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        installId();
    }

    public synchronized String installId() {
        String id = prefs.getString("install_id", "");
        if (id != null && id.length() >= 8) return id;
        id = UUID.randomUUID().toString();
        prefs.edit().putString("install_id", id).apply();
        return id;
    }

    public boolean isLocallyUnlocked() {
        long until = prefs.getLong("until_wall", 0);
        long serverAt = prefs.getLong("server_at", 0);
        long localAt = prefs.getLong("local_at", 0);
        if (until <= 0 || serverAt <= 0 || localAt <= 0) return false;
        long remaining = until - serverAt;
        return remaining > 0 && System.currentTimeMillis() < localAt + remaining - 5000L;
    }

    public String pendingVerifyUrl() {
        long exp = prefs.getLong("sid_expires", 0);
        if (exp > 0 && System.currentTimeMillis() > exp) {
            clearSession();
            return null;
        }
        String url = prefs.getString("verify_url", "");
        return url == null || url.isEmpty() ? null : url;
    }

    public Result entitlement() {
        Result out = post(ENTITLEMENT, bodyInstall());
        if (out.unlocked) rememberUnlock(out.untilIso, out.serverTimeIso);
        return out;
    }

    public Result start() {
        Result out = post(START, bodyInstall());
        if (out.alreadyUnlocked && out.unlocked) {
            rememberUnlock(out.untilIso, out.serverTimeIso);
            clearSession();
            return out;
        }
        if (out.verifyUrl != null && !out.verifyUrl.isEmpty()) {
            prefs.edit()
                .putString("sid", out.sid == null ? "" : out.sid)
                .putString("verify_url", out.verifyUrl)
                .putLong("sid_expires", parseIso(out.expiresAtIso))
                .apply();
        }
        return out;
    }

    public Result redeem(String code) {
        JSONObject body = bodyInstall();
        try {
            body.put("code", code == null ? "" : code);
        } catch (Exception ignored) {
            // JSONObject put of a string cannot fail.
        }
        Result out = post(REDEEM, body);
        if (out.unlocked) {
            rememberUnlock(out.untilIso, out.serverTimeIso);
            clearSession();
        }
        return out;
    }

    private JSONObject bodyInstall() {
        JSONObject body = new JSONObject();
        try {
            body.put("installId", installId());
        } catch (Exception ignored) {
            // JSONObject put of a string cannot fail.
        }
        return body;
    }

    private void rememberUnlock(String untilIso, String serverTimeIso) {
        long until = parseIso(untilIso);
        long serverAt = parseIso(serverTimeIso);
        if (serverAt <= 0) serverAt = System.currentTimeMillis();
        if (until <= 0) return;
        prefs.edit()
            .putLong("until_wall", until)
            .putLong("server_at", serverAt)
            .putLong("local_at", System.currentTimeMillis())
            .apply();
    }

    private void clearSession() {
        prefs.edit().remove("sid").remove("verify_url").remove("sid_expires").apply();
    }

    private Result post(String url, JSONObject body) {
        JSONObject raw = NativeHttp.execute("POST", url, JSON_HEADERS, body.toString());
        return Result.from(raw);
    }

    static long parseIso(String iso) {
        if (iso == null || iso.isEmpty()) return 0;
        String[] patterns = {
            "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
            "yyyy-MM-dd'T'HH:mm:ss'Z'"
        };
        for (String pattern : patterns) {
            try {
                SimpleDateFormat format = new SimpleDateFormat(pattern, Locale.US);
                format.setTimeZone(TimeZone.getTimeZone("UTC"));
                format.setLenient(false);
                return format.parse(iso).getTime();
            } catch (Exception ignored) {
                // Try the next pattern.
            }
        }
        return 0;
    }

    public static final class Result {
        public boolean ok;
        public boolean unlocked;
        public boolean alreadyUnlocked;
        public int status;
        public String error;
        public String reason;
        public String sid;
        public String verifyUrl;
        public String expiresAtIso;
        public String untilIso;
        public String serverTimeIso;
        public String message;
        public int retryAfter;

        static Result from(JSONObject raw) {
            Result out = new Result();
            if (raw == null) {
                out.error = "unavailable";
                out.message = "Can't reach the server. Try again.";
                return out;
            }
            out.ok = raw.optBoolean("ok", false);
            out.status = raw.optInt("status", 0);
            Object dataObj = raw.opt("data");
            JSONObject data = dataObj instanceof JSONObject ? (JSONObject) dataObj : null;
            if (data == null) {
                out.error = raw.optString("error", "unavailable");
                out.message = "Can't reach the server. Try again.";
                return out;
            }
            out.alreadyUnlocked = data.optBoolean("alreadyUnlocked", false);
            out.sid = emptyToNull(data.optString("sid", ""));
            out.verifyUrl = emptyToNull(data.optString("verifyUrl", ""));
            out.expiresAtIso = emptyToNull(data.optString("expiresAt", ""));
            out.serverTimeIso = emptyToNull(data.optString("serverTime", ""));
            out.error = emptyToNull(data.optString("error", ""));
            out.reason = emptyToNull(data.optString("reason", ""));
            out.retryAfter = data.optInt("retryAfter", 0);
            JSONObject ent = data.optJSONObject("entitlement");
            if (ent != null) {
                out.untilIso = emptyToNull(ent.optString("until", ""));
            }
            if (out.untilIso == null) {
                out.untilIso = emptyToNull(data.optString("until", ""));
            }
            boolean flagUnlocked = data.optBoolean("unlocked", false);
            out.unlocked =
                flagUnlocked ||
                out.alreadyUnlocked ||
                (out.ok && out.untilIso != null && out.error == null);
            if (out.status == 409 && "already_used".equals(out.error) && out.untilIso != null) {
                out.unlocked = true;
            }
            out.message = userMessage(out);
            return out;
        }

        private static String userMessage(Result out) {
            if (out.unlocked) return null;
            String err = out.error == null ? "" : out.error;
            switch (err) {
                case "invalid_code":
                    return "That code doesn't work. Check it and try again.";
                case "mismatch":
                    return "That code isn't for this install. Open Chrome from this app.";
                case "expired":
                    return "That session expired. Open Chrome again.";
                case "already_used":
                    return "That code was already used.";
                case "rate_limited":
                    return "Too many tries. Wait a minute and try again.";
                case "disabled":
                case "unavailable":
                    return "Verification is temporarily down. Try again.";
                case "invalid_install_id":
                    return "This install couldn't register. Reinstall the app.";
                default:
                    if (out.status == 0) return "Can't reach the server. Try again.";
                    if (out.status >= 500) return "Server error. Try again in a moment.";
                    return "Couldn't verify. Try again.";
            }
        }

        private static String emptyToNull(String value) {
            return value == null || value.isEmpty() ? null : value;
        }
    }
}
