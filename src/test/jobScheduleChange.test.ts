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
 * @mutate supabase/migrations/20261005064336_schedule_clash_declines_with_notice.sql |   IF v_uid IS DISTINCT FROM v_req.responder_id\n     OR v_uid IS DISTINCT FROM (CASE WHEN v_req.requested_by = v_job.customer_id THEN v_job.helper_id ELSE v_job.customer_id END) THEN |   IF v_uid IS NULL THEN
 * @mutate supabase/migrations/20261005064336_schedule_clash_declines_with_notice.sql |   IF now() >= v_req.expires_at\n     OR v_job.status::text <> 'accepted' |   IF v_job.status::text <> 'accepted'
 * @mutate supabase/migrations/20261002060514_schedule_change_refuses_helpr_clash.sql |     (v_job.id, v_uid, v_other, v_job.date_needed, v_job.start_time, p_date, p_start_time, v_starts_at) |     (v_job.id, v_uid, v_other, v_job.date_needed, v_job.start_time, p_date, p_start_time, v_starts_at + interval '30 days')
 * @mutate supabase/migrations/20260927012807_job_schedule_change_requests.sql |   ON public.job_schedule_change_requests (job_id) WHERE status = 'pending'; |   ON public.job_schedule_change_requests (job_id, id) WHERE status = 'pending';
 * @mutate supabase/migrations/20261002060514_schedule_change_refuses_helpr_clash.sql |     RAISE EXCEPTION 'schedule_change_clash'; |     NULL;
 * @mutate supabase/migrations/20261002060514_schedule_change_refuses_helpr_clash.sql |        AND (o.helper_id = v_job.helper_id\n |        AND (false\n
 * @mutate supabase/migrations/20261005064336_schedule_clash_declines_with_notice.sql | IF FOUND THEN\n        UPDATE public.job_schedule_change_requests SET status = 'declined' | IF false THEN\n        UPDATE public.job_schedule_change_requests SET status = 'declined'
 * Q1262(2): the clash declines the request and tells the asker.
 * @mutate supabase/migrations/20261005064336_schedule_clash_declines_with_notice.sql |         UPDATE public.job_schedule_change_requests SET status = 'declined', decided_at = now() WHERE id = v_req.id;\n        INSERT INTO public.notifications | UPDATE public.job_schedule_change_requests SET status = 'pending' WHERE false;\n        INSERT INTO public.notifications
 * @mutate supabase/migrations/20261005064336_schedule_clash_declines_with_notice.sql |           'New date or time not possible', |           NULL,
 * @mutate supabase/migrations/20261005064336_schedule_clash_declines_with_notice.sql | FOR SHARE OF o; | ;
 * @mutate supabase/migrations/20261005064336_schedule_clash_declines_with_notice.sql | AND (o.helper_id = v_job.helper_id | AND (false
 * @mutate supabase/migrations/20261004192041_helper_only_clears_response_deadline.sql |          AND current_setting('app.schedule_change_rpc', true) = '1' THEN |          AND true THEN
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankSqlComments } from "./helpers/blankNonCode";
import { readdirSync } from "./helpers/trackedFiles";

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

  it("Q736: a proposed start overlapping another booking the Helpr holds is refused", () => {
    const at = request.indexOf("RAISE EXCEPTION 'schedule_change_clash'");
    expect(at).toBeGreaterThan(0);
    // The check runs before the request row is written.
    expect(at).toBeLessThan(request.indexOf("INSERT INTO public.job_schedule_change_requests"));
    const check = request.slice(request.lastIndexOf("IF p_start_time IS NOT NULL AND EXISTS", at), at);
    expect(check).toMatch(/o\.helper_id = v_job\.helper_id/);
    expect(check).toMatch(/g\.helper_id = v_job\.helper_id/);
    expect(check).toMatch(/OVERLAPS/);
  });

  it("Q925: accepting re-checks the clash, under the job lock, before the job moves", () => {
    const lock = respond.indexOf("FOR UPDATE;");
    // Q1262(2): the clash now DECLINES (see the next test); its anchor is the reply.
    const at = respond.indexOf("'reason', 'schedule_change_clash'");
    expect(lock).toBeGreaterThan(0);
    expect(at).toBeGreaterThan(lock);
    // Inside the accept branch, ahead of the write that moves the job.
    expect(respond.lastIndexOf("IF p_accept THEN", at)).toBeGreaterThan(lock);
    expect(at).toBeLessThan(respond.indexOf("set_config('app.schedule_change_rpc', '1', true)"));
    const check = respond.slice(respond.lastIndexOf("PERFORM 1", at), at);
    expect(check).toMatch(/o\.helper_id = v_job\.helper_id/);
    expect(check).toMatch(/g\.helper_id = v_job\.helper_id/);
    expect(check).toMatch(/OVERLAPS/);
    expect(check).toMatch(/FOR SHARE OF o/);
    expect(respond).toMatch(/j\.estimated_hours\s+INTO v_job/);
  });

  it("Q1262(2): a clash at accept declines the request and tells whoever asked (never leaves it pending, unannounced)", () => {
    expect(respond).toMatch(
      /IF FOUND THEN\s+UPDATE public\.job_schedule_change_requests SET status = 'declined', decided_at = now\(\) WHERE id = v_req\.id;\s+INSERT INTO public\.notifications \(user_id, job_id, title, message, type, link\)\s+VALUES \(\s+v_req\.requested_by, v_job\.id,\s+'New date or time not possible',[\s\S]*?RETURN jsonb_build_object\('status', 'declined', 'reason', 'schedule_change_clash'\);\s+END IF;/,
    );
    expect(respond).not.toMatch(/RAISE EXCEPTION 'schedule_change_clash'/);
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
    expect(probe).toContain("20260927012807_job_schedule_change_requests.sql");
    expect(probe).toContain("OLD STATE RED");
    expect(probe).toContain("Q925 OLD STATE");
    expect(probe).toContain("20261004004707_schedule_change_accept_rechecks_clash.sql");
  });
});
