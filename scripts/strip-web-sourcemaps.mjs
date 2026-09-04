#!/usr/bin/env node
/**
 * Remove JS/CSS sourcemaps from the PRODUCTION WEB bundle before Vercel
 * serves it.
 *
 * vite.config.ts sets `build.sourcemap: "hidden"` — no `//# sourceMappingURL`
 * comment ships, but the .map files themselves are still written into
 * dist/assets/, and Vercel serves whatever is in dist/ as static files with
 * no auth of any kind. As of 2026-09-03 that was 377 maps / ~20.8 MB of the
 * app's real, uncompiled TypeScript, publicly fetchable by anyone who knows
 * (or guesses) a chunk's hashed filename, with `cache-control: immutable`.
 *
 * They are dead weight on this surface for the identical reason
 * strip-ios-sourcemaps.mjs already established for the native bundle:
 * Sentry symbolicates from maps UPLOADED at build time by
 * .github/workflows/sentry-release.yml (a SEPARATE `npm run build` +
 * getsentry/action-release, from that job's own ./dist/assets), never from
 * maps a client happens to fetch off the live site. Deleting the publicly
 * served copies changes nothing about Sentry's ability to symbolicate a
 * production stack trace.
 *
 * GATED ON `process.env.VERCEL`, which Vercel's build environment sets
 * automatically — this must NOT run during the sentry-release workflow's own
 * build (which needs the maps present in ITS dist/assets for the upload step
 * immediately after), during local dev builds, or during any other CI job
 * that builds the app for a reason other than deploying it. Vercel is the
 * only build whose output is served to the public with no further step in
 * between.
 */
import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

if (!process.env.VERCEL) {
  console.log("[strip-web-sourcemaps] not a Vercel build (process.env.VERCEL unset) — leaving maps in place");
  process.exit(0);
}

// The whole dist/ tree, not just dist/assets/ — vite-plugin-pwa emits
// sw.js.map and workbox-*.js.map at the dist/ ROOT, which the assets-only
// version of this script missed on its first pass (measured: 0 left in
// dist/assets/, 2 left at dist/ root, 2026-09-04). The MAP regex below is
// specific enough that walking the whole tree cannot touch anything else.
const distRoot = join(process.cwd(), "dist");

const MAP = /\.(js|css)\.map$/;

let removed = 0;
let bytes = 0;

const walk = (dir) => {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // directory absent — nothing to strip
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (MAP.test(entry.name)) {
      bytes += statSync(full).size;
      rmSync(full);
      removed += 1;
    }
  }
};

walk(distRoot);

console.log(
  `[strip-web-sourcemaps] removed ${removed} map file(s), ${(bytes / 1024 / 1024).toFixed(1)} MB, from dist/`,
);
