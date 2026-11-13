import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const accountApiTarget = env.VITE_ACCOUNT_API_DEV_TARGET;

  return {
    plugins: [react(), tailwindcss()],
    build: {
      // ── Why this is pinned ──────────────────────────────────────────────
      // The bundle is not only a website: it is the app's PLAYER and its
      // offline copy, and it runs inside whatever WebView the device has.
      // Vite 6's default target is 'baseline-widely-available' (Chrome 107+),
      // which leaves `??` and `?.` in the output — syntax an older Android TV
      // box's WebView (Chrome 60–80, common on cheap boxes that never get
      // Play updates) cannot PARSE. The failure mode is a blank player, on a
      // television, with no error anyone can see.
      //
      // chrome64 is the floor: everything above that syntax level is
      // downlevelled to plain functions and ternaries, so the same file runs
      // on a 2018 box and a 2025 phone. Nothing about behaviour changes; the
      // bundle simply uses older grammar.
      target: ["chrome64", "safari12"],
    },
    server: {
      host: true,
      allowedHosts: true,
      watch: { ignored: ["**/android/**", "**/worker/.wrangler/**"] },
      // Local Cloudflare Worker (run with `npm run worker:dev`, i.e. wrangler's
      // workerd runtime on :8787). The app always calls relative /tmdb and
      // /api paths in dev; this proxy forwards them to the local worker so you
      // never need CORS or a hardcoded localhost URL in client code.
      proxy: {
        // When an Iris/Fumio Node server is running locally, route only the
        // member database paths there; the media proxy keeps using workerd.
        ...(accountApiTarget
          ? {
              "/api/db": { target: accountApiTarget, changeOrigin: true },
              "/api/recommendations": { target: accountApiTarget, changeOrigin: true },
            }
          : {}),
        "/tmdb": { target: "http://127.0.0.1:8787", changeOrigin: true },
        "/api": { target: "http://127.0.0.1:8787", changeOrigin: true },
      },
    },
    preview: {
      host: true,
      allowedHosts: true,
    },
  };
});
