package com.fumio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * What counts as a downloadable file.
 *
 * {@code Downloader.looksLikeFile} is the last gate before a tap either saves a
 * film or tries to render an .mkv as a web page (which shows a black screen and
 * nothing else). It runs on URLs coming from servers we do not control, so the
 * shapes it has to survive are the ones those servers actually emit.
 */
public class DownloaderTest {

    @Test
    public void recognisesTheFormatsThePoolsServe() {
        String[] files = {
            "https://tgdl.lovable.app/file/abc.mkv",
            "https://host.example/film.MP4",
            "https://host.example/ep1.srt",
            "https://host.example/bundle.zip",
            "https://host.example/app.apk",
            "https://host.example/x.webm",
            "https://host.example/show.torrent",
        };
        for (String url : files) {
            assertTrue(url, Downloader.looksLikeFile(url));
        }
    }

    @Test
    public void aQueryStringIsNotTheExtension() {
        // The download pools put tokens after the name. If this returns false
        // the file opens in the WebView instead of downloading.
        assertTrue(Downloader.looksLikeFile("https://host.example/film.mkv?token=abc&expires=1"));
        assertTrue(Downloader.looksLikeFile("https://host.example/film.mp4?a=1.mkv"));
    }

    @Test
    public void pagesAreNotFiles() {
        String[] pages = {
            "https://theogpiratebot.to/download",
            "https://theogpiratebot.to/watch/movie/550",
            "https://host.example/file/abc", // no extension at all
            "https://host.example/player?id=1",
        };
        for (String url : pages) {
            assertFalse(url, Downloader.looksLikeFile(url));
        }
    }

    @Test
    public void nothingIsNotAFile() {
        assertFalse(Downloader.looksLikeFile(null));
        assertFalse(Downloader.looksLikeFile(""));
    }

    @Test
    public void anSpaRouteThatMerelyContainsADotIsNotAFile() {
        // /v1.2/player is a route, not media. The regex is anchored on the
        // final segment's extension, so this must not pass.
        assertFalse(Downloader.looksLikeFile("https://host.example/v1.2/player"));
    }
}
