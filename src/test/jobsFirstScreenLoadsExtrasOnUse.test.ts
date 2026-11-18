/**
 * Q2705 pass 3 (2026-11-17): signed-in /jobs' first screen no longer downloads code only a tap or a rare link runs.
 *
 * After pass 2 the first job card title still painted at ~4.85 s on prod (Slow 4G + 4x CPU, 375 px), its render
 * delay spent waiting on the JS. Four things rode on that download without drawing anything:
 *
 *   1. useNotifyWhenWorkLands (the empty feed's Notify button) imported nativePush.ts statically: the whole push
 *      module (native-push, 3.7 KB gz) and deepLinkRouter under it. nativePush now loads on the tap, beside the save.
 *   2. DashboardDialogs imported QuickApplyHandler (the ?quickApply deep link's sheet read and poster lookup)
 *      statically. It is lazy now, mounted from the first ?quickApply on.
 *   3. openJobFromPin imported fetchJobForPin (a map pin's job read) statically. It loads on that tap now.
 *   4. browse-first-screen held guest /browse's route skeleton, section switch and filter chips, which /jobs never
 *      runs. vite.config.ts gives them their own chunk (browse-guest-screen).
 *
 * And native-push sits above signed-in-deep: with no first screen reaching it, signedInSplit counts nativePush as
 * deep, and in signed-in-deep every lazy import of it preloaded that chunk's ~77 files. Measured: 16.7 still lost
 * to signed-in-deep's 16 (the build acts as if only the whole number counts), so the guard reads the whole number.
 *
 * critical-path (bundle-size.yml env): /jobs 319 -> 309 KB gz; every other row unchanged or 1 KB lower.
 *
 * @mutate src/hooks/useNotifyWhenWorkLands.ts | import { loadModule } from "@/lib/loadModule"; | import { loadModule } from "@/lib/loadModule"; import "@/lib/nativePush";
 * @mutate src/pages/home/DashboardDialogs.tsx | import type { useDetailJob } from "./useDetailJob"; | import type { useDetailJob } from "./useDetailJob"; import "./QuickApplyHandler";
 * @mutate src/components/browseMap/openJobFromPin.ts | import { loadModule, untilReload } from "@/lib/loadModule"; | import { loadModule, untilReload } from "@/lib/loadModule"; import "./fetchJobForPin";
 * @mutate vite.config.ts |               priority: 18, |               priority: 16.9,
 * @mutate vite.config.ts | !jobsReach.has(norm(id)) && !BROWSE_GROUP_SKIPS.test(id), | true && !BROWSE_GROUP_SKIPS.test(id),
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { jobsBrowseReach } from "../../scripts/perf/bootReach.mjs";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const rel = (abs: string) => abs.slice(ROOT.length + 1).split("\\").join("/");
const reach = new Set([...jobsBrowseReach(ROOT)].map(rel));
const code = (f: string) => blankComments(readFileSync(resolve(ROOT, f), "utf8"));
const vite = code("vite.config.ts");

/** Each codeSplitting group's `test` source and priority, by name. */
function groups(): Map<string, { test: string; priority: number }> {
  const out = new Map<string, { test: string; priority: number }>();
  for (const m of vite.matchAll(/\{\s*name:\s*"([\w-]+)",\s*test:\s*([^\n]+)\n[\s\S]*?priority:\s*([\d.]+)/g)) {
    out.set(m[1], { test: m[2], priority: Number(m[3]) });
  }
  return out;
}

describe("signed-in /jobs' first screen loads the Notify, quick-apply and pin code on use (Q2705 pass 3)", () => {
  it("walks the real /jobs Browse screen (floor: the feed, the dialogs and the files that now load lazily are reached)", () => {
    expect(reach.size).toBeGreaterThan(150);
    for (const f of [
      "src/pages/jobs/JobsSection.tsx",
      "src/components/dashboard/BrowseTasksFeed.tsx",
      "src/hooks/useNotifyWhenWorkLands.ts",
      "src/pages/home/DashboardDialogs.tsx",
      "src/components/browseMap/openJobFromPin.ts",
    ]) {
      expect(reach.has(f), f).toBe(true);
    }
  });

  it("does not reach the push module, the quick-apply handler or the pin read", () => {
    for (const f of ["src/lib/nativePush.ts", "src/lib/deepLinkRouter.ts", "src/pages/home/QuickApplyHandler.tsx", "src/components/browseMap/fetchJobForPin.ts"]) {
      expect(reach.has(f), `${f} is on /jobs' static reach`).toBe(false);
    }
  });

  it("each one is loaded where it is used", () => {
    expect(code("src/hooks/useNotifyWhenWorkLands.ts")).toContain('loadModule(() => import("@/lib/nativePush"))');
    expect(code("src/pages/home/dashboardLazyParts.ts")).toContain('loadModule(() => import("./QuickApplyHandler"))');
    expect(code("src/components/browseMap/openJobFromPin.ts")).toContain('loadModule(() => import("./fetchJobForPin"))');
  });

  it("splits guest /browse's own part out of browse-first-screen, and keeps nativePush out of signed-in-deep", () => {
    const g = groups();
    expect(g.size).toBeGreaterThan(20);
    const guest = g.get("browse-guest-screen");
    const first = g.get("browse-first-screen");
    expect(guest, "browse-guest-screen").toBeTruthy();
    expect(first, "browse-first-screen").toBeTruthy();
    expect(guest!.test).toContain("!jobsReach.has(norm(id))");
    expect(guest!.priority).toBeGreaterThan(first!.priority);

    const push = g.get("native-push");
    const deep = g.get("signed-in-deep");
    expect(push, "native-push").toBeTruthy();
    expect(deep, "signed-in-deep").toBeTruthy();
    expect(push!.test).toContain("deepLinkRouter");
    // The whole number, not the fraction: 16.7 lost to 16 in the build (see the header).
    expect(Math.floor(push!.priority)).toBeGreaterThan(Math.floor(deep!.priority));
  });
});
