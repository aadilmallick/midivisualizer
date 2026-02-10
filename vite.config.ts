import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
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
        globPatterns: ["**/*.{js,css,html,svg,png,ico,txt,woff2}"],
        runtimeCaching: [
          {
            // Cache the @tonejs/midi library from CDN
            urlPattern: /^https:\/\/unpkg\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "cdn-cache",
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
            // Cache Web MIDI API related requests
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
        ],
        // Cache all navigation requests
        navigateFallback: null,
      },
      devOptions: {
        enabled: true,
        type: "module",
      },
    }),
  ],
});
