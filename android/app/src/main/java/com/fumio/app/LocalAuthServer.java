package com.fumio.app;

import android.net.Uri;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Loopback page that Chrome can load so Firebase Auth starts in the same
 * browser that later hits {@code /__/auth/handler}. Opening the handler cold
 * is what produced "missing initial state".
 */
final class LocalAuthServer {

    interface TokenListener {
        void onGoogleIdToken(String idToken);
    }

    private final AtomicBoolean running = new AtomicBoolean(false);
    private ServerSocket socket;
    private Thread thread;
    private byte[] html = new byte[0];
    private TokenListener listener;

    synchronized int start(String page, TokenListener tokenListener) throws Exception {
        stop();
        html = page.getBytes(StandardCharsets.UTF_8);
        listener = tokenListener;
        // Wildcard so Chrome can use localhost (IPv4 or IPv6). Non-loopback
        // clients are dropped in acceptLoop.
        socket = new ServerSocket(0);
        running.set(true);
        thread = new Thread(this::acceptLoop, "fumio-google-auth");
        thread.setDaemon(true);
        thread.start();
        return socket.getLocalPort();
    }

    synchronized void stop() {
        running.set(false);
        ServerSocket open = socket;
        socket = null;
        listener = null;
        if (open != null) {
            try {
                open.close();
            } catch (Exception ignored) {
                // Closed on teardown.
            }
        }
    }

    private void acceptLoop() {
        while (running.get()) {
            ServerSocket open = socket;
            if (open == null || open.isClosed()) return;
            try {
                Socket client = open.accept();
                if (client.getInetAddress() != null && !client.getInetAddress().isLoopbackAddress()) {
                    client.close();
                    continue;
                }
                handle(client);
            } catch (Exception ignored) {
                if (!running.get()) return;
            }
        }
    }

    private void handle(Socket client) {
        try (Socket ignored = client;
             InputStream in = client.getInputStream();
             OutputStream out = client.getOutputStream()) {
            BufferedReader reader = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
            String request = reader.readLine();
            if (request == null) return;
            while (true) {
                String header = reader.readLine();
                if (header == null || header.isEmpty()) break;
            }

            String path = pathOf(request);
            if (path.startsWith("/done")) {
                String token = tokenOf(path);
                if (token != null && !token.isEmpty()) {
                    TokenListener next = listener;
                    if (next != null) next.onGoogleIdToken(token);
                }
                write(out, 200, "text/plain; charset=utf-8", "ok".getBytes(StandardCharsets.UTF_8), request);
                return;
            }

            write(out, 200, "text/html; charset=utf-8", html, request);
        } catch (Exception ignored) {
            // Chrome disconnected; the next request can retry.
        }
    }

    private static String pathOf(String request) {
        int first = request.indexOf(' ');
        int second = request.indexOf(' ', first + 1);
        if (first < 0) return "/";
        if (second < 0) return request.substring(first + 1);
        return request.substring(first + 1, second);
    }

    private static String tokenOf(String path) {
        int query = path.indexOf('?');
        if (query < 0) return "";
        return Uri.parse("http://local" + path).getQueryParameter("idToken");
    }

    private static void write(OutputStream out, int status, String type, byte[] body, String request) throws Exception {
        boolean head = request.startsWith("HEAD ");
        String reason = status == 200 ? "OK" : "Error";
        String headers =
            "HTTP/1.1 " + status + " " + reason + "\r\n" +
            "Content-Type: " + type + "\r\n" +
            "Content-Length: " + body.length + "\r\n" +
            "Cache-Control: no-store\r\n" +
            "Connection: close\r\n\r\n";
        out.write(headers.getBytes(StandardCharsets.UTF_8));
        if (!head) out.write(body);
        out.flush();
    }
}
