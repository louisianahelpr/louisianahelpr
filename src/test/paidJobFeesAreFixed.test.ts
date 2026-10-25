/**
 * Once a job is paid, SQL does not rewrite its fee fields unless a migration
 * opts in on purpose (migration 20261025161802; lead 2026-10-25: the owner's
 * 10-21 restamp stands, guard it with an explicit migration opt-in).
 *
 * The incident: 20261021142508 restamped funded jobs 11f8b084 and 9c6ff2de
 * from 12% to 5% + 70c (updated_at 2026-10-21 18:27:42) while their Stripe
 * metadata says 12%. It was an owner decision, but nothing in the schema made
 * a bulk rewrite of a paid job's fees say so.
 *
 * Behaviour is executed in PGlite (src/test/pglite/paidJobFeesAreFixed.pglite.mjs:
 * 4 [fix] checks red before, all green applied 3x, the 20261021142508 UPDATE
 * run verbatim). This guard pins the NEWEST trigger definition and holds the
 * CLASS: every fee-named jobs column is either fixed by the trigger or
 * exempted here with a reason, and every LATER migration that writes a fixed
 * fee column on jobs carries the opt-in.
 *
 * @mutate supabase/migrations/20261025161802_paid_job_fees_are_fixed.sql |        AND NEW.customer_fee_amount IS NOT DISTINCT FROM OLD.customer_fee_amount |        AND true
 * @mutate supabase/migrations/20261025161802_paid_job_fees_are_fixed.sql |     IF coalesce(OLD.payment_status, 'unpaid') IN ('unpaid', 'abandoned', 'failed') THEN |     IF coalesce(OLD.payment_status, 'unpaid') IN ('unpaid', 'abandoned', 'failed', 'escrow') THEN
 * @mutate supabase/migrations/20261025161802_paid_job_fees_are_fixed.sql |        AND length(btrim(coalesce(current_setting('app.paid_job_fee_rewrite', true), ''))) > 0 THEN |        THEN
 * @mutate supabase/migrations/20261025161802_paid_job_fees_are_fixed.sql |     BEFORE UPDATE ON public.jobs |     AFTER INSERT ON public.jobs
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { migrationFiles, effectiveDefs } from "./helpers/effectiveFunctionDefs";

const ROOT = resolve(__dirname, "../..");
const DIR = resolve(ROOT, "supabase/migrations");
const THIS = "20261025161802_paid_job_fees_are_fixed.sql";
const squash = (s: string) => s.replace(/\s+/g, " ");

/** The fee stamp the trigger holds fixed on a paid job. */
const FIXED = [
  "customer_fee_amount",
  "helper_fee_flat_cents",
  "helper_fee_percent",
  "platform_fee_amount",
  "platform_fee_percent",
  "poster_fee_flat_cents",
] as const;

/** Every other fee-named jobs column, and why it may change after payment. */
// @two-way src/test/paidJobFeesAreFixed.test.ts:expect(found).toEqual(classified);
const EXEMPT: Record<string, string> = {
  cancellation_fee: "set when a paid job is cancelled late; it is the cancel's fee, not the price stamp",
  cancellation_fee_status: "the cancellation fee's own status",
  onboarding_fee_amount: "the one-time $2 setup fee, written by settleOnboardingFee after the checkout completes",
  urgent_fee: "the poster's urgent bonus (the Helpr's pay), not a fee rate",
  protection_fee: "not written by any app path today (types.ts only); listed so a new writer is a decision",
};

/** Fee-named columns ADDed to jobs anywhere in the migrations, plus the measured base table's. */
function jobsFeeColumns(files: string[]): Set<string> {
  // The base jobs table predates the migrations folder's ADD COLUMNs; its fee
  // columns measured on prod 2026-10-25 (information_schema.columns).
  const out = new Set<string>(["customer_fee_amount", "helper_fee_percent", "protection_fee"]);
  for (const f of files) {
    const sql = blankSqlComments(readFileSync(resolve(DIR, f), "utf8"));
    for (const m of sql.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:public\.)?jobs\b([^;]*)/gi)) {
      for (const c of m[1].matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?("?)([a-z_]*fee[a-z_]*)\1/gi)) out.add(c[2].toLowerCase());
    }
  }
  return out;
}

