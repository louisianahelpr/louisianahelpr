/**
 * F443 (whole-app audit 11-10, Worker 5, Medium; job-name half): the bell row for a job's status line in a chat
 * ("▶ Work started") and the "Unread message" reminder named no job. Migration 20261111194802: a system row's bell
 * message ends ': "<job>"'; the reminder says 'waiting on your reply about "<job>"'.
 *
 * Reads the EFFECTIVE definitions (newest CREATE, any dollar tag, comments blanked). Behaviour (real Postgres):
 * src/test/pglite/threadNoticesNameTheJob.pglite.mjs (9 PASS; 5 FAIL with NEW_MIGRATION=skip).
 *
 * @mutate supabase/migrations/20261111194802_thread_notices_name_the_job.sql |       preview := preview \|\| ': "' \|\| v_job_title \|\| '"'; |       preview := preview;
 * @mutate supabase/migrations/20261111194802_thread_notices_name_the_job.sql |   IF COALESCE(NEW.is_system, false) AND NEW.job_id IS NOT NULL THEN | IF false THEN
 * @mutate supabase/migrations/20261111194802_thread_notices_name_the_job.sql |         \|\| COALESCE(' about "' \|\| v_job_title \|\| '"', '') \|\| '. Next: open the message and reply.', |         \|\| '. Next: open the message and reply.',
 */
import { describe, expect, it } from "vitest";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const defs = effectiveDefs("supabase/migrations");
const body = (fn: string) => {
  const s = blankSqlComments(defs.get(fn)?.stmt ?? "").replace(/\s+/g, " ");
  expect(s.length, fn).toBeGreaterThan(1500);
  return s;
};

describe("thread notices name the job (F443)", () => {
  it("a job's status row names the job in the bell; a member's words do not change", () => {
    const b = body("notify_message_recipient");
    expect(b).toContain("IF COALESCE(NEW.is_system, false) AND NEW.job_id IS NOT NULL THEN SELECT NULLIF(btrim(j.title), '') INTO v_job_title FROM public.jobs j WHERE j.id = NEW.job_id;");
    expect(b).toContain(`preview := preview || ': "' || v_job_title || '"';`);
  });

  it("the unread-message reminder says which job", () => {
    const b = body("sweep_unread_message_reminders");
    expect(b).toContain("SELECT NULLIF(btrim(j.title), '') INTO v_job_title FROM public.jobs j WHERE j.id = r.job_id;");
    expect(b).toContain(`|| COALESCE(' about "' || v_job_title || '"', '') || '. Next: open the message and reply.'`);
    expect(b).not.toContain("' is waiting on your reply.'");
  });
});
