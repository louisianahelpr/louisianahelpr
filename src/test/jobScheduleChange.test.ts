/**
 * Q407 (8), owner 2026-09-25: a booked one-time job's date or start time
 * changes only as a REQUEST the other party accepts. Three guards the owner
 * named: only the counterparty can accept; a request expires at the original
 * start; a direct client write is refused.
 *
 * Executable proof: src/test/pglite/jobScheduleChange.pglite.mjs (real jobs
 * trigger chain, OLD STATE RED, chain 3x). This file pins the shape of the
 * NEWEST definitions so a later migration cannot drop a clause silently.
 *
 * @mutate supabase/migrations/20260925165200_job_schedule_change_requests.sql |   IF v_uid IS DISTINCT FROM v_req.responder_id\n     OR v_uid IS DISTINCT FROM (CASE WHEN v_req.requested_by = v_job.customer_id THEN v_job.helper_id ELSE v_job.customer_id END) THEN |   IF v_uid IS NULL THEN
 * @mutate supabase/migrations/20260925165200_job_schedule_change_requests.sql |   IF now() >= v_req.expires_at\n     OR v_job.status::text <> 'accepted' |   IF v_job.status::text <> 'accepted'
 * @mutate supabase/migrations/20260925165200_job_schedule_change_requests.sql |     (v_job.id, v_uid, v_other, v_job.date_needed, v_job.start_time, p_date, p_start_time, v_starts_at) |     (v_job.id, v_uid, v_other, v_job.date_needed, v_job.start_time, p_date, p_start_time, v_starts_at + interval '30 days')
 * @mutate supabase/migrations/20260925165200_job_schedule_change_requests.sql |   ON public.job_schedule_change_requests (job_id) WHERE status = 'pending'; |   ON public.job_schedule_change_requests (job_id, id) WHERE status = 'pending';
 * @mutate supabase/migrations/20260925165200_job_schedule_change_requests.sql |          AND current_setting('app.schedule_change_rpc', true) = '1' THEN |          AND true THEN
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankSqlComments } from "./helpers/blankNonCode";

const dir = "supabase/migrations";
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const allSql = files.map((f) => blankSqlComments(readFileSync(`${dir}/${f}`, "utf8"))).join("\n");

function newestFunction(name: string): string {
  const header = `CREATE OR REPLACE FUNCTION public.${name}(`;
  for (let i = files.length - 1; i >= 0; i--) {
    const sql = blankSqlComments(readFileSync(`${dir}/${files[i]}`, "utf8"));
    const at = sql.lastIndexOf(header);
    if (at < 0) continue;
    const tag = /AS\s+(\$[A-Za-z_]*\$)/.exec(sql.slice(at))?.[1];
    if (!tag) throw new Error(`${name}: no dollar-quote tag`);
    const open = sql.indexOf(tag, at);
    return sql.slice(at, sql.indexOf(tag, open + tag.length) + tag.length);
  }
  return "";
}

describe("a booked one-time job's date/time changes only by an accepted request (Q407 8)", () => {
  const request = newestFunction("request_job_schedule_change");
  const respond = newestFunction("respond_job_schedule_change");

  it("inventory: both RPCs exist, SECURITY DEFINER, and anon cannot run them", () => {
    expect(request).toMatch(/SECURITY DEFINER/);
    expect(respond).toMatch(/SECURITY DEFINER/);
    expect(allSql).toContain("REVOKE ALL ON FUNCTION public.request_job_schedule_change(uuid, date, time) FROM PUBLIC, anon;");
    expect(allSql).toContain("REVOKE ALL ON FUNCTION public.respond_job_schedule_change(uuid, boolean) FROM PUBLIC, anon;");
  });

  it("only the party the request is addressed to, still on the job, can answer", () => {
    expect(respond).toMatch(
      /IF v_uid IS DISTINCT FROM v_req\.responder_id\s+OR v_uid IS DISTINCT FROM \(CASE WHEN v_req\.requested_by = v_job\.customer_id THEN v_job\.helper_id ELSE v_job\.customer_id END\) THEN\s+RAISE EXCEPTION 'not_authorized'/,
    );
    // Either side may ASK; the responder is always the other one.
    expect(request).toMatch(/v_other := CASE WHEN v_uid = v_job\.customer_id THEN v_job\.helper_id ELSE v_job\.customer_id END;/);
  });

  it("a request expires at the job's ORIGINAL start, and an expired one cannot be accepted", () => {
    expect(request).toMatch(/v_starts_at := \(v_job\.date_needed \+ COALESCE\(v_job\.start_time, '00:00'::time\)\) AT TIME ZONE 'America\/Chicago';/);
    expect(request).toMatch(/\(v_job\.id, v_uid, v_other, v_job\.date_needed, v_job\.start_time, p_date, p_start_time, v_starts_at\)/);
    expect(respond).toMatch(/IF now\(\) >= v_req\.expires_at\s+OR v_job\.status::text <> 'accepted'/);
  });

  it("one pending request per job", () => {
    expect(allSql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS job_schedule_change_one_pending\s+ON public\.job_schedule_change_requests \(job_id\) WHERE status = 'pending';/);
  });

  it("the direct client write stays refused, and only the accept RPC's flag lets a Helpr's row change", () => {
    const lock = newestFunction("enforce_series_columns_client_lock");
    expect(lock).toMatch(/RAISE EXCEPTION 'schedule_locked/);
    const wl = newestFunction("enforce_helper_jobs_column_whitelist");
    expect(wl).toMatch(/IF changed_col IN \('date_needed', 'start_time'[\s\S]*?AND current_setting\('app\.schedule_change_rpc', true\) = '1' THEN\s+CONTINUE;/);
    const on = respond.indexOf("set_config('app.schedule_change_rpc', '1', true)");
    expect(on).toBeGreaterThan(respond.indexOf("RAISE EXCEPTION 'not_authorized'"));
    expect(respond.indexOf("set_config('app.schedule_change_rpc', '0', true)")).toBeGreaterThan(on);
  });

  it("the executable PGlite proof exists", () => {
    const probe = readFileSync("src/test/pglite/jobScheduleChange.pglite.mjs", "utf8");
    expect(probe).toContain("20260925165200_job_schedule_change_requests.sql");
    expect(probe).toContain("OLD STATE RED");
  });
});
