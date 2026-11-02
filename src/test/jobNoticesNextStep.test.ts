/**
 * Audit 11-01 A3-36, A3-37, A3-38: the job notices the database sends end with the member's next step and its
 * deadline, and the deadline is the app's own rule, not a copy that can drift:
 *   - "<Helpr> marked the job complete" (poster): approve by helper_completed_at + APPROVAL_WINDOW_HOURS
 *     (supabase/functions/_shared/escrowTiming.ts; the job page's autoCompleteAt), in Louisiana time.
 *   - "<Helpr> is on the way" / "has arrived" (poster): say there is nothing for them to do.
 *   - "New application" (poster): pick a Helpr before the start or the listing's close, whichever is first
 *     (src/lib/listingDeadline.ts).
 *   - "Job funded" (Helpr): confirm by CONFIRM_DEADLINE_HOURS_BEFORE_START before the start
 *     (supabase/functions/_shared/confirmDeadline.ts), never "Get to work!".
 *
 * Reads the EFFECTIVE definition of each sender (newest CREATE plus later in-place rewrites, any dollar tag, comments
 * blanked). Can fail on the original bug: every definition before 20261102043115 lacks the "Next:" sentences.
 * Behaviour (real Postgres): src/test/pglite/jobNoticesNextStep.pglite.mjs (23 PASS; 15 FAIL with NEW_MIGRATION=skip;
 * 7 planted defects each red).
 *
 * @mutate supabase/migrations/20261102043115_job_notices_say_the_next_step.sql | (NEW.helper_completed_at + interval '24 hours') | (NEW.helper_completed_at + interval '48 hours')
 * @mutate supabase/migrations/20261102043115_job_notices_say_the_next_step.sql | '. Next: review them and approve by ' | '. Review them and confirm. '
 * @mutate supabase/migrations/20261102043115_job_notices_say_the_next_step.sql | '". Next: nothing for you to do until they arrive.' | '"'
 * @mutate supabase/migrations/20261102043115_job_notices_say_the_next_step.sql | '". Next: nothing for you to do; they mark it done when they finish.' | '"'
 * @mutate supabase/migrations/20261102043115_job_notices_say_the_next_step.sql | '". Next: review and pick a Helpr' | '"'
 * @mutate supabase/migrations/20261102043115_job_notices_say_the_next_step.sql | AND (job_expires IS NULL OR v_start < job_expires) | AND true
 * @mutate supabase/migrations/20261102084222_a3_stack_reconcile.sql | - interval '2 hours'; | - interval '12 hours';
 * @mutate supabase/migrations/20261102084222_a3_stack_reconcile.sql | THEN ' Next: confirm you''ll be there by ' | THEN ' Get to work! '
 */
import { describe, expect, it } from "vitest";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";
import { APPROVAL_WINDOW_HOURS } from "../../supabase/functions/_shared/escrowTiming";
import { CONFIRM_DEADLINE_HOURS_BEFORE_START } from "../../supabase/functions/_shared/confirmDeadline";

const defs = effectiveDefs("supabase/migrations");
const body = (fn: string): string => {
  const d = defs.get(fn);
  expect(d, `no live definition of public.${fn}`).toBeTruthy();
  return blankSqlComments(d!.stmt);
};
const flat = (s: string) => s.replace(/\s+/g, " ");

describe("job notices end with the next step and its deadline (A3-36..38)", () => {
  it("the inventory: three senders, all defined", () => {
    const fns = ["notify_poster_on_status_change", "notify_on_application", "notify_on_payment_escrowed"];
    expect(fns.filter((f) => defs.has(f)).length).toBeGreaterThan(2);
  });

  it("marked complete: approve by completion + the app's approval window, in Louisiana time", () => {
    const b = flat(body("notify_poster_on_status_change"));
    expect(b).toContain(
      `to_char((NEW.helper_completed_at + interval '${APPROVAL_WINDOW_HOURS} hours') AT TIME ZONE 'America/Chicago'`,
    );
    expect(b).toContain("'. Next: review them and approve by ' || v_approve_by || ', or Helpr support steps in.'");
    expect(b).toContain(`'". Next: check the work and approve by ' || v_approve_by || ', or Helpr support steps in.'`);
    expect(b).not.toMatch(/Please review and confirm|Review them and confirm/);
  });

  it("on the way and arrived say there is nothing for the poster to do", () => {
    const b = flat(body("notify_poster_on_status_change"));
    expect(b).toContain(`'". Next: nothing for you to do until they arrive.'`);
    expect(b).toContain(`'". Next: nothing for you to do; they mark it done when they finish.'`);
  });

  it("new application: pick by the start or the close, whichever is first", () => {
    const b = flat(body("notify_on_application"));
    expect(b).toContain(`'". Next: review and pick a Helpr' || COALESCE(v_pick_by, '') || '.'`);
    expect(b).toContain("v_start > now() AND (job_expires IS NULL OR v_start < job_expires)");
    expect(b).toContain("ELSIF job_expires IS NOT NULL AND job_expires > now() THEN");
  });

  it("job funded: confirm by the app's confirm deadline, never Get to work", () => {
    const b = flat(body("notify_on_payment_escrowed"));
    expect(b).toContain(`AT TIME ZONE 'America/Chicago') - interval '${CONFIRM_DEADLINE_HOURS_BEFORE_START} hours';`);
    expect(b).toContain("WHEN NEW.helper_confirmed_at IS NULL AND v_confirm_by > now() THEN ' Next: confirm you''ll be there by '");
    expect(b).not.toContain("Get to work");
  });
});
