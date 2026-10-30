/**
 * UX-3 (owner 2026-10-29, audit page; Q2484): applicants are told kindly when a job fills, with
 * similar jobs, and a poster whose applicants waited 24 hours is nudged once.
 *
 * Reads the definitions the migrations leave in the database (effectiveDefs, newest after any
 * rewrite, any dollar tag, comments blanked):
 *  - complete_job_accept still closes the other pending applications with no closed_reason, which is
 *    what the filled branch keys on (if it started stamping a reason, the kind notice would go silent);
 *  - notify_on_application has the filled branch: no closed_reason, the job has a Helpr who is not
 *    this applicant, no decline note; title 'This job was filled', the kind words, and the Browse
 *    link filtered by the job's category group;
 *  - sweep_unanswered_applications: 24 h floor and 72 h ceiling on the oldest pending application,
 *    daytime only, once per job (claim before send), skips a job with a Helpr or a pending direct
 *    offer, and is service_role only; the cron runs it hourly.
 * Behaviour, every edge on a fixed clock, red with LH_PROOF_REVERT=1 (9 FAILED):
 *   node src/test/pglite/applicantNudgesAndFilledNotice.pglite.mjs   (26 PASS)
 *
 * @mutate supabase/migrations/20261030150630_applicant_nudges_and_filled_notice.sql |     ELSIF NEW.closed_reason IS NULL AND job_helper IS NOT NULL AND NEW.helper_id IS DISTINCT FROM job_helper |     ELSIF false AND NEW.closed_reason IS NULL AND job_helper IS NOT NULL AND NEW.helper_id IS DISTINCT FROM job_helper
 * @mutate supabase/migrations/20261030150630_applicant_nudges_and_filled_notice.sql |       v_link := '/jobs?tab=browse' \|\| CASE |       v_link := '/jobs?job=' \|\| NEW.job_id::text \|\| CASE
 * @mutate supabase/migrations/20261030150630_applicant_nudges_and_filled_notice.sql |       HAVING min(a.created_at) <= v_now - interval '24 hours' |       HAVING min(a.created_at) <= v_now - interval '1 hours'
 * @mutate supabase/migrations/20261030150630_applicant_nudges_and_filled_notice.sql |          AND min(a.created_at) > v_now - interval '72 hours' |          AND true
 * @mutate supabase/migrations/20261030150630_applicant_nudges_and_filled_notice.sql |   IF v_hour < 8 OR v_hour >= 20 THEN |   IF false THEN
 * @mutate supabase/migrations/20261030150630_applicant_nudges_and_filled_notice.sql |       ON CONFLICT (job_id) DO NOTHING\n      RETURNING job_id | \n      RETURNING job_id
 * @mutate supabase/migrations/20261030150630_applicant_nudges_and_filled_notice.sql |          AND NOT public.is_test_member(j.customer_id) |          AND true
 * @mutate supabase/migrations/20261030150630_applicant_nudges_and_filled_notice.sql |          AND NOT COALESCE(j.is_seed, false) |          AND true
 * @mutate supabase/migrations/20261030150630_applicant_nudges_and_filled_notice.sql |          AND NOT (j.offered_to_helper_id IS NOT NULL AND j.direct_offer_status = 'pending') |          AND true
 * @mutate supabase/migrations/20261030150630_applicant_nudges_and_filled_notice.sql | REVOKE ALL ON FUNCTION public.sweep_unanswered_applications(timestamptz) FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.sweep_unanswered_applications(timestamptz) FROM PUBLIC;
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const MIG = join(process.cwd(), "supabase", "migrations");
const defs = effectiveDefs(MIG);
const body = (fn: string): string => {
  const d = defs.get(fn);
  if (!d) throw new Error(`no definition of public.${fn} in supabase/migrations`);
  return blankSqlComments(d.stmt).replace(/\s+/g, " ");
};
/** Every migration's SQL, comments blanked, oldest first. */
const all = migrationFiles(MIG).map((f) => ({ f, sql: blankSqlComments(readFileSync(join(MIG, f), "utf8")) }));

