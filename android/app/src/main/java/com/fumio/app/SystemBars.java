package com.fumio.app;

import android.os.Build;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;

/**
 * Browse: full-screen window (no letterbox), pad the WebView for the
 * status/nav/cutout so UI is not drawn through the notch.
 * Playback: hide bars and use the cutout.
 */
final class SystemBars {

    private SystemBars() {}

    static void browse(Window window, View content) {
        show(window);
        pad(content, true);
    }

    static void hide(Window window, View content) {
        hide(window);
        pad(content, false);
    }

    static void hide(Window window) {
        if (window == null) return;
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
        if (window == null) return;
        window.clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setCutout(window, true);
        View decor = window.getDecorView();
        decor.setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController controller = window.getInsetsController();
            if (controller != null) {
                controller.show(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
            }
        }
    }

    private static void pad(View content, boolean inset) {
        if (content == null) return;
        if (!inset) {
            content.setPadding(0, 0, 0, 0);
            return;
        }
        content.setOnApplyWindowInsetsListener(
            (v, insets) -> {
                int left;
                int top;
                int right;
                int bottom;
                if (Build.VERSION.SDK_INT >= 30) {
                    android.graphics.Insets bars =
                        insets.getInsets(
                            WindowInsets.Type.statusBars() | WindowInsets.Type.displayCutout()
                        );
                    android.graphics.Insets nav = insets.getInsets(WindowInsets.Type.navigationBars());
                    left = Math.max(bars.left, nav.left);
                    top = bars.top;
                    right = Math.max(bars.right, nav.right);
                    bottom = nav.bottom;
                } else {
                    left = insets.getSystemWindowInsetLeft();
                    top = insets.getSystemWindowInsetTop();
                    right = insets.getSystemWindowInsetRight();
                    bottom = insets.getSystemWindowInsetBottom();
                }
                v.setPadding(left, top, right, bottom);
                return insets;
            }
        );
        content.requestApplyInsets();
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
