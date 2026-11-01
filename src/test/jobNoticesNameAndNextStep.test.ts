/**
 * Audit 11-01 JA-57 / JA-58 / JA-60, and the owner's 11-01 rule: "people aren't told what to do next. In every
 * Jobs notice ... end with the next step and its deadline ... and link to the page where that step is done."
 *
 * Every job template create-notification builds (push, email and the in-app bell all carry these words):
 *  - names the sender by first name, never "The person who posted this job" / "The Helpr" (JA-57);
 *  - says "Next:" (the owner's next-step rule);
 *  - opens the job page /jobs/<id>, not a list (JA-58), except the decline, whose next step is Find work,
 *    and the no-show warning, whose page is the warnings tab.
 * The offer says WHEN to answer by (a clock time, not "within N hours"), and "Issue resolved" carries no symbol
 * and says whose pay (JA-60).
 *
 * @mutate supabase/functions/_shared/notification-templates.ts |       message: `${who} confirmed "${jobTitle(f)}". Next: confirm your side | message: `The person who posted this job confirmed "${jobTitle(f)}". Next: confirm your side
 * @mutate supabase/functions/_shared/notification-templates.ts |         message: `${who} picked you for "${jobTitle(f)}". Next: accept ${by ? `by ${by}` : "soon"}, or the offer expires.`, |         message: `You've been selected for "${jobTitle(f)}". Respond soon or the offer expires.`,
 * @mutate supabase/functions/_shared/notification-templates.ts |   return `/jobs/${f.job.id}`; |   return `/jobs?job=${f.job.id}`;
 * @mutate supabase/functions/_shared/notification-templates.ts |       title: "Issue resolved", |       title: "Dispute resolved ✓",
 * @mutate supabase/functions/_shared/notification-templates.ts |       message: `${sender(f, "The poster")} confirmed you've arrived for "${jobTitle(f)}". Next: start the work, and mark it done when you finish.`, |       message: `${sender(f, "The poster")} confirmed you've arrived for "${jobTitle(f)}".`,
 */
import { describe, it, expect } from "vitest";
import { NOTIFICATION_TEMPLATES, noticeWhen, type TemplateFacts } from "../../supabase/functions/_shared/notification-templates";

const JOB = "11111111-2222-3333-4444-555555555555";
const SENDER = "aaaaaaaa-0000-0000-0000-000000000001";
const NOW = new Date("2026-11-01T15:00:00Z");

/** Facts under which every template's own state check passes. */
function facts(name: string): TemplateFacts {
  const poster = ["dispute_resolved", "revision_requested", "arrival_confirmed", "work_confirmed", "job_offer", "application_declined", "no_show_reported"].includes(name);
  return {
    job: {
      id: JOB, title: "Move a couch", customer_id: poster ? SENDER : "c", helper_id: poster ? "h" : SENDER,
      response_deadline: "2026-11-07T15:00:00Z", dispute_status: "open", status: "in_progress",
      dispute_helper_response: "I did it", poster_confirmed_at: poster ? NOW.toISOString() : null,
      helper_dayof_confirmed_at: poster ? null : NOW.toISOString(), date_needed: "2026-11-07",
      poster_confirmed_arrival_at: NOW.toISOString(), poster_confirmed_working_at: NOW.toISOString(), payment_status: "released",
    },
    senderRole: poster ? "poster" : "helper",
    senderId: SENDER,
    revisionDescription: "Wipe the floor", revisionStatus: "accepted", revisionRequestedBy: "c",
    dispute: { status: "withdrawn", opener_id: SENDER },
    trackingStatus: "working",
    application: { status: name === "application_declined" ? "rejected" : "accepted", decline_reason: null },
    posterFirstName: "Dana", senderFirstName: "Dana",
    noShowAction: "warning",
    now: NOW,
  };
}

const JOB_NOTICES = Object.keys(NOTIFICATION_TEMPLATES).filter((k) => k !== "no_show_reported");

describe("job notices name people, say what's next, and open the job (JA-57/58/60)", () => {
  it("covers every job template", () => {
    expect(JOB_NOTICES.length).toBeGreaterThan(10);
  });

  for (const name of JOB_NOTICES) {
    it(name, () => {
      const out = NOTIFICATION_TEMPLATES[name].build(facts(name));
      expect(out, `${name} built nothing under its own state`).not.toBeNull();
      const words = `${out!.title} ${out!.message}`;
      expect(words).not.toMatch(/person who posted this job|\bThe Helpr\b/);
      expect(words, name).toContain("Dana");
      expect(out!.message, name).toMatch(/Next: /);
      if (name !== "application_declined") expect(out!.link).toBe(`/jobs/${JOB}`);
      expect(out!.title).not.toMatch(/✓|✔|⛔|⚠|!/u);
    });
  }

  it("the offer says the time to answer by, in Louisiana time", () => {
    const out = NOTIFICATION_TEMPLATES.job_offer.build(facts("job_offer"))!;
    expect(noticeWhen("2026-11-07T15:00:00Z")).toBe("Sat 9 AM");
    expect(out.message).toContain("Next: accept by Sat 9 AM");
  });

  it("issue resolved says whose pay, with no symbol", () => {
    const out = NOTIFICATION_TEMPLATES.dispute_resolved.build(facts("dispute_resolved"))!;
    expect(out.title).toBe("Issue resolved");
    expect(out.message).toContain("your pay is on its way");
  });

  it("a blank sender name falls back to the side, never the long phrase", () => {
    const f = { ...facts("arrival_confirmed"), senderFirstName: null };
    expect(NOTIFICATION_TEMPLATES.arrival_confirmed.build(f)!.message).toMatch(/^The poster confirmed/);
  });
});
