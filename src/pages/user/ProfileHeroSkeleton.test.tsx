/**
 * The /user/:id loading masthead reserves the REAL masthead's geometry.
 *
 * loading-states-refresh 36158775025 (2026-09-25) measured both personas on
 * both test profiles: the record-strip bones stood 4 rows of 64px where the
 * profile's identity block (147-183px) landed, and the hero card 291px where
 * 247-386px arrived. The tiles were hand-drawn `p-3` boxes in a plain
 * `grid-cols-2` (64px against AtAGlanceCard's 58px, and 2x2 at 1440 where the
 * real strip is 1x4), the identity column was three bars, and a 160px bone
 * below the card held space for sections that were deleted.
 *
 * Same pattern as src/components/ui/skeletons/skeletons.test.tsx: jsdom has no
 * layout, so what is proven is the shared SOURCE of the geometry (each side
 * wears the exported constant); the pixels are measured on prod by
 * scripts/audit/measure-loading-states.mjs.
 *
 * @mutate src/pages/user/ProfileHeroSkeleton.tsx | <div className={AT_A_GLANCE_GRID}> | <div className="grid grid-cols-2 gap-2">
 * @mutate src/pages/user/ProfileHeroSkeleton.tsx | <div key={i} className={METRIC_CELL_FRAME} | <div key={i} className="rounded-ds-md p-3 space-y-2"
 * @mutate src/pages/user/AtAGlanceCard.tsx | <div className={AT_A_GLANCE_GRID}> | <div className="grid grid-cols-2 gap-2">
 * @mutate src/pages/user/UserProfile.tsx |             <ProfileHeroSkeleton /> |             <div className="h-40 rounded-2xl liquid-glass motion-safe:animate-pulse" />
 * @mutate src/pages/user/UserProfile.tsx |       <div className="h-10 w-10 rounded-ds-md bg-muted motion-safe:animate-pulse" />\n    </div>\n  ) : null; |       <div className="h-10 w-10 rounded-ds-md bg-muted motion-safe:animate-pulse" />\n      <div className="h-10 w-10 rounded-ds-md bg-muted motion-safe:animate-pulse" />\n    </div>\n  ) : null;
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ProfileHeroSkeleton } from "./ProfileHeroSkeleton";
import { AtAGlanceCard, AT_A_GLANCE_GRID, METRIC_CELL_FRAME } from "./AtAGlanceCard";
import { PROFILE_HERO_AVATAR, PROFILE_HERO_CARD } from "./ProfileHeaderCard";
import { blankComments } from "@/test/helpers/blankNonCode";

const noop = () => {};

describe("ProfileHeroSkeleton wears the real masthead's frames", () => {
  it("the record strip is AtAGlanceCard's grid and tiles, four of them", () => {
    const { container } = render(<ProfileHeroSkeleton />);
    const grids = [...container.querySelectorAll("div")].filter((d) => d.className === AT_A_GLANCE_GRID);
    expect(grids).toHaveLength(1);
    const tiles = [...grids[0].children];
    expect(tiles).toHaveLength(4);
    for (const t of tiles) expect(t.className).toBe(METRIC_CELL_FRAME);
  });

  it("the card and the avatar are ProfileHeaderCard's", () => {
    const { container } = render(<ProfileHeroSkeleton />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toBe(PROFILE_HERO_CARD);
    expect(container.querySelector(`[class^="${PROFILE_HERO_AVATAR}"]`)).not.toBeNull();
  });

  it("the real AtAGlanceCard wears the same two constants (both sides of the share)", () => {
    render(
      <AtAGlanceCard
        isOwnProfile={false}
        displayName="Hallie H."
        memberSinceLabel="Aug 2026"
        stats={{ completedJobs: 16, avgRating: 5, reviewCount: 1 }}
        postedJobsCount={4}
        workedJobsCount={16}
        replyLatency={{ medianReplyMinutes: null, replySample: 0, measured: false }}
        onTimeArrivalRate={null}
        revisionFrequency={null}
        repeatHirePercent={null}
        mutualJobsCount={3}
        showReviews={false}
        showPostedJobs={false}
        showWorkedJobs={false}
        onToggleReviews={noop}
        onTogglePosted={noop}
        onToggleWorked={noop}
      />,
    );
    const grid = screen.getByRole("region", { name: "At a glance" }).firstElementChild as HTMLElement;
    expect(grid.className).toBe(AT_A_GLANCE_GRID);
    expect(grid.children).toHaveLength(4);
    for (const t of grid.children) expect(t.className.startsWith(METRIC_CELL_FRAME)).toBe(true);
  });

  it("every frame constant is a real class string, so the checks above can bite", () => {
    expect(METRIC_CELL_FRAME).toMatch(/min-h-\[58px\]/);
    expect(AT_A_GLANCE_GRID).toMatch(/sm:grid-cols-4/);
  });
});

describe("UserProfile's loading branch", () => {
  const src = blankComments(readFileSync(resolve(__dirname, "UserProfile.tsx"), "utf8"));
  const loading = src.slice(src.indexOf("if (loading || blockCheckPending) {"), src.indexOf("if (isError) {"));

  it("renders the shared masthead skeleton and no bone for deleted sections", () => {
    expect(loading.length).toBeGreaterThan(200);
    expect(loading).toMatch(/<ProfileHeroSkeleton \/>/);
    expect(loading).not.toMatch(/h-40/);
  });

  it("reserves one header bone per loaded header control (Save, overflow menu)", () => {
    const block = src.slice(src.indexOf("const headerActionPlaceholder"), src.indexOf(") : null;", src.indexOf("const headerActionPlaceholder")));
    expect(block.match(/h-10 w-10 rounded-ds-md bg-muted/g)).toHaveLength(2);
    const actions = src.slice(src.indexOf("titleActions={\n          !isOwnProfile"), src.indexOf("</DropdownMenuTrigger>"));
    expect(actions).toMatch(/<SaveHelperButton /);
    expect(actions.match(/<Button /g)).toHaveLength(1);
  });
});
