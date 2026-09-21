// Regression tests for the Browse map's filter predicate. The map used to
// ignore filters entirely (it runs its own fetch, so it never saw the list's
// `filteredJobs`) — tapping a category chip changed the list and left every
// pin in place. These lock the predicate to the list's semantics.

import { describe, it, expect } from "vitest";
import { buildMapJobFilter, isAnyFilterActive, unsupportedMapFilters, type MapJobFilterInput } from "./mapFilter";
import type { MapJob } from "./config";

const NONE: MapJobFilterInput = {
  selectedCategory: null,
  searchQuery: "",
  minBudget: "",
  maxBudget: "",
  urgentOnly: false,
  boostedOnly: false,
  expiresWithin: "",
  matchAvailability: false,
  nearbyMiles: null,
  userLoc: null,
  earlyAccessDelayMs: 0,
};

const job = (over: Partial<MapJob> = {}): MapJob => ({
  id: "j1",
  title: "Mow the front lawn",
  category: "yard_work",
  budget: 60,
  is_urgent: false,
  latitude: 30.45,
  longitude: -91.15, // Baton Rouge
  parish: "East Baton Rouge",
  created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  ...over,
});

describe("buildMapJobFilter", () => {
  it("keeps everything when no filter is set", () => {
    expect(buildMapJobFilter(NONE)(job())).toBe(true);
  });

  it("filters by category — the reported 'clicked errands and nothing filtered' bug", () => {
    const f = buildMapJobFilter({ ...NONE, selectedCategory: "errands" });
    expect(f(job({ category: "errands" }))).toBe(true);
    expect(f(job({ category: "yard_work" }))).toBe(false);
  });

  it("matches the search query against the title, case-insensitively", () => {
    const f = buildMapJobFilter({ ...NONE, searchQuery: "  LAWN " });
    expect(f(job({ title: "Mow the front lawn" }))).toBe(true);
    expect(f(job({ title: "Walk my dog" }))).toBe(false);
  });

  it("applies the budget band inclusively at both ends", () => {
    const f = buildMapJobFilter({ ...NONE, minBudget: "50", maxBudget: "150" });
    expect(f(job({ budget: 50 }))).toBe(true);
    expect(f(job({ budget: 150 }))).toBe(true);
    expect(f(job({ budget: 49 }))).toBe(false);
    expect(f(job({ budget: 151 }))).toBe(false);
  });

  it("filters to urgent only", () => {
    const f = buildMapJobFilter({ ...NONE, urgentOnly: true });
    expect(f(job({ is_urgent: true }))).toBe(true);
    expect(f(job({ is_urgent: false }))).toBe(false);
  });

  it("applies the nearby radius when coords are known", () => {
    const f = buildMapJobFilter({
      ...NONE,
      nearbyMiles: 25,
      userLoc: { lat: 30.45, lng: -91.15 },
    });
    expect(f(job())).toBe(true);
    // New Orleans is ~65mi from Baton Rouge.
    expect(f(job({ latitude: 29.95, longitude: -90.07 }))).toBe(false);
  });

  it("ignores the nearby radius when the viewer's coords aren't resolved", () => {
    const f = buildMapJobFilter({ ...NONE, nearbyMiles: 5, userLoc: null });
    expect(f(job({ latitude: 29.95, longitude: -90.07 }))).toBe(true);
  });

  it("honours the subscription early-access delay, so the map can't leak jobs the list holds back", () => {
    const f = buildMapJobFilter({ ...NONE, earlyAccessDelayMs: 20 * 60 * 1000 });
    expect(f(job({ created_at: new Date(Date.now() - 60_000).toISOString() }))).toBe(false);
    expect(f(job({ created_at: new Date(Date.now() - 30 * 60_000).toISOString() }))).toBe(true);
  });
});

describe("isAnyFilterActive", () => {
  it("is false for a pristine filter state", () => {
    expect(isAnyFilterActive(NONE)).toBe(false);
  });

  it("is true for a whitespace-only search but false for an empty one", () => {
    expect(isAnyFilterActive({ ...NONE, searchQuery: "   " })).toBe(false);
    expect(isAnyFilterActive({ ...NONE, searchQuery: "lawn" })).toBe(true);
  });

  it("counts filters the map can't apply — the viewer still turned them on", () => {
    expect(isAnyFilterActive({ ...NONE, boostedOnly: true })).toBe(true);
  });
});

