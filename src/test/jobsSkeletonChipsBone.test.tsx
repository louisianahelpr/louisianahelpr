/**
 * Design audit A J1 follow-up (11-08): Jobs Browse's category chips row arrived after the loading frame, so the list
 * moved down ~44 px. The skeleton now draws a chips bone the chips' own height (40 px chips + 4 px pad, like
 * JobCategoryChips) whenever the last loaded Browse drew the row; JobCategoryChips records that (jobChipsSeen.ts).
 * With no record (first visit, or a feed with under two groups) there is no bone, so a bone never vanishes either.
 *
 * @mutate src/components/JobsSectionSkeleton.tsx | <BrowseFrame header={<JobsHeaderBones chips={jobChipsRowSeen()} />} /> | <BrowseFrame header={<JobsHeaderBones />} />
 * @mutate src/components/dashboard/JobCategoryChips.tsx |   useEffect(() => { noteJobChipsRow(shown); }, [shown]); |   useEffect(() => {}, [shown]);
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
    render(<JobCategoryChips jobs={[{ category: "moving" }, { category: "lawn_care" }, { category: "cleaning" }]} value={null} onChange={() => {}} />);
    cleanup();
    const bone = skeleton().querySelector<HTMLElement>("[data-chips-bone]");
    expect(bone).not.toBeNull();
    expect(bone!.className).toContain("pb-1");
    const bones = [...bone!.children];
    expect(bones.length).toBeGreaterThanOrEqual(3);
    for (const b of bones) expect(b.className).toContain("h-10");
  });

  it("with no chips last time (one group, or first visit), no bone", () => {
    expect(skeleton().querySelector("[data-chips-bone]")).toBeNull();
    cleanup();
    render(<JobCategoryChips jobs={[{ category: "moving" }]} value={null} onChange={() => {}} />);
    cleanup();
    expect(skeleton().querySelector("[data-chips-bone]")).toBeNull();
  });
});
