/**
 * Q2705 pass 2 (2026-11-17): signed-in /jobs' first screen downloads only the code its Browse screen runs.
 *
 * Signed-in /jobs first drew at about 5 s on Slow 4G + 4x CPU at 375 px, waiting on 357 KB gz of JS
 * (scripts/perf/critical-path.mjs, bundle-size.yml env). Two causes, both fixed here:
 *
 *   1. usePrefetchUserData imported the referral, Activity and payout readers statically, so /jobs downloaded
 *      useActivityData and its helpers before its first job card, only to run them after the page settled. They now
 *      load inside the idle callback that runs them (the reads still go out then, so the next tap stays warm).
 *   2. /jobs ran a few modules of three shared chunks and downloaded each chunk whole: shared-late (page meta,
 *      sponsor and card-hold copy), signed-in-shared (Profile's tab reads, poster spend, Declutter to-dos) and
 *      signed-in-dock (archived and unread conversations), and leaves (the next-step line, whose import pulled all of
 *      signed-in-shared back). vite.config.ts now gives the part /jobs runs its own chunk (jobs-late, jobs-signed-in,
 *      jobs-dock, jobs-leaves), ranked above the chunk it came from.
 *
 * Same build: /jobs 357 -> 319 KB gz, /admin 310 -> 279 (budget lowered in scripts/perf/critical-path-budget.json; CI's bundle-size.yml
 * checks the built graph). This file reads the same source walk vite.config.ts splits by (bootReach.mjs).
 *
 * @mutate src/hooks/usePrefetchUserData.ts | import { isConstrainedNetwork, prefetchRoute, whenPageSettled } from "@/lib/routePrefetch"; | import "@/hooks/useActivityData"; import { isConstrainedNetwork, prefetchRoute, whenPageSettled } from "@/lib/routePrefetch";
 * @mutate vite.config.ts |               test: (id: string) => signedInOnly.has(norm(id)) && jobsReach.has(norm(id)), |               test: (id: string) => signedInOnly.has(norm(id)) && false,
 * @mutate vite.config.ts |               priority: 10.5, |               priority: 9.5,
 * @mutate vite.config.ts |               priority: 15.35, |               priority: 15.25,
 * @mutate vite.config.ts |               priority: 15.85, // above leaves (15.8), below native-push (15.9) |               priority: 15.75, // above leaves (15.8), below native-push (15.9)
 * @mutate scripts/perf/bootReach.mjs |   return staticReach(root, [path.join(root, JOBS_BROWSE_ROOT)]); |   return new Set();
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { jobsBrowseReach } from "../../scripts/perf/bootReach.mjs";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const rel = (abs: string) => abs.slice(ROOT.length + 1).split("\\").join("/");
const reach = new Set([...jobsBrowseReach(ROOT)].map(rel));
const vite = blankComments(readFileSync(resolve(ROOT, "vite.config.ts"), "utf8"));

/** Each codeSplitting group's `test` source and priority, by name. */
function groups(): Map<string, { test: string; priority: number }> {
  const out = new Map<string, { test: string; priority: number }>();
  for (const m of vite.matchAll(/\{\s*name:\s*"([\w-]+)",\s*test:\s*([^\n]+)\n[\s\S]*?priority:\s*([\d.]+)/g)) {
    out.set(m[1], { test: m[2], priority: Number(m[3]) });
  }
  return out;
}

describe("signed-in /jobs' first screen skips the warm-up and other screens' code (Q2705 pass 2)", () => {
  it("walks the real /jobs Browse screen (floor: the page, its feed and the warm-up hook are reached)", () => {
    expect(reach.size).toBeGreaterThan(150);
    for (const f of ["src/pages/jobs/JobsSection.tsx", "src/pages/home/Dashboard.tsx", "src/components/dashboard/BrowseTasksFeed.tsx", "src/hooks/usePrefetchUserData.ts"]) {
      expect(reach.has(f), f).toBe(true);
    }
  });

  it("does not reach the warm-up's readers: they load inside the idle callback", () => {
    for (const f of ["src/hooks/useActivityData.ts", "src/hooks/useReferralData.ts", "src/lib/payoutSetupQueries.ts"]) {
      expect(reach.has(f), `${f} is on /jobs' static reach`).toBe(false);
    }
    const hook = blankComments(readFileSync(resolve(ROOT, "src/hooks/usePrefetchUserData.ts"), "utf8"));
    for (const spec of ["@/hooks/useActivityData", "@/hooks/useReferralData", "@/lib/payoutSetupQueries"]) {
      expect(hook, spec).toContain(`import("${spec}")`);
    }
  });

  it("splits the part of shared-late, signed-in-shared, signed-in-dock and leaves /jobs runs into its own chunk", () => {
    const g = groups();
    expect(g.size).toBeGreaterThan(20);
    const pairs: Array<[string, string]> = [
      ["jobs-late", "shared-late"],
      ["jobs-signed-in", "signed-in-shared"],
      ["jobs-dock", "signed-in-dock"],
      ["jobs-leaves", "leaves"],
    ];
    for (const [mine, parent] of pairs) {
      const a = g.get(mine);
      const b = g.get(parent);
      expect(a, mine).toBeTruthy();
      expect(b, parent).toBeTruthy();
      expect(a!.test, mine).toContain("jobsReach.has(norm(id))");
      expect(a!.priority, `${mine} must outrank ${parent}`).toBeGreaterThan(b!.priority);
    }
    // jobs-late keeps out the modules that reach the Supabase client, as shared-late-db does for shared-late.
    expect(g.get("jobs-late")!.test).toContain("!reachesClient.has(norm(id))");
  });

  it("the other screens' shared code those chunks keep is off /jobs' reach", () => {
    for (const f of ["src/lib/publicPageMeta.mjs", "src/hooks/useProfileTabData.ts", "src/lib/posterSpend.ts", "src/lib/archivedConversations.ts", "src/components/ui/NextStep.tsx", "src/lib/celebrate.ts"]) {
      expect(reach.has(f), f).toBe(false);
    }
  });
});
