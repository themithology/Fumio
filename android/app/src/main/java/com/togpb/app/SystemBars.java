package com.togpb.app;

import android.graphics.Color;
import android.os.Build;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;

/**
 * Browse: keep the system status bar and push the WebView below it (layout
 * margins). Playback: hide bars and let the player fill the screen.
 */
final class SystemBars {

    private SystemBars() {}

    static void browse(Window window, View webView) {
        if (window == null) return;
        window.clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        window.setStatusBarColor(Color.BLACK);
        if (Build.VERSION.SDK_INT >= 21) window.setNavigationBarColor(Color.BLACK);
        if (Build.VERSION.SDK_INT >= 30) window.setDecorFitsSystemWindows(false);
        setCutout(window, true);
        View decor = window.getDecorView();
        decor.setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController controller = window.getInsetsController();
            if (controller != null) {
                controller.show(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
            }
        }
        insetWebView(webView, true);
    }

    static void hide(Window window, View webView) {
        insetWebView(webView, false);
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

    private static void insetWebView(View webView, boolean inset) {
        if (webView == null) return;
        webView.setFitsSystemWindows(false);
        webView.setOnApplyWindowInsetsListener(
            (v, insets) -> {
                int left = 0;
                int top = 0;
                int right = 0;
                int bottom = 0;
                if (inset) {
                    if (Build.VERSION.SDK_INT >= 30) {
                        android.graphics.Insets bars =
                            insets.getInsets(
                                WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout()
                            );
                        left = bars.left;
                        top = bars.top;
                        right = bars.right;
                        bottom = bars.bottom;
                    } else {
                        left = insets.getSystemWindowInsetLeft();
                        top = insets.getSystemWindowInsetTop();
                        right = insets.getSystemWindowInsetRight();
                        bottom = insets.getSystemWindowInsetBottom();
                    }
                }
                applyMargins(v, left, top, right, bottom);
                return insets;
            }
        );
        webView.requestApplyInsets();
        if (!inset) applyMargins(webView, 0, 0, 0, 0);
    }

    private static void applyMargins(View view, int left, int top, int right, int bottom) {
        ViewGroup.LayoutParams params = view.getLayoutParams();
        if (!(params instanceof ViewGroup.MarginLayoutParams)) return;
        ViewGroup.MarginLayoutParams margins = (ViewGroup.MarginLayoutParams) params;
        if (
            margins.leftMargin == left &&
            margins.topMargin == top &&
            margins.rightMargin == right &&
            margins.bottomMargin == bottom
        ) {
            return;
        }
        margins.setMargins(left, top, right, bottom);
        view.setLayoutParams(margins);
    }

    private static void setCutout(Window window, boolean intoCutout) {
        if (Build.VERSION.SDK_INT < 28) return;
        WindowManager.LayoutParams params = window.getAttributes();
        params.layoutInDisplayCutoutMode =
            WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        window.setAttributes(params);
    }
}
