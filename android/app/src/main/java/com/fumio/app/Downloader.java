package com.fumio.app;

import android.Manifest;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.WebView;
import android.widget.Toast;

import java.util.Locale;

/**
 * Real downloads for the app.
 *
 * The site's /download window (TG + vidsrc pools) hands out ordinary file
 * links. The old shell answered every one of them with a no-op download
 * listener, which is the single reason "download" never worked on mobile.
 *
 * Everything now goes through Android's DownloadManager: it survives the
 * WebView being torn down, shows its own progress + "download complete"
 * notification, and tapping that notification opens the file with whatever
 * the phone has. No storage permission is needed on API 29+ because the file
 * lands in the public Downloads collection.
 */
final class Downloader {

    /** Notification permission request (API 33+). Enqueue happens either way. */
    static final int REQ_NOTIFICATIONS = 4210;

    /** Cookie-free hosts still need these two headers to hand us the file. */
    private static final String FALLBACK_NAME = "theogpiratebot-download";

    private Downloader() {}

    /**
     * @return true when the download was handed to DownloadManager.
     */
    static boolean start(
        Activity activity,
        WebView webView,
        String url,
        String userAgent,
        String contentDisposition,
        String mimeType
    ) {
        if (activity == null || url == null || url.isEmpty()) return false;

        // blob:/data: links cannot be fetched by DownloadManager. Ask the page
        // to save it for us (BLOB_DOWNLOAD_JS) and report honestly otherwise.
        if (url.startsWith("blob:") || url.startsWith("data:")) {
            if (webView != null) {
                webView.evaluateJavascript(BLOB_DOWNLOAD_JS, null);
                toast(activity, "Saving file…");
                return true;
            }
            toast(activity, "This link can't be saved on this device.");
            return false;
        }

        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            toast(activity, "This link can't be downloaded.");
            return false;
        }

        String fileName = safeFileName(URLUtil.guessFileName(url, contentDisposition, mimeType));
        String cookie = readCookie(url);
        String referer = webView == null ? null : webView.getUrl();
        String agent = userAgent == null || userAgent.isEmpty() ? null : userAgent;

        askForNotificationPermission(activity);

        DownloadManager.Request request;
        try {
            request = buildRequest(activity, url, fileName, mimeType, cookie, agent, referer);
        } catch (Exception first) {
            // A duplicate or unparseable display name must never cancel the
            // download — retry with a timestamped name.
            try {
                request = buildRequest(
                    activity,
                    url,
                    uniqueName(fileName),
                    mimeType,
                    cookie,
                    agent,
                    referer
                );
            } catch (Exception ignored) {
                toast(activity, "Couldn't start that download.");
                return false;
            }
        }

