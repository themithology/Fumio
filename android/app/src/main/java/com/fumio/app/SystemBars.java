package com.fumio.app;

import android.graphics.Color;
import android.os.Build;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;

/**
 * Browse: the activity starts below the Android status bar (clock / battery /
 * notch stay outside the app). Playback: hide those bars.
 */
final class SystemBars {

    private SystemBars() {}

    static void browse(Window window, View content) {
        if (window == null) return;
        window.clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        window.setStatusBarColor(Color.BLACK);
        if (Build.VERSION.SDK_INT >= 21) window.setNavigationBarColor(Color.BLACK);
        setCutout(window, false);
        if (Build.VERSION.SDK_INT >= 30) window.setDecorFitsSystemWindows(true);
        View decor = window.getDecorView();
        decor.setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController controller = window.getInsetsController();
            if (controller != null) {
                controller.show(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
            }
        }
        if (content != null) {
            content.setFitsSystemWindows(true);
            content.setPadding(0, 0, 0, 0);
            content.requestApplyInsets();
        }
    }

    static void hide(Window window, View content) {
        if (content != null) {
            content.setFitsSystemWindows(false);
            content.setPadding(0, 0, 0, 0);
        }
        hide(window);
    }

    static void hide(Window window) {
        if (window == null) return;
        if (Build.VERSION.SDK_INT >= 30) window.setDecorFitsSystemWindows(false);
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        window.addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        setCutout(window, true);
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
        browse(window, null);
    }

    private static void setCutout(Window window, boolean intoCutout) {
        if (Build.VERSION.SDK_INT < 28) return;
        WindowManager.LayoutParams params = window.getAttributes();
        params.layoutInDisplayCutoutMode =
            intoCutout
                ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
                : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_DEFAULT;
        window.setAttributes(params);
    }
}
