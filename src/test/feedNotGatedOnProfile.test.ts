/**
 * Q1158 (B41, 2026-11-03): the signed-in job feed is never gated on the
 * viewer's profile read again.
 *
 * Measured (scripts/perf/cwv-lab.mjs, signed in, 375 = Slow 4G + calibrated
 * CPU, local real-key build against prod data, median of 3): /jobs LCP 6988 ms,
 * the first job card's title. After the app drew (4834 ms) three reads ran in
 * series: the profile (4861-5685), then the feed (5697-6341), then the
 * posters' names (6344-6934). The feed waited for the profile only because
 * its `enabled` carried `!userLoading` and its queryFn read the profile's tier
 * for a redundant `.lte("created_at", ...)` pre-filter. open_jobs_browse
 * enforces early access itself (pinned in openJobsBrowseStaysDefiner.test.ts,
 * `created_at <= early_access_cutoff()`), and useDashboardFilters still applies
 * the viewer's own cutoff to what is shown.
 *
 * Reads the dashboard.jobs useInfiniteQuery call in useDashboardData.ts with
 * comments and string bodies blanked (blankNonCode), so a note that mentions
 * the profile does not count and a paren inside a string cannot unbalance it.
 */
// Registered mutations - each turns this guard RED on its own:
// @mutate src/hooks/useDashboardData.ts |     enabled: !!user,\n    // Spotty rural | enabled: !!user && !userLoading,\n    // Spotty rural
// @mutate src/hooks/useDashboardData.ts |           .neq("payment_status", "abandoned")\n | .neq("payment_status", "abandoned")\n          .lte("created_at", profile?.subscription_tier ? new Date().toISOString() : new Date(Date.now() - 1).toISOString())\n
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankNonCode } from "./helpers/blankNonCode";

const FILE = resolve(__dirname, "..", "hooks", "useDashboardData.ts");

/** The source of the `useInfiniteQuery({ ... })` call whose key is dashboard.jobs, comments and strings blanked. */
function feedQueryCall(): string {
  const code = blankNonCode(readFileSync(FILE, "utf8"));
  const key = code.indexOf("queryKey: queryKeys.dashboard.jobs(");
  expect(key, "the feed query (queryKeys.dashboard.jobs) was not found in useDashboardData.ts").toBeGreaterThan(-1);
  const open = code.lastIndexOf("useInfiniteQuery(", key);
  expect(open, "the feed query is no longer a useInfiniteQuery call").toBeGreaterThan(-1);
  let depth = 0;
  for (let i = open + "useInfiniteQuery".length; i < code.length; i++) {
    if (code[i] === "(") depth++;
    else if (code[i] === ")" && --depth === 0) return code.slice(open, i + 1);
  }
  throw new Error("unbalanced useInfiniteQuery call");
}

describe("the signed-in feed starts beside the profile read, not after it (Q1158)", () => {
  const call = feedQueryCall();

  it("reads the whole call (inventory floor)", () => {
    expect(call.length).toBeGreaterThan(3000);
    expect(call).toMatch(/\bqueryFn\s*:/);
    expect(call).toMatch(/\bfrom\("\s*"\)/); // .from("open_jobs_browse"), string body blanked
  });

  it("is enabled by the signed-in user alone", () => {
    const enabled = /\benabled\s*:\s*([^,\n]+)/.exec(call)?.[1] ?? "";
    expect(enabled.trim()).toBe("!!user");
  });

  it("never reads the profile or its loading state", () => {
    expect(call).not.toMatch(/\bprofile\b/);
    expect(call).not.toMatch(/\buserLoading\b/);
  });
});
