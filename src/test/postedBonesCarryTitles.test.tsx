/**
 * Q2705 (11-17): while the Posted tab's card code is on its way, its bones carry the first cards' REAL titles.
 *
 * prod-audit 44032555275 (Slow 4G + 4x CPU, 375) read Jobs > Posted's largest paint, the first card's title, at
 * 10872 ms. With the lean posted core the rows are in at ~5.0 s (cwv-lab, local build), but PostedJobsTab's chunk
 * (~300 KB gz with its closure) lands ~3 s later; the bones now print each first card's title in MineJobFace's own
 * title type, so the reader sees their jobs (2026-11-17 lab, `npm run build`: LCP 8848 -> 5084 ms, median of 3; the titles draw at 5.0 s, the full
 * cards at 8.0 s in the same boxes, CLS unchanged at 0.0076).
 *
 * @mutate src/components/ui/skeletons/ApplicationCardSkeleton.tsx | <ApplicationCardSkeleton key={i} {...shape} title={titles[i] \|\| undefined} /> | <ApplicationCardSkeleton key={i} {...shape} />
 * @mutate src/components/ui/skeletons/ApplicationCardSkeleton.tsx |   return <MineFaceSkeleton tracker={tracker} address={address} title={title} />; |   return <MineFaceSkeleton tracker={tracker} address={address} />;
 * @mutate src/components/job-card/JobListPage.tsx | <PostedListBones filter={statusFilter} titles={firstCardTitles(filteredPostedJobs, statusFilter, pendingApplicantCounts)} /> | <PostedListBones filter={statusFilter} />
 * @mutate src/components/job-card/JobListPage.tsx | useActivityData(user, tab, { leanFirst, holdWhole: !postedTabIn }) | useActivityData(user, tab)
 * @mutate src/components/job-card/JobListPage.tsx |     if (group.length) return group.slice(0, 3).map(title); |     if (group.length) return group.map(title);
 */
import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PostedListBones, MINE_FACE_BOXES } from "@/components/ui/skeletons/ApplicationCardSkeleton";
import { blankComments } from "@/test/helpers/blankNonCode";

afterEach(cleanup);

const ROOT = resolve(__dirname, "../..");
const page = blankComments(readFileSync(resolve(ROOT, "src/components/job-card/JobListPage.tsx"), "utf8"));

describe("Posted's bones carry the first cards' titles (Q2705)", () => {
  it("prints each given title in the face's own title type, and bone lines for the rest", () => {
    const { container } = render(<PostedListBones filter="all" titles={["Mow a front lawn", "Paint a fence"]} />);
    const titles = [...container.querySelectorAll("[data-bones-title]")];
    expect(titles.map((t) => t.textContent)).toEqual(["Mow a front lawn", "Paint a fence"]);
    for (const t of titles) for (const c of MINE_FACE_BOXES.title.split(" ")) expect(t.classList.contains(c), c).toBe(true);
    // Four face cards as before; the two without a title keep their bone lines.
    expect(container.querySelectorAll("[data-mine-face-skeleton]")).toHaveLength(4);
  });

  it("without titles it is the plain bones", () => {
    const { container } = render(<PostedListBones filter="waiting" />);
    expect(container.querySelectorAll("[data-bones-title]")).toHaveLength(0);
    expect(container.querySelectorAll("[data-mine-face-skeleton]")).toHaveLength(4);
  });

  it("JobListPage draws them while the tab's code is out, from the rows it already has, and reads lean-first", () => {
    expect(page).toContain("<PostedListBones filter={statusFilter} titles={firstCardTitles(filteredPostedJobs, statusFilter, pendingApplicantCounts)} />");
    expect(page).toMatch(/tab === "posted" && !postedTabIn && \(/);
    expect(page).toContain("useActivityData(user, tab, { leanFirst, holdWhole: !postedTabIn })");
    // The first open group's first PREVIEW (3) cards, as ActivityBucketGroups draws them.
    expect(page).toContain("return group.slice(0, 3).map(title);");
    // Inventory floor: the lean-first gate names every condition (no deep link, no search, a lean-covered filter).
    const gate = page.slice(page.indexOf("const leanFirst ="), page.indexOf("LEAN_FIRST_FILTERS.has(statusFilter)"));
    expect(["deepLinkJobId", "highlightJobId", "manageJobId", "applicantsJobId", "searchQuery"].filter((n) => gate.includes(n)).length).toBeGreaterThan(4);
  });
});
