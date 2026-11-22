/**
 * Jobs audit 11-21 (L23): the job page's top bar held share, "..." and Help, and a long title wrapped to three lines at
 * 375; on a job nobody has applied to, the share icon repeated the card's own "Copy link". Where the page's action row
 * has a "..." menu, the share is its last line and the top bar draws no share icon; with no menu the icon stays.
 *
 * @mutate src/pages/jobs/jobPage/JobPageActionRow.tsx |               <MenuShareLine />\n |
 * @mutate src/pages/jobs/jobPage/JobPageActionRow.tsx |       <MenuShareMark on={menuCount > 0} />\n |
 * @mutate src/pages/jobs/jobPage/JobPage.tsx | const share = canShare && !menuShare.inMenu && !noApplicantsCard ? | const share = canShare ?
 * @mutate src/pages/jobs/jobPage/JobPage.tsx |     <MenuShareProvider value={canShare ? menuShare.ctx : null}> |     <MenuShareProvider value={null}>
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useEffect } from "react";
import { blankComments } from "@/test/helpers/blankNonCode";
import { JobPageActionRow, type RowAction } from "@/pages/jobs/jobPage/JobPageActionRow";
import { MenuShareProvider, useJobMenuShare } from "@/pages/jobs/jobPage/menuShare";
import type { JobPageRow } from "@/pages/jobs/jobPage/useJobPage";

const shareNative = vi.fn(async () => "copied");
vi.mock("@/lib/nativeShare", () => ({ shareNative: (...a: unknown[]) => shareNative(...(a as [])) }));

const JOB = { id: "11111111-1111-1111-1111-111111111111", title: "Hang two shelves", budget: 60, category: "handyman", location: "12 Main St, Lafayette, LA", helper_fee_flat_cents: null, helper_fee_percent: null } as unknown as JobPageRow;
const act = (key: string): RowAction => ({ key, label: key, go: () => {} });

function Page({ extras, onInMenu }: { extras: RowAction[]; onInMenu: (v: boolean) => void }) {
  const share = useJobMenuShare(JOB);
  useEffect(() => { onInMenu(share.inMenu); }, [share.inMenu, onInMenu]);
  return (
    <MenuShareProvider value={share.ctx}>
      <JobPageActionRow tag="poster" lead={act("See applicants")} leadIsStep extras={extras} />
    </MenuShareProvider>
  );
}

describe("the job page's share sits in its \"...\" menu when there is one (L23)", () => {
  it("a row with a menu lists the share last and tells the page (no share icon in the top bar)", async () => {
    const seen: boolean[] = [];
    render(<Page extras={[act("Edit job"), act("Change date or time"), act("Cancel job")]} onInMenu={(v) => seen.push(v)} />);
    expect(seen[seen.length - 1]).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "More options" }));
    const sheet = await screen.findByRole("dialog", { name: "More options" });
    const names = within(sheet).getAllByRole("button").map((b) => b.textContent ?? "").filter((t) => t && t !== "Close");
    // jsdom has no share sheet: the words say what happens (a copy), as ShareJobButton's do.
    expect(names.length).toBeGreaterThan(2);
    expect(names[names.length - 1]).toBe("Copy job link");
    fireEvent.click(within(sheet).getByRole("button", { name: "Copy job link" }));
    expect(shareNative).toHaveBeenCalledWith(expect.objectContaining({ url: `https://www.louisianahelpr.com/jobs/${JOB.id}?ref=share` }));
  });

  it("a row with no menu keeps the icon (the page is told the menu does not hold it)", () => {
    const seen: boolean[] = [];
    render(<Page extras={[act("Edit job")]} onInMenu={(v) => seen.push(v)} />);
    expect(screen.queryByRole("button", { name: "More options" })).toBeNull();
    expect(seen.every((v) => v === false)).toBe(true);
  });

  it("JobPage draws the top-bar icon only when no menu holds the share and no 'No applicants yet' card shows its Copy link", () => {
    const src = blankComments(readFileSync(resolve(__dirname, "../pages/jobs/jobPage/JobPage.tsx"), "utf8"));
    expect(src).toMatch(/const share = canShare && !menuShare\.inMenu && !noApplicantsCard \? <JobHeaderShare job=\{job\} \/> : null;/);
    expect(src).toMatch(/<MenuShareProvider value=\{canShare \? menuShare\.ctx : null\}>/);
    expect(src.match(/<JobHeaderShare /g)).toHaveLength(1);
  });
});
