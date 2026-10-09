import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    allowedHosts: true,
    // Local Cloudflare Worker (run with `npm run worker:dev`, i.e. wrangler's
    // workerd runtime on :8787). The app always calls relative /tmdb and
    // /api paths in dev; this proxy forwards them to the local worker so you
    // never need CORS or a hardcoded localhost URL in client code.
    proxy: {
      "/tmdb": { target: "http://127.0.0.1:8787", changeOrigin: true },
      "/api": { target: "http://127.0.0.1:8787", changeOrigin: true },
    },
  },
  preview: {
    host: true,
    allowedHosts: true,
  },
});
