// CLASS GUARD — the browse feed renders EVERY job its own filtered list holds.
//
// THE CLASS: "a section subtracts a job on the grounds that ANOTHER section
// renders it, and that other section does not render it." The job is returned
// by the API, survives every viewer cull, and is then painted by nobody.
//
// Two instances, both on this one component:
//
//   2026-09-16  `visibleJobs` dropped everything in `filters.nearbyJobs`,
//               dating from a "Nearby" band that had since been deleted. With
//               6 local jobs and 3 skill-matching out-of-town ones, nearbyJobs
//               claimed 5 local rows while `recommendedJobs` held a different
//               set — 3 local jobs were subtracted and rendered nowhere.
//               Guarded at the API boundary by
//               e2e/happy-path/browse-feed-completeness.spec.ts.
//
//   2026-09-20  (this) The SAME subtract-because-rendered-elsewhere shape, one
//               predicate over: `visibleJobs` drops `recommendedJobs` members
//               whenever `!hasFilters`, but the recommended band renders only
//               when `!hasFilters && !savedOnly`. `savedOnly` is NOT part of
//               `activeFilterCount` (useDashboardFilters.ts), so turning on
//               "Only saved jobs" leaves `hasFilters === false`: the band goes
//               empty and the everything-else list has still subtracted it.
//               Every saved job that was also a recommended pick vanished —
//               and if all of them were, the panel said "Nothing saved yet"
//               over a non-empty saved list.
//
// WHY A TEST AT THIS LEVEL. The e2e spec above proves the invariant for ONE
// viewer state (no filters, nothing saved, nothing dismissed) — the state the
// 2026-09-16 bug happened to live in. It cannot see the 2026-09-20 bug at all,
// because that one needs `savedOnly` on. This test sweeps the STATE SPACE of
// the flags that gate the two sections, so the next predicate to drift is
// caught by a case that already exists rather than by one nobody wrote.
//
// The invariant is a PARTITION, asserted both ways:
//   • nothing LOST     — every job in `filters.filteredJobs` is rendered.
//   • nothing INVENTED — nothing is rendered that is not in `filteredJobs`
//                        (the band used to be built from `recommendedJobs`,
//                        a list that is NOT viewer-culled, so it could paint
//                        a job the list had legitimately removed).
//
// @mutate src/pages/home/browseFeedSections.ts | const inBand = bandIds.has(j.id); | const inBand = false;
// @mutate src/pages/home/browseFeedSections.ts | if (!showRecommendedBand) return { band: [], rest: filteredJobs.slice() }; | if (!showRecommendedBand) return { band: [], rest: filteredJobs.filter((_, i) => i > 0) };

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { EnrichedJob } from "@/components/dashboard/types";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";

vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/haptics", () => ({
  hapticLight: vi.fn(), hapticError: vi.fn(), hapticSuccess: vi.fn(),
  hapticMedium: vi.fn(), hapticSelection: vi.fn(), hapticWarning: vi.fn(), hapticHeavy: vi.fn(),
}));
vi.mock("@/hooks/useProfile", () => ({ useProfile: () => ({ data: null }) }));
vi.mock("@/hooks/useHelprActivity", () => ({ useHelprActivity: () => ({ activity: null }) }));

import { BrowseTasksFeed } from "@/components/dashboard/BrowseTasksFeed";

const AGO = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

function job(tag: string, over: Partial<EnrichedJob> = {}): EnrichedJob {
  return {
    id: `id-${tag}`,
    title: `JOB ${tag}`,
    description: `Task ${tag} description, long enough to render.`,
    category: "cleaning",
    budget: 100,
    date_needed: jobLocalDateISO(5),
    location: "New Orleans, LA",
    customer_id: "poster-1",
    status: "open",
    created_at: AGO(60),
    is_urgent: false,
    pricing_mode: "set_price",
    ...over,
  } as EnrichedJob;
}

/**
 * The feed's own filtered list is the contract: whatever `useDashboardFilters`
 * hands over has already had every viewer-local cull applied (applied,
 * blocked, dismissed, saved-only — see viewerFeedExclusions.ts). The feed's
 * only remaining job is to ARRANGE it, never to shrink it.
 */
function renderFeed(opts: {
  filteredJobs: EnrichedJob[];
  recommendedJobs: EnrichedJob[];
  hasFilters: boolean;
  savedOnly: boolean;
  sortBy?: string;
}) {
  const filters = {
    filteredJobs: opts.filteredJobs,
    nearbyJobs: [],
    hasFilters: opts.hasFilters,
    sortBy: opts.sortBy ?? "smart",
    userLoc: null,
    nearbyMiles: null,
    locationFilter: "all",
    boostedOnly: false,
    mapFilter: "all",
    clearFilters: vi.fn(),
    setLocationFilter: vi.fn(),
  };
  const noop = vi.fn();
  render(
    <MemoryRouter>
      <BrowseTasksFeed
        view="list"
        density={"compact" as never}
        filters={filters as never}
        user={{ id: "viewer-1" } as never}
        allJobs={opts.filteredJobs}
        loadError={false}
        refresh={noop}
        recommendedJobs={opts.recommendedJobs}
        recommendedLoading={false}
        savedOnly={opts.savedOnly}
        savedJobIds={new Set(opts.filteredJobs.map((j) => j.id))}
        effectiveFee={10}
        handleApplyRequest={noop}
        handleDismissRequest={noop}
        handleToggleSave={noop}
        expandedCardId={null}
        setExpandedCardId={noop}
        setReportJobId={noop}
        setDetailJob={noop}
        containerRef={{ current: null }}
        pullDistance={0}
        refreshing={false}
        isPulling={false}
        loadMoreRef={{ current: null }}
        hasNextPage={false}
        isFetchingNextPage={false}
        fetchNextPage={noop}
      />
    </MemoryRouter>,
  );
}

