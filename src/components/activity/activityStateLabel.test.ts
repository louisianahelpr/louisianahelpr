import { describe, it, expect } from "vitest";
import {
  postedActiveState,
  appliedActiveState,
  postedCardState,
  appliedCardState,
  stateToneColors,
} from "./activityStateLabel";

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

describe("card status stripe — every status gets a band", () => {
  // The stripe is the full-width band under a card's title divider. Unlike the
  // Active-bucket pill it replaced, it has to colour EVERY status: a card in
  // the Completed or Cancelled section still needs one. These cases exist so a
  // new job status can never silently render a blank band.

  const POSTED_STATUSES = [
    "open",
    "pending_approval",
    "accepted",
    "in_progress",
    "revision_requested",
    "completed",
    "cancelled",
    "disputed",
  ];

  it("returns a labelled, toned state for every posted job status", () => {
    for (const status of POSTED_STATUSES) {
      const state = postedCardState({ status });
      expect(state.label, status).toBeTruthy();
      expect(state.tone, status).toBeTruthy();
    }
  });

  it("names the three terminal statuses the Active pill stays silent about", () => {
    expect(postedCardState({ status: "completed" })).toEqual({ label: "Completed", tone: "success" });
    expect(postedCardState({ status: "cancelled" })).toEqual({ label: "Cancelled", tone: "danger" });
    expect(postedCardState({ status: "disputed" })).toEqual({ label: "Disputed", tone: "action" });
    // ...and the pill itself is unchanged — it still says nothing there.
    expect(postedActiveState({ status: "completed" })).toBeNull();
  });

  it("reuses the Active vocabulary verbatim for the live statuses", () => {
    // No second wording. Whatever the pill says, the stripe says.
    for (const status of ["open", "accepted", "in_progress", "revision_requested", "pending_approval"]) {
      expect(postedCardState({ status }), status).toEqual(postedActiveState({ status }));
    }
  });

  it("covers the applied card's application states, which are not job states", () => {
    // "Not selected" is a fact about THIS application; the job may still be open.
    expect(appliedCardState({ status: "rejected", job: { status: "open" } })).toEqual({
      label: "Not selected",
      tone: "neutral",
    });
    expect(appliedCardState({ status: "withdrawn", job: { status: "open" } })).toEqual({
      label: "Withdrawn",
      tone: "neutral",
    });
    expect(appliedCardState({ status: "accepted", job: { status: "completed" } })).toEqual({
      label: "Completed",
      tone: "success",
    });
    expect(appliedCardState({ status: "pending", job: { status: "cancelled" } })).toEqual({
      label: "Job cancelled",
      tone: "danger",
    });
    expect(appliedCardState({ status: "accepted", job: { status: "disputed" } })).toEqual({
      label: "Disputed",
      tone: "action",
    });
    // Live states delegate, so the two sides cannot drift.
    expect(appliedCardState({ status: "pending", job: { status: "open" } })).toEqual(
      appliedActiveState({ status: "pending", job: { status: "open" } }),
    );
  });

  it("never leaves a card without a band, even with a missing job row", () => {
    const state = appliedCardState({ status: "pending", job: null });
    expect(state.label).toBeTruthy();
    expect(state.tone).toBeTruthy();
  });

  it("gives every tone a foreground and background from brand tokens", () => {
    // Guards the shape that passes contrast: a TINT background with INK text.
    // A saturated fill with light text is where this app's AA failures came
    // from, so every pair must be var()-driven, never a raw literal.
    for (const tone of ["action", "waiting", "live", "neutral", "success", "danger"] as const) {
      const { fg, bg } = stateToneColors(tone);
      expect(fg, tone).toMatch(/^hsl\(var\(--/);
      expect(bg, tone).toMatch(/^hsl\(var\(--/);
    }
  });
});
