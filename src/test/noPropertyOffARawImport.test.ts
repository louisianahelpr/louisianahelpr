/**
 * Q2532 (alert ledger ba04c0f07725, Sentry 2026-10-30, 5 sightings): "TypeError: Cannot read properties of undefined
 * (reading 'fetchSupportTickets')". adminRailBadges' query read `(await import("@/components/admin/AdminSupport"))
 * .fetchSupportTickets`. In the build Vite wraps every import() in its preload helper, and when main.tsx's
 * vite:preloadError handler starts a recovery reload it calls preventDefault(), which makes the import RESOLVE
 * undefined (src/lib/loadModule.ts). Reading a property straight off it throws.
 *
 * CLASS: no app source file reads a member straight off an awaited import() (`(await import(x)).y`); a site goes
 * through loadModule() and handles null (untilReload() for a query, return early for decoration).
 * Found and fixed with it: AdminReports in the same file, BoughtWhatNext's seller-delivery booking, celebrate.ts's
 * confetti and bunchSaved's item statuses.
 *
 * @mutate src/components/admin/adminRailBadges.ts |     queryFn: () => loadModule(() => import("@/components/admin/AdminSupport").then((m) => m?.fetchSupportTickets)).then((fetch) => (fetch ? fetch("pending") : untilReload())), |     queryFn: async () => (await import("@/components/admin/AdminSupport")).fetchSupportTickets("pending"),
 * @mutate src/lib/celebrate.ts |   const confetti = m.default; |   const confetti = (await import("canvas-confetti")).default;
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { trackedFiles } from "./helpers/trackedFiles";
import { blankComments } from "./helpers/blankNonCode";

const RAW = /\(\s*await\s+import\s*\([^)]*\)\s*\)\s*(\?\.|\.|\[)/g;

const appFiles = trackedFiles("src").filter(
  (f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f) && !f.startsWith("src/test/"),
);

describe("Q2532: no app code reads a member straight off an awaited import()", () => {
  it("scans the app tree, and the detector sees the shape", () => {
    expect(appFiles.length).toBeGreaterThan(1000);
    expect('const x = (await import("./a")).b;'.match(RAW)).toHaveLength(1);
    expect('const x = (await import("./a"))?.b;'.match(RAW)).toHaveLength(1);
    expect('const m = await loadModule(() => import("./a"));'.match(RAW)).toBeNull();
  });

  it("every lazy module site goes through loadModule", () => {
    const hits: string[] = [];
    for (const f of appFiles) {
      const src = blankComments(readFileSync(f, "utf8"));
      for (const m of src.matchAll(RAW)) hits.push(`${f}: ${m[0]}`);
    }
    expect(hits, "use loadModule(() => import(...)) and handle null (src/lib/loadModule.ts)").toEqual([]);
  });
});
