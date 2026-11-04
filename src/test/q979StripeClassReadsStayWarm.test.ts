// @mutate src/lib/queryClient.ts |       gcTime: PERSIST_MAX_AGE_MS, |       gcTime: 5 * 60 * 1000,
// @mutate src/hooks/usePrefetchUserData.ts |       prefetchPayoutSetup(queryClient, userId); |       void 0;
// @mutate src/hooks/useActivityData.ts |     supabase.rpc("get_my_pending_direct_offers"), |     supabase.rpc("get_my_pending_direct_offers"), supabase.rpc("get_my_pending_direct_offers"),
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";
import { trackedFiles } from "@/test/helpers/trackedFiles";

/**
 * Q979 (ticked 2026-11-04): the three performance fixes for the Stripe-hop delays stay in place.
 *   1. The query cache outlives a screen: the app's default gcTime is the persister's 24 h max age, never TanStack's
 *      5 min default (an entry dropped before hydrate defeats the disk cache).
 *   2. The stripe-connect status read (~395 ms, an edge function -> Stripe) is warmed by usePrefetchUserData.
 *   3. get_my_pending_direct_offers is read in exactly two places, once each: Activity's list (useActivityData) and
 *      one job's row (useJobPage, .eq("id", jobId)). The nav badge's raw copy (useActivityBadgeCounts) went with
 *      7c6ef501e7 (2026-10-20, the To-do badge).
 */
const src = (p: string) => blankComments(readFileSync(resolve(__dirname, "../..", p), "utf8"));

describe("Q979: Stripe-class reads stay warm and are read once", () => {
  it("the default gcTime is the persisted-cache max age (24 h), past 5 min", async () => {
    const { queryClient } = await import("@/lib/queryClient");
    const { PERSIST_MAX_AGE_MS } = await import("@/lib/queryPersister");
    const gc = queryClient.getDefaultOptions().queries?.gcTime as number;
    expect(gc).toBe(PERSIST_MAX_AGE_MS);
    expect(gc).toBeGreaterThan(5 * 60 * 1000);
  });

  it("usePrefetchUserData warms the payout status read", () => {
    expect(src("src/hooks/usePrefetchUserData.ts")).toMatch(/\bprefetchPayoutSetup\(queryClient, userId\)/);
  });

  it("get_my_pending_direct_offers is read once in Activity's list and once for one job, nowhere else", () => {
    const files = trackedFiles("src").filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.|\/test\/|integrations\/supabase\/types|admin\/preview\//.test(f));
    expect(files.length).toBeGreaterThan(300);
    const calls = files.flatMap((f) => {
      const n = (src(f).match(/rpc\(\s*["']get_my_pending_direct_offers["']/g) ?? []).length;
      return n ? [`${f.replace(/^.*?src\//, "src/")}:${n}`] : [];
    });
    expect(calls.sort()).toEqual(["src/hooks/useActivityData.ts:1", "src/pages/jobs/jobPage/useJobPage.ts:1"]);
  });
});
