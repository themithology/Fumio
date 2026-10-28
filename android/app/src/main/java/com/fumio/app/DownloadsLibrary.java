package com.fumio.app;

import android.app.DownloadManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.util.ArrayList;
import java.util.List;

/**
 * The app's own list of downloaded files.
 *
 * DownloadManager is the transport (it owns the bytes, the progress and the
 * notification) but it has no idea what a download was *about*: the title, the
 * quality it came from, or which of its rows belongs to this app. So every
 * enqueue is also recorded here, and {@link #list(Context)} folds the live
 * DownloadManager status back into each record.
 *
 * Everything is local: the list, the files and the player all work with the
 * network off, which is the point of a download.
 */
final class DownloadsLibrary {

    private static final String PREFS = "ogpb_downloads";
    private static final String KEY = "items";

    private DownloadsLibrary() {}

    /** One downloaded (or downloading) file. */
    static final class Item {
        long id;
        String name = "";
        String title = "";
        String mime = "";
        long addedAt;
        /** DownloadManager status: 8 = successful, 16 = failed. */
        int status;
        long bytes = 0;
        Uri uri;

        boolean isReady() {
            return status == DownloadManager.STATUS_SUCCESSFUL && uri != null;
        }
    }

    /** Called right after a download is enqueued. */
    static void remember(Context context, long id, String name, String title, String mime) {
        if (context == null || id <= 0) return;
        try {
            JSONArray list = read(context);
            JSONObject row = new JSONObject();
            row.put("id", id);
            row.put("name", name == null ? "" : name);
            row.put("title", title == null ? "" : title);
            row.put("mime", mime == null ? "" : mime);
            row.put("addedAt", System.currentTimeMillis());
            list.put(row);
            write(context, list);
        } catch (Exception ignored) {
            /* the file still downloads; it just may not be listed */
        }
    }

    /** Stored records, newest first, with live status and a playable URI. */
    static List<Item> list(Context context) {
        List<Item> out = new ArrayList<>();
        if (context == null) return out;
        JSONArray rows = read(context);
        DownloadManager manager = manager(context);
        for (int i = 0; i < rows.length(); i += 1) {
            JSONObject row = rows.optJSONObject(i);
            if (row == null) continue;
            Item item = new Item();
            item.id = row.optLong("id", 0);
            item.name = row.optString("name", "");
            item.title = row.optString("title", "");
            item.mime = row.optString("mime", "");
            item.addedAt = row.optLong("addedAt", 0);
            item.status = DownloadManager.STATUS_PENDING;
            if (manager != null && item.id > 0) {
                fillStatus(manager, item);
            }
            // A row whose DownloadManager record is gone (app data cleared for
            // downloads, or the user removed it from the notification) is
            // dropped rather than shown as a dead card.
            if (manager != null && item.status == 0) continue;
            out.add(item);
        }
        out.sort((a, b) -> Long.compare(b.addedAt, a.addedAt));
        return out;
    }

    private static void fillStatus(DownloadManager manager, Item item) {
        android.database.Cursor cursor = null;
        try {
            DownloadManager.Query query = new DownloadManager.Query().setFilterById(item.id);
            cursor = manager.query(query);
            if (cursor == null || !cursor.moveToFirst()) {
                item.status = 0;
                return;
            }
            item.status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
            int total = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
            int done = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
            item.bytes = Math.max(0, total > 0 ? total : done);
            if (item.status == DownloadManager.STATUS_SUCCESSFUL) {
                item.uri = manager.getUriForDownloadedFile(item.id);
                if (item.name.isEmpty()) {
                    String guess = cursor.getString(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TITLE));
                    if (guess != null) item.name = guess;
                }
            }
        } catch (Exception ignored) {
            item.status = 0;
        } finally {
            if (cursor != null) {
                try {
                    cursor.close();
                } catch (Exception ignored) {
                    /* nothing to release */
                }
            }
        }
    }

    /** Removes the record and asks DownloadManager to drop the file too. */
    static void forget(Context context, Item item) {
        if (context == null || item == null) return;
        DownloadManager manager = manager(context);
        if (manager != null && item.id > 0) {
            try {
                manager.remove(item.id);
            } catch (Exception ignored) {
                /* already gone */
            }
        }
        removeFile(item);
        JSONArray rows = read(context);
        JSONArray next = new JSONArray();
        for (int i = 0; i < rows.length(); i += 1) {
            JSONObject row = rows.optJSONObject(i);
            if (row == null) continue;
            if (row.optLong("id", 0) == item.id) continue;
            next.put(row);
        }
        write(context, next);
    }

    private static void removeFile(Item item) {
        if (item == null || item.uri == null) return;
        try {
            if ("file".equals(item.uri.getScheme())) {
                File file = new File(item.uri.getPath());
                if (file.exists()) file.delete();
            }
        } catch (Exception ignored) {
            /* the DownloadManager removal above is the real cleanup */
        }
    }

    private static DownloadManager manager(Context context) {
        try {
            return (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
        } catch (Exception ignored) {
            return null;
        }
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static JSONArray read(Context context) {
        try {
            String raw = prefs(context).getString(KEY, "");
            if (raw == null || raw.isEmpty()) return new JSONArray();
            return new JSONArray(raw);
        } catch (Exception ignored) {
            return new JSONArray();
        }
    }

    private static void write(Context context, JSONArray rows) {
        try {
            prefs(context).edit().putString(KEY, rows.toString()).apply();
        } catch (Exception ignored) {
            /* list rebuilds on the next enqueue */
        }
    }

    /** "1.4 GB" / "820 MB" for the list. */
    static String humanSize(long bytes) {
        if (bytes <= 0) return "";
        double value = bytes;
        String[] units = { "B", "KB", "MB", "GB", "TB" };
        int unit = 0;
        while (value >= 1024 && unit < units.length - 1) {
            value /= 1024;
            unit += 1;
        }
        if (unit <= 1) return String.format(java.util.Locale.US, "%.0f %s", value, units[unit]);
        return String.format(java.util.Locale.US, "%.1f %s", value, units[unit]);
    }

    /** Playback position for a file, in ms (0 when never opened). */
    static long resumeFor(Context context, String key) {
        if (context == null || key == null) return 0;
        try {
            return context.getSharedPreferences("ogpb_resume", Context.MODE_PRIVATE).getLong(key, 0);
        } catch (Exception ignored) {
            return 0;
        }
    }

    static void saveResume(Context context, String key, long positionMs) {
        if (context == null || key == null || positionMs < 0) return;
        try {
            context.getSharedPreferences("ogpb_resume", Context.MODE_PRIVATE)
                .edit()
                .putLong(key, positionMs)
                .apply();
        } catch (Exception ignored) {
            /* resume is a convenience, never a requirement */
        }
    }
}
