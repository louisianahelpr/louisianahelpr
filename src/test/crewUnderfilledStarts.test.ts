import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

/**
 * Q1460 (owner decision 2026-10-06): an under-filled crew STARTS WITH WHO IS
 * HIRED instead of being auto-cancelled at its start (hired Helprs were paid
 * nothing; lh-money-escrow review of the group-jobs flip).
 *
 * Two halves, both required: start_underfilled_crews() books a funded,
 * expired, still-open crew with >= 1 hired member, and auto-expire-jobs runs it
 * BEFORE its cancel step and never cancels a crew that has anyone hired.
 * Behaviour: src/test/pglite/crewUnderfilledStarts.pglite.mjs (4 RED before,
 * 8 PASS after, migration applied 3x).
 *
 * @mutate supabase/migrations/20261006225402_underfilled_crew_starts_with_who_is_hired.sql | WHERE g.job_id = j.id AND g.helper_id IS NOT NULL AND g.helper_confirmed_at IS NOT NULL) | WHERE g.job_id = j.id AND g.helper_id IS NOT NULL)
 * @mutate supabase/migrations/20261006225402_underfilled_crew_starts_with_who_is_hired.sql |              public.job_offer_cutoff(j.date_needed, j.start_time) <= now() + interval '15 minutes' |              FALSE
 * @mutate supabase/migrations/20261006225402_underfilled_crew_starts_with_who_is_hired.sql |        AND public.job_payment_is_funded(j.payment_status) |        AND TRUE
 * @mutate supabase/migrations/20261006225402_underfilled_crew_starts_with_who_is_hired.sql | GRANT EXECUTE ON FUNCTION public.start_underfilled_crews() TO service_role; | GRANT EXECUTE ON FUNCTION public.start_underfilled_crews() TO anon, authenticated, service_role;
 * @mutate supabase/functions/auto-expire-jobs/index.ts |         if ((confirmed ?? 0) > 0) { |         if (false) {
 * @mutate supabase/functions/auto-expire-jobs/index.ts |       const { data: crewRpc, error: crewRpcErr } = await supabase.rpc("start_underfilled_crews"); |       const { data: crewRpc, error: crewRpcErr } = { data: 0, error: null };
 */
const ROOT = resolve(__dirname, "../..");
const DEFS = effectiveDefs(resolve(ROOT, "supabase/migrations"));
const MIGRATION = blankSqlComments(readFileSync(resolve(ROOT, "supabase/migrations/20261006225402_underfilled_crew_starts_with_who_is_hired.sql"), "utf8"));
const EXPIRE = blankComments(readFileSync(resolve(ROOT, "supabase/functions/auto-expire-jobs/index.ts"), "utf8"));

describe("Q1460: an under-filled crew starts with who is hired", () => {
  it("start_underfilled_crews books only funded, expired, open crews with someone hired", () => {
    const body = blankSqlComments(DEFS.get("start_underfilled_crews")?.stmt ?? "");
    expect(body, "start_underfilled_crews is defined").toMatch(/CREATE OR REPLACE FUNCTION public\.start_underfilled_crews\(\)/);
    expect(body).toMatch(/j\.status = 'open'::job_status/);
    expect(body).toMatch(/j\.is_group_job IS TRUE/);
    expect(body).toMatch(/AND public\.job_payment_is_funded\(j\.payment_status\)/);
    expect(body).toMatch(/AND EXISTS \(SELECT 1 FROM public\.group_job_helpers g\s+WHERE g\.job_id = j\.id AND g\.helper_id IS NOT NULL AND g\.helper_confirmed_at IS NOT NULL\)/);
    // Booked at the hire cutoff (the moment accept_group_application stops hiring), not an hour late.
    expect(body).toMatch(/public\.job_offer_cutoff\(j\.date_needed, j\.start_time\) <= now\(\) \+ interval '15 minutes'/);
    expect(body).toMatch(/SET status = 'accepted'::job_status\s+WHERE id = rec\.id\s+AND status = 'open'::job_status/);
  });
  it("it is server-only (no client grant)", () => {
    expect(MIGRATION).toMatch(/REVOKE ALL ON FUNCTION public\.start_underfilled_crews\(\) FROM PUBLIC, anon, authenticated;/);
    expect(MIGRATION).toMatch(/GRANT EXECUTE ON FUNCTION public\.start_underfilled_crews\(\) TO service_role;/);
    expect(MIGRATION, "runs every 5 minutes, not only from the hourly sweep").toMatch(/cron\.schedule\('start-underfilled-crews', '2-59\/5 \* \* \* \*'/);
  });
  it("auto-expire-jobs books crews BEFORE its cancel step and never cancels a crew with anyone hired", () => {
    const call = EXPIRE.indexOf('supabase.rpc("start_underfilled_crews")');
    const cancel = EXPIRE.indexOf('status: "cancelled"');
    expect(call, "start_underfilled_crews is called").toBeGreaterThan(0);
    expect(cancel).toBeGreaterThan(call);
    expect(EXPIRE).toMatch(/if \(job\.is_group_job === true\) \{[\s\S]{0,600}.from\("group_job_helpers"\)[\s\S]{0,700}if \(\(confirmed \?\? 0\) > 0\) \{[\s\S]{0,250}defects\.record\([\s\S]{0,250}continue;/);
  });
});
