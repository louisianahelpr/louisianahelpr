/**
 * Q417 (b), closed by lead decision 2026-10-15: void-cancelled-payments prices
 * a cancelled job's fee from its LIVE date_needed / start_time
 * (computeCancellationFee), so those columns must never move once the job is
 * cancelled. Measured live 2026-10-15 (pg_get_functiondef): the only two doors
 * that could move them are shut, and this guard keeps them shut:
 *   1. the client lock: enforce_series_columns_client_lock refuses a client
 *      write of date_needed / start_time on a cancelled job (schedule_locked,
 *      20260927012805, restated verbatim since);
 *   2. the change-request door: respond_job_schedule_change (a definer RPC that
 *      passes the lock) applies a new date only while the job is 'accepted';
 *      any other status expires the request with nothing changed.
 * What is left is a service-role or admin direct write, which no app path
 * makes. A snapshot of the priced inputs was judged not worth building.
 *
 * Both checks read the NEWEST definition (effectiveDefs), so a restatement
 * that drops either refusal fails here.
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

// Shown able to fail: each line alone reds this test.
// @mutate supabase/migrations/20260927012806_recurring_split_days.sql |           OR OLD.status::text = 'cancelled'\n |
// @mutate supabase/migrations/20261008183640_schedule_change_lead_time_and_expiry_notice.sql |      OR v_job.status::text <> 'accepted'\n     OR v_job.date_needed IS DISTINCT FROM v_req.old_date |      OR v_job.date_needed IS DISTINCT FROM v_req.old_date

const defs = effectiveDefs(join(process.cwd(), "supabase/migrations"));
const body = (fn: string) => blankSqlComments(defs.get(fn)?.stmt ?? "").replace(/\s+/g, " ");

describe("Q417 (b): a cancelled job's date and start time cannot move", () => {
  it("the client lock refuses date_needed / start_time on a cancelled job", () => {
    const lock = body("enforce_series_columns_client_lock");
    expect(lock.length).toBeGreaterThan(2000);
    const block = lock.match(
      /IF \(NEW\.date_needed IS DISTINCT FROM OLD\.date_needed OR NEW\.start_time IS DISTINCT FROM OLD\.start_time\) AND \(([^;]*?)\) THEN RAISE EXCEPTION 'schedule_locked/,
    );
    expect(block, "the schedule_locked block is gone from the newest lock").not.toBeNull();
    expect(block![1]).toContain("OLD.status::text = 'cancelled'");
  });

  it("respond_job_schedule_change expires a request unless the job is still accepted, before it writes the job", () => {
    const respond = body("respond_job_schedule_change");
    expect(respond.length).toBeGreaterThan(2000);
    const expire = respond.search(/IF now\(\) >= v_req\.expires_at OR v_job\.status::text <> 'accepted'[^;]*THEN UPDATE public\.job_schedule_change_requests SET status = 'expired'/);
    expect(expire, "the accepted-only expiry is gone").toBeGreaterThan(0);
    // Every write to the job's row comes after that refusal.
    const jobWrites = [...respond.matchAll(/UPDATE public\.jobs\b/g)].map((m) => m.index!);
    expect(jobWrites.length).toBeGreaterThan(0);
    for (const at of jobWrites) expect(at).toBeGreaterThan(expire);
  });
});
