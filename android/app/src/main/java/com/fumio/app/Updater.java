package com.fumio.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.app.AlertDialog;
import androidx.core.content.FileProvider;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Self-update, because the app is delivered as an APK and a television has no
 * browser to go and fetch the next one.
 *
 * The releases published by CI are the version feed:
 *
 *   tag_name  theogpiratebot-apk-<run_number>      (run_number is monotonic)
 *   asset     app-debug.apk                        (the same file the phone gets)
 *
 * CI stamps the APK with {@code versionCode = run_number}, so "is there an
 * update?" is a straight integer comparison — no semver, no date parsing.
 *
 * Behaviour, deliberately boring:
 *   - at most one check every 6 hours, on a background thread, at launch;
 *   - a small dialog (D-pad navigable out of the box, which is what a remote
 *     needs) offering Install / Not now / Skip this build;
 *   - the APK is downloaded into the app cache and handed to the system
 *     installer through FileProvider — we never install silently, the user
 *     always sees Android's own confirmation;
 *   - a half-downloaded or installed build is remembered, so "grant the install
 *     permission, come back" does not download 60 MB twice;
 *   - any failure is silent. An update check must never stand between the user
 *     and a video.
 */
final class Updater {

    private static final String RELEASES =
        "https://api.github.com/repos/themithology/Fumio/releases?per_page=15";
    private static final String PREFS = "ogpb_updates";
    private static final String KEY_LAST_CHECK = "last_check";
    private static final String KEY_SKIP_BUILD = "skip_build";
    private static final String KEY_PENDING_APK = "pending_apk";
    private static final String KEY_PENDING_BUILD = "pending_build";
    private static final long CHECK_EVERY_MS = 6L * 60 * 60 * 1000L;
    private static final String APK_MIME = "application/vnd.android.package-archive";
    /**
     * A framework dialog with an explicit theme: MainActivity runs a splash/
     * no-action-bar theme, and androidx's AlertDialog throws on a non-AppCompat
     * theme. The platform dialog is also the one that already understands a
     * D-pad, which is the whole point on a TV.
     */
    private static final int DIALOG_THEME = android.R.style.Theme_DeviceDefault_Dialog_Alert;
    private static final Pattern BUILD_TAG =
        Pattern.compile("theogpiratebot-apk-(\\d+)", Pattern.CASE_INSENSITIVE);
    private static final Handler MAIN = new Handler(Looper.getMainLooper());

    private static boolean busy;

    private Updater() {}

    // ─── entry point ─────────────────────────────────────────────────────────

    /** Called once per launch. Safe to call from {@code onCreate}. */
    static void checkAndPrompt(Activity activity) {
        checkAndPrompt(activity, false);
    }

    /**
     * @param force true when the user asked explicitly (ignore the 6 h window
     *              and the "skip this build" answer).
     */
    static void checkAndPrompt(Activity activity, boolean force) {
        if (activity == null || activity.isFinishing() || busy) return;
        final SharedPreferences prefs = prefs(activity);

        // A previous attempt already downloaded the APK — finish that job
        // first; re-downloading 60 MB because a permission dialog appeared is
        // exactly the kind of thing that makes people give up on a TV app.
        String pending = prefs.getString(KEY_PENDING_APK, "");
        if (!pending.isEmpty()) {
            File apk = new File(pending);
            int pendingBuild = prefs.getInt(KEY_PENDING_BUILD, 0);
            // Already installed that build? Clear the marker, or every launch
            // would keep offering an update that has happened (the old code
            // never recorded which build the file was, so after installing it
            // prompted "Finish the update" forever).
            if (pendingBuild > 0 && versionCode(activity) >= pendingBuild) {
                clearPending(prefs, apk);
            } else if (apk.isFile() && apk.length() > 1024 * 1024 && canInstall(activity)) {
                promptInstall(activity, apk, "Finish the update", "The new build is already downloaded.");
                return;
            } else if (!apk.isFile()) {
                clearPending(prefs, apk);
            }
        }

        long now = System.currentTimeMillis();
        long last = prefs.getLong(KEY_LAST_CHECK, 0L);
        if (!force && now - last < CHECK_EVERY_MS) return;
        prefs.edit().putLong(KEY_LAST_CHECK, now).apply();

        busy = true;
        new Thread(
            () -> {
                final Release found = latestRelease();
                MAIN.post(() -> {
                    busy = false;
                    if (activity.isFinishing() || activity.isDestroyed()) return;
                    if (found == null) return;
                    int current = versionCode(activity);
                    if (found.build <= current) return;
                    if (!force && found.build == prefs.getInt(KEY_SKIP_BUILD, -1)) return;
                    promptUpdate(activity, found, current);
                });
            },
            "ogpb-update-check"
        ).start();
    }