describe("unsupportedMapFilters", () => {
  /*
   * REWRITTEN 2026-09-21, and the old expectation is worth recording because
   * it was CORRECT and still let the defect stand.
   *
   * It asserted all three of Boosted / Ending soon / Matches my availability
   * were named as unsupported — a faithful description of the code, and the
   * code was the bug. Naming a filter the map cannot apply is honest, but the
   * owner still sees two surfaces disagreeing: "the map still shows 6 jobs but
   * 3 on the left ... when i apply they fall off the left but not the map."
   *
   * A guard can be perfectly accurate about behaviour nobody wants. This one
   * pinned the workaround in place and would have gone red at any attempt to
   * fix it.
   *
   * Now: availability was never unsupportable (it needs `date_needed` +
   * `start_time`, returned since 20260823120000), and the other two are
   * decided from the ROWS — absent keys mean the deployed RPC predates
   * 20260921173413.
   */
  it("names nothing once the RPC returns the columns", () => {
    expect(unsupportedMapFilters(NONE)).toEqual([]);
    const fresh = [{ boost_expires_at: null, expires_at: null }] as never[];
    expect(
      unsupportedMapFilters(
        { ...NONE, boostedOnly: true, expiresWithin: "24h", matchAvailability: true },
        fresh,
      ),
    ).toEqual([]);
  });

  it("still names the two column-dependent filters while the old RPC is deployed", () => {
    const oldRow = [{ id: "j1" }] as never[];
    expect(
      unsupportedMapFilters({ ...NONE, boostedOnly: true, expiresWithin: "24h", matchAvailability: true }, oldRow),
    ).toEqual(["Boosted", "Ending soon"]);
  });

  it("does not name filters it CAN apply", () => {
    expect(unsupportedMapFilters({ ...NONE, selectedCategory: "errands", urgentOnly: true })).toEqual([]);
  });
});

// The category predicate is the bug this file was written for ("I clicked
// errands filter and it didn't filter"). Delete it and every job survives the
// filter, which is precisely the reported behaviour.
// @mutate src/components/browseMap/mapFilter.ts | if (f.selectedCategory && job.category !== f.selectedCategory) return false; |
// The early-access gate is the one filter whose absence LEAKS data (paid-tier
// jobs on a free viewer's map) rather than merely showing too much.
// @mutate src/components/browseMap/mapFilter.ts | if (age < f.earlyAccessDelayMs) return false; |

/*
 * THE OWNER'S REPORT, 2026-09-21 — "the map still shows 6 jobs but 3 on the
 * left ... when i apply they fall off the left but not the map."
 *
 * Third time for this class. The first two rounds were viewer EXCLUSIONS
 * (applied jobs 2026-09-15, dismissed jobs 2026-09-19 — "map shows 7 jobs.
 * list shows 4") and both were fixed by routing every surface through one
 * `ViewerFeedExclusions` object. This round was not an exclusion: it was the
 * FILTER BAR. `unsupportedMapFilters` named three filters the map "has no
 * field to evaluate" and the map simply did not apply them — so turning any of
 * the three on narrowed the list and left every pin in place.
 *
 * Two of them genuinely had no field: `boosted_at` and `expires_at` were not
 * projected by the RPC (boosted_at was already the first key of its ORDER BY).
 * The third never needed one — availability reads `date_needed` and
 * `start_time`, returned since 20260823120000 and never wired up.
 *
 * Each case below asserts the map now culls what the list culls.
 */
