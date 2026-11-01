/**
 * OWNER (10-31, job 7b1da54b "Mow and Weed Eat"): the poster confirmed at 10:31 AM; at 7:08 PM the Helpr's day-of
 * confirm sent her "Helpr confirmed the job! ... Tap to confirm your side too." by email and in-app. "I've already
 * done this why am I getting this email." When the OTHER side has already confirmed, job_confirmed says only
 * "You're both confirmed for <job> on <date>." with no ask. Both directions.
 *
 * @mutate supabase/functions/_shared/notification-templates.ts |       if (byPoster ? f.job.helper_dayof_confirmed_at : f.job.poster_confirmed_at) { |       if (false) {
 */
import { describe, it, expect } from "vitest";
import { NOTIFICATION_TEMPLATES, type TemplateFacts } from "../../supabase/functions/_shared/notification-templates";

const job = (o: Partial<TemplateFacts["job"]>): TemplateFacts["job"] => ({
  id: "7b1da54b-0000-4000-8000-000000000000",
  title: "Mow and Weed Eat",
  customer_id: "poster",
  helper_id: "helpr",
  response_deadline: null,
  dispute_status: null,
  // A fixed day: the copy below names it ("Sun, Nov 7"). jobLocalDateISO(1) made this a one-day test (red from 2026-11-01); a literal past five years out never flips.
  date_needed: "2032-11-07",
  ...o,
});
const build = (senderRole: "poster" | "helper", j: Partial<TemplateFacts["job"]>) =>
  NOTIFICATION_TEMPLATES.job_confirmed.build({ job: job(j), senderRole } as TemplateFacts);

const T1 = "2026-10-31T15:31:00Z";
const T2 = "2026-11-01T00:08:00Z";

describe("job_confirmed never asks a side that already confirmed", () => {
  it("Helpr confirms after the poster: the poster is told they're both confirmed, with no ask", () => {
    const n = build("helper", { poster_confirmed_at: T1, helper_dayof_confirmed_at: T2 })!;
    expect(n.message).toBe('You\'re both confirmed for "Mow and Weed Eat" on Sun, Nov 7.');
    expect(n.title).toBe("You're both confirmed");
    expect(`${n.title} ${n.message}`).not.toMatch(/confirm your side|tap to confirm/i);
  });

  it("poster confirms after the Helpr: the Helpr is told the same", () => {
    const n = build("poster", { poster_confirmed_at: T2, helper_dayof_confirmed_at: T1 })!;
    expect(n.message).toMatch(/^You're both confirmed for "Mow and Weed Eat" on Sun, Nov 7\.$/);
    expect(n.link).toBe("/jobs?job=7b1da54b-0000-4000-8000-000000000000");
  });

  it("only the sender has confirmed: the other side is still asked", () => {
    expect(build("helper", { poster_confirmed_at: null, helper_dayof_confirmed_at: T2 })!.message).toMatch(/Tap to confirm your side too\./);
    expect(build("poster", { poster_confirmed_at: T2, helper_dayof_confirmed_at: null })!.message).toMatch(/Tap to confirm your side too\./);
  });

  it("no date: the both-confirmed line leaves the day out", () => {
    expect(build("helper", { poster_confirmed_at: T1, helper_dayof_confirmed_at: T2, date_needed: null })!.message).toBe('You\'re both confirmed for "Mow and Weed Eat".');
  });

  it("the sender's own stamp missing still sends nothing", () => {
    expect(build("helper", { poster_confirmed_at: T1, helper_dayof_confirmed_at: null })).toBeNull();
  });
});
