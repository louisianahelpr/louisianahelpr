/**
 * Q205 (a), (b) and (c) — what Q193 left behind once the approval-pending and
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
 *   (b) What 'approved' still meant was "passed the entry gate", and the entry
 *       gate is a confirmed email (owner, 2026-09-23). Every reader moved to
 *       profiles.email_verified or was deleted (20260923172405: 14 SQL
 *       functions, the profiles INSERT policy, the partial index; edge
 *       functions; src/; seeders). The column is left INERT until a follow-up
 *       migration drops it, so NOTHING may name it again: no code outside
 *       comments, tests and the generated types, and no newest SQL function,
 *       policy, view or index.
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
 * @mutate src/components/admin/adminAnalytics/adminAnalyticsHelpers.ts | const verifiedUsers = profiles.filter(p => p.email_verified).length; | const verifiedUsers = profiles.filter(p => p.email_verified).length; const deniedUsers = profiles.filter(p => p.approval_status === "denied").length;
 * @mutate src/hooks/useProfile.ts | "user_id, full_name, email, avatar_url, ban_status, idv_status, | "user_id, full_name, email, avatar_url, ban_status, approval_status, idv_status,
 * @mutate supabase/functions/cleanup-abandoned-accounts/index.ts | .select("ban_status") | .select("ban_status, approval_status")
 * @mutate supabase/migrations/20260924055509_get_safe_profiles_hide_anonymized.sql |   WHERE (p.user_id = ANY(user_ids) OR p.id = ANY(user_ids))\n    AND p.email_verified |   WHERE (p.user_id = ANY(user_ids) OR p.id = ANY(user_ids))\n    AND p.approval_status = 'approved'
 * @mutate supabase/migrations/20260923172405_retire_approval_status_reads.sql |     AND onboarding_fee_paid = false\n    AND email_verified = false |     AND onboarding_fee_paid = false\n    AND approval_status = 'pending'\n    AND email_verified = false
 * @mutate supabase/migrations/20260923172405_retire_approval_status_reads.sql | DROP INDEX IF EXISTS public.idx_profiles_pending_verified; | SELECT 1;
 * @mutate supabase/migrations/20260923171331_referral_credit_eligibility_drop_denied.sql | IF v_ban_status IN ('banned', 'temp_banned', 'permanently_banned') THEN | IF v_ban_status IN ('banned', 'temp_banned', 'permanently_banned') OR (SELECT approval_status FROM public.profiles WHERE user_id = NEW.user_id) = 'denied' THEN
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
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

/**
 * The newest surviving CREATE of every policy (by name + table), view and index
 * in supabase/migrations, in apply order: a later CREATE replaces, a DROP
 * removes. Comments are blanked first, so a migration that only CITES the
 * column in prose is not a reader.
 */
function latestSqlObjects(dir: string): Map<string, { file: string; body: string }> {
  const out = new Map<string, { file: string; body: string }>();
  const q = (n: string) => n.replace(/"/g, "").replace(/^public\./i, "").toLowerCase();
  const ev =
    /CREATE\s+POLICY\s+("[^"]+"|\w+)\s+ON\s+([\w."]+)[\s\S]*?;|DROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?("[^"]+"|\w+)\s+ON\s+([\w."]+)|CREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW\s+([\w."]+)[\s\S]*?;|DROP\s+(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+EXISTS\s+)?([\w."]+)|CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?([\w."]+)[\s\S]*?;|DROP\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+EXISTS\s+)?([\w."]+)/gi;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = blankSqlComments(readFileSync(join(dir, f), "utf8"));
    for (const m of sql.matchAll(ev)) {
      if (m[1]) out.set(`policy ${q(m[1])} on ${q(m[2])}`, { file: f, body: m[0] });
      else if (m[3]) out.delete(`policy ${q(m[3])} on ${q(m[4])}`);
      else if (m[5]) out.set(`view ${q(m[5])}`, { file: f, body: m[0] });
      else if (m[6]) out.delete(`view ${q(m[6])}`);
      else if (m[7]) out.set(`index ${q(m[7])}`, { file: f, body: m[0] });
      else if (m[8]) out.delete(`index ${q(m[8])}`);
    }
  }
  return out;
}

/** Files whose code (comments blanked) may name the column. Exact, two-way. */
// @two-way src/test/retiredApprovalReads.test.ts:ALLOWED_NAMERS is exact: lower or delete the entry
const ALLOWED_NAMERS: Record<string, number> = {
  // Display label for helper_verifications history rows written before Q205b;
  // no new row carries the field (log_verification_change no longer logs it).
  "src/components/admin/UserVerificationHistory.tsx": 1,
};

describe("Q205 (b): nothing reads profiles.approval_status", () => {
  const isFixture = (f: string) => f.startsWith("src/test/") || /(^|\/)e2e\/.*\.spec\.[cm]?[jt]sx?$/.test(f);
  const app = files.filter((f) => !isTest(f) && !isFixture(f));

  it("no app, edge-function, script or seed code names approval_status", () => {
    expect(app.length).toBeGreaterThan(1000);
    for (const f of [
      "src/hooks/useProfile.ts",
      "src/lib/helperTier.ts",
      "supabase/functions/cleanup-abandoned-accounts/index.ts",
      "supabase/functions/engagement-automations/index.ts",
      "supabase/functions/stripe-webhook/handlers/accountUpdated.ts",
      "scripts/audit/prod-seed.mjs",
      "e2e/happy-path/seedData.ts",
    ]) {
      expect(app).toContain(f);
    }
    const perFile = new Map<string, string[]>();
    for (const hit of hitsIn(app, (line) => /approval_status/i.test(line))) {
      const f = hit.slice(0, hit.indexOf(":"));
      perFile.set(f, [...(perFile.get(f) ?? []), hit]);
    }
    const unexpected = [...perFile].flatMap(([f, hits]) => (hits.length === ALLOWED_NAMERS[f] ? [] : hits));
    expect(unexpected, "approval_status is retired (Q205b): read email_verified (the entry gate) instead").toEqual([]);
    const stale = Object.keys(ALLOWED_NAMERS).filter((f) => (perFile.get(f)?.length ?? 0) !== ALLOWED_NAMERS[f]);
    expect(stale, "ALLOWED_NAMERS is exact: lower or delete the entry").toEqual([]);
  });

  it("no SQL function's NEWEST definition names approval_status", () => {
    const defs = latestFunctionDefs(join(REPO, "supabase/migrations"));
    expect(defs.size).toBeGreaterThan(300);
    for (const fn of ["get_safe_profiles", "sync_email_verified", "prevent_self_escalation", "sweep_daily_job_digest"]) {
      expect(defs.has(fn)).toBe(true);
    }
    const readers = [...defs].filter(([, d]) => /approval_status/i.test(d.body)).map(([name, d]) => `${name} (${d.file})`);
    expect(readers).toEqual([]);
  });

  it("no surviving policy, view or index names approval_status", () => {
    const objs = latestSqlObjects(join(REPO, "supabase/migrations"));
    expect(objs.size).toBeGreaterThan(300);
    expect(objs.has('policy users can insert their own profile on profiles')).toBe(true);
    const readers = [...objs].filter(([, o]) => /approval_status/i.test(o.body)).map(([k, o]) => `${k} (${o.file})`);
    expect(readers).toEqual([]);
  });
});
