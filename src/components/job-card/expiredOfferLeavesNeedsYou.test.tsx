/*
 * GUARD (owner, 2026-10-03, from a My Jobs screenshot): "If the offer expired
 * then it should no longer be in needs you".
 *
 * The offer card said "This offer has expired" from its own clock while the
 * Activity bucket, which never looked at the clock, kept the card in Needs You
 * until the server's hourly sweep filed the application as rejected. Both now
 * read offerClock(), so an offer leaves Needs You the instant its card says it
 * expired, files under Cancelled (where the sweep puts it), and its status
 * line says "The offer expired" instead of "Accept or decline it". Red on the
 * tree before this change: appliedActivityBucket returned "needs_you" for
 * every expired fixture below.
 */
// @mutate src/components/job-card/activityFilters.ts |   if (offerHasExpired(app)) return "cancelled";\n  // An offer held for me | // An offer held for me
// @mutate src/components/job-card/activityFilters.ts |   return isHeldOffer(app) && !offerClock(app, app.job).isExpired; |   return isHeldOffer(app);
// @mutate src/components/job-card/jobStatusLine.ts |       if (offerHasExpired(app)) return "offer_expired"; |       if (false) return "offer_expired";
// @mutate src/components/job-card/activityFilters.ts |   if (!job \|\| job.helper_confirmed_at \|\| job.is_group_job) return false; |   if (!job) return false;
// @mutate src/components/job-card/activityFilters.ts |   if (job.direct_offer_status === "pending" && job.status === "open" && !job.helper_id | if (job.direct_offer_status === "pending"
// @mutate src/components/job-card/activityFilters.ts |   const offerNow = useExpiryClock(appliedApps.map(heldOfferDeadline)); |   const offerNow = useExpiryClock([]);
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { appliedActivityBucket, bucketAppliedApp, useActivityFilters } from "./activityFilters";
import { deriveHelperWait } from "./jobStatusLine";
import { offerClock } from "./offerClock";
import type { AppliedApp } from "./activityConstants";

const HELPER = "11111111-2222-3333-4444-555555555555";
const H = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

function app(over: Record<string, unknown>, job: Record<string, unknown>): AppliedApp {
  return {
    id: "app-1", job_id: "job-1", helper_id: HELPER, status: "accepted", created_at: iso(Date.now() - 72 * H),
    job: { id: "job-1", customer_id: "poster-1", title: "Fixture", status: "accepted", helper_id: HELPER, helper_confirmed_at: null,
      date_needed: iso(Date.now() + 72 * H).slice(0, 10), payment_status: "escrow", ...job },
    ...over,
  } as unknown as AppliedApp;
}

/** The three kinds of held offer, each with its clock run out and still running. */
const CASES = (deltaMs: number) => ({
  "an offer from the Helpr's own application (response_deadline)": app({}, { response_deadline: iso(Date.now() + deltaMs) }),
  "a direct offer (direct_offer_expires_at)": app(
    { id: "direct-job-1", status: "pending" },
    { status: "open", helper_id: null, offered_to_helper_id: HELPER, direct_offer_status: "pending", direct_offer_expires_at: iso(Date.now() + deltaMs) },
  ),
  "a legacy offer with only the 24-hour rule": app({ updated_at: iso(Date.now() - 24 * H + deltaMs) }, {}),
});

afterEach(() => vi.useRealTimers());

