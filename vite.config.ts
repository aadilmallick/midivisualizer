import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

const pwaPlugin = VitePWA({
  registerType: "autoUpdate",
  includeAssets: ["favicon.svg", "og-image.svg"],
  manifest: {
    name: "FlowKeys - Real-time MIDI Visualizer",
    short_name: "FlowKeys",
    description:
      "Experience your music come to life with FlowKeys. A stunning real-time MIDI visualizer with 88-key piano display and falling note animations.",
    theme_color: "#3b82f6",
    background_color: "#0f172a",
    display: "standalone",
    scope: "/",
    start_url: "/",
    orientation: "landscape-primary",
    icons: [
      {
        src: "/favicon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any maskable",
      },
    ],
    categories: ["music", "entertainment", "education"],
  },
  workbox: {
    // 1. This handles your local npm packages (@ffmpeg/ffmpeg, @ffmpeg/util)
    // because Vite bundles them into .js files.
    globPatterns: ["**/*.{js,css,html,svg,png,ico,txt,woff2}"],

    runtimeCaching: [
      {
        // Cache Web MIDI API related requests (Fonts)
        urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
        handler: "CacheFirst",
        options: {
          cacheName: "google-fonts-cache",
          expiration: {
            maxEntries: 10,
            maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
          },
          cacheableResponse: {
            statuses: [0, 200],
          },
        },
      },
      {
        // 2. Cache the heavy @ffmpeg/core files loaded by toBlobURL()
        // We use a flexible regex so it caches any minor version of 0.12.x
        urlPattern:
          /^https:\/\/cdn\.jsdelivr\.net\/npm\/@ffmpeg\/core@0\.12\.\d+\/dist\/esm\/.*/i,
        handler: "CacheFirst",
        options: {
          cacheName: "ffmpeg-core-esm-cache",
          expiration: {
            maxEntries: 10, // Keep a few versions in case of hotfixes
            maxAgeSeconds: 60 * 60 * 24 * 90, // 90 days
          },
          cacheableResponse: {
            statuses: [0, 200],
          },
        },
      },
    ],
    navigateFallback: null,
  },
  devOptions: {
    enabled: true,
    type: "module",
  },
});

export default defineConfig({
  plugins: [react(), tailwindcss(), pwaPlugin],
  server: {
    headers: {
      // Required for SharedArrayBuffer (which Emscripten relies on)
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  optimizeDeps: {
    // Prevents Vite from breaking FFmpeg's worker thread
    exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util"],
  },
});
