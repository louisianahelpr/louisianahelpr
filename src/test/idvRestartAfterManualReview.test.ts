/**
 * CLASS CHECK (owner report 2026-10-21: the ID sheet said "with our team…
 * within 24 hours" and never offered a way to verify). Read from the code that
 * ships (the EFFECTIVE SQL definitions, comments blanked):
 *   1. claim_idv_attempt lets a member restart from manual_review (p_restart),
 *      but a ban and an admin's rejection ('failed') refuse FIRST, a fourth
 *      attempt is a person's call, the write is conditional on the status it
 *      read (an admin decision in between wins), and it never writes 'verified'.
 *   2. A member in manual_review over 24 h reaches every admin through the
 *      existing identity-review alert (its title carries the idv-review close
 *      prefix, so the push->Slack mirror, the ops ledger item and its
 *      self-close are the existing ones), on an hourly cron with a liveness
 *      expectation.
 *   3. Every member in manual_review is in the Identity review queue
 *      (AdminIDVReview lists idv_status manual_review).
 *
 * Behaviour: src/test/pglite/idvRestartAfterManualReview.pglite.mjs (18 [fix]
 * checks red before the migration, all green after, 3x replay). The sheet:
 * src/test/identityRestartSheet.test.tsx. The edge function and webhook:
 * src/test/edge/stripe-idv-start.test.ts, src/test/edge/stripe-idv-webhook.test.ts.
 *
 * @mutate supabase/migrations/20261021135734_idv_restart_after_manual_review.sql |   IF v_status = 'failed' THEN |   IF v_status = 'failed_never' THEN
 * @mutate supabase/migrations/20261021135734_idv_restart_after_manual_review.sql |      AND idv_status IS NOT DISTINCT FROM v_status\n | \n
 * @mutate supabase/migrations/20261021135734_idv_restart_after_manual_review.sql |   v_restart_max integer := 3; |   v_restart_max integer := 30;
 * @mutate supabase/migrations/20261021135734_idv_restart_after_manual_review.sql |       SELECT ur.user_id, 'Identity verification needs review — waiting over 24 hours', |       SELECT ur.user_id, 'ID check waiting over 24 hours',
 * @mutate supabase/migrations/20261021135734_idv_restart_after_manual_review.sql |     CONTINUE WHEN r.since IS NULL OR r.since > now() - interval '24 hours'; |     CONTINUE WHEN r.since IS NULL OR r.since > now() - interval '72 hours';
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const REPO = resolve(__dirname, "..", "..");
const MIG = join(REPO, "supabase", "migrations");
const THIS = "20261021135734_idv_restart_after_manual_review.sql";
const flat = (s: string) => blankSqlComments(s).replace(/\s+/g, " ");
const defs = effectiveDefs(MIG);
const body = (fn: string) => {
  const d = defs.get(fn);
  if (!d) throw new Error(`${fn}: no effective definition`);
  return flat(d.stmt);
};

describe("a member stuck 'with our team' can restart, and admins are told (owner report 2026-10-21)", () => {
  it("claim_idv_attempt: ban and rejection refuse BEFORE the restart is considered", () => {
    const c = body("claim_idv_attempt");
    const ban = c.indexOf("IF v_banned IN ('temp_banned', 'permanently_banned') THEN");
    const rejected = c.indexOf("IF v_status = 'failed' THEN RETURN jsonb_build_object('claimed', false, 'reason', 'rejected');");
    const review = c.indexOf("IF v_status = 'manual_review' AND p_restart IS NOT TRUE THEN");
    const restart = c.indexOf("IF p_restart IS TRUE THEN");
    expect(ban).toBeGreaterThan(0);
    expect(rejected).toBeGreaterThan(ban);
    expect(review).toBeGreaterThan(rejected);
    expect(restart).toBeGreaterThan(review);
  });

  it("claim_idv_attempt: a bounded restart, a conditional write, never 'verified'", () => {
    const c = body("claim_idv_attempt");
    expect(c).toMatch(/v_restart_max integer := 3;/);
    expect(c).toMatch(/IF COALESCE\(v_count, 0\) >= v_restart_max THEN/);
    expect(c).toMatch(/v_status NOT IN \('manual_review', 'pending', 'not_started'\)/);
    expect(c).toMatch(/AND COALESCE\(idv_attempt_count, 0\) = COALESCE\(v_count, 0\) AND idv_status IS NOT DISTINCT FROM v_status RETURNING/);
    expect(c).toMatch(/idv_status = 'pending', idv_session_id = NULL/);
    expect(c).not.toMatch(/idv_status\s*=\s*'verified'/);
    expect(c).toMatch(/p_restart boolean DEFAULT false/);
  });

  it("one claim signature, service role only", () => {
    const sql = flat(readFileSync(join(MIG, THIS), "utf8"));
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS public\.claim_idv_attempt\(uuid, integer, boolean\);/);
    for (const sig of ["claim_idv_attempt(uuid, integer, boolean, boolean)", "idv_review_waiting_since(uuid)", "sweep_idv_review_waiting()"]) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${sig} FROM PUBLIC, anon, authenticated;`);
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.${sig} TO service_role;`);
    }
  });

  it("the 24-hour alert rides the existing identity-review alert, hourly, with a liveness expectation", () => {
    const s = body("sweep_idv_review_waiting");
    const title = /SELECT ur\.user_id, '([^']+)',/.exec(s)?.[1] ?? "";
    // admin_alert_close_rule maps by normalised-title PREFIX.
    expect(title.toLowerCase().startsWith("identity verification needs review")).toBe(true);
    expect(body("admin_alert_close_rule")).toContain("('identity verification needs review', 'idv-review')");
    expect(s).toMatch(/WHERE p\.idv_status = 'manual_review' AND p\.is_seed IS NOT TRUE/);
    expect(s).toMatch(/r\.since > now\(\) - interval '24 hours'/);
    expect(s).toMatch(/'admin_alert', v_link/);
    expect(s).toMatch(/v_link := '\/admin\?view=idvreview&user=' \|\| r\.user_id::text;/);
    const sql = flat(readFileSync(join(MIG, THIS), "utf8"));
    expect(sql).toMatch(/INSERT INTO public\.cron_work_expectations[\s\S]*'idv-review-waiting'/);
    expect(sql).toMatch(/cron\.schedule\('idv-review-waiting', '23 \* \* \* \*'/);
    expect(body("idv_review_waiting_since")).toMatch(/h\.field = 'idv_status' AND h\.new_value = 'manual_review'/);
  });

  it("every manual_review member is in the Identity review queue", () => {
    const q = blankComments(readFileSync(join(REPO, "src/components/admin/AdminIDVReview.tsx"), "utf8"));
    expect(q).toMatch(/\.in\("idv_status", \["manual_review", "failed"\]\)/);
  });

  it("the PGlite proof exists and runs THIS migration", () => {
    const p = join(REPO, "src/test/pglite/idvRestartAfterManualReview.pglite.mjs");
    expect(existsSync(p)).toBe(true);
    expect(readFileSync(p, "utf8")).toContain(THIS);
  });
});
