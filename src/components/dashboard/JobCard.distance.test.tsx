/**
 * THE OWNER'S SCREENSHOT, AS A TEST.
 *
 * 2026-09-19, /dashboard: "im not sure about the timer thing and the miles??
 * why is this showing here it hasnt before". The browse cards carried
 * "27h 6m · 1634 mi", "29h 52m · 1813 mi", "29h 28m · 1797 mi",
 * "28h 23m · 1731 mi" for jobs in Shreveport, New Iberia, Lafayette and Lake
 * Charles.
 *
 * `geo.trip.test.ts` proves those numbers follow from the coordinate that was
 * on the account's prod profile, and `useUserLocation.originTrust.test.tsx`
 * proves that coordinate can no longer be believed. This file is the last
 * line: even handed the bad origin directly, the card renders no chip.
 *
 * "why is this showing here it hasnt before" is also answered here: the chip
 * only renders when the job resolves to a parish centroid AND the viewer has
 * coordinates. The seeded listings minted on 2026-09-19 were the first with a
 * parish on them, so the chip had never had anything to draw on before — the
 * defect was not introduced that day, it became VISIBLE that day. The
 * "no parish, no chip" case below is the half of that which is testable here.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// The card's own ETA hook is used for real (that is the point — the chip
// composes "drive · miles"), but MapKit must not try to load a script in
// jsdom. "idle" is the heuristic branch, which is what a web viewer without
// a MapKit token gets anyway.
vi.mock("@/hooks/useMapKitJs", () => ({ useMapKitJs: () => "idle" }));
vi.mock("@/lib/haptics", () => ({ hapticLight: vi.fn() }));

import JobCard from "./JobCard";
import type { EnrichedJob } from "./types";

/** Verbatim from prod `profiles` for the reporting account, 2026-09-19. */
const MENLO_PARK = { lat: 37.47282350893211, lng: -122.2443517921565 };
/** A viewer actually in Louisiana. */
const BATON_ROUGE = { lat: 30.4515, lng: -91.1871 };

/** One of the four real listings, as the browse view returns it. */
function shreveportJob(overrides: Partial<EnrichedJob> = {}): EnrichedJob {
  return {
    id: "job-shreveport",
    title: "Touch up the hallway paint",
    description: "Two coats, paint supplied.",
    category: "handyman",
    budget: 120,
    location: "Shreveport, LA",
    parish: "Caddo",
    date_needed: "2026-09-25",
    start_time: null,
    created_at: new Date("2026-09-19T12:00:00Z").toISOString(),
    expires_at: new Date("2026-10-03T12:00:00Z").toISOString(),
    customer_id: "poster-1",
    is_urgent: false,
    urgent_fee: 0,
    is_group_job: false,
    helpers_needed: 1,
    is_recurring: false,
    ...overrides,
  } as unknown as EnrichedJob;
}

function renderCard(job: EnrichedJob, userLat: number | null, userLng: number | null) {
  return render(
    <JobCard
      job={job}
      effectiveFee={0.15}
      onApply={vi.fn()}
      onReport={vi.fn()}
      onSelect={vi.fn()}
      userLat={userLat}
      userLng={userLng}
    />,
  );
}

/** The chip is the one element carrying an "…away" accessible name. */
function distanceChip() {
  return screen.queryByRole("img", { name: /away/i });
}

describe("the reported chip", () => {
  it("does not render 1634 mi, or any distance, from the out-of-state origin", () => {
    renderCard(shreveportJob(), MENLO_PARK.lat, MENLO_PARK.lng);
    expect(screen.queryByText(/1634/)).toBeNull();
    expect(screen.queryByText(/\bmi\b/)).toBeNull();
    expect(distanceChip()).toBeNull();
  });

  it("does not render the 27-hour drive either", () => {
    renderCard(shreveportJob(), MENLO_PARK.lat, MENLO_PARK.lng);
    // Any "Nh Mm" duration at all. The ETA and the miles share one chip, so
    // neither half may survive the other's refusal.
    expect(screen.queryByText(/\d+h\s*\d+m/)).toBeNull();
  });

  it("still shows the city — the card is not blanked, only the impossible claim", () => {
    renderCard(shreveportJob(), MENLO_PARK.lat, MENLO_PARK.lng);
    expect(screen.getByText(/Shreveport/)).toBeTruthy();
    expect(screen.getByText("Touch up the hallway paint")).toBeTruthy();
  });
});

describe("a legitimately long in-state trip still shows", () => {
  it("renders Baton Rouge → Shreveport, the kind of drive this bound must not eat", () => {
    renderCard(shreveportJob(), BATON_ROUGE.lat, BATON_ROUGE.lng);
    const chip = distanceChip();
    expect(chip).not.toBeNull();
    // ~230 mi great-circle between the two parish points.
    expect(chip!.textContent).toMatch(/2\d\d mi/);
  });

  it("marks the figure approximate in the PIXELS, not only in the aria-label", () => {
    // open_jobs_browse masks precise job coordinates on purpose, so the
    // destination is always a parish centroid and this number has never been
    // able to mean a measurement. The sighted reader now sees that too.
    renderCard(shreveportJob(), BATON_ROUGE.lat, BATON_ROUGE.lng);
    expect(distanceChip()!.textContent).toMatch(/~\d/);
  });

  it("keeps the tilde out of the spoken name, where the word is already there", () => {
    renderCard(shreveportJob(), BATON_ROUGE.lat, BATON_ROUGE.lng);
    const name = distanceChip()!.getAttribute("aria-label") ?? "";
    expect(name).toMatch(/^Approximately /);
    expect(name).not.toContain("~");
  });
});

describe("why it had never shown before", () => {
  it("renders no chip for a job with no parish and no mappable location", () => {
    renderCard(
      shreveportJob({ parish: null, location: null } as Partial<EnrichedJob>),
      BATON_ROUGE.lat,
      BATON_ROUGE.lng,
    );
    expect(distanceChip()).toBeNull();
  });

  it("renders no chip for a viewer with no coordinates", () => {
    renderCard(shreveportJob(), null, null);
    expect(distanceChip()).toBeNull();
  });
});
