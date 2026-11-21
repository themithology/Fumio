package com.fumio.app;

import android.view.KeyEvent;
import android.webkit.WebView;

/**
 * TYPING FROM A REMOTE.
 *
 * The problem this solves is specific: on a television, "focus the search box"
 * is easy and "put characters in it" is not. Most Android TV boxes ship no soft
 * keyboard, so the IME path ({@link TvUi#showKeyboard}) can legitimately open
 * nothing — and a viewer is left pointing at an empty search field with a remote
 * that only has arrows and OK.
 *
 * So when a text field has focus, the remote's printable keys are turned into
 * text and inserted into the page, through {@code FumioTvType} /
 * {@code FumioTvBackspace} in tv-cursor.js. That is the one path that works on
 * every device: a D-pad-only remote types nothing (there is nothing to type),
 * and any remote or air-mouse that has letters types them.
 *
 * Rules, all of them learned from what a real keyboard does:
 *
 *   - Letters, digits and punctuation go in as text, with SHIFT honoured.
 *   - DEL / FORWARD_DEL is a backspace.
 *   - OK / ENTER submits and gives up the field (a search box must be able to
 *     search), and BACK leaves the field without navigating the app away.
 *   - Arrows, MENU, volume, media keys and power are NOT ours while typing:
 *     they return false and reach the WebView, because a page may use the arrows
 *     inside a text field (an autocomplete list) and the box may need its volume.
 */
final class TvRemoteKeys {

    /** Nothing to do with typing: never swallow these. */
    private static final int[] NEVER = {
        KeyEvent.KEYCODE_VOLUME_UP,
        KeyEvent.KEYCODE_VOLUME_DOWN,
        KeyEvent.KEYCODE_VOLUME_MUTE,
        KeyEvent.KEYCODE_POWER,
        KeyEvent.KEYCODE_HOME,
        KeyEvent.KEYCODE_MENU,
        KeyEvent.KEYCODE_INFO,
        KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE,
        KeyEvent.KEYCODE_MEDIA_PLAY,
        KeyEvent.KEYCODE_MEDIA_PAUSE,
        KeyEvent.KEYCODE_MEDIA_STOP,
        KeyEvent.KEYCODE_MEDIA_REWIND,
        KeyEvent.KEYCODE_MEDIA_FAST_FORWARD,
    };

    private TvRemoteKeys() {}

    /**
     * @return true when this key became text in the page and must not be
     *         delivered to anything else.
     */
    static boolean handle(WebView webView, KeyEvent event) {
        if (webView == null || event == null) return false;
        int code = event.getKeyCode();

        for (int never : NEVER) {
            if (code == never) return false;
        }

        // BACK leaves the field. The app's BACK handling is a BackPressed
        // callback, not a key event, so swallowing the field's BACK here does
        // not trap the viewer: the page blurs, and the next BACK leaves.
        if (code == KeyEvent.KEYCODE_BACK) {
            if (event.getAction() == KeyEvent.ACTION_DOWN) run(webView, "window.FumioTvBlur&&window.FumioTvBlur();");
            return true;
        }

        if (event.getAction() != KeyEvent.ACTION_DOWN) {
            // Every repeat of a letter must be delivered, so only the initial
            // DOWN of a *command* key is filtered; characters repeat below.
            if (event.getAction() != KeyEvent.ACTION_MULTIPLE) return isCharacter(code);
        }

        if (code == KeyEvent.KEYCODE_DEL) {
            run(webView, "window.FumioTvBackspace&&window.FumioTvBackspace();");
            return true;
        }
        if (code == KeyEvent.KEYCODE_FORWARD_DEL) {
            run(webView, "window.FumioTvBackspace&&window.FumioTvBackspace();");
            return true;
        }
        if (code == KeyEvent.KEYCODE_DPAD_CENTER || code == KeyEvent.KEYCODE_ENTER) {
            // A search field is useless without a way to run the search: the
            // page's own handler has the value, so let the WebView have the key.
            return false;
        }

        String text = charactersFor(event);
        if (text == null) return false;
        run(webView, "window.FumioTvType&&window.FumioTvType(" + quote(text) + ");");
        return true;
    }

