/**
 * Q341 — the applicant list and every applicant COUNTER must agree about
 * blocked applicants, and they agree because there is ONE definition.
 *
 * WHAT WAS BROKEN (prod, 2026-09-24): an applicant who had blocked the poster
 * was hidden by the applicant panel (a client-side user_blocks filter in
 * useApplicantsState) but counted by useActivityData's applicantCounts and
 * pendingApplicantCounts and by useActivityBadgeCounts' posts badge. /posts
 * said "Applicants (1)" and the panel said "Still no applications".
 *
 * THE ONE DEFINITION is the poster's SELECT policy on `applications`
 * ("Job owners can view applications for their jobs", 20260924020956), which
 * now excludes are_users_blocked(helper_id, auth.uid()). Every poster-side read
 * — list and counters alike — is a PostgREST read under that policy.
 *
 * So this guard pins, both ways:
 *   1. the NEWEST definition of that policy carries the block filter;
 *   2. the SELECT policies on `applications` are exactly the three known ones
 *      (a fourth permissive SELECT policy would be OR'd in and re-expose
 *      blocked applicants to whoever it admits) and each is either admin-only,
 *      own-row, or block-filtered;
 *   3. no src/ file that reads `applications` re-implements the block filter
 *      client-side (a second definition is how the list and counters drifted);
 *   4. the inventory of src/ files that read `applications` is exact, so a new
 *      reader (a new counter) is a conscious addition, seen here.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { walkSource } from "./helpers/walkSource";

const ROOT = process.cwd();
const MIG_DIR = join(ROOT, "supabase/migrations");
const POSTER_POLICY = "Job owners can view applications for their jobs";

type Policy = { name: string; cmd: string; body: string; file: string };

/** Newest definition of every policy on public.applications, drops applied. */
function applicationsPolicies(): Map<string, Policy> {
  const live = new Map<string, Policy>();
  for (const file of readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = blankSqlComments(readFileSync(join(MIG_DIR, file), "utf8"));
    const re =
      /\b(create|drop)\s+policy\s+(?:if\s+exists\s+)?"([^"]+)"\s+on\s+(?:public\.)?applications\b([^;]*);/gi;
    for (const m of sql.matchAll(re)) {
      const [, verb, name, rest] = m;
      if (verb.toLowerCase() === "drop") {
        live.delete(name);
        continue;
      }
      const cmd = /\bfor\s+(select|insert|update|delete|all)\b/i.exec(rest)?.[1]?.toLowerCase() ?? "all";
      live.set(name, { name, cmd, body: rest.replace(/\s+/g, " "), file });
    }
  }
  return live;
}

describe("Q341: applicant list and counters share ONE blocked filter", () => {
  const policies = applicationsPolicies();
  const selects = [...policies.values()].filter((p) => p.cmd === "select" || p.cmd === "all");

  it("the policy inventory is real", () => {
    expect(policies.size, "no policies on applications parsed from migrations").toBeGreaterThan(5);
    expect(selects.length).toBeGreaterThan(2);
  });

  it("the poster's SELECT policy (newest definition) excludes blocked applicants", () => {
    const p = policies.get(POSTER_POLICY);
    expect(p, `${POSTER_POLICY} not found in migrations`).toBeTruthy();
    expect(
      p!.body,
      `${POSTER_POLICY} (newest in ${p!.file}) must exclude applicants the poster is blocked with — ` +
        `it is the single definition the applicant panel AND every counter read through.`,
    ).toMatch(/not\s+(public\.)?are_users_blocked\s*\(\s*(applications\.)?helper_id\s*,\s*\(\s*select\s+auth\.uid\(\)\s*\)\s*\)/i);
  });

  it("the SELECT policies on applications are exactly the known three, each admin/own-row/block-filtered", () => {
    expect(selects.map((p) => p.name).sort()).toEqual(
      ["Admins can view all applications", "Helpers can view their own applications", POSTER_POLICY].sort(),
    );
    for (const p of selects) {
      const admin = /has_role\s*\(/i.test(p.body);
      const ownRow = /using\s*\(\s*\(?\s*(\(\s*select\s+)?auth\.uid\(\)\s*\)?\s*=\s*helper_id\s*\)\s*$/i.test(p.body.trim());
      const blockFiltered = /are_users_blocked/i.test(p.body);
      expect(admin || ownRow || blockFiltered, `${p.name} exposes other users' applications without a block filter`).toBe(true);
    }
  });

  const readers = walkSource([join(ROOT, "src")])
    .filter((f) => !/\.test\.tsx?$/.test(f) && !f.includes("/src/test/"))
    .map((f) => ({ rel: f.slice(ROOT.length + 1), code: blankComments(readFileSync(f, "utf8")) }))
    .filter((f) => /\.from\(\s*["']applications["']\s*\)/.test(f.code));

  it("no applications reader re-implements the block filter client-side (one definition)", () => {
    const dupes = readers
      .filter((f) => /getBlockedUserIds|["']user_blocks["']|areUsersBlocked/.test(f.code))
      .map((f) => f.rel)
      .sort();
    // Exact, both ways. useDashboardData reads user_blocks for the HELPER's job
    // feed (whose posters to hide), not to filter anyone's applicants — its
    // applications read is the helper's own rows.
    expect(dupes).toEqual(["src/hooks/useDashboardData.ts"]);
  });

  it("the inventory of src/ files that read applications is exact", () => {
    expect(readers.length).toBeGreaterThan(10);
    expect(readers.map((f) => f.rel).sort()).toEqual(
      [
        "src/pages/jobs/AppliedJobsTab.tsx",
        // Admin reads the one application a report names (Q366), not a list.
        "src/components/admin/AdminReports.tsx",
        "src/components/admin/adminHealth/useHealthData.ts",
        "src/components/admin/useAdminUserSummaries.ts",
        "src/components/dashboard/jobDetailDialog/useJobDetailData.ts",
        "src/components/dashboard/prefetchJobDialog.ts",
        "src/hooks/useActivityBadgeCounts.ts",
        "src/hooks/useActivityData.ts",
        "src/hooks/useDashboardData.ts",
        "src/pages/profile/HomeHistory.tsx",
        "src/components/job-card/activityActions/useApplicantsState.ts",
        "src/components/job-card/activityActions/useOfferHandlers.ts",
        "src/pages/home/useApplyFlow.ts",
        "src/pages/info/legal/DataExportCard.tsx",
        "src/pages/user/useUserProfileData.ts",
      ].sort(),
    );
  });
});

// The block filter dropped from the poster policy.
// @mutate supabase/migrations/20260924020956_applications_refuse_and_hide_across_block.sql | AND NOT public.are_users_blocked(applications.helper_id, (SELECT auth.uid())) | AND true
// A client-side block filter re-added to the applicant list.
// @mutate src/components/job-card/activityActions/useApplicantsState.ts | const { data: apps, error: appsError } = await supabase.from("applications") | await supabase.from("user_blocks").select("*");\n    const { data: apps, error: appsError } = await supabase.from("applications")