/**
 * Every job title the feed actually painted, read off the cards' own
 * aria-labels.
 *
 * `density="compact"` on purpose: the comfortable feed is virtualized
 * (MainFeedSection), and a virtualizer in jsdom measures a 0px scroll
 * container and renders 0 rows — every assertion here would report an empty
 * feed regardless of the derivation under test. The compact path renders the
 * same `combinedVisible` array through a plain <ul>, so it observes the
 * derivation without the layout dependency.
 */
function renderedTitles(): string[] {
  return Array.from(document.querySelectorAll("[aria-label]"))
    .map((el) => el.getAttribute("aria-label") ?? "")
    .filter((l) => /^JOB /.test(l))
    .map((l) => l.split(",")[0]);
}

// The flags that gate the two sections. `hasFilters` gates the subtraction in
// the everything-else list; `hasFilters && savedOnly` gate the band that is
// supposed to render what was subtracted. Any combination in which those two
// disagree loses jobs.
const FLAG_MATRIX: { hasFilters: boolean; savedOnly: boolean }[] = [
  { hasFilters: false, savedOnly: false },
  { hasFilters: false, savedOnly: true },
  { hasFilters: true, savedOnly: false },
  { hasFilters: true, savedOnly: true },
];

describe("Browse feed: every job in the filtered list is rendered by SOME section", () => {
  beforeEach(cleanup);

  for (const { hasFilters, savedOnly } of FLAG_MATRIX) {
    const label = `hasFilters=${hasFilters} savedOnly=${savedOnly}`;

    it(`renders all of filteredJobs — ${label}, recommended overlaps the list`, () => {
      // The condition that makes the subtraction bite: the recommended picks
      // are a SUBSET of the filtered list, so anything subtracted for the band
      // must actually be painted by the band.
      const jobs = [job("A"), job("B"), job("C"), job("D")];
      renderFeed({
        filteredJobs: jobs,
        recommendedJobs: [jobs[0], jobs[1]],
        hasFilters,
        savedOnly,
      });
      const shown = renderedTitles();
      const missing = jobs.map((j) => j.title).filter((t) => !shown.includes(t));
      expect(
        missing,
        `${label}: in filteredJobs but rendered by no section: ${missing.join(", ")}`,
      ).toEqual([]);

      // A partition renders each job EXACTLY once. Without this, a band that
      // stops removing its rows from the everything-else list still satisfies
      // "nothing is missing" — it just paints every recommended pick twice,
      // which is the same two-lists-out-of-step defect pointing the other way.
      const dupes = shown.filter((t, i) => shown.indexOf(t) !== i);
      expect(
        [...new Set(dupes)],
        `${label}: rendered by more than one section: ${[...new Set(dupes)].join(", ")}`,
      ).toEqual([]);
    });

    it(`renders nothing outside filteredJobs — ${label}`, () => {
      // A recommended pick the viewer culls (dismissed, unsaved, applied) is
      // absent from `filteredJobs`. The band must not resurrect it.
      const kept = [job("KEEP-1"), job("KEEP-2")];
      const culled = job("CULLED");
      renderFeed({
        filteredJobs: kept,
        recommendedJobs: [culled, kept[0]],
        hasFilters,
        savedOnly,
      });
      const shown = renderedTitles();
      const allowed = new Set(kept.map((j) => j.title));
      const invented = shown.filter((t) => !allowed.has(t));
      expect(
        invented,
        `${label}: rendered but not in filteredJobs: ${invented.join(", ")}`,
      ).toEqual([]);
    });
  }

  it("an explicit sort still renders every job", () => {
    const jobs = [job("S1", { budget: 50 }), job("S2", { budget: 300 }), job("S3", { budget: 120 })];
    renderFeed({
      filteredJobs: jobs,
      recommendedJobs: [jobs[1]],
      hasFilters: false,
      savedOnly: false,
      sortBy: "budget_desc",
    });
    const shown = renderedTitles();
    expect(jobs.map((j) => j.title).filter((t) => !shown.includes(t))).toEqual([]);
  });

  it("saved-only with every saved job recommended does NOT claim nothing is saved", () => {
    // The 2026-09-20 instance at its worst: all three saved jobs are also
    // recommended picks, so the everything-else list subtracted all of them
    // and the band rendered none — the panel showed "Nothing saved yet" over
    // a saved list of three.
    const jobs = [job("SV-1"), job("SV-2"), job("SV-3")];
    renderFeed({
      filteredJobs: jobs,
      recommendedJobs: jobs,
      hasFilters: false,
      savedOnly: true,
    });
    expect(screen.queryByText("Nothing saved yet")).toBeNull();
    expect(renderedTitles().sort()).toEqual(["JOB SV-1", "JOB SV-2", "JOB SV-3"]);
  });
});
