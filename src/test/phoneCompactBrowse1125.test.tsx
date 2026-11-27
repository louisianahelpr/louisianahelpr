/**
 * Owner 11-25 (phone screenshots of Jobs and Declutter, signed in and out):
 *   1. "move the category chips into the filter bc they take up too much space here" / "Same here": no category chip row
 *      on any Browse (Jobs, Declutter; member, guest, the app). Category is the FIRST section of each Filters sheet, and
 *      a category that is on stays visible as one small removable chip ("Home decor ×", "Home ×").
 *   2. "there is no way for signed out people to see the gift guides": the app's signed-out top bar carries the gift
 *      icon (to /gift-guides), with one "Join / Log in" pill (owner 11-22's phone header words) and the logo.
 *   3. "This needs polishing. They take up too much space." (signed-out Jobs list): compact job rows (40px tile, 10px
 *      above and below, ONE meta line with no calendar or clock icon, semibold title, no empty poster line on a
 *      guest card), and the guest Declutter's sign-up card is one slim line.
 *   4. Lead 11-25: with the chips gone, the app's signed-out Jobs bar gets the Filters icon (members' already had it).
 *
 * @mutate src/components/declutter/DeclutterFilterPanel.tsx |   sections.unshift(...sections.splice(at, 1)); |   sections.push(...sections.splice(at, 1));
 * @mutate src/components/dashboard/filterSheet/jobFilterSections.tsx |       key: "category", |       key: "category-moved",
 * @mutate src/components/declutter/DeclutterActiveFilters.tsx |   if (f.category) { |   if (f.category && false) {
 * @mutate src/components/dashboard/JobActiveFilters.tsx |   if (category) pills.push | if (category && false) pills.push
 * @mutate src/pages/home/GuestAuthActions.tsx |         to="/gift-guides" |         to="/browse"
 * @mutate src/components/sections/AppTopBar.tsx |       {guestBar && ( |       {false && (
 * @mutate src/components/dashboard/JobCard.tsx |           {!isGuest && ( |           {(
 * @mutate src/components/job/cardGeometry.ts | export const JOB_ROW_MEDIA = "relative shrink-0 self-start w-10 h-10 | export const JOB_ROW_MEDIA = "relative shrink-0 self-start w-12 h-12
 * @mutate src/components/declutter/DeclutterGuest.tsx |   if (!want) return null; |   if (false) return null;
 * @mutate src/pages/home/DashboardGuest.tsx |               filter={<BrowseFiltersButton filters={filters} filtersButtonRef={filtersButtonRef} />} />} /> |               />} />
 * @mutate src/index.css |   [data-feed-row] .job-card-media-col .job-meta-row { flex-wrap: nowrap; } |   [data-feed-row] .job-card-media-col .job-meta-row { flex-wrap: wrap; }
 * @mutate src/components/dashboard/JobCard.tsx | <Clock className={row ? JOB_ROW_META_ICON : "w-2.5 h-2.5 shrink-0"} /> | {!row && <Clock className="w-2.5 h-2.5 shrink-0" />}
 * @mutate src/pages/home/Dashboard.tsx |     <JobActiveFilters category={filters.selectedCategory} | <JobCategoryChips value={filters.selectedCategory}
 */
