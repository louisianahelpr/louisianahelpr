# Performance audit — May 2026

**Live Vercel Speed Insights (mobile)** shows real-user FCP of **10.98s**
(threshold: <3s for "great") and TTFB of **4.6s**. Desktop is 3.16s FCP /
0.22s TTFB — borderline. Real Experience Score is 0/100 on mobile, 85/100
on desktop.

## What's already done

The codebase has substantial perf work in place (see file references):

- `index.html` — preconnect to fonts.googleapis.com / fonts.gstatic.com /
  Supabase; async-CSS pattern (preload + print/onload swap); hero LCP image
  preload with responsive `imagesrcset`; navbar logo preload with
  `fetchpriority="high"`; DNS-prefetch for Sentry + PostHog (skipped
  preconnect because they fire only after first interaction).
- `vite.config.ts` — manual chunks (`react-vendor`, `lucide`, `motion`,
  `stripe`, `supabase`, `dates`, `tanstack`, `forms`, `sentry`, `posthog`);
  modulePreload set to skip dynamic-import deps so lazy routes don't preload
  on the landing page; terser 3 passes + pure_funcs; `cssCodeSplit: true`;
  sourcemap: "hidden" so .map files don't fetch on the landing page.
- `main.tsx` — Sentry + PostHog + Supabase imports deferred behind first
  user interaction (`pointerdown` / `keydown` / `touchstart`) with a 25s
  fallback for passive visits. Toaster / Sonner / MobileNav / PermissionRationaleDialog
  all lazy.
- `App.tsx` — every route is `lazy()` including the landing page (`Index`).
  Toaster + Sonner + MobileNav + PermissionRationaleDialog lazy.
- Service worker only ships in production builds (`!isCapacitorBuild`),
  with `NetworkFirst` for navigations + `CacheFirst` for hashed assets
  (1y expiration). Big admin/charts chunks deliberately excluded from
  precache so first visitors don't pay their cost.

## What's blocking further client-side wins

The 10.98s mobile FCP is dominated by:

1. **TTFB 4.6s on mobile.** This is dominated by network handshake
   (DNS + TLS + TCP) on slow rural Louisiana 3G/4G, plus Vercel cold-start
   on the rare requests that miss the edge cache. Roughly 2-3s of the TTFB
   is uncloseable client-side — it's network-bound.

2. **Bundle parse + execute on slow Android.** Even with code splitting,
   the React + router + query-client + framework entry chunks need to
   parse and execute before the first React render fires. Lighthouse uses
   a simulated Moto G4 — 2× slower CPU than typical real users — so this
   probably accounts for 2-3s of the post-TTFB delay.

## Next-step work (ranked by impact)

### 1. Static pre-render the landing page (`/`) — biggest single win

The landing page is content-stable (Hero, FAQ, CategoryBento, etc.) — no
auth-dependent data. Rendering its HTML at build time turns FCP into TTFB
(eliminating the ~6s of "wait for JS to render" delay on mobile).

Implementation options:
- `vite-plugin-prerender` (cleanest, headless Chrome at build)
- `react-snap` (post-build snapshot via puppeteer)
- Hand-rolled: `scripts/prerender.mjs` boots a tiny static server over
  `dist/` and uses Puppeteer to navigate + extract the rendered HTML,
  then writes it back into `dist/index.html` in place of the empty
  `<div id="root">` shell.

A scaffold for option 3 lives at `scripts/prerender.mjs` (DISABLED). To
enable:
1. `npm install --save-dev puppeteer`
2. Edit `package.json` `scripts.build` to: `"vite build && node scripts/prerender.mjs"`
3. Verify locally with `npm run build && npm run preview` — landing page
   should serve HTML with hero markup populated.
4. Test on a real iPhone (`/` should show the hero in <1s on cellular).
5. If smoke-test passes, commit + push the package.json change.

**Risk:** any Supabase call that fires during landing render needs to be
gated behind `typeof window !== "undefined"` first. Audit `src/pages/Index.tsx`
+ children before enabling.

### 2. Move first-paint Supabase calls behind `requestIdleCallback`

Some pages (Dashboard, Browse, Profile) fire Supabase queries during their
initial render. Even with deferred analytics, these queries block the
paint of meaningful content. Defer non-critical queries (greetings,
recommendations, trending) to a post-paint idle window.

Owner: open a separate PR per page; instrument with `performance.mark()`
before/after each query to validate impact.

### 3. Bundle analyzer pass

Run `ANALYZE=1 npm run build` locally (sandbox can't run npm install).
Open `dist/stats.html` and look for:
- Large vendor chunks that aren't already split
- Duplicate React copies (shouldn't happen with the `dedupe` rule but worth
  verifying)
- Unused exports being shipped (tree-shaking gaps)

Common offenders historically: `recharts` (currently rides with
AdminAnalytics chunk — keep it that way), `framer-motion` (already split
to `motion-*.js` chunk, excluded from SW precache), date-fns (already in
`dates` chunk).

### 4. Font weight audit

`index.html` requests 14+ font weights across Bodoni Moda / EB Garamond /
Montserrat / Beth Ellen. Some are likely unused but tangled with Tailwind
classes — `font-bold` could resolve to any of the loaded families depending
on which `font-display` / `font-serif` / `font-sans` is in scope at the use
site. Safe trim requires:
1. Build the production bundle
2. Scan all rendered CSS for actual `font-weight` resolutions
3. Cross-reference with the Google Fonts URL

Estimated savings: 50-100 KB of font data. Won't fix FCP (display=swap
already handles font load asynchronously) but reduces overall transfer.

Lower priority than 1-3.

### 5. CDN / edge config

- Verify Vercel's edge cache is hitting for HTML responses (check `cf-cache-status`
  or Vercel-equivalent headers).
- Consider Vercel's ISR for the landing page if pre-render isn't ideal —
  same benefit, less infrastructure.

## Acceptable end state

After items 1-2, mobile FCP should drop from ~11s to **3-4s** (limited by
network round-trip + bundle hydration). Real Experience Score should rise
from 0 to 60-75. Desktop should drop from 3.16s to <1s.

After items 3-5 (incremental), another 20-30% improvement on FCP.

Beyond that, the limit is physics (mobile network handshakes can't go
under 1-2s on cellular). Real-world hard floor for Helpr on rural Louisiana
mobile is probably 2-3s FCP.

## When to revisit

Add to `TODO.md` Section C (future engineering sessions). Lexi should
prioritize after the marketplace has enough users to make the data
statistically meaningful (currently Real Experience Score sample size
may be small).