describe("UX-3: the filled notice", () => {
  it("reads real definitions (floor)", () => {
    expect(defs.size).toBeGreaterThan(500);
  });

  it("complete_job_accept still closes the other pending applications with no closed_reason", () => {
    const b = body("complete_job_accept");
    const close = b.match(/UPDATE public\.applications SET ([^;]*?) WHERE job_id = p_job_id AND helper_id IS DISTINCT FROM v_job\.helper_id AND status = 'pending'/);
    expect(close, "complete_job_accept's close of the other applicants").not.toBeNull();
    expect(close![1]).toContain("status = 'rejected'");
    expect(close![1]).not.toContain("closed_reason");
  });

  it("notify_on_application tells the other applicants kindly, with similar open jobs", () => {
    const b = body("notify_on_application");
    expect(b).toMatch(/ELSIF NEW\.closed_reason IS NULL AND job_helper IS NOT NULL AND NEW\.helper_id IS DISTINCT FROM job_helper AND \(NEW\.decline_reason IS NULL OR btrim\(NEW\.decline_reason\) = ''\) THEN/);
    const branch = b.slice(b.indexOf("ELSIF NEW.closed_reason IS NULL AND job_helper IS NOT NULL"));
    expect(branch).toMatch(/^[\s\S]*?v_title := 'This job was filled';/);
    expect(branch).toMatch(/^[\s\S]*?'Thanks for applying to "' \|\| COALESCE\(job_title, 'this job'\) \|\| '"\. The poster picked someone else this time\. Tap to see similar open jobs\.'/);
    expect(branch).toMatch(/^[\s\S]*?v_link := '\/jobs\?tab=browse' \|\| CASE WHEN job_cat IS NOT NULL THEN '&cat=' \|\| job_cat ELSE '' END;/);
    // The group is the Browse chip id (src/lib/jobCategoryGroups.ts), so ?cat= filters the feed.
    expect(b).toContain("COALESCE(public.job_category_group(category), category::text)");
  });
});

describe("UX-3: the 24-hour nudge", () => {
  const b = body("sweep_unanswered_applications");

  it("is due between 24 and 72 hours after the oldest pending application, daytime only", () => {
    expect(b).toContain("HAVING min(a.created_at) <= v_now - interval '24 hours' AND min(a.created_at) > v_now - interval '72 hours'");
    expect(b).toContain("IF v_hour < 8 OR v_hour >= 20 THEN RETURN 0;");
    expect(b).toContain("AT TIME ZONE 'America/Chicago'");
  });

  it("only for an open job with no Helpr and no pending direct offer, once per job", () => {
    expect(b).toContain("j.status = 'open' AND j.helper_id IS NULL AND j.customer_id IS NOT NULL");
    expect(b).toContain("AND NOT (j.offered_to_helper_id IS NOT NULL AND j.direct_offer_status = 'pending')");
    expect(b).toContain("AND NOT EXISTS (SELECT 1 FROM public.application_nudge_sends s WHERE s.job_id = j.id)");
    // Test stuff never sends notices (owner rule): no seed job, no test poster.
    expect(b).toContain("AND NOT COALESCE(j.is_seed, false) AND NOT public.is_test_member(j.customer_id)");
    // Claimed before anything is sent: only the rows the INSERT returned are sent.
    expect(b).toMatch(/INSERT INTO public\.application_nudge_sends \(job_id, user_id, sent_at\) SELECT [^;]*? ON CONFLICT \(job_id\) DO NOTHING RETURNING job_id \) SELECT due\.\* FROM due JOIN claimed USING \(job_id\)/);
  });

  it("is service_role only, and the cron runs it hourly", () => {
    const grants = all.filter((m) => m.sql.includes("sweep_unanswered_applications(timestamptz)"));
    expect(grants.length).toBeGreaterThan(0);
    const newest = grants[grants.length - 1].sql;
    expect(newest).toContain("REVOKE ALL ON FUNCTION public.sweep_unanswered_applications(timestamptz) FROM PUBLIC, anon, authenticated;");
    expect(newest).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.sweep_unanswered_applications\(timestamptz\) TO [^;]*\b(anon|authenticated|PUBLIC)\b/);
    const cron = all.filter((m) => m.sql.includes("'unanswered-applications-nudge'"));
    expect(cron[cron.length - 1].sql).toMatch(/cron\.schedule\('unanswered-applications-nudge', '53 \* \* \* \*',\s*\$c\$SELECT public\.cron_record_work\('unanswered-applications-nudge', to_jsonb\(public\.sweep_unanswered_applications\(\)\)\);\$c\$\)/);
  });
});