import { readFileSync, existsSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { blankComments } from "./helpers/blankNonCode";
import { declutterFilterSections } from "@/components/declutter/DeclutterFilterPanel";
import { activeFilterPills } from "@/components/declutter/DeclutterActiveFilters";
import { buildJobFilterSections } from "@/components/dashboard/filterSheet/jobFilterSections";
import { JobActiveFilters } from "@/components/dashboard/JobActiveFilters";
import { GuestAuthActions } from "@/pages/home/GuestAuthActions";
import { JOB_ROW_BODY, JOB_ROW_MEDIA, JOB_ROW_MEDIA_PAD } from "@/components/job/cardGeometry";
import { SHELL_CARD_CLASSES } from "@/lib/browseShellCards.mjs";
import { NO_FILTERS } from "@/lib/declutter/browseFilters";
import JobCard from "@/components/dashboard/JobCard";
import type { EnrichedJob } from "@/components/dashboard/types";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";

vi.mock("@/hooks/useFirstPayoutFee", () => ({ useFirstPayoutFeeDollars: () => 0, useFirstPayoutFeeCents: () => 0 }));
vi.mock("@/hooks/useMapKitJs", () => ({ useMapKitJs: () => "idle" }));
vi.mock("@/lib/haptics", () => ({ hapticLight: vi.fn() }));

afterEach(cleanup);

const code = (p: string) => blankComments(readFileSync(p, "utf8"));

/** Every Browse surface that drew (or could draw) a category chip row: members' and guests', Jobs' and Declutter's. */
const BROWSE_SURFACES = [
  "src/components/declutter/DeclutterBrowseView.tsx",
  "src/components/declutter/DeclutterHomeView.tsx",
  "src/components/declutter/DeclutterGuestHome.tsx",
  "src/pages/home/Dashboard.tsx",
  "src/pages/home/DashboardGuest.tsx",
  "src/pages/jobs/JobsSection.tsx",
  "src/components/JobsSectionSkeleton.tsx",
];

describe("1. no category chip row on Browse; Category leads Filters", () => {
  it("no Browse surface draws a category chip row (the row components are gone)", () => {
    expect(BROWSE_SURFACES.length).toBeGreaterThan(5);
    for (const f of BROWSE_SURFACES) {
      const src = code(f);
      expect(src, f).not.toMatch(/\bDeclutterCategoryChips\b|\bJobCategoryChips\b|data-chip-row|DeclutterChipBones|data-chips-bone/);
    }
    expect(existsSync("src/components/declutter/DeclutterCategoryChips.tsx")).toBe(false);
    expect(existsSync("src/components/dashboard/JobCategoryChips.tsx")).toBe(false);
  });

  it("Declutter's Filters sheet opens with Category, unfolded", () => {
    const sections = declutterFilterSections({
      filters: NO_FILTERS, onChange: () => {}, maxMiles: null, onMaxMiles: () => {},
      ask: { origin: { status: "none", zipOnFile: false }, asked: false, asking: false, canAskAgain: false, deviceNote: null, askDevice: () => {}, zip: null, guest: true } as never,
      showDrops: true,
    });
    expect(sections.length).toBeGreaterThan(4);
    expect(sections[0].key).toBe("category");
    expect(sections[0].more).toBeFalsy();
  });

  it("Jobs' Filters sheet (members and guests: one builder) opens with Category", () => {
    const sections = buildJobFilterSections({
      selectedCategory: null, setSelectedCategory: () => {}, sortBy: "newest", setSortBy: () => {},
      expiresWithin: "", setExpiresWithin: () => {}, boostedOnly: false, setBoostedOnly: () => {}, urgentOnly: false, setUrgentOnly: () => {},
      setMinBudget: () => {}, setMaxBudget: () => {}, setJobWhen: () => {}, setLocationFilter: () => {},
    });
    expect(sections.length).toBeGreaterThan(4);
    expect(sections[0].key).toBe("category");
  });

  it("a Declutter category that is on shows first as a removable chip, and Free too", () => {
    const pills = activeFilterPills({ ...NO_FILTERS, category: "home_decor", freeOnly: true }, null);
    expect(pills.map((p) => p.key)).toEqual(["category", "free"]);
    expect(pills[0].label).toBe("Home decor");
    expect(pills[0].clear({ ...NO_FILTERS, category: "home_decor" }, null).filters.category).toBeNull();
  });

  it("a Jobs category that is on shows as one removable chip, and pressing it clears it", () => {
    const clear = vi.fn();
    render(<JobActiveFilters category="home" onClearCategory={clear} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove filter: Home" }));
    expect(clear).toHaveBeenCalledTimes(1);
    cleanup();
    const { container } = render(<JobActiveFilters category={null} onClearCategory={clear} />);
    expect(container.innerHTML).toBe("");
  });

  it("member Jobs Browse draws the filters-on chips where the chip row was", () => {
    expect(code("src/pages/home/Dashboard.tsx")).toMatch(/<JobActiveFilters category=\{filters\.selectedCategory\}/);
  });
});

describe("2. the app's signed-out top bar has the gift guides", () => {
  it("the guest actions are the gift icon (to /gift-guides, named Gift guides) and one Join / Log in pill", () => {
    const signup = vi.fn();
    render(<MemoryRouter><GuestAuthActions onSignup={signup} /></MemoryRouter>);
    const gift = screen.getByRole("link", { name: "Gift guides" });
    expect(gift.getAttribute("href")).toBe("/gift-guides");
    fireEvent.click(screen.getByRole("button", { name: "Join / Log in" }));
    expect(signup).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Log in")).toBeNull();
  });

  it("AppTopBar draws them on its signed-out bar", () => {
    expect(code("src/components/sections/AppTopBar.tsx")).toMatch(/\{guestBar && \(\s*<div className="flex items-center" data-testid="top-bar-guest">\s*<GuestAuthActions /);
  });
});

describe("3. compact job rows and a slim guest sign-up line", () => {
  const job = {
    id: "job-1", title: "Deep clean 2 bedroom house", description: "x", category: "cleaning", budget: 120,
    location: "New Iberia, LA", parish: "Iberia", date_needed: null, start_time: null,
    created_at: new Date(Date.now() - 86_400_000).toISOString(), expires_at: new Date(Date.now() + 9 * 86_400_000).toISOString(),
    customer_id: "poster-1", is_urgent: false, urgent_fee: 0, is_group_job: false, helpers_needed: 1, is_recurring: false,
  } as unknown as EnrichedJob;

  it("the row's tile is 40px in 10px padding, and the pre-boot shell wears the same classes", () => {
    expect(JOB_ROW_MEDIA.split(/\s+/)).toEqual(expect.arrayContaining(["w-10", "h-10"]));
    expect(JOB_ROW_MEDIA_PAD).toBe("py-2.5");
    expect(SHELL_CARD_CLASSES.media).toBe(JOB_ROW_MEDIA);
    expect(SHELL_CARD_CLASSES.mediaPad).toBe(JOB_ROW_MEDIA_PAD);
    expect(SHELL_CARD_CLASSES.body).toBe(JOB_ROW_BODY);
    expect("face" in SHELL_CARD_CLASSES).toBe(false);
  });

  it("a guest card draws no empty poster line; a member's card keeps the poster's face", () => {
    const guest = render(<JobCard job={job} variant="guest" effectiveFee={0.15} onApply={vi.fn()} onReport={vi.fn()} onSelect={vi.fn()} />).container;
    expect(guest.querySelector("[data-testid=job-card-media]")!.className).toContain("w-10");
    expect(guest.querySelector("[data-testid=job-card-poster]")).toBeNull();
    cleanup();
    const member = render(<JobCard job={{ ...job, posterName: "Lexi" } as EnrichedJob} effectiveFee={0.15} onApply={vi.fn()} onReport={vi.fn()} onSelect={vi.fn()} />).container;
    expect(member.querySelector("[data-testid=job-card-poster]")).not.toBeNull();
  });

  // Owner 2026-11-27 reversed 11-25's "no calendar or clock icon": the one line names each part by its icon instead of
  // "·" (src/test/jobRowsPriceAlone1127.test.tsx). Still ONE line from 360px, still "9 AM".
  it("a row's meta is ONE line from 360px, with a clock before the time, and says 9 AM for 9:00 AM", () => {
    const css = readFileSync("src/index.css", "utf8");
    expect(css).toMatch(/@media \(min-width: 360px\) \{\s*\[data-feed-row\] \.job-card-media-col \.job-meta-row \{ flex-wrap: nowrap; \}/);
    const row = render(<JobCard job={{ ...job, date_needed: jobLocalDateISO(4), start_time: "09:00" } as EnrichedJob} variant="guest" effectiveFee={0.15} onApply={vi.fn()} onReport={vi.fn()} onSelect={vi.fn()} />).container;
    const meta = row.querySelector(".job-meta-row")!;
    expect(meta.querySelector("[data-meta-time] .lucide-clock")).not.toBeNull();
    expect(meta.querySelector("[data-meta-time]")!.textContent).toBe("9 AM");
  });

  it("the app's signed-out Jobs bar has the Filters icon", () => {
    expect(code("src/pages/home/DashboardGuest.tsx")).toMatch(/<SectionSearchBar noun="jobs" home="\/browse"[^>]*\s+filter=\{<BrowseFiltersButton filters=\{filters\} filtersButtonRef=\{filtersButtonRef\} \/>\}/);
  });

  // Owner 2026-11-27 ("there is a repetitive sign up"): 11-25's slim line is gone too; the top bar's "Join / Log in" is
  // the one way in. DeclutterBrowse.guest.test.tsx renders it.
  it("guest Declutter's plain visit draws no sign-up card at all", () => {
    const src = code("src/components/declutter/DeclutterGuest.tsx");
    expect(src).toMatch(/if \(!want\) return null;/);
    expect(src).not.toContain("data-guest-join-slim");
  });
});
