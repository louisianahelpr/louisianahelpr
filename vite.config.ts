import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { createRequire } from "module";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

const require = createRequire(import.meta.url);
const reactEntry = require.resolve("react");
const reactDomEntry = require.resolve("react-dom");
const reactDomClientEntry = require.resolve("react-dom/client");
const reactJsxRuntimeEntry = require.resolve("react/jsx-runtime");
const reactJsxDevRuntimeEntry = require.resolve("react/jsx-dev-runtime");

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "robots.txt", "apple-touch-icon.png"],
      workbox: {
        navigateFallbackDenylist: [/^\/~oauth/],
        globPatterns: ["**/*.{js,css,html,ico,png,svg,jpg,jpeg,webp,woff,woff2}"],
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
            handler: "NetworkFirst",
            options: {
              cacheName: "api-cache",
              expiration: { maxEntries: 50, maxAgeSeconds: 300 },
            },
          },
        ],
      },
      manifest: {
        id: "/?source=helpr-pwa",
        name: "Helpr — Louisiana Help Marketplace",
        short_name: "Helpr",
        description: "Connect with trusted Louisiana neighbors for cleaning, errands, moving, yard work, and more.",
        theme_color: "#1FA678",
        background_color: "#1FA678",
        display: "standalone",
        orientation: "portrait",
        scope: "/",
        start_url: "/?source=pwa",
        icons: [
          { src: "/pwa-192x192-v2.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512x512-v2.png", sizes: "512x512", type: "image/png" },
          { src: "/pwa-512x512-v2.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ].filter(Boolean),
  resolve: {
    alias: [
      { find: "@", replacement: path.resolve(__dirname, "./src") },
      { find: /^react$/, replacement: reactEntry },
      { find: /^react-dom$/, replacement: reactDomEntry },
      { find: /^react-dom\/client$/, replacement: reactDomClientEntry },
      { find: /^react\/jsx-runtime$/, replacement: reactJsxRuntimeEntry },
      { find: /^react\/jsx-dev-runtime$/, replacement: reactJsxDevRuntimeEntry },
    ],
    dedupe: ["react", "react-dom", "react/jsx-runtime"],
  },
  // Force Vite to pre-bundle React and any libs that consume React hooks
  // into a single dep graph. Without this, @sentry/react and Radix can end
  // up in separate optimized chunks with their own React copy, which makes
  // hooks like useRef return null at runtime (TooltipProvider crash).
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "@sentry/react",
      "@radix-ui/react-tooltip",
    ],
  },
  // Strip console + debugger from production bundles. Keeps bundle slim
  // and avoids leaking debug info in App Store builds.
  esbuild: {
    drop: mode === "production" ? ["console", "debugger"] : [],
  },
  build: {
    target: "es2020",
    cssCodeSplit: true,
    sourcemap: false,
    rollupOptions: {
      // Native-only Capacitor plugins that aren't installed in the web build.
      // They're loaded via dynamic import() and silently no-op on web.
      external: ["@capacitor-community/in-app-review"],
      output: {
        // Bundle all lucide icons into a single chunk so we don't ship 40+
        // tiny per-icon files (HTTP overhead > byte savings).
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("lucide-react")) return "lucide";
          if (id.includes("@radix-ui")) return "radix";
          if (id.includes("react-dom")) return "react-dom";
          if (id.includes("recharts") || id.includes("d3-")) return "charts";
          if (id.includes("framer-motion")) return "motion";
          if (id.includes("@stripe") || id.includes("stripe-js")) return "stripe";
          if (id.includes("@supabase")) return "supabase";
          if (id.includes("date-fns") || id.includes("react-day-picker")) return "dates";
          if (id.includes("@tanstack")) return "tanstack";
          if (id.includes("react-hook-form") || id.includes("zod") || id.includes("@hookform")) return "forms";
        },
      },
    },
  },
}));
