/**
 * Design audit A J1 follow-up (11-08): Jobs Browse's category chips row arrived after the loading frame, so the list
 * moved down ~44 px. The skeleton now draws a chips bone the chips' own height (44 px chips + 4 px pad, like
 * JobCategoryChips) whenever the last loaded Browse drew the row; JobCategoryChips records that (jobChipsSeen.ts).
 * With no record (first visit) there is no bone, so a bone never vanishes either. Owner 11-13: the row now always
 * draws (all 8 groups), so after any Browse the bone is drawn.
 *
 * 2026-11-17 (nightly-red #2436): the chips are FilterChip `tall` (min-h-11, 44 px), like Declutter's row, because the
 * always-drawn row put ten 40 px controls on every signed-in /jobs (e2e-journeys 44101977703, feed-chrome "sub-44px
 * controls"). The bone follows them to h-11, so the list still does not jump when the chips arrive.
 * @mutate src/components/dashboard/JobCategoryChips.tsx | onChange(value === g.id ? null : g.id)} size="tall" className | onChange(value === g.id ? null : g.id)} className
 * @mutate src/components/JobsSectionSkeleton.tsx | <Skeleton className="h-11 w-24 shrink-0 rounded-full" /> | <Skeleton className="h-10 w-24 shrink-0 rounded-full" />
 *
 * @mutate src/components/JobsSectionSkeleton.tsx | <BrowseFrame header={<JobsHeaderBones chips={jobChipsRowSeen()} />} /> | <BrowseFrame header={<JobsHeaderBones />} />
 * @mutate src/components/dashboard/JobCategoryChips.tsx |   useEffect(() => { noteJobChipsRow(true); }, []); |   useEffect(() => {}, []);
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import JobsSectionSkeleton from "@/components/JobsSectionSkeleton";
import { JobCategoryChips } from "@/components/dashboard/JobCategoryChips";

function skeleton() {
  const mm = window.matchMedia;
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
  window.history.replaceState(null, "", "/jobs");
  try {
    return render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={["/jobs"]}><JobsSectionSkeleton /></MemoryRouter>
      </QueryClientProvider>,
    ).container;
  } finally {
    window.matchMedia = mm;
  }
}

describe("the Jobs loading frame reserves the chips row the feed will draw", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  it("after a Browse that drew the chips, the phone skeleton has a 44 px chips bone", () => {
    render(<JobCategoryChips value={null} onChange={() => {}} />);
    cleanup();
    const bone = skeleton().querySelector<HTMLElement>("[data-chips-bone]");
    expect(bone).not.toBeNull();
    expect(bone!.className).toContain("pb-1");
    const bones = [...bone!.children];
    expect(bones.length).toBeGreaterThanOrEqual(3);
    for (const b of bones) expect(b.className).toContain("h-11");
  });

  it("every category chip is the 44 px tall chip, so the row clears the tap floor", () => {
    const { container } = render(<JobCategoryChips value={null} onChange={() => {}} saved={{ on: false, count: 1, onToggle: () => {} }} />);
    const chips = [...container.querySelectorAll<HTMLElement>("[data-category-chip]")];
    // Inventory floor: All + Saved + every Post a job group (JOB_CATEGORY_GROUPS).
    expect(chips.length).toBeGreaterThan(9);
    for (const c of chips) {
      expect(c.className, `chip ${c.dataset.categoryChip}`).toContain("min-h-11");
      expect(c.className, `chip ${c.dataset.categoryChip}`).not.toContain("min-h-10");
    }
  });

  it("with no chips last time (first visit), no bone", () => {
    expect(skeleton().querySelector("[data-chips-bone]")).toBeNull();
  });
});
