package com.fumio.app;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * The app has to recognise a player whenever the site mounts one, and the site
 * does not spell it one way.
 *
 * Every path below is copied from the site's own provider registry
 * (src/utils/serverRegistry.js in themithology/Iris), one per grammar, so a
 * provider that changes its path shows up as a failing test here rather than as
 * "the app opened the webpage instead of the player".
 *
 * Path-based and WebView-free on purpose: the parsing is a function of the path,
 * so the JVM can prove the half that used to be wrong.
 */
public class EmbedTitleTest {

    private static void assertTitle(String path, String type, String id, String season, String episode) {
        String[] got = MainActivity.embedTitle(path);
        if (got == null) throw new AssertionError("no title parsed out of " + path);
        assertArrayEquals("parsed from " + path, new String[] { type, id, season, episode }, got);
    }

    @Test
    public void ourOwnEmbedIsATitle() {
        // embed.theogpiratebot.to — Server 1 in both lanes since 2026-11-05.
        assertTitle("/embed/tv/1399/1/1", "tv", "1399", "1", "1");
        assertTitle("/embed/movie/27205", "movie", "27205", null, null);
    }

    @Test
    public void everyGrammarTheSiteEmitsIsUnderstood() {
        // /embed/…  TGVID, vidstuck (0vidads.top), our own embed.
        assertTitle("/embed/tv/1399/1/1", "tv", "1399", "1", "1");
        assertTitle("/embed/movie/27205", "movie", "27205", null, null);
        // /player/…  zxcstream, our Roxy slot.
        assertTitle("/player/movie/693134", "movie", "693134", null, null);
        // /watch/…  bingr.
        assertTitle("/watch/movie/693134", "movie", "693134", null, null);
        // bare /movie/…  vidfast.
        assertTitle("/movie/693134", "movie", "693134", null, null);
    }

    @Test
    public void aSeasonlessTvUrlDoesNotInventEpisodeOne() {
        // The anime lane's shape: the provider owns that numbering. Saying
        // "season 1, episode 1" opens an episode the viewer never chose.
        assertTitle("/embed/tv/1399", "tv", "1399", null, null);
    }

    @Test
    public void landingPagesAndAssetsAreNotPlayers() {
        assertFalse(MainActivity.isPlayerPage("/"));
        assertFalse(MainActivity.isPlayerPage("/api/v1/health"));
        assertFalse(MainActivity.isPlayerPage("/assets/app.js"));
        assertFalse(MainActivity.isPlayerPage("/demo"));
        assertTrue(MainActivity.isPlayerPage("/embed/tv/1/1/1"));
        assertTrue(MainActivity.isPlayerPage("/player/movie/1"));
    }

    @Test
    public void aDemoPageIsNotATitleEvenOnAPlayerPath() {
        // The providers publish /embed/demo and similar; no digits, no title.
        assertNull(MainActivity.embedTitle("/embed/demo"));
        assertNull(MainActivity.embedTitle("/"));
        assertNull(MainActivity.embedTitle((String) null));
    }
}