    // ─── the feed ────────────────────────────────────────────────────────────

    private static class Release {
        int build;
        String url;
        String notes;
    }

    private static Release latestRelease() {
        try {
            JSONObject result = NativeHttp.execute(
                "GET",
                RELEASES,
                "{\"Accept\":\"application/vnd.github+json\"}",
                null
            );
            if (result == null || !result.optBoolean("ok", false)) return null;
            Object data = result.opt("data");
            if (!(data instanceof JSONArray)) return null;
            JSONArray list = (JSONArray) data;
            Release best = null;
            for (int i = 0; i < list.length(); i += 1) {
                JSONObject rel = list.optJSONObject(i);
                if (rel == null) continue;
                Matcher m = BUILD_TAG.matcher(rel.optString("tag_name", ""));
                if (!m.find()) continue;
                int build;
                try {
                    build = Integer.parseInt(m.group(1));
                } catch (Exception ignored) {
                    continue;
                }
                String apk = apkAsset(rel);
                if (apk == null) continue;
                if (best == null || build > best.build) {
                    best = new Release();
                    best.build = build;
                    best.url = apk;
                    best.notes = rel.optString("name", "");
                }
            }
            return best;
        } catch (Exception ignored) {
            return null;
        }
    }

    private static String apkAsset(JSONObject release) {
        JSONArray assets = release.optJSONArray("assets");
        if (assets == null) return null;
        for (int i = 0; i < assets.length(); i += 1) {
            JSONObject asset = assets.optJSONObject(i);
            if (asset == null) continue;
            String name = asset.optString("name", "");
            if (!name.toLowerCase().endsWith(".apk")) continue;
            String url = asset.optString("browser_download_url", "");
            if (url.startsWith("https://")) return url;
        }
        return null;
    }

    // ─── the dialogs ─────────────────────────────────────────────────────────

    private static void promptUpdate(final Activity activity, final Release release, int current) {
        AlertDialog dialog = new AlertDialog.Builder(activity, DIALOG_THEME)
            .setTitle("Update available")
            .setMessage(
                "Build " + release.build + " is ready. This APK is build " + current + ".\n\n" +
                "Installing over the top keeps your downloads, watch history and settings."
            )
            .setPositiveButton("Install", (d, w) -> {
                pendingBuild = release.build;
                download(activity, release.url);
            })
            .setNeutralButton("Skip this build", (d, w) -> {
                prefs(activity).edit().putInt(KEY_SKIP_BUILD, release.build).apply();
            })
            .setNegativeButton("Not now", null)
            .create();
        dialog.show();
    }

    private static void promptInstall(final Activity activity, final File apk, String title, String message) {
        new AlertDialog.Builder(activity, DIALOG_THEME)
            .setTitle(title)
            .setMessage(message)
            .setPositiveButton("Install", (d, w) -> install(activity, apk))
            .setNegativeButton("Later", null)
            .create()
            .show();
    }

    // ─── download + hand-off ─────────────────────────────────────────────────

