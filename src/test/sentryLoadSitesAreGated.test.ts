/**
 * PD-005 / Q178: the 214KB Sentry chunk was fetched on every passive page load
 * because useAuthReady did `import("@/lib/sentry")` for one breadcrumb. Sentry
 * may be LOADED from exactly two places: main.tsx's first-interaction gate and
 * errorLogger (only once an error exists). Any new load site is a regression;
 * the list is exact both ways.
 *
 * @mutate src/hooks/useAuthReady.ts | recordColdLaunchPhase("auth-ready-resolved"); | void import("@/lib/sentry");
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// @two-way src/test/sentryLoadSitesAreGated.test.ts:expect(sites).toEqual(ALLOWED);
const ALLOWED = ["src/lib/errorLogger.ts", "src/main.tsx"];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}

// Code only: comments that mention the old call are fine.
const LOAD = /^(?!\s*(?:\/\/|\*)).*import\(\s*["'](?:@\/lib\/sentry|\.\.?\/(?:lib\/)?sentry)["']\s*\)/m;

describe("Sentry loads only behind interaction or an error (PD-005)", () => {
  it("the load sites are exactly the allowed ones", () => {
    const all = walk("src");
    expect(all.length).toBeGreaterThan(500);
    const sites = all.filter((f) => f !== "src/lib/sentry.ts" && LOAD.test(readFileSync(f, "utf8"))).sort();
    expect(sites).toEqual(ALLOWED);
  });
});
