package com.fumio.app;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

/**
 * The quoting that carries typed text into the page.
 *
 * {@code TvRemoteKeys.quote} builds the JavaScript string literal for a
 * character the viewer pressed. A stray quote or backslash there is not a
 * cosmetic bug: it breaks the evaluated script, so that character is silently
 * not typed — on the one path that makes a TV search box work.
 */
public class TvRemoteKeysTest {

    @Test
    public void plainTextIsQuoted() {
        assertEquals("\"a\"", TvRemoteKeys.quote("a"));
    }

    @Test
    public void quotesAndBackslashesAreEscaped() {
        assertEquals("\"\\\\\"", TvRemoteKeys.quote("\\"));
        assertEquals("\"\\\"\"", TvRemoteKeys.quote("\""));
    }

    @Test
    public void aNewlineCannotBreakTheStatement() {
        assertEquals("\"\\n\"", TvRemoteKeys.quote("\n"));
    }

    @Test
    public void unicodePassesThrough() {
        // A remote or IME can produce these; the literal must stay valid.
        assertEquals("\"\u00e9\"", TvRemoteKeys.quote("\u00e9"));
    }
}