        try {
            DownloadManager manager = (DownloadManager) activity.getSystemService(Context.DOWNLOAD_SERVICE);
            if (manager == null) {
                toast(activity, "Downloads aren't available on this device.");
                return false;
            }
            manager.enqueue(request);
            toast(activity, "Downloading " + fileName);
            return true;
        } catch (Exception ignored) {
            toast(activity, "Couldn't start that download.");
            return false;
        }
    }

    private static DownloadManager.Request buildRequest(
        Activity activity,
        String url,
        String fileName,
        String mimeType,
        String cookie,
        String userAgent,
        String referer
    ) {
        DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
        request.setTitle(fileName);
        request.setDescription("TheOGPirateBot");
        request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
        request.setAllowedOverMetered(true);
        request.setAllowedOverRoaming(true);
        if (mimeType != null && !mimeType.isEmpty() && !mimeType.equalsIgnoreCase("application/octet-stream")) {
            request.setMimeType(mimeType);
        }
        if (cookie != null && !cookie.isEmpty()) request.addRequestHeader("Cookie", cookie);
        if (userAgent != null) request.addRequestHeader("User-Agent", userAgent);
        if (referer != null && (referer.startsWith("https://theogpiratebot.online") || referer.startsWith("https://localhost"))) {
            request.addRequestHeader("Referer", referer);
        }

        if (Build.VERSION.SDK_INT >= 29) {
            // Public Downloads/ — visible in the Files app, no permission.
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);
        } else if (hasStoragePermission(activity)) {
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);
        } else {
            // App-scoped folder: always writable, still tappable from the
            // completion notification.
            request.setDestinationInExternalFilesDir(activity, Environment.DIRECTORY_DOWNLOADS, fileName);
        }
        return request;
    }

    /** DownloadManager keeps the site's session when we forward its cookies. */
    private static String readCookie(String url) {
        try {
            return CookieManager.getInstance().getCookie(url);
        } catch (Exception ignored) {
            return null;
        }
    }

    /**
     * The pools serve names like
     * {@code Movie.Name.2024.1080p.WEB-DL.x264.mkv} — those are fine. This only
     * strips what a filesystem rejects and what would let a path escape.
     */
    private static String safeFileName(String raw) {
        String name = raw == null ? "" : raw.trim();
        name = name.replaceAll("[\\\\/:*?\"<>|\\r\\n\\t]", "_");
        int cut = name.lastIndexOf('/');
        if (cut >= 0) name = name.substring(cut + 1);
        name = name.replaceAll("^\\.+", "");
        if (name.isEmpty()) return FALLBACK_NAME;
        if (name.length() > 120) {
            int dot = name.lastIndexOf('.');
            String ext = dot > 0 && name.length() - dot <= 8 ? name.substring(dot) : "";
            name = name.substring(0, 120 - ext.length()) + ext;
        }
        return name;
    }

    private static String uniqueName(String fileName) {
        int dot = fileName.lastIndexOf('.');
        String base = dot > 0 ? fileName.substring(0, dot) : fileName;
        String ext = dot > 0 ? fileName.substring(dot) : "";
        return base + "-" + System.currentTimeMillis() % 100000 + ext;
    }

    private static boolean hasStoragePermission(Activity activity) {
        try {
            return activity.checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)
                == PackageManager.PERMISSION_GRANTED;
        } catch (Exception ignored) {
            return false;
        }
    }

    /**
     * DownloadManager's "complete" notification is what makes the file
     * reachable, so ask for it once on API 33+. The download itself is
     * enqueued whether or not the person allows it.
     */
    private static void askForNotificationPermission(Activity activity) {
        if (Build.VERSION.SDK_INT < 33) return;
        try {
            if (activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED) return;
            activity.requestPermissions(
                new String[] { Manifest.permission.POST_NOTIFICATIONS },
                REQ_NOTIFICATIONS
            );
        } catch (Exception ignored) {
            /* the download still runs */
        }
    }

    private static void toast(Activity activity, String message) {
        try {
            Toast.makeText(activity, message, Toast.LENGTH_SHORT).show();
        } catch (Exception ignored) {
            /* no window to show it in */
        }
    }

    /** Is this URL a direct file (so a tap can save it) rather than a page? */
    static boolean looksLikeFile(String url) {
        if (url == null) return false;
        String path = url;
        int query = path.indexOf('?');
        if (query >= 0) path = path.substring(0, query);
        path = path.toLowerCase(Locale.US);
        return path.matches(".*\\.(mkv|mp4|avi|mov|webm|m4v|mp3|zip|apk|srt|vtt|torrent)$");
    }

    /**
     * Last resort for blob: links (an anchor the page built in memory). The
     * page keeps the bytes, so it has to do the saving.
     */
    private static final String BLOB_DOWNLOAD_JS =
        "(function(){try{"
            + "var a=document.querySelector('a[download][href^=\"blob:\"]');"
            + "if(a){a.click();return;}"
            + "if(window.__fumioSaveBlob){window.__fumioSaveBlob();}"
            + "}catch(e){}})()";
}
