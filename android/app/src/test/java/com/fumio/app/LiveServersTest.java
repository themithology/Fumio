package com.fumio.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * The embed hosts are learned from the site, so the app has to be able to say
 * "that is one of ours" for a host it was never compiled with.
 *
 * The failure this prevents is the one that shipped: vidstuck moved from
 * vidstuck.xyz to 0vidads.top and the app kept opening the site's own page —
 * with the site's ads — because the new host was not in a list inside the APK.
 */
public class LiveServersTest {

    @Test
    public void whatTheBundleKnowsBeforeAnyNetworkCall() {
        assertTrue("our own embed", LiveServers.isKnownHost("embed.theogpiratebot.to"));
        assertTrue("vidstuck's current domain", LiveServers.isKnownHost("0vidads.top"));
    }

    @Test
    public void aSubdomainOfAKnownHostStillCounts() {
        assertTrue(LiveServers.isKnownHost("cdn.0vidads.top"));
        assertTrue(LiveServers.isKnownHost("www.0vidads.top"));
    }

    @Test
    public void anUnrelatedHostIsNotAPlayer() {
        assertFalse(LiveServers.isKnownHost("example.com"));
        // A suffix match must not be fooled by a prefix that merely looks alike.
        assertFalse(LiveServers.isKnownHost("not0vidads.top.example.com"));
        assertFalse(LiveServers.isKnownHost(null));
        assertFalse(LiveServers.isKnownHost(""));
    }
}