describe("an expired offer leaves Needs You (owner, 2026-10-03)", () => {
  for (const [name, a] of Object.entries(CASES(-60_000))) {
    it(`${name}: expired -> Cancelled, never Needs You, and the line says so`, () => {
      expect(offerClock(a, a.job).isExpired, "the card says expired").toBe(true);
      expect(appliedActivityBucket(a)).toBe("cancelled");
      expect(bucketAppliedApp(a)).toBe("cancelled");
      expect(deriveHelperWait(a)).toBe("offer_expired");
    });
  }

  for (const [name, a] of Object.entries(CASES(60 * 60_000))) {
    it(`${name}: still open -> Needs You, unchanged`, () => {
      expect(offerClock(a, a.job).isExpired).toBe(false);
      expect(appliedActivityBucket(a)).toBe("needs_you");
      expect(deriveHelperWait(a)).not.toBe("offer_expired");
    });
  }

  it("a stale direct-offer marker never turns a booking or someone else's application into an expired offer (UI review must-fix 1)", () => {
    const marker = { direct_offer_status: "pending", direct_offer_expires_at: null };
    const booked = app({ updated_at: iso(Date.now() - 25 * H) }, { ...marker, helper_confirmed_at: iso(Date.now() - 24.5 * H) });
    expect(appliedActivityBucket(booked)).not.toBe("cancelled");
    expect(deriveHelperWait(booked)).not.toBe("offer_expired");
    const working = app({ updated_at: iso(Date.now() - 25 * H) }, { ...marker, status: "in_progress", helper_confirmed_at: iso(Date.now() - 24.5 * H) });
    expect(appliedActivityBucket(working)).not.toBe("cancelled");
    const otherApplicant = app({ status: "pending", updated_at: iso(Date.now() - 25 * H) },
      { status: "open", helper_id: null, offered_to_helper_id: null, direct_offer_status: "pending", direct_offer_expires_at: iso(Date.now() - H) });
    expect(appliedActivityBucket(otherApplicant)).toBe("waiting");
    // a Hired job (not open) still carrying a pending marker for this helper is not a direct offer
    const hiredWithMarker = app({ status: "pending" },
      { status: "accepted", helper_id: HELPER, helper_confirmed_at: null, offered_to_helper_id: HELPER, direct_offer_status: "pending", direct_offer_expires_at: iso(Date.now() - H) });
    expect(appliedActivityBucket(hiredWithMarker)).not.toBe("cancelled");
  });

  it("a stale marker never hides a live hired offer, nor keeps an expired one (re-review must-fix)", () => {
    const marker = { direct_offer_status: "pending", direct_offer_expires_at: null };
    const live = app({}, { ...marker, response_deadline: iso(Date.now() + 5 * H) });
    expect(appliedActivityBucket(live)).toBe("needs_you");
    const past = app({}, { ...marker, response_deadline: iso(Date.now() - H) });
    expect(appliedActivityBucket(past)).toBe("cancelled");
  });

  it("a garbage stamp derives no clock and never throws", () => {
    const bad = app({ updated_at: "not a date" }, {});
    expect(() => appliedActivityBucket(bad)).not.toThrow();
    expect(offerClock(bad, bad.job).isExpired).toBe(false);
  });

  it("a confirmed booking is never an offer, whatever its old deadline says", () => {
    const booked = app({}, { helper_confirmed_at: iso(Date.now() - 2 * H), response_deadline: iso(Date.now() - H) });
    expect(appliedActivityBucket(booked)).not.toBe("cancelled");
    expect(deriveHelperWait(booked)).not.toBe("offer_expired");
  });

  it("an expired offer is not lifted to the top of Cancelled like a live one would be", () => {
    // The list lifts offers still held for the Helpr's answer above everything
    // else; an expired one is not held any more, so it keeps its place.
    const rejected = app({ id: "app-0", status: "rejected" }, { status: "open", helper_id: null });
    const expired = { ...CASES(-60_000)["an offer from the Helpr's own application (response_deadline)"], id: "app-9" } as AppliedApp;
    const { result } = renderHook(() =>
      useActivityFilters({ postedJobs: [], appliedApps: [rejected, expired], statusFilter: "cancelled", searchQuery: "", userId: HELPER }),
    );
    expect(result.current.filteredAppliedApps.map((x) => x.id)).toEqual(["app-0", "app-9"]);
  });

  it("leaves Needs You at the instant the window closes, with the screen open", () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date("2026-10-03T23:00:00Z"));
    const a = app({}, { response_deadline: iso(Date.now() + 90_000) });
    const { result } = renderHook(() =>
      useActivityFilters({ postedJobs: [], appliedApps: [a], statusFilter: "needs_you", searchQuery: "", userId: HELPER }),
    );
    expect(result.current.filteredAppliedApps.map((x) => x.id)).toEqual(["app-1"]);
    act(() => { vi.advanceTimersByTime(91_000); });
    expect(result.current.filteredAppliedApps).toEqual([]);
    expect(result.current.appliedCounts.needs_you).toBe(0);
    expect(result.current.appliedCounts.cancelled).toBe(1);
  });
});
