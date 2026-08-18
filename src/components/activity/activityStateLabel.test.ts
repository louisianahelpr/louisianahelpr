import { describe, it, expect } from "vitest";
import { postedActiveState, appliedActiveState } from "./activityStateLabel";

/**
 * These labels exist because Active is a bucket: it folds several statuses
 * into one list, so without them a job awaiting a reply, one whose offer was
 * just declined, and one already underway all look alike.
 *
 * The cases below are the distinctions the owner actually asked for, so they
 * are the ones worth freezing.
 */

describe("postedActiveState — what is happening to my job", () => {
  it("says a declined offer is still open", () => {
    // The specific ask: a declined offer is NOT a dead end. Without this the
    // job silently reverts to looking like one nobody has seen.
    expect(postedActiveState({ status: "open", direct_offer_status: "declined" })).toEqual({
      label: "Offer declined · still open",
      tone: "action",
    });
  });

  it("distinguishes an offer sent from a booking", () => {
    // Both are job.status "accepted"; only helper_confirmed_at separates them.
    expect(postedActiveState({ status: "accepted", helper_confirmed_at: null })).toEqual({
      label: "Offer sent · awaiting reply",
      tone: "waiting",
    });
    expect(postedActiveState({ status: "accepted", helper_confirmed_at: "2026-08-01T00:00:00Z" })).toEqual({
      label: "Booked",
      tone: "live",
    });
  });

  it("prompts a decision when applicants are waiting, and says so when there are none", () => {
    // The pill must NOT restate the count — the card's "Applicants (N)"
    // button already carries it. See postedActiveState for the full note.
    expect(postedActiveState({ status: "open", applicantCount: 1 })).toEqual({
      label: "Pick someone",
      tone: "action",
    });
    expect(postedActiveState({ status: "open", applicantCount: 3 })).toEqual({
      label: "Pick someone",
      tone: "action",
    });
    for (const applicantCount of [1, 3, 12]) {
      expect(postedActiveState({ status: "open", applicantCount })?.label).not.toMatch(/\d/);
    }
    expect(postedActiveState({ status: "open", applicantCount: 0 })).toEqual({
      label: "Open · no applicants yet",
      tone: "neutral",
    });
  });

  it("stays silent outside the Active bucket", () => {
    // Those cards already carry their own treatment; a pill would say it twice.
    expect(postedActiveState({ status: "completed" })).toBeNull();
    expect(postedActiveState({ status: "cancelled" })).toBeNull();
    expect(postedActiveState({ status: "disputed" })).toBeNull();
  });
});

describe("appliedActiveState — where do I stand", () => {
  const job = (over: Record<string, unknown>) => ({
    status: "open",
    helper_confirmed_at: null,
    offered_to_helper_id: null,
    direct_offer_status: null,
    ...over,
  });

  it("separates waiting on them from waiting on me", () => {
    // The distinction that decides whether the card needs a tap.
    expect(appliedActiveState({ status: "pending", job: job({}) })).toEqual({
      label: "Applied · awaiting decision",
      tone: "waiting",
    });
    expect(
      appliedActiveState({ status: "accepted", job: job({ status: "accepted", helper_confirmed_at: null }) }),
    ).toEqual({ label: "Offered to you · respond", tone: "action" });
  });

  it("treats a direct invite as needing my response", () => {
    expect(
      appliedActiveState({
        status: "pending",
        job: job({ offered_to_helper_id: "me", direct_offer_status: "pending" }),
      }),
    ).toEqual({ label: "Offered to you · respond", tone: "action" });
  });

  it("goes quiet once my involvement has ended", () => {
    // Matches the owner's decision that Active means "is my standing still
    // live" — rejected and cancelled drop out of the bucket entirely.
    expect(appliedActiveState({ status: "rejected", job: job({}) })).toBeNull();
    expect(appliedActiveState({ status: "pending", job: job({ status: "cancelled" }) })).toBeNull();
    expect(appliedActiveState({ status: "accepted", job: job({ status: "completed" }) })).toBeNull();
  });

  it("handles a missing job row without throwing", () => {
    // appliedApps join their job client-side; a null job is reachable.
    expect(appliedActiveState({ status: "pending", job: null })).toBeNull();
  });
});
