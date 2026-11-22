/**
 * Jobs audit 11-21, the visual Mediums (each checked by screenshot at 375 / 768 / 1440 against prod, read-only; evidence
 * in ~/.lh-shots/jobs-fixes2-1121/). These hold the shape in source and render; the screenshots hold the look.
 *
 * P6: the guest job page hand-built its shell (`pt-20 px-5` + `container max-w-lg`): a doubled gutter (content 52-323
 * at 375), the title 352px right of the logo at 1440, no back arrow. It is PublicHeaderPage now, with the town page's
 * 760px column, and the arrow goes back (else Browse).
 * @mutate src/pages/jobs/JobDetail.tsx |       backTo="/browse" |       hideBack
 * @mutate src/pages/jobs/JobDetail.tsx |       headerWrapperClassName={NARROW_HEADER_COLUMN} |
 *
 * P10: the Browse skeleton was the retired bordered card (85px, a tab corner) under no switch row; the list is flat rows
 * (~110-130px) under the "Jobs | Declutter" switch, so the page jumped as it landed.
 * @mutate src/components/ui/skeletons/JobCardSkeleton.tsx |         <div className={JOB_CARD_TEXT_COL}> |         <div className="min-w-0 flex-1">
 * @mutate src/components/sections/GuestSectionSwitch.tsx |   if (at !== "declutter" && !settled) { |   if (false) {
 * @mutate src/components/GuestBrowseSkeleton.tsx |           <div className="chip-row"> |           <div className="hidden">
 *
 * G10: Private note, Report and Block were three 32px icon-only buttons on every applicant row, Block in red at the same
 * weight; one labelled 44px "..." menu now (ApplicantMoreMenu), Block last and red.
 * @mutate src/pages/posts/postedJobs/applicantsPanel/ApplicantMoreMenu.tsx | const ROW = "min-h-11 gap-2 px-3 text-ds-14"; | const ROW = "gap-2 px-3 text-ds-14";
 * @mutate src/pages/posts/postedJobs/applicantsPanel/ApplicantMoreMenu.tsx | size="iconCompact" | size="icon"
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { blankComments } from "./helpers/blankNonCode";
import { JobCardSkeleton } from "@/components/ui/skeletons/JobCardSkeleton";
import { ApplicantMoreMenu } from "@/pages/posts/postedJobs/applicantsPanel/ApplicantMoreMenu";

vi.mock("@/lib/haptics", () => ({ hapticLight: vi.fn() }));

const code = (f: string) => blankComments(readFileSync(f, "utf8"));

describe("P6: the guest job page wears the shared public shell", () => {
  const page = code("src/pages/jobs/JobDetail.tsx");
  it("PublicHeaderPage with a back arrow (back, else Browse) and the 760px column, never the hand-built frame", () => {
    expect(page).toMatch(/<PublicHeaderPage\b[\s\S]*?backTo="\/browse"[\s\S]*?headerWrapperClassName=\{NARROW_HEADER_COLUMN\}/);
    expect(page).toContain('className={`mx-auto ${NARROW_COLUMN}`}');
    expect(page).not.toMatch(/<PublicLayout\b/);
    expect(page).not.toMatch(/pt-20 pb-safe-nav px-5|container mx-auto max-w-lg/);
    // The title is the job's (visible on its own page; read-only for the not-found, error and loading cards).
    expect(page).toMatch(/title=\{headingText\}[\s\S]*?hidesTitle=\{!showsGuestPage\}/);
  });
  it("the town page and the job page share one column definition", () => {
    expect(code("src/pages/info/HireTownPage.tsx")).toContain("const TOWN_COLUMN = NARROW_COLUMN;");
  });
});

describe("P10: the Browse bones are the loaded rows", () => {
  it("a row: the tile, the text column with the meta row's own classes, a hairline; never the bordered card", () => {
    const { container } = render(<JobCardSkeleton />);
    const row = container.querySelector("[data-feed-row-skeleton]")!;
    expect(row.className.split(/\s+/)).toEqual(expect.arrayContaining(["border-b", "border-border"]));
    expect(row.querySelector(".job-card-media-col .job-meta-row [data-meta-break]")).not.toBeNull();
    expect(row.querySelector(".rounded-xl.w-12.h-12")).not.toBeNull();
    const src = code("src/components/ui/skeletons/JobCardSkeleton.tsx");
    expect(src).not.toMatch(/JOB_CARD_(FRAME|CLIP)|JOB_CATEGORY_TAB_FRAME/);
  });
  it("the switch row is held while the sections answer is out, and in the chunk skeleton", () => {
    expect(code("src/components/sections/GuestSectionSwitch.tsx")).toMatch(/if \(at !== "declutter" && !settled\) \{[\s\S]*?data-guest-section-switch-pending=""[\s\S]*?className="chip-row"/);
    expect(code("src/components/GuestBrowseSkeleton.tsx")).toMatch(/data-skeleton-section-switch=""[\s\S]*?className="chip-row"/);
  });
});

describe("G10: the applicant row's note, Report and Block are one labelled menu", () => {
  it("a 44px '...' named for the applicant; three labelled 44px rows, Block last", () => {
    const onNote = vi.fn();
    const onReport = vi.fn();
    const onBlock = vi.fn();
    render(<ApplicantMoreMenu helperName="Eli B." hasNote={false} onNote={onNote} onReport={onReport} onBlock={onBlock} />);
    const trigger = screen.getByRole("button", { name: "More for Eli B." });
    expect(trigger.className).toMatch(/\bh-11\b/);
    fireEvent.keyDown(trigger, { key: "Enter" });
    const items = screen.getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual(["Add a private note", "Report application", "Block Eli B."]);
    for (const i of items) expect(i.className).toMatch(/\bmin-h-11\b/);
    fireEvent.click(items[2]);
    expect(onBlock).toHaveBeenCalled();
  });
  it("both applicant layouts draw the menu and no icon-only note, flag or block button", () => {
    for (const f of ["src/pages/posts/postedJobs/ApplicantsPanel.tsx", "src/pages/posts/postedJobs/applicantsPanel/ApplicantsDesktopTable.tsx"]) {
      const src = code(f);
      expect(src, f).toContain("<ApplicantMoreMenu ");
      expect(src, f).not.toMatch(/icon=\{<(NotebookPen|Flag|Ban)\b/);
    }
  });
});