describe("the map applies the filters it used to only name (owner 2026-09-21)", () => {
  const base = {
    selectedCategory: null, searchQuery: "", minBudget: "", maxBudget: "",
    urgentOnly: false, boostedOnly: false, expiresWithin: "",
    matchAvailability: false, nearbyMiles: null, userLoc: null,
    earlyAccessDelayMs: 0,
  } as const;

  const job = (over: Record<string, unknown> = {}) => ({
    id: "j1", title: "Mow a lawn", category: "lawn_care", budget: 80,
    is_urgent: false, latitude: 30.45, longitude: -91.18, parish: "East Baton Rouge",
    // Old enough to clear any early-access gate.
    created_at: new Date(Date.now() - 6 * 36e5).toISOString(),
    date_needed: "2099-01-02", // a Friday
    start_time: "09:00:00",
    ...over,
  }) as never;

  it("Boosted means the boost is STILL RUNNING, not ever-boosted", () => {
    const f = buildMapJobFilter({ ...base, boostedOnly: true });
    expect(f(job({ boost_expires_at: null })), "an unboosted job survived the Boosted filter").toBe(false);
    expect(f(job({ boost_expires_at: new Date(Date.now() + 36e5).toISOString() }))).toBe(true);
    /*
     * The correction. 20260921173413 projected `boosted_at` — "ever boosted" —
     * so an EXPIRED boost would have shown on the map while the list, the
     * count, the guest dashboard and job detail all test
     * `boost_expires_at > now` and showed nothing. A new divergence inside the
     * fix for the old one. Caught before any user saw it (0 boosted rows on
     * prod), corrected by 20260921201657.
     */
    expect(
      f(job({ boost_expires_at: new Date(Date.now() - 36e5).toISOString() })),
      "an EXPIRED boost passed the Boosted filter — the map would disagree with the list again",
    ).toBe(false);
  });

  it("Ending soon culls a pin outside the window, and one with no expiry at all", () => {
    const f = buildMapJobFilter({ ...base, expiresWithin: "24h" });
    expect(f(job({ expires_at: new Date(Date.now() + 72 * 36e5).toISOString() }))).toBe(false);
    // The list culls a job with no expires_at when the filter is on; the map
    // must agree rather than treating "unknown" as "matches".
    expect(f(job({ expires_at: null }))).toBe(false);
    expect(f(job({ expires_at: new Date(Date.now() + 6 * 36e5).toISOString() }))).toBe(true);
  });

  it("Matches my availability culls a job on a day the helper is not available", () => {
    const avail = [{ day_of_week: 5, is_available: true, start_time: "08:00:00", end_time: "17:00:00" }];
    const f = buildMapJobFilter({ ...base, matchAvailability: true, helperAvailability: avail });
    // 2099-01-02 is a Friday (day 5) — inside the slot.
    expect(f(job())).toBe(true);
    // 2099-01-03 is a Saturday — no slot at all.
    expect(f(job({ date_needed: "2099-01-03" })), "a job outside the helper's week survived").toBe(false);
    // Right day, outside the hours.
    expect(f(job({ start_time: "19:00:00" })), "a job past the helper's end time survived").toBe(false);
  });

  /*
   * THE DEPLOY WINDOW. Migrations auto-deploy on merge but not instantly, so
   * between the merge and db-deploy finishing the RPC returns the old row and
   * the two new keys are ABSENT — not null. Absent must mean "cannot
   * evaluate", never "cull everything", or the map would empty itself for a
   * few minutes on every deploy.
   */
  it("an old RPC row (keys absent) is not culled, and is reported as unsupported", () => {
    const old = job(); // no boosted_at / expires_at keys at all
    expect(buildMapJobFilter({ ...base, boostedOnly: true })(old)).toBe(true);
    expect(buildMapJobFilter({ ...base, expiresWithin: "24h" })(old)).toBe(true);
    expect(unsupportedMapFilters({ ...base, boostedOnly: true }, [old])).toEqual(["Boosted"]);
    expect(unsupportedMapFilters({ ...base, expiresWithin: "24h" }, [old])).toEqual(["Ending soon"]);
  });

  it("once the RPC returns the columns, nothing is reported as unsupported", () => {
    const fresh = job({ boost_expires_at: null, expires_at: null });
    expect(
      unsupportedMapFilters(
        { ...base, boostedOnly: true, expiresWithin: "24h", matchAvailability: true },
        [fresh],
      ),
      "the map claimed it could not apply a filter it can now apply",
    ).toEqual([]);
  });
});
