/**
 * Q1690: a migration that schedules a cron against a NEW edge function got one
 * 404 alert on the cron's first run, because db-deploy schedules the cron
 * before functions-deploy uploads the function (functions-deploy waits for
 * db-deploy, functionsDeployWaitsForDbDeploy.test.ts). 20261012202854 makes
 * sweep_cron_http_failures remember each cron job's FIRST run and skip a 404
 * from within 30 minutes of it ONLY once a later 2xx of the same job proves the
 * function arrived; a candidate under 30 minutes old waits for the next run
 * (two runs remain in the 60-minute lookback to file it);
 * anything else is filed as before. Every job that existed at the migration is
 * backfilled with -infinity (no grace). Narrowed by the lh-silent-failure
 * review of 08d868cf8 (a function that never ships must still page within the
 * hour).
 *
 * Behaviour: src/test/pglite/cronFirstRunRacesItsFunction.pglite.mjs (ALL PASS
 * with the migration applied 3x; 5 FAIL on main). This guard pins, from the
 * NEWEST definition, that the grace stays narrow.
 *
 * @mutate supabase/migrations/20261012202854_cron_first_run_404_grace.sql |           (resp.status_code = 404\n |           (resp.status_code >= 400\n
 * @mutate supabase/migrations/20261012202854_cron_first_run_404_grace.sql |                            AND resp.created < f.first_seen + interval '30 minutes')) AS first_run_grace, |                            AND true) AS first_run_grace,
 * @mutate supabase/migrations/20261012202854_cron_first_run_404_grace.sql |                            AND resp.created >= f.first_seen - interval '20 minutes'\n |                            AND true\n
 * @mutate supabase/migrations/20261012202854_cron_first_run_404_grace.sql |         IF r.later_success THEN | IF true THEN
 * @mutate supabase/migrations/20261012202854_cron_first_run_404_grace.sql |         ELSIF r.created > now() - interval '30 minutes' THEN | ELSIF true THEN
 * @mutate supabase/migrations/20261012202854_cron_first_run_404_grace.sql |         ELSIF r.created > now() - interval '30 minutes' THEN | ELSIF r.created > now() - interval '45 minutes' THEN
 * @mutate supabase/migrations/20261012202854_cron_first_run_404_grace.sql |            LEAST(now(), (SELECT min(h.created_at) FROM public.cron_http_requests h WHERE h.jobname = j.jobname)) | now()
 * @mutate supabase/migrations/20261012202854_cron_first_run_404_grace.sql |     SELECT j.jobname, '-infinity'::timestamptz FROM cron.job j WHERE j.jobname IS NOT NULL | SELECT j.jobname, now() FROM cron.job j WHERE j.jobname IS NOT NULL
 * @mutate supabase/migrations/20261012202854_cron_first_run_404_grace.sql |                             'first_run_404_skipped', v_grace, |                             'first_run_404_skipped_x', v_grace,
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const MIG = join(__dirname, "..", "..", "supabase", "migrations");
const FIX = "20261012202854_cron_first_run_404_grace.sql";
const defs = effectiveDefs(MIG);
const body = () => blankSqlComments(defs.get("sweep_cron_http_failures")!.stmt).replace(/\s+/g, " ");

describe("a new cron's first-run 404 is not an alert (Q1690)", () => {
  it("reads the real definition (floor)", () => {
    expect(defs.size).toBeGreaterThan(400);
    expect(defs.get("sweep_cron_http_failures")?.file).toBeDefined();
  });

  it("the grace is a 404 within 30 minutes of the job first being seen, and nothing wider", () => {
    const b = body();
    // Anchored at the job's first tagged request (its first run).
    expect(b).toContain("LEAST(now(), (SELECT min(h.created_at) FROM public.cron_http_requests h WHERE h.jobname = j.jobname))");
    expect(b).toContain(
      "(resp.status_code = 404 AND EXISTS (SELECT 1 FROM public.cron_job_first_seen f WHERE f.jobname = tag.jobname AND resp.created >= f.first_seen - interval '20 minutes' AND resp.created < f.first_seen + interval '30 minutes')) AS first_run_grace",
    );
    // Skipped only once a later success proves the function arrived; young ones wait; the rest are filed.
    expect(b).toMatch(/AND ok\.created > resp\.created AND ok\.status_code BETWEEN 200 AND 299\) AS later_success/);
    expect(b).toMatch(/IF r\.first_run_grace THEN IF r\.later_success THEN v_grace := v_grace \+ 1;[^]*?CONTINUE; ELSIF r\.created > now\(\) - interval '30 minutes' THEN CONTINUE; END IF; END IF;/);
    expect(b).toContain("'first_run_404_skipped', v_grace,");
  });

  it("every job that existed at the migration gets no grace; clients cannot touch the table", () => {
    const sql = blankSqlComments(readFileSync(join(MIG, FIX), "utf8"));
    expect(sql).toMatch(/SELECT j\.jobname, '-infinity'::timestamptz FROM cron\.job j WHERE j\.jobname IS NOT NULL/);
    expect(sql).toMatch(/REVOKE ALL ON public\.cron_job_first_seen FROM PUBLIC, anon, authenticated;/);
    expect(sql).toMatch(/ALTER TABLE public\.cron_job_first_seen ENABLE ROW LEVEL SECURITY;/);
  });
});
