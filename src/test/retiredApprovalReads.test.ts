/**
 * Q205 (a) and (c) — what Q193 left behind once the approval-pending and
 * account-denied states were retired (owner, 2026-09-23: "every signup is
 * auto-approved and bans are automated").
 *
 *   (a) ProtectedRoute's `allowPending` / `allowUnapproved` props were kept,
 *       accepted and IGNORED, so the route table did not have to change in the
 *       same commit. They are deleted; no code, test or script names them.
 *   (c) 'denied' can no longer be stored (CHECK profiles_approval_status_no_denied,
 *       20260923153703), so every READ of it is dead: complete-signup's
 *       resubmission branch, admin-update-email's "free a denied holder's
 *       address", enforce_referral_credit_eligibility's denied branch, and the
 *       admin analytics "Pending Approval" / "Denied" rows + Users filter.
 *
 * Derived from the source tree and the NEWEST definition of every SQL function,
 * not from the list of sites that were fixed, so a read added tomorrow anywhere
 * is caught the day it lands. Writers of 'denied' are pinned separately in
 * src/test/retiredAccountStateScreens.test.ts.
 *
 * PROVEN RED 2026-09-23 on origin/main 9a0582ecf (before this change): 3 of 3
 * checks failed — (a) 19 code references in 6 files; (c) 8 client/edge reads
 * in 4 files; SQL: enforce_referral_credit_eligibility.
 *
 * @mutate src/App.tsx | <ProtectedRoute fallback={<DashboardRouteSkeleton />}><Dashboard /> | <ProtectedRoute allowPending fallback={<DashboardRouteSkeleton />}><Dashboard />
 * @mutate supabase/functions/admin-update-email/index.ts | if (conflictingProfiles?.[0]) { | if (conflictingProfiles?.[0] && conflictingProfiles[0].approval_status !== 'denied') {
 * @mutate src/components/admin/adminAnalytics/adminAnalyticsHelpers.ts | const approvedUsers = profiles.filter(p => p.approval_status === "approved").length; | const approvedUsers = profiles.filter(p => p.approval_status === "approved").length; const deniedUsers = profiles.filter(p => p.approval_status === "denied").length;
 * @mutate supabase/migrations/20260923165543_referral_credit_eligibility_drop_denied.sql | IF v_ban_status IN ('banned', 'temp_banned', 'permanently_banned') THEN | IF v_ban_status IN ('banned', 'temp_banned', 'permanently_banned') OR (SELECT approval_status FROM public.profiles WHERE user_id = NEW.user_id) = 'denied' THEN
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { latestFunctionDefs } from "./helpers/rpcErrorInventory";

const REPO = resolve(__dirname, "..", "..");
const ROOTS = ["src", "supabase/functions", "scripts", "e2e"];
const CODE_EXT = /\.(ts|tsx|js|mjs|cjs)$/;
const SELF = "src/test/retiredApprovalReads.test.ts";
/** Generated from the live schema; not app code. */
const GENERATED = new Set(["src/integrations/supabase/types.ts"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (CODE_EXT.test(name)) out.push(full);
  }
  return out;
}

const files = ROOTS.flatMap((r) => walk(join(REPO, r)))
  .map((f) => relative(REPO, f))
  .filter((f) => f !== SELF && !GENERATED.has(f));
const code = (rel: string) => blankComments(readFileSync(join(REPO, rel), "utf8"));
const isTest = (f: string) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(f);

const hitsIn = (list: string[], bad: (line: string) => boolean): string[] => {
  const hits: string[] = [];
  for (const f of list) {
    code(f).split("\n").forEach((line, i) => {
      if (bad(line)) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 140)}`);
    });
  }
  return hits;
};

/** A 'denied' string literal read as an APPROVAL state: on a line that also
 *  names approval_status or another approval value, or a PostgREST filter. */
const DENIED_LITERAL = /(["'`])denied\1/;
const APPROVAL_CONTEXT = /approval_status|(["'`])(approved|pending)\1/;
const DENIED_FILTER = /\b(neq|eq)\.denied\b/;

describe("Q205 (a, c): no code reads the retired approval states", () => {
  it("the scan actually read the tree (inventory floor)", () => {
    expect(files.length).toBeGreaterThan(1000);
    for (const f of [
      "src/App.tsx",
      "src/components/ProtectedRoute.tsx",
      "supabase/functions/complete-signup/index.ts",
      "supabase/functions/admin-update-email/index.ts",
      "src/components/admin/AdminAnalyticsDrilldowns.tsx",
    ]) {
      expect(files).toContain(f);
    }
  });

  it("(a) nothing names the deleted allowPending / allowUnapproved props", () => {
    const hits = hitsIn(files, (line) => /\ballow(Pending|Unapproved)\b/.test(line));
    expect(hits, "ProtectedRoute has no per-route gate props any more (Q205a)").toEqual([]);
  });

  it("(c) no client or edge code reads approval_status 'denied'", () => {
    const app = files.filter((f) => (f.startsWith("src/") || f.startsWith("supabase/functions/")) && !isTest(f));
    expect(app.length).toBeGreaterThan(500);
    const hits = hitsIn(app, (line) => DENIED_FILTER.test(line) || (DENIED_LITERAL.test(line) && APPROVAL_CONTEXT.test(line)));
    expect(hits, "'denied' is not a storable approval_status (Q193); this read is dead").toEqual([]);
  });

  it("(c) no SQL function's NEWEST definition reads approval_status 'denied'", () => {
    const defs = latestFunctionDefs(join(REPO, "supabase/migrations"));
    expect(defs.size).toBeGreaterThan(300);
    expect(defs.has("enforce_referral_credit_eligibility")).toBe(true);
    const readers = [...defs]
      .filter(([, d]) => /approval_status/i.test(d.body) && /'denied'/.test(d.body))
      .map(([name, d]) => `${name} (${d.file})`);
    expect(readers).toEqual([]);
  });
});
