#!/usr/bin/env node
/**
 * Remove JS/CSS sourcemaps from the native iOS web bundle.
 *
 * `npx cap sync ios` copies dist/ wholesale into ios/App/App/public/, and
 * dist/ contains a .js.map for every chunk (vite.config.ts sets
 * `build.sourcemap: "hidden"`). Those maps then ship inside the .ipa: as of
 * 2026-08-27 that was 20.3 MB of maps against 5.2 MB of actual JavaScript —
 * roughly 20 MB added to every user's App Store download.
 *
 * They are unreachable dead weight, not a debugging aid:
 *   - `sourcemap: "hidden"` means Vite emits NO `//# sourceMappingURL=`
 *     comment, so nothing — WKWebView, DevTools, or the Sentry SDK — ever
 *     looks for the .map next to the .js. Verified: zero occurrences of
 *     `sourceMappingURL` across all 368 shipped chunks.
 *   - Sentry symbolicates from maps UPLOADED at build time by
 *     .github/workflows/sentry-release.yml (getsentry/action-release, from
 *     ./dist/assets with url_prefix "~/assets"), not from maps present on the
 *     device. Deleting the on-device copies changes nothing about that.
 *
 * dist/ keeps its maps — only the copy inside the native bundle is pruned —
 * so any sourcemap upload step still has everything it needs.
 */
import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const iosPublic = join(process.cwd(), "ios", "App", "App", "public");

const MAP = /\.(js|css)\.map$/;

let removed = 0;
let bytes = 0;

const walk = (dir) => {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // directory absent — nothing synced yet
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

walk(iosPublic);

console.log(
  removed === 0
    ? "✓ iOS bundle carries no sourcemaps."
    : `✓ Stripped ${removed} sourcemap(s) from the iOS bundle (${(bytes / 1_048_576).toFixed(1)} MB saved in the .ipa).`,
);
