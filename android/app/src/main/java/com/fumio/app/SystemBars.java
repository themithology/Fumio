package com.fumio.app;

import android.os.Build;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import androidx.core.view.WindowCompat;

/**
 * Browse: keep the clock/battery bar and stay out of the notch.
 * Playback: hide bars and allow the player into the cutout.
 */
final class SystemBars {

    private SystemBars() {}

    static void rest(Window window) {
        show(window);
    }

    static void hide(Window window) {
        if (window == null) return;
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        window.addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        setCutout(window, true);
        WindowCompat.setDecorFitsSystemWindows(window, false);
        View decor = window.getDecorView();
        decor.setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
        );
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController controller = window.getInsetsController();
            if (controller != null) {
                controller.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                controller.setSystemBarsBehavior(
                    WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                );
            }
        }
    }

    static void show(Window window) {
        if (window == null) return;
        window.clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setCutout(window, false);
        WindowCompat.setDecorFitsSystemWindows(window, true);
        View decor = window.getDecorView();
        decor.setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController controller = window.getInsetsController();
            if (controller != null) {
                controller.show(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
            }
        }
    }

    private static void setCutout(Window window, boolean intoCutout) {
        if (Build.VERSION.SDK_INT < 28) return;
        WindowManager.LayoutParams params = window.getAttributes();
        params.layoutInDisplayCutoutMode =
            intoCutout
                ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
                : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_NEVER;
        window.setAttributes(params);
    }
}
