/**
 * A3-94 rest (audit 11-01): the browse card's countdown chip said "16 hours left" for the LISTING's close on a job
 * that starts sooner (expires_at is after the start on every dated open job on prod, read-only). The chip now counts
 * to whichever comes first (listingDeadline, shared with the job dialog's tile): "Starts · 5 hours left" when the start
 * is first, the close's own words when the close is first, and the close again once the start has passed.
 *
 * @mutate src/lib/listingDeadline.ts |   const startsFirst = Number.isFinite(startMs) && startMs < closeMs; |   const startsFirst = false;
 * @mutate src/lib/listingDeadline.ts |   return { text: first.startsFirst && !startPassed ? `Starts · ${text}` : text, soon: expired \|\| hours < 24 }; |   return { text, soon: expired \|\| hours < 24 };
 * @mutate src/lib/listingDeadline.ts |   const at = startPassed ? new Date(Date.parse(job.expires_at!)) : first.at; |   const at = first.at;
 * @mutate src/lib/listingDeadline.ts |   if (!expired && hours >= 48) return null; |
 * @mutate src/components/dashboard/JobCard.tsx |   const chip = listingChip(job, expiryNow); |   const chip = listingChip({ ...job, date_needed: null }, expiryNow);
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/hooks/useFirstPayoutFee", () => ({ useFirstPayoutFeeDollars: () => 0, useFirstPayoutFeeCents: () => 0 }));
vi.mock("@/hooks/useMapKitJs", () => ({ useMapKitJs: () => "idle" }));
vi.mock("@/lib/haptics", () => ({ hapticLight: vi.fn() }));

import JobCard from "@/components/dashboard/JobCard";
import type { EnrichedJob } from "@/components/dashboard/types";
import { listingChip, listingDeadline } from "@/lib/listingDeadline";

// Sun Nov 1 2054, 1:00 PM in Louisiana (CST, UTC-6). The job starts at 6:00 PM that day (5 hours on).
// Pinned 28 years out (same weekdays and DST days as 2026), so no job day here ages into the present (jobDayFixtureTimezone).
const NOW = new Date("2054-11-01T19:00:00Z");
const START_ISO = "2054-11-02T00:00:00.000Z";
const job = (over: Record<string, unknown> = {}) => ({ date_needed: "2054-11-01", start_time: "18:00", expires_at: "2054-11-05T19:00:00Z", ...over });

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("listingDeadline: the start or the close, whichever is first", () => {
  it("names the start when it comes first, the close otherwise, nothing with no close", () => {
    expect(listingDeadline(job())).toEqual({ at: new Date(START_ISO), startsFirst: true });
    expect(listingDeadline(job({ expires_at: "2054-11-01T20:00:00Z" }))).toEqual({ at: new Date("2054-11-01T20:00:00Z"), startsFirst: false });
    expect(listingDeadline(job({ date_needed: null }))?.startsFirst).toBe(false);
    expect(listingDeadline(job({ expires_at: null }))).toBeNull();
  });
});

describe("listingChip: the browse card's countdown", () => {
  it("a job starting in 5 hours, listing open 4 more days: Starts · 5 hours left, urgent", () => {
    expect(listingChip(job(), NOW)).toEqual({ text: "Starts · 5 hours left", soon: true });
  });

  it("the close first: the close's own words; past 48 hours: no chip", () => {
    expect(listingChip(job({ date_needed: "2054-11-10", expires_at: "2054-11-02T07:00:00Z" }), NOW)).toEqual({ text: "12 hours left", soon: true });
    expect(listingChip(job({ date_needed: "2054-11-10", expires_at: "2054-11-05T19:00:00Z" }), NOW)).toBeNull();
  });

  it("the start passed, the listing still open: the close again (never 'Starts · Expired')", () => {
    const later = new Date("2054-11-04T19:00:00Z");
    expect(listingChip(job(), later)).toEqual({ text: "1 day left", soon: false });
  });
});

describe("the browse card draws it", () => {
  it("Starts · 5 hours left on the card of a job starting tonight", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const card = {
      id: "j1", title: "Haul off a couch", description: "", category: "moving", budget: 60, location: "Lafayette, LA",
      created_at: "2054-10-30T12:00:00Z", customer_id: "p1", is_urgent: false, urgent_fee: 0, is_group_job: false,
      helpers_needed: 1, is_recurring: false, ...job(),
    } as unknown as EnrichedJob;
    render(<JobCard job={card} effectiveFee={0.15} onApply={vi.fn()} onReport={vi.fn()} onSelect={vi.fn()} userLat={null} userLng={null} />);
    expect(screen.getByTestId("job-card-countdown-slot").textContent).toContain("Starts · 5 hours left");
  });
});