    private static void download(final Activity activity, final String url) {
        final AlertDialog progress = new AlertDialog.Builder(activity, DIALOG_THEME)
            .setTitle("Downloading update")
            .setMessage("Starting…")
            .setCancelable(false)
            .create();
        progress.show();

        new Thread(
            () -> {
                File target = new File(activity.getCacheDir(), "update.apk");
                boolean ok = false;
                try {
                    HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
                    conn.setInstanceFollowRedirects(true);
                    conn.setConnectTimeout(15000);
                    conn.setReadTimeout(30000);
                    conn.setRequestProperty("Accept", "*/*");
                    InputStream in = conn.getInputStream();
                    int total = conn.getContentLength();
                    FileOutputStream out = new FileOutputStream(target);
                    byte[] buffer = new byte[64 * 1024];
                    int read;
                    long done = 0;
                    int lastPct = -1;
                    while ((read = in.read(buffer)) != -1) {
                        out.write(buffer, 0, read);
                        done += read;
                        if (total > 0) {
                            final int pct = (int) (done * 100 / total);
                            if (pct >= lastPct + 5) {
                                lastPct = pct;
                                MAIN.post(() -> progress.setMessage(pct + "%"));
                            }
                        }
                    }
                    out.flush();
                    out.close();
                    in.close();
                    ok = target.length() > 1024 * 1024;
                } catch (Exception ignored) {
                    ok = false;
                }
                final boolean success = ok;
                MAIN.post(() -> {
                    progress.dismiss();
                    if (activity.isFinishing() || activity.isDestroyed()) return;
                    if (!success) {
                        new AlertDialog.Builder(activity, DIALOG_THEME)
                            .setTitle("Update failed")
                            .setMessage("The download did not finish. Try again later.")
                            .setPositiveButton("OK", null)
                            .show();
                        return;
                    }
                    prefs(activity)
                        .edit()
                        .putString(KEY_PENDING_APK, target.getAbsolutePath())
                        .putInt(KEY_PENDING_BUILD, pendingBuildOf(activity))
                        .apply();
                    if (!canInstall(activity)) {
                        askForInstallPermission(activity);
                        return;
                    }
                    install(activity, target);
                });
            },
            "ogpb-update-download"
        ).start();
    }

    private static boolean canInstall(Context context) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                return context.getPackageManager().canRequestPackageInstalls();
            }
            return true;
        } catch (Exception ignored) {
            return true;
        }
    }

    private static void askForInstallPermission(Context context) {
        try {
            new AlertDialog.Builder(context, DIALOG_THEME)
                .setTitle("One permission needed")
                .setMessage(
                    "Android needs your permission to install the update.\n\n" +
                    "Allow \"Install unknown apps\" for this app, then come back — " +
                    "the download is already saved and will not repeat."
                )
                .setPositiveButton("Open settings", (d, w) -> {
                    try {
                        Intent intent = new Intent(
                            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                            Uri.parse("package:" + context.getPackageName())
                        );
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        context.startActivity(intent);
                    } catch (Exception ignored) {
                        // Some TVs have no such screen; the installer will ask.
                    }
                })
                .setNegativeButton("Later", null)
                .show();
        } catch (Exception ignored) {
            // A dialog we cannot show is not worth a crash.
        }
    }

    private static void install(Context context, File apk) {
        try {
            Uri uri = FileProvider.getUriForFile(
                context,
                context.getPackageName() + ".fileprovider",
                apk
            );
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, APK_MIME);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
        } catch (Exception ignored) {
            // FileProvider misconfigured or no installer on the box: leave the
            // downloaded file in cache and say nothing.
        }
    }

    // ─── helpers ─────────────────────────────────────────────────────────────

    private static int versionCode(Context context) {
        try {
            PackageManager pm = context.getPackageManager();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                return (int) pm.getPackageInfo(context.getPackageName(), 0).getLongVersionCode();
            }
            return pm.getPackageInfo(context.getPackageName(), 0).versionCode;
        } catch (Exception ignored) {
            return 0;
        }
    }

    /** The build this download is FOR, captured before the download starts. */
    private static int pendingBuild;
    private static int pendingBuildOf(Context context) {
        return pendingBuild;
    }

    private static void clearPending(SharedPreferences prefs, File apk) {
        try {
            if (apk != null && apk.isFile()) apk.delete();
        } catch (Exception ignored) {
            /* the OS will trim the cache anyway */
        }
        prefs.edit().remove(KEY_PENDING_APK).remove(KEY_PENDING_BUILD).apply();
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
