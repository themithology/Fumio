package com.fumio.app;

import static org.junit.Assert.assertEquals;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import android.app.UiModeManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.content.res.Configuration;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;

/**
 * "Am I on a television?" — the one boolean the whole TV build hangs off.
 *
 * Get this wrong in either direction and something real breaks:
 *
 *   - a TV that answers NO gets the phone experience: an ad wall that cannot
 *     be completed without Chrome, at 10 feet, with a remote;
 *   - a phone that answers YES gets no ad wall at all, which is the app giving
 *     away the only thing it monetises.
 *
 * Each of the four recognition paths is tested on its own, and so is the
 * default: a vendor whose system service throws must be treated as a phone.
 */
public class TvModeTest {

    private Context context;
    private UiModeManager ui;
    private PackageManager pm;

    @Before
    public void setUp() {
        TvMode.forget(); // the answer is cached; a test must not inherit one
        context = mock(Context.class);
        ui = mock(UiModeManager.class);
        pm = mock(PackageManager.class);
        when(context.getSystemService(Context.UI_MODE_SERVICE)).thenReturn(ui);
        when(context.getPackageManager()).thenReturn(pm);
    }

    @After
    public void tearDown() {
        TvMode.forget();
    }

    @Test
    public void systemUiModeTelevisionIsATv() {
        when(ui.getCurrentModeType()).thenReturn(Configuration.UI_MODE_TYPE_TELEVISION);
        assertEquals(true, TvMode.isTv(context));
    }

    @Test
    public void aLeanbackDeviceIsATv() {
        when(ui.getCurrentModeType()).thenReturn(Configuration.UI_MODE_TYPE_NORMAL);
        when(pm.hasSystemFeature(PackageManager.FEATURE_LEANBACK)).thenReturn(true);
        assertEquals(true, TvMode.isTv(context));
    }

    @Test
    public void fireTvStyleTelemetryIsATv() {
        when(ui.getCurrentModeType()).thenReturn(Configuration.UI_MODE_TYPE_NORMAL);
        when(pm.hasSystemFeature(PackageManager.FEATURE_TELEVISION)).thenReturn(true);
        assertEquals(true, TvMode.isTv(context));
    }

    @Test
    public void theLegacyTelevisionFeatureIsATv() {
        when(ui.getCurrentModeType()).thenReturn(Configuration.UI_MODE_TYPE_NORMAL);
        when(pm.hasSystemFeature("android.hardware.type.television")).thenReturn(true);
        assertEquals(true, TvMode.isTv(context));
    }

    @Test
    public void aPhoneIsNotATv() {
        when(ui.getCurrentModeType()).thenReturn(Configuration.UI_MODE_TYPE_NORMAL);
        assertEquals(false, TvMode.isTv(context));
    }

    @Test
    public void aBrokenSystemServiceFailsClosed() {
        // A vendor service that throws must never hand the phone the TV path
        // (which would skip the ad wall).
        when(ui.getCurrentModeType()).thenThrow(new RuntimeException("vendor"));
        when(pm.hasSystemFeature(PackageManager.FEATURE_LEANBACK)).thenThrow(new RuntimeException("vendor"));
        assertEquals(false, TvMode.isTv(context));
    }

    @Test
    public void noContextAtAllIsNotATv() {
        TvMode.forget();
        assertEquals(false, TvMode.isTv(null));
    }

    @Test
    public void theAnswerIsCachedUntilTheConfigurationChanges() {
        when(ui.getCurrentModeType()).thenReturn(Configuration.UI_MODE_TYPE_TELEVISION);
        assertEquals(true, TvMode.isTv(context));
        // Second call must not ask the system again: this runs on every resume.
        TvMode.forget();
        when(ui.getCurrentModeType()).thenReturn(Configuration.UI_MODE_TYPE_NORMAL);
        assertEquals(false, TvMode.isTv(context));
    }
}
