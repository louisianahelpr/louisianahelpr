import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { createRequire } from "module";
import { execSync } from "node:child_process";
import { VitePWA } from "vite-plugin-pwa";
import { visualizer } from "rollup-plugin-visualizer";

const require = createRequire(import.meta.url);

// Build identity — baked into the bundle at build time so any running app
// can show exactly which commit it was built from without any API calls.
const appCommit = (() => {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev";
  }
})();
const appBuiltAt = new Date().toISOString();

const reactEntry = require.resolve("react");
const reactDomEntry = require.resolve("react-dom");
const reactDomClientEntry = require.resolve("react-dom/client");
const reactJsxRuntimeEntry = require.resolve("react/jsx-runtime");
const reactJsxDevRuntimeEntry = require.resolve("react/jsx-dev-runtime");
const isCapacitorBuild = process.env.VITE_CAPACITOR_BUILD === "1";
// Opt-in bundle analyzer: `ANALYZE=1 npm run build` writes dist/stats.html.
// Off by default so normal builds don't pay the analysis overhead.
const isAnalyze = process.env.ANALYZE === "1";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  define: {
    __APP_COMMIT__: JSON.stringify(appCommit),
    __APP_BUILT_AT__: JSON.stringify(appBuiltAt),
  },
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    isAnalyze && visualizer({
      filename: "dist/stats.html",
      open: false,
      gzipSize: true,
      brotliSize: true,
      template: "treemap",
    }) as Plugin,
    // Strip the <meta http-equiv="Content-Security-Policy"> tag from the
    // web build. The meta exists for Capacitor (file:// loads can't get
    // HTTP headers), but on web Vercel injects a CSP header from
    // vercel.json. When BOTH are present the browser intersects them per
    // W3C CSP spec — the meta is more restrictive, so it silently blocks
    // resources the header allows (PostHog ingestion, OpenAI, Stripe
    // checkout iframes, blob: workers, unsafe-eval). This plugin keeps
    // the meta only for the Capacitor bundle where it's actually needed.
    !isCapacitorBuild && {
      name: "html-strip-meta-csp",
      apply: "build",
      enforce: "post",
      transformIndexHtml(html: string) {
        return html.replace(
          /\s*<meta\s+http-equiv=["']Content-Security-Policy["'][^>]*>\s*/gi,
          "\n",
        );
      },
    } satisfies Plugin,
    // Avoid the main app stylesheet blocking first paint. Vite emits the entry
    // CSS as a synchronous <link rel="stylesheet">, which Lighthouse flagged as
    // a ~150ms render-blocking request on the critical path. We rewrite that
    // tag to the standard async-CSS pattern (media="print" + onload swap) and
    // add a <noscript> fallback so non-JS clients still get styled output.
    // This is build-time only and does not change any styles or load order
    // beyond moving the stylesheet off the render-blocking critical path.
    {
      name: "html-async-entry-css",
      apply: "build",
      enforce: "post",
      transformIndexHtml(html: string) {
        return html.replace(
          /<link rel="stylesheet"[^>]*?href="(\/assets\/[^"]+\.css)"[^>]*>/g,
          (_match: string, href: string) =>
            `<link rel="preload" as="style" href="${href}">` +
            `<link rel="stylesheet" href="${href}" media="print" onload="this.media='all'">` +
            `<noscript><link rel="stylesheet" href="${href}"></noscript>`,
        );
      },
    } satisfies Plugin,
    // Hero LCP preload plugin removed 2026-05-04: HeroSection no longer
    // renders an <img> for hero-porch-garden-*.webp — those assets were
    // retired with the editorial brand polish. The plugin scanned the
    // bundle for filenames that no longer exist and silently no-op'd.
    // If hero imagery returns, restore from git history at this commit's
    // parent and update the regex to match the new asset name.
    // Service worker only ships in production. In dev it caused stale chunks
    // to be served across HMR reloads — code edits "didn't appear" because a
    // pre-cached bundle answered the request before Vite's transform pipeline
    // even ran. Disabling in dev removes that whole class of bug.
    mode === "production" && !isCapacitorBuild && VitePWA({
      registerType: "autoUpdate",
      // Defer the SW registration script so it doesn't block FCP.
      // Lighthouse flagged /registerSW.js as a ~150ms render-blocking request
      // in the critical chain. "script-defer" emits the same script tag with
      // `defer` so the browser can paint before fetching/parsing it.
      injectRegister: "script-defer",
      includeAssets: ["favicon.ico", "robots.txt", "apple-touch-icon.png"],
      workbox: {
        navigateFallbackDenylist: [/^\/~oauth/],
        // PRECACHE = critical-path first-paint files ONLY. Everything else
        // (route chunks, dialog chunks, vendor chunks not in the entry's
        // static graph, all src/assets/ imagery, social/marketing PNGs in
        // public/) falls through to the runtimeCaching rules below and is
        // cached on first use with StaleWhileRevalidate.
        //
        // Why: the previous globPatterns (`**/*.{js,css,…}` with a few
        // ignores) precached 231 entries / 5260 KiB on every first visit —
        // before the SW was even useful — and downloaded all 800+ KB
        // social-media images, every lazy route chunk, every dialog chunk
        // etc. up front. Trimmed precache is now <1 MB; the boot files the
        // browser is already fetching to render landing are the only ones
        // covered, and the SW just keeps them warm for repeat visits.
        //
        // Deliberately exclude `html` from precache. When index.html was
        // precached, a stale SW kept serving the old HTML (which references
        // old hashed bundle URLs) for hours after a deploy — users had to
        // manually unregister the SW to see updates. The navigation handler
        // below now NetworkFirst's HTML so deploys take effect on next reload.
        globPatterns: [
          // Entry chunks: the <script src=…> and the entry stylesheet the
          // index.html ships. Both are fetched on every cold load.
          "assets/index-*.js",
          "assets/index-*.css",
          // React + React DOM + scheduler + jsx-runtime — statically
          // imported by the entry chunk, so the browser fetches this on
          // every cold load regardless. Keeping it in the precache lets
          // repeat visits boot fully offline.
          "assets/react-vendor-*.js",
          // Favicon + PWA icon set referenced from index.html / the web
          // manifest. Tiny (<50 KB total), needed for tab + install UI.
          "favicon.ico",
          "favicon-16.png",
          "favicon-32.png",
          "apple-touch-icon.png",
          "pwa-192x192-v2.png",
          "pwa-512x512-v2.png",
          // The offline fallback page. This is the ONE html file that must be
          // precached — the `html` exclusion above exists so a stale SW can't
          // serve outdated index.html, which does not apply here: offline.html
          // references no hashed bundles and is entirely self-contained.
          //
          // Without this it was dead weight: nothing referenced offline.html
          // anywhere in the build or the SW, so it shipped and was never
          // served. An offline navigation that missed the html-pages cache
          // (first visit offline, or an evicted entry) fell through to the
          // browser's own error page.
          "offline.html",
        ],
        // Drop sourcemaps (never fetched by the browser) and the unrelated
        // `assets/index.es-*.js` vendor chunk (jspdf etc.) that happens to
        // share the `index` prefix — it's not part of the entry graph.
        globIgnores: ["**/*.map", "assets/index.es-*.js"],
        // 1 MiB ceiling on per-file precache. The trimmed boot set is well
        // under this (~23 KB entry JS, ~150 KB entry CSS, ~132 KB
        // react-vendor, ~45 KB total icons). If a future bundle balloons
        // past 1 MiB it fails loudly at build time rather than silently
        // re-shipping multi-MB precache.
        maximumFileSizeToCacheInBytes: 1024 * 1024,
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
        runtimeCaching: [
          // Always try network first for HTML page navigations so a new deploy
          // is picked up on the next reload. Falls back to cache only when the
          // network is slow/offline (3s timeout).
          {
            urlPattern: ({ request }) => request.mode === "navigate",
            handler: "NetworkFirst",
            options: {
              cacheName: "html-pages",
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [0, 200] },
              // Last resort when BOTH the network and the html-pages cache
              // miss — a first visit while offline, or an evicted entry.
              // Previously that fell through to the browser's own error page,
              // because nothing in the build ever referenced offline.html.
              //
              // Ordering note: this only fires after the cache lookup fails,
              // so a returning user still gets the real app shell offline and
              // the app's own in-app offline handling. This page is the floor,
              // not the default.
              precacheFallback: { fallbackURL: "offline.html" },
            },
          },
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
            handler: "NetworkFirst",
            options: {
              cacheName: "api-cache",
              expiration: { maxEntries: 50, maxAgeSeconds: 300 },
            },
          },
          // Hashed/fingerprinted build assets not in the precache (route
          // chunks like Dashboard / Profile / PostJob, dialog chunks, vendor
          // chunks like motion / posthog / sentry / charts, all
          // `src/assets/` imagery emitted under `/assets/`, etc.). Fetched
          // on demand on first use, cached SWR so repeat visits are fast
          // while updates still propagate in the background.
          //
          // SWR is safe here because filenames are content-hashed: a new
          // deploy produces new URLs (no stale-version risk for a given
          // URL), and the revalidate step just keeps the cache pruned. The
          // expiration cap (50 entries / 30 days) bounds total disk usage
          // — older entries are evicted LRU when the cap is hit.
          {
            urlPattern: ({ url, sameOrigin }) =>
              sameOrigin && /\/assets\/.*-[A-Za-z0-9_-]{8,}\.(js|css|webp|png|jpg|jpeg|svg|woff2?)$/.test(url.pathname),
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "static-assets",
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // Static images at the site root not covered above (splash icon,
          // OG/social images, marketing PNGs like helpr-wordmark, the
          // 800-KB app-icon-1024 used by the iOS icon generator script,
          // etc.). Same SWR + 50/30d caps.
          {
            urlPattern: ({ url, sameOrigin }) =>
              sameOrigin && /\.(png|webp|jpg|jpeg|svg|ico)$/.test(url.pathname),
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "static-images",
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
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
        background_color: "#FFFFFF",
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
  // Force Vite to pre-bundle React into a single dep graph. Without this,
  // @sentry/react and Radix can end up in separate optimized chunks with
  // their own React copy, which makes hooks like useRef return null at
  // runtime (TooltipProvider crash).
  // NOTE: Do NOT include @radix-ui/react-tooltip here — it's lazy-loaded in
  // App.tsx so it stays out of the critical entry chunk. Including it forces
  // it back into the main bundle.
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
    ],
    exclude: ["@capacitor-community/in-app-review"],
  },
  build: {
    // es2022 is Baseline-supported across all evergreen browsers (Chrome 94+,
    // Safari 16.4+, Firefox 93+) and lets Vite skip down-leveling syntax like
    // class fields / top-level await. Cuts a few KB of legacy helpers.
    target: "es2022",
    cssCodeSplit: true,
    // Vite default emits <link rel="modulepreload"> for the entry AND walks
    // dynamic-import graphs to preload their dependencies too. That meant
    // chunks like `charts` (recharts, only used in /admin) and `posthog`
    // were being preloaded on the landing page even though no landing
    // component touches them — Lighthouse flagged 200KB+ of "unused JS"
    // on first paint.
    //
    // Setting `resolveDependencies` to an empty array keeps modulepreload
    // for the entry's static graph but stops the recursive walk into
    // dynamic-import branches. Lazy chunks still load on demand when the
    // user navigates — they just aren't preloaded ahead of time.
    modulePreload: {
      resolveDependencies: () => [],
    },
    // "hidden" = .map files are still emitted (so Sentry / DevTools can
    // symbolicate uploaded stacks) but no `//# sourceMappingURL=` comment
    // is appended to the JS. Browsers therefore never fetch / parse the
    // maps on the landing page — Lighthouse was attributing extra
    // main-thread work to the source-map fetch + parse step.
    sourcemap: "hidden",
    // oxc is Vite 8's built-in minifier — 10–20× faster than Terser with
    // comparable output size. Terser with passes:3 was the dominant build
    // bottleneck (≈46 of 60 s). Console stripping is handled by oxc
    // automatically in production mode.
    minify: "oxc",
    rollupOptions: {
      // Native-only Capacitor plugins that aren't installed in the web build.
      // They're loaded via dynamic import() and silently no-op on web.
      // NOTE: do NOT add browser/runtime deps here. `react-is` was wrongly
      // listed and shipped as an unresolvable bare `import "react-is"` in the
      // output, crashing every chunk that pulls recharts (Profile charts,
      // post-job price stats) with "Failed to resolve module specifier".
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
          // NOTE: Do NOT manually chunk recharts/d3 OR framer-motion. The
          // same Rolldown behaviour that hoisted clsx into "charts" also
          // hoisted react/jsx-runtime (a CJS interop virtual module) into
          // the "motion" named chunk, which caused the entry to statically
          // import 45 kB gzip of framer-motion on every page even though
          // every importer (PageTransition, ScrollToTop, MobileNav,
          // DesktopSidebarNav) is already React.lazy'd. Letting
          // framer-motion ride with those lazy-loaded consumers keeps it
          // off the critical path entirely — same fix as recharts.
          if (id.includes("@stripe") || id.includes("stripe-js")) return "stripe";
          if (id.includes("@supabase")) return "supabase";
          // react-day-picker is only imported by <Calendar> which is always
          // React.lazy'd — keep it off the critical path by not pinning it to
          // the eagerly-loaded "dates" chunk.
          if (id.includes("date-fns")) return "dates";
          if (id.includes("@tanstack")) return "tanstack";
          if (id.includes("react-hook-form") || id.includes("zod") || id.includes("@hookform")) return "forms";
          // Split Sentry and PostHog out of the main bundle. They're only
          // imported from src/lib/sentry.ts and src/lib/posthog.ts, which are
          // dynamically imported AFTER first paint via requestIdleCallback in
          // main.tsx. Splitting them shaves ~70KB off the LCP-blocking main
          // chunk on the landing page.
          //
          // Session Replay (@sentry-internal/replay, replay-canvas) and the
          // Feedback widget are dynamic-imported separately from sentry.ts —
          // give them their own chunk so they don't fetch alongside the core
          // SDK on the deferred Sentry chunk. Without this rule the rule
          // below would catch them and lump them back into "sentry",
          // re-bloating the chunk that runs on first idle tick.
          if (
            id.includes("@sentry-internal/replay") ||
            id.includes("@sentry-internal/feedback")
          ) {
            return "sentry-replay";
          }
          if (id.includes("@sentry") || id.includes("sentry-internal")) return "sentry";
          if (id.includes("posthog-js")) return "posthog";
        },
      },
    },
  },
}));
