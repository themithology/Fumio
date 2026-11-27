package com.fumio.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * The site moved from theogpiratebot.online to theogpiratebot.to.
 *
 * THE FAILURE THIS PINS. `isLiveSite` decides whether a URL is our own site or
 * somebody else's: the app shell intercepts /watch, kills ads, routes downloads,
 * and decides whether a link opens in the app or in a browser, all on this one
 * answer. On the day the domain moved, a build that recognised only the new
 * host would treat every viewer still on the old one as a stranger — their own
 * site would open in a browser, and the player would stop being ours.
 *
 * So both origins must answer yes, and nothing else may.
 */
public class LiveOriginTest {

    @Test
    public void theNewOriginIsLive() {
        assertTrue(MainActivity.isLiveHost("theogpiratebot.to"));
        assertTrue(MainActivity.isLiveHost("www.theogpiratebot.to"));
    }

    @Test
    public void theOldOriginStillIs() {
        // Old links, old bookmarks, a WebView still sitting on the previous page.
        assertTrue(MainActivity.isLiveHost("theogpiratebot.online"));
        assertTrue(MainActivity.isLiveHost("www.theogpiratebot.online"));
    }

    @Test
    public void ourOwnEmbedIsASubdomainNotAStranger() {
        assertTrue(MainActivity.isLiveHost("embed.theogpiratebot.to"));
    }

    @Test
    public void hostCaseIsIrrelevant() {
        assertTrue(MainActivity.isLiveHost("TheOGPirateBot.TO"));
    }

    @Test
    public void lookAlikesAreNotUs() {
        // A suffix match must not be fooled by a prefix that merely resembles it.
        assertFalse(MainActivity.isLiveHost("nottheogpiratebot.to"));
        assertFalse(MainActivity.isLiveHost("theogpiratebot.to.example.com"));
        assertFalse(MainActivity.isLiveHost("theogpiratebot.told"));
        assertFalse(MainActivity.isLiveHost("theogpiratebot.online.example.com"));
        assertFalse(MainActivity.isLiveHost(null));
        assertFalse(MainActivity.isLiveHost(""));
    }
}
