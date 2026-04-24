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
      // Defer the SW registration script so it doesn't block FCP.
      // Lighthouse flagged /registerSW.js as a ~150ms render-blocking request
      // in the critical chain. "script-defer" emits the same script tag with
      // `defer` so the browser can paint before fetching/parsing it.
      injectRegister: "script-defer",
      includeAssets: ["favicon.ico", "robots.txt", "apple-touch-icon.png"],
      workbox: {
        navigateFallbackDenylist: [/^\/~oauth/],
        globPatterns: ["**/*.{js,css,html,ico,png,svg,jpg,jpeg,webp,woff,woff2}"],
        // Don't precache heavy admin-only chunks. They're lazy-loaded behind
        // an auth gate and would otherwise bloat the SW cache for every
        // public visitor (Lighthouse flags them as unused JS on landing).
        globIgnores: [
          "**/assets/charts-*.js",
          "**/assets/Admin*-*.js",
          // framer-motion is only used inside Dashboard / Community and a few
          // dialogs that mount post-login. The landing page has zero motion
          // imports, but the SW would otherwise fetch this 42 KB chunk on the
          // first visit and Lighthouse attributes the load + a misleading
          // forced-reflow source to it. Defer the cache fetch to actual use.
          "**/assets/motion-*.js",
        ],
        // Bump the per-file precache limit so the main bundle still fits.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
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
      "@radix-ui/react-tooltip",
    ],
  },
  // Strip console + debugger from production bundles. Keeps bundle slim
  // and avoids leaking debug info in App Store builds.
  esbuild: {
    drop: mode === "production" ? ["console", "debugger"] : [],
  },
  build: {
    // es2022 is Baseline-supported across all evergreen browsers (Chrome 94+,
    // Safari 16.4+, Firefox 93+) and lets Vite skip down-leveling syntax like
    // class fields / top-level await. Cuts a few KB of legacy helpers.
    target: "es2022",
    cssCodeSplit: true,
    // Emit production source maps so Lighthouse / Sentry / DevTools can
    // map minified frames back to original source. Hidden = .map files
    // are uploaded but no `//# sourceMappingURL=` comment is appended,
    // keeping the maps available without exposing them via the bundle.
    sourcemap: true,
    // Terser produces tighter output than esbuild's default minifier for ESM
    // packages like lucide-react that ship with comments + whitespace.
    minify: "terser",
    terserOptions: {
      compress: { passes: 2 },
      format: { comments: false },
    },
    rollupOptions: {
      // Native-only Capacitor plugins that aren't installed in the web build.
      // They're loaded via dynamic import() and silently no-op on web.
      external: ["@capacitor-community/in-app-review"],
      output: {
        // Bundle all lucide icons into a single chunk so we don't ship 40+
        // tiny per-icon files (HTTP overhead > byte savings).
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          // CRITICAL: Keep React, React DOM, scheduler and the JSX runtime
          // together in ONE chunk. Splitting react-dom away from react (or
          // letting Radix end up in a separate chunk that loads first)
          // causes "Cannot read properties of null (reading 'useRef')"
          // because React's internal dispatcher isn't initialized yet when
          // a hook in another chunk runs.
          if (
            id.includes("/node_modules/react/") ||
            id.includes("/node_modules/react-dom/") ||
            id.includes("/node_modules/scheduler/")
          ) {
            return "react-vendor";
          }
          if (id.includes("lucide-react")) return "lucide";
          if (id.includes("recharts") || id.includes("d3-")) return "charts";
          if (id.includes("framer-motion")) return "motion";
          if (id.includes("@stripe") || id.includes("stripe-js")) return "stripe";
          if (id.includes("@supabase")) return "supabase";
          if (id.includes("date-fns") || id.includes("react-day-picker")) return "dates";
          if (id.includes("@tanstack")) return "tanstack";
          if (id.includes("react-hook-form") || id.includes("zod") || id.includes("@hookform")) return "forms";
          // Split Sentry and PostHog out of the main bundle. They're only
          // imported from src/lib/sentry.ts and src/lib/posthog.ts, which are
          // dynamically imported AFTER first paint via requestIdleCallback in
          // main.tsx. Splitting them shaves ~70KB off the LCP-blocking main
          // chunk on the landing page.
          if (id.includes("@sentry") || id.includes("sentry-internal")) return "sentry";
          if (id.includes("posthog-js")) return "posthog";
        },
      },
    },
  },
}));
