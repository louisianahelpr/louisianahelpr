import { describe, it, expect } from "vitest";
import { shouldShowUnfundedNotice, unfundedNoticeCause } from "./UnfundedJobNotice";
import { type Job } from "../activityConstants";

/**
 * When the "not posted yet" warning appears.
 *
 * The bug it exists for: `str-ical-sync` creates a cleaning job at each guest
 * checkout with `payment_status = 'unpaid'`, and all three browse surfaces
 * require a funded status — so the row is invisible to every helper while the
 * host's own card, reading `public.jobs` directly, looks entirely normal. The
 * host sees "0 applicants" and concludes the app is quiet.
 *
 * Both directions matter and they fail differently. Not showing it leaves the
 * original silent trap intact. Showing it too eagerly puts "no Helpr can see
 * this" on a perfectly healthy job — which is worse, because it tells the
 * truth about a state the job is not in and undermines the warning everywhere
 * it IS correct.
 */
const job = (over: Partial<Job> = {}): Job =>
  ({
    id: "job-1",
    status: "open",
    payment_status: "unpaid",
    is_auto_created: true,
    ...over,
  }) as Job;

describe("shouldShowUnfundedNotice", () => {
  it("shows for an auto-created, unfunded, open job — the actual trap", () => {
    expect(shouldShowUnfundedNotice(job())).toBe(true);
  });

  it("stays off a hand-posted job that is briefly unpaid, mid-redirect", () => {
    // The normal post-a-job flow inserts the row and THEN redirects to Stripe,
    // so every hand-posted job is 'unpaid' for a moment. Flashing the warning
    // there would accuse the working path of being broken. In that window no
    // Checkout Session exists yet, which is what keeps it quiet.
    expect(shouldShowUnfundedNotice(job({ is_auto_created: false, stripe_session_id: null }))).toBe(false);
  });

  it("SHOWS on a hand-posted job whose checkout was abandoned", () => {
    // The gap this closes: before 2026-09-06 this returned false, so an
    // abandoned checkout left a ghost job in My Posts with no notice and no way
    // to finish paying. `stripe_session_id` is server-owned — the jobs INSERT
    // column lock forces it NULL — so its presence proves create-payment minted
    // a session and the poster reached Stripe.
    const ghost = job({ is_auto_created: false, stripe_session_id: "cs_test_abandoned" });
    expect(shouldShowUnfundedNotice(ghost)).toBe(true);
    expect(unfundedNoticeCause(ghost)).toBe("abandoned-checkout");
  });

  it("tells the two causes apart, so the copy can differ", () => {
    expect(unfundedNoticeCause(job())).toBe("calendar");
    expect(unfundedNoticeCause(job({ payment_status: "escrow" }))).toBeNull();
  });

  it("a calendar job needs no session id — the sync never opens checkout", () => {
    expect(unfundedNoticeCause(job({ stripe_session_id: null }))).toBe("calendar");
  });

  it("stays off when the column is absent rather than false", () => {
    // Defensive: a caller whose SELECT omits `is_auto_created` gets undefined,
    // and undefined must not read as "auto-created". The strict === true is
    // what makes that safe, so it is asserted rather than assumed.
    expect(shouldShowUnfundedNotice(job({ is_auto_created: undefined as unknown as boolean }))).toBe(false);
    expect(shouldShowUnfundedNotice(job({ is_auto_created: null as unknown as boolean }))).toBe(false);
  });

  it.each(["escrow", "payout_pending", "released"])(
    "stays off once the job is funded (%s) — it is genuinely visible then",
    (status) => {
      expect(shouldShowUnfundedNotice(job({ payment_status: status }))).toBe(false);
    },
  );

  it.each(["cancelled", "completed", "accepted", "in_progress", "disputed"])(
    "stays off a job that is no longer open (%s) — no CTA to offer",
    (status) => {
      expect(shouldShowUnfundedNotice(job({ status: status as Job["status"] }))).toBe(false);
    },
  );

  it("needs ALL THREE conditions, not any of them", () => {
    // Guards against the predicate degrading into an OR, which would put the
    // warning on most of the poster's feed.
    expect(shouldShowUnfundedNotice(job({ is_auto_created: false, payment_status: "escrow" }))).toBe(false);
    expect(shouldShowUnfundedNotice(job({ payment_status: "escrow", status: "completed" }))).toBe(false);
    expect(shouldShowUnfundedNotice(job({ is_auto_created: false, status: "cancelled" }))).toBe(false);
  });
});
