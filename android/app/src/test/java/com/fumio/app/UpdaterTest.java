package com.fumio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/**
 * The updater's decision, without a device.
 *
 * Every rule here has already broken a release at least once, and each one is
 * invisible until somebody's phone tries to update: a wrong pick is not a test
 * failure in the app, it is "install blocked" on a stranger's phone.
 *
 * Nothing in this file touches Android — {@code Updater.bestRelease} is pure,
 * which is the only reason any of it can run in CI.
 */
public class UpdaterTest {

    private static JSONObject release(String tag, String apkName, String url) throws Exception {
        JSONObject rel = new JSONObject();
        rel.put("tag_name", tag);
        rel.put("name", tag + " notes");
        rel.put("prerelease", true);
        JSONArray assets = new JSONArray();
        if (apkName != null) {
            JSONObject asset = new JSONObject();
            asset.put("name", apkName);
            asset.put("browser_download_url", url);
            assets.put(asset);
        }
        rel.put("assets", assets);
        return rel;
    }

    private static JSONArray feed(JSONObject... releases) {
        JSONArray list = new JSONArray();
        for (JSONObject rel : releases) list.put(rel);
        return list;
    }

    @Test
    public void picksTheHighestBuildNotTheFirstOne() throws Exception {
        // The API returns newest first, but nothing guarantees it — and a
        // re-run publishes an older number after a newer one.
        JSONArray list =
            feed(
                release("theogpiratebot-apk-120", "app-debug.apk", "https://x/120.apk"),
                release("theogpiratebot-apk-131", "app-debug.apk", "https://x/131.apk"),
                release("theogpiratebot-apk-127", "app-debug.apk", "https://x/127.apk")
            );
        Updater.Release best = Updater.bestRelease(list);
        assertNotNull(best);
        assertEquals(131, best.build);
        assertEquals("https://x/131.apk", best.url);
    }

    @Test
    public void aPrereleaseIsARealBuild() throws Exception {
        // Every CI build is published as a prerelease. /releases/latest would
        // ignore all of them, which is why the feed is the release LIST.
        JSONObject pre = release("theogpiratebot-apk-130", "app-debug.apk", "https://x/130.apk");
        pre.put("prerelease", true);
        Updater.Release best = Updater.bestRelease(feed(pre));
        assertNotNull(best);
        assertEquals(130, best.build);
    }

    @Test
    public void skipsTagsThatAreNotBuilds() throws Exception {
        JSONArray list =
            feed(
                release("v1.0.0", "app-debug.apk", "https://x/v1.apk"),
                release("some-other-tag", "app-debug.apk", "https://x/other.apk")
            );
        assertNull(Updater.bestRelease(list));
    }

    @Test
    public void skipsAReleaseWithNoApkAsset() throws Exception {
        // A release with only source archives must never be offered: the
        // download would succeed and the install would fail.
        JSONArray list =
            feed(
                release("theogpiratebot-apk-140", null, null),
                release("theogpiratebot-apk-139", "app-debug.apk", "https://x/139.apk")
            );
        Updater.Release best = Updater.bestRelease(list);
        assertNotNull(best);
        assertEquals(139, best.build);
    }

    @Test
    public void refusesANonHttpsAsset() throws Exception {
        JSONArray list = feed(release("theogpiratebot-apk-140", "app-debug.apk", "http://insecure/x.apk"));
        assertNull(Updater.bestRelease(list));
    }

    @Test
    public void anEmptyOrBrokenFeedIsNotAnUpdate() throws Exception {
        assertNull(Updater.bestRelease(new JSONArray()));
        assertNull(Updater.bestRelease(null));
        assertNull(Updater.bestRelease(feed()));
    }

    @Test
    public void survivesGarbageInsideTheList() throws Exception {
        JSONArray list = new JSONArray();
        list.put(JSONObject.NULL);
        list.put("a string, not a release");
        list.put(release("theogpiratebot-apk-141", "app-debug.apk", "https://x/141.apk"));
        Updater.Release best = Updater.bestRelease(list);
        assertNotNull(best);
        assertEquals(141, best.build);
    }
}