    /** Does this key produce a character at all? Used for key-ups. */
    private static boolean isCharacter(int code) {
        return code >= KeyEvent.KEYCODE_A && code <= KeyEvent.KEYCODE_Z;
    }

    /**
     * The text a key produces, or null.
     *
     * KeyEvent.getUnicodeChar already handles SHIFT and the keyboard layout for
     * a hardware keyboard, which is what an air-mouse presents itself as — so it
     * is preferred over a hand-written A–Z table. The table is the fallback for
     * keys with no unicode value (some remote firmware reports 0, and a
     * synthetic KeyEvent always does).
     *
     * Package-private and WebView-free on purpose: this is the part that decides
     * whether a letter reaches the page, so it must be testable without a
     * WebView — and a WebView can only be touched from the UI thread.
     */
    static String charactersFor(KeyEvent event) {
        if (event == null) return null;
        int code = event.getKeyCode();
        boolean shift = event.isShiftPressed();

        // LETTERS FIRST, from the key code, because getUnicodeChar does not
        // reliably honour SHIFT here: on the TV image, SHIFT+B came back as "b",
        // so a capital was impossible to type into a search box. A remote's
        // letter keys are layout-independent, so the key code is the source of
        // truth and SHIFT is applied by us.
        if (code >= KeyEvent.KEYCODE_A && code <= KeyEvent.KEYCODE_Z) {
            char letter = (char) ('a' + (code - KeyEvent.KEYCODE_A));
            return String.valueOf(shift ? Character.toUpperCase(letter) : letter);
        }

        int unicode = 0;
        try {
            unicode = event.getUnicodeChar(event.getMetaState());
        } catch (Exception ignored) {
            unicode = 0;
        }
        if (unicode > 0 && !Character.isISOControl((char) unicode)) {
            return new String(Character.toChars(unicode));
        }

        if (code >= KeyEvent.KEYCODE_0 && code <= KeyEvent.KEYCODE_9) {
            return String.valueOf((char) ('0' + (code - KeyEvent.KEYCODE_0)));
        }
        if (code == KeyEvent.KEYCODE_SPACE) return " ";
        if (code == KeyEvent.KEYCODE_PERIOD) return ".";
        if (code == KeyEvent.KEYCODE_COMMA) return ",";
        if (code == KeyEvent.KEYCODE_MINUS) return "-";
        if (code == KeyEvent.KEYCODE_APOSTROPHE) return "'";
        if (code == KeyEvent.KEYCODE_SLASH) return "/";
        if (code == KeyEvent.KEYCODE_AT) return "@";
        if (code == KeyEvent.KEYCODE_GRAVE) return "`";
        if (code == KeyEvent.KEYCODE_SEMICOLON) return ";";
        if (code == KeyEvent.KEYCODE_EQUALS) return "=";
        if (code == KeyEvent.KEYCODE_LEFT_BRACKET) return "[";
        if (code == KeyEvent.KEYCODE_RIGHT_BRACKET) return "]";
        if (code == KeyEvent.KEYCODE_BACKSLASH) return "\\";
        return null;
    }

    /** JSON-quote for evaluateJavascript without pulling in org.json here. */
    static String quote(String value) {
        StringBuilder out = new StringBuilder(value.length() + 2);
        out.append('"');
        for (int i = 0; i < value.length(); i += 1) {
            char c = value.charAt(i);
            if (c == '"' || c == '\\') out.append('\\');
            if (c == '\n') {
                out.append("\\n");
                continue;
            }
            out.append(c);
        }
        out.append('"');
        return out.toString();
    }

    private static void run(WebView webView, String script) {
        try {
            webView.evaluateJavascript(script, null);
        } catch (Exception ignored) {
            /* the view may be going away */
        }
    }
}