describe("a paid job's fee fields are fixed (migration 20261025161802)", () => {
  const files = migrationFiles(DIR);

  it("every fee-named jobs column is either fixed by the trigger or exempted with a reason (exact, both ways)", () => {
    const found = [...jobsFeeColumns(files)].sort();
    expect(found.length).toBeGreaterThan(8);
    const classified = [...FIXED, ...Object.keys(EXEMPT)].sort();
    expect(found).toEqual(classified);
  });

  it("the NEWEST trigger function compares every fixed column, refuses with 42501, and lets only service_role or an opted-in migration through", () => {
    const def = effectiveDefs(DIR).get("enforce_paid_job_fee_fields_fixed");
    expect(def, "no migration defines enforce_paid_job_fee_fields_fixed").toBeTruthy();
    expect(def!.file).toBe(THIS);
    const body = squash(blankSqlComments(def!.stmt));
    for (const col of FIXED) expect(body, col).toContain(`NEW.${col} IS NOT DISTINCT FROM OLD.${col}`);
    expect(body).toContain("IF coalesce(OLD.payment_status, 'unpaid') IN ('unpaid', 'abandoned', 'failed') THEN RETURN NEW;");
    expect(body).toContain("IF coalesce(auth.role(), '') = 'service_role' AND coalesce(current_setting('role', true), 'none') = 'service_role' THEN RETURN NEW;");
    expect(body).toContain("coalesce(auth.role(), '') NOT IN ('anon', 'authenticated')");
    expect(body).toContain("current_setting('app.paid_job_fee_rewrite', true)");
    expect(body).toContain("ERRCODE = '42501'");
  });

  it("the trigger fires BEFORE every UPDATE of jobs and its function is revoked from members", () => {
    const sql = squash(blankSqlComments(readFileSync(resolve(DIR, THIS), "utf8")));
    expect(sql).toContain("CREATE TRIGGER zzzzzzz_jobs_paid_fee_fields_fixed BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.enforce_paid_job_fee_fields_fixed();");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.enforce_paid_job_fee_fields_fixed() FROM PUBLIC, anon, authenticated;");
    // Nothing later drops it.
    const later = files.filter((f) => f > THIS);
    for (const f of later) {
      expect(blankSqlComments(readFileSync(resolve(DIR, f), "utf8")), f).not.toMatch(/drop\s+trigger\s+(if\s+exists\s+)?zzzzzzz_jobs_paid_fee_fields_fixed/i);
    }
  });

  // Postgres fires BEFORE triggers in name order: the guard must sort last so
  // a fee another BEFORE trigger sets is seen (lh-money-escrow review 2026-10-25 #6).
  it("the guard trigger's name sorts after every other BEFORE trigger created on jobs", () => {
    const names = new Set<string>();
    for (const f of files) {
      const sql = blankSqlComments(readFileSync(resolve(DIR, f), "utf8"));
      for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger\s+"?([a-z0-9_]+)"?\s+before\b[\s\S]{0,200}?\bon\s+(?:public\.)?jobs\b/gi)) names.add(m[1]);
    }
    expect(names.size).toBeGreaterThan(10);
    expect(names.has("zzzzzzz_jobs_paid_fee_fields_fixed")).toBe(true);
    const sorted = [...names].sort();
    expect(sorted[sorted.length - 1]).toBe("zzzzzzz_jobs_paid_fee_fields_fixed");
  });

  it("CLASS: a later migration that writes a fixed fee column of jobs says why (SET LOCAL app.paid_job_fee_rewrite)", () => {
    const later = files.filter((f) => f > THIS);
    const writers: string[] = [];
    for (const f of later) {
      const sql = blankSqlComments(readFileSync(resolve(DIR, f), "utf8"));
      for (const m of sql.matchAll(/update\s+(?:only\s+)?(?:public\.)?jobs\b[\s\S]*?\bset\b([\s\S]*?)(?:\bwhere\b|\bfrom\b|;)/gi)) {
        if (FIXED.some((c) => new RegExp(`\\b${c}\\s*=`, "i").test(m[1]))) writers.push(f);
      }
    }
    for (const f of new Set(writers)) {
      const sql = blankSqlComments(readFileSync(resolve(DIR, f), "utf8"));
      expect(sql, `${f} rewrites a jobs fee column: a paid job refuses it unless the migration runs SET LOCAL app.paid_job_fee_rewrite = '<owner decision, dated>'`)
        .toMatch(/set\s+local\s+app\.paid_job_fee_rewrite\s*=\s*'[^']{8,}'/i);
    }
  });

  it("the PGlite proof exists, names every case and runs the incident's UPDATE verbatim", () => {
    const proof = readFileSync(resolve(ROOT, "src/test/pglite/paidJobFeesAreFixed.pglite.mjs"), "utf8");
    for (const c of ["F1 [fix]", "F2 [fix]", "F3 [fix]", "F4 [fix]", "F5 [fix]", "K1 [keep]", "K2 [keep]", "K3 [keep]", "K4 [keep]", "K5 [keep]", "K6 [keep]", "K7 [keep]", "K8 [keep]", "20261021142508_legacy_jobs_take_the_flat_helpr_fee.sql", "--before", "--replay"]) {
      expect(proof, c).toContain(c);
    }
  });
});
