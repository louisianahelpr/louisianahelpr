/**
 * Boot bytes (Builder 2, 11-15): helpers no page draws with stay off the boot chunk.
 *
 * vite.config.ts's `app-shared` chunk is every shared module in src/main.tsx's static closure (bootReach.mjs
 * bootModules), and every page boots with it. Measured on the bundle-size.yml build (critical-path.mjs): it carried
 * routePrefetch's page table (each page's import() with its preload list: 5.5 KB gz on its own), the PPO test
 * tables, the permission explainer's copy, the bug report's text building and the session-loss report, none of
 * which a page needs to draw. app-shared 61.9 -> 52.2 KB gz; guest / 205 -> 199 KB gz, /home 293 -> 286,
 * /declutter 464 -> 459, /profile 399 -> 394.
 *
 * CLASS: each of these loads where it is used (loadModule / backgroundImport), and the boot halves that must run at
 * boot (pageSettled, bugReportTrail, authLanding) import nothing. The route table is held to the stricter line:
 * no first screen of any page reaches it statically.
 *
 * @mutate src/App.tsx | import { whenPageSettled } from "@/lib/pageSettled"; | import { whenPageSettled } from "@/lib/pageSettled"; import "@/lib/routePrefetchTable";
 * @mutate src/hooks/useWebPush.ts | import { loadModule } from "@/lib/loadModule"; | import { loadModule } from "@/lib/loadModule"; import "@/hooks/usePermissionRationale";
 * @mutate src/lib/cppRouting.ts | import { loadModule } from "@/lib/loadModule"; | import { loadModule } from "@/lib/loadModule"; import "@/lib/ppoAttribution";
 * @mutate src/lib/errorLogger.ts | import { noteRecentError } from "@/lib/bugReportTrail"; | import { noteRecentError } from "@/lib/bugReportContext";
 * @mutate src/main.tsx | import { landingAuthHint, noteAuthEventForDiagnostics } from "./lib/authLanding"; | import { landingAuthHint, noteAuthEventForDiagnostics } from "./lib/authDiagnostics";
 * @mutate src/components/MobileNav.tsx | import { prefetchRoute } from "@/lib/routePrefetch"; | import { prefetchRoute } from "@/lib/routePrefetch"; import "@/lib/routePrefetchTable";
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bootModules, firstScreenRoots, staticReach } from "../../scripts/perf/bootReach.mjs";
import { blankComments } from "@/test/helpers/blankNonCode";

const ROOT = join(__dirname, "..", "..");
const posix = (f: string) => f.replace(/\\/g, "/");
const code = (rel: string) => blankComments(readFileSync(join(ROOT, rel), "utf8"));

/** Loaded where they are used, never by boot. */
const LATE = [
  "src/lib/routePrefetchTable.ts",
  "src/hooks/usePermissionRationale.ts",
  "src/lib/ppoAttribution.ts",
  "src/lib/bugReportContext.ts",
  "src/lib/authDiagnostics.ts",
];
/** The halves boot runs: they must not pull a late module (or anything else) back in. */
const BOOT_HALVES = ["src/lib/pageSettled.ts", "src/lib/bugReportTrail.ts", "src/lib/authLanding.ts"];

describe("boot skips the late helpers", () => {
  const boot = [...bootModules(ROOT)].map(posix);

  it("reads the real boot graph", () => {
    expect(boot.length).toBeGreaterThan(80);
    for (const f of ["src/App.tsx", "src/lib/errorLogger.ts", "src/components/SessionManager.tsx", ...BOOT_HALVES]) {
      expect(boot.some((b) => b.endsWith(`/${f}`)), `${f} should be on boot`).toBe(true);
    }
  });

  it.each(LATE)("%s is not in main.tsx's static closure (app-shared)", (f) => {
    expect(boot.filter((b) => b.endsWith(`/${f}`))).toEqual([]);
  });

  it("no first screen of any page reaches the route prefetch table statically", () => {
    const roots = firstScreenRoots(ROOT);
    expect(roots.length).toBeGreaterThan(15);
    const reach = [...staticReach(ROOT, roots)].map(posix);
    expect(reach.length).toBeGreaterThan(boot.length);
    expect(reach.some((f) => f.endsWith("/src/lib/routePrefetch.ts"))).toBe(true);
    expect(reach.filter((f) => f.endsWith("/src/lib/routePrefetchTable.ts"))).toEqual([]);
  });

  it.each(BOOT_HALVES)("%s imports nothing", (f) => {
    expect(code(f)).not.toMatch(/^\s*(import|export)\s[^;]*from\s/m);
    expect(code(f)).not.toMatch(/^\s*import\s*["']/m);
  });
});
