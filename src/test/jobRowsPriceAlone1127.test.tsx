/**
 * Owner 2026-11-27 (phone screenshots of signed-out Jobs at 390):
 *   1. "Remove after fees from the money part." The Jobs list row's price stands alone ($116, no "after fees" under
 *      it), on every surface that draws that row (JobPrice's chip: Browse, Home's "Jobs near you"; CompactJobCard; the
 *      /browse HTML shell), and on the job's detail, where the same small label sat (JobPrice's pop-up pill, the pop-up
 *      title row's large figure, the job page's HelprPrice). The apply sheet, the chat card, the Applied/Working card,
 *      Search rows and the "Application sent" sentence keep 11-22's note (src/test/helprPayAfterFeesNote.test.ts).
 *   2. "It's hard to tell the difference between location, category, time, day" ... then "keep them ALL ON ONE LINE":
 *      a feed ROW's meta line names each part by its look: the category tinted (its tile's colour), a pin before the
 *      town, a calendar before the day ("Sun 11/29" on a phone, "Sun, Nov 29" from 640px), a clock before the time,
 *      10px apart and no "·" between them. The shell draws the same.
 * (Owner 3, Declutter's repeated sign-up line, is held by phoneCompactBrowse1125 and DeclutterBrowse.guest.)
 *
 * @mutate src/components/dashboard/JobPrice.tsx |       {/* Guest/poster surfaces still see | {!showBudget && <AfterFeesNote />}{/* Guest/poster surfaces still see
 * @mutate src/components/dashboard/helprTakeHome.tsx | </span>}${formatPriceFloor(net)} | </span>}${formatPriceFloor(net)}<AfterFeesNote />
 * @mutate src/pages/jobs/jobPage/JobPageParts.tsx | ${formatPriceFloor(net)}</p> | ${formatPriceFloor(net)}</p><AfterFeesNote />
 * @mutate src/lib/browseShellCards.mjs | ${net}</span></div> | ${net}</span><span data-after-fees="">after fees</span></div>
 * @mutate src/components/dashboard/JobCard.tsx | <MapPin className={row ? JOB_ROW_META_ICON : "w-2.5 h-2.5 shrink-0"} /> | {!row && <MapPin className="w-2.5 h-2.5 shrink-0" />}
 * @mutate src/components/dashboard/JobCard.tsx | {!row && job.date_needed && timeLabel && <span | {job.date_needed && timeLabel && <span
 * @mutate src/components/dashboard/JobCard.tsx | <span className="font-sans whitespace-nowrap sm:hidden">{jobDayLabelShort(job)}</span> | <span className="font-sans whitespace-nowrap sm:hidden">{jobDayLabel(job)}</span>
 * @mutate src/lib/browseShellCards.mjs | <span class="flex items-center gap-1 min-w-[3.625rem] overflow-hidden">${SHELL_PIN_SVG} | <span class="flex items-center gap-1 min-w-[3.625rem] overflow-hidden">
 * @mutate src/components/job/JobCategoryTab.tsx |       style={tinted ? { color: jobCategoryTint(category).color } : undefined} |       style={undefined}
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { blankComments } from "./helpers/blankNonCode";

vi.mock("@/hooks/useFirstPayoutFee", () => ({ useFirstPayoutFeeDollars: () => 0, useFirstPayoutFeeCents: () => 0 }));
vi.mock("@/hooks/useMapKitJs", () => ({ useMapKitJs: () => "idle" }));
vi.mock("@/lib/haptics", () => ({ hapticLight: vi.fn() }));

import JobCard from "@/components/dashboard/JobCard";
import type { EnrichedJob } from "@/components/dashboard/types";
import { browseShellHtml } from "@/lib/browseShellCards.mjs";
import { jobCategoryTint } from "@/lib/jobCategoryTint.mjs";

const code = (p: string) => blankComments(readFileSync(p, "utf8"));
const NOW = Date.parse("2026-11-27T18:00:00Z");
const row = {
  title: "Deep clean 2 bedroom house", category: "cleaning", budget: 130, location: "New Iberia, LA", status: "open",
  expires_at: null, boost_expires_at: null, boosted_at: null, created_at: "2026-11-27T12:00:00Z", is_urgent: false,
  urgent_fee: 0, is_group_job: false, helpers_needed: 1, date_needed: "2032-11-29", date_window_end: null,
  start_time: "09:00", is_flexible_schedule: false,
};
const job = { ...row, id: "j1", description: "x", updated_at: row.created_at, photos: [] } as unknown as EnrichedJob;

function card(props: Record<string, unknown> = {}) {
  return render(
    <MemoryRouter>
      <JobCard job={job} variant="guest" effectiveFee={12} onApply={() => {}} onReport={() => {}} onSelect={() => {}} {...props} />
    </MemoryRouter>,
  ).container;
}

describe("1. the Jobs list row and the job's detail show the price alone (owner 2026-11-27)", () => {
  it("a guest row and a member row: the chip is the figure, no \"after fees\"", () => {
    for (const c of [card(), card({ variant: "default", currentUserId: "someone-else" })]) {
      const chip = c.querySelector(".money-chip")!;
      expect(chip).not.toBeNull();
      expect(chip.querySelector("[data-after-fees]")).toBeNull();
      expect((chip.textContent ?? "").trim()).toMatch(/^\$\d+$/);
    }
  });

  it("no list-row or job-detail surface renders the note; the shell draws none", () => {
    for (const f of ["src/components/dashboard/JobPrice.tsx", "src/components/dashboard/CompactJobCard.tsx", "src/pages/jobs/jobPage/JobPageParts.tsx"]) {
      expect(code(f), f).not.toMatch(/<AfterFeesNote\b/);
    }
    // The pop-up title row's large figure (JobPriceTakeHome bare); its in-sentence form keeps the note.
    const take = code("src/components/dashboard/helprTakeHome.tsx");
    const bare = take.slice(take.indexOf("if (bare) {"), take.indexOf("  return (", take.indexOf("if (bare) {") + 20));
    expect(bare.length).toBeGreaterThan(80);
    expect(bare).not.toMatch(/AfterFeesNote/);
    const shell = browseShellHtml([row], NOW);
    expect(shell).toContain("Deep clean 2 bedroom house");
    expect(shell).not.toMatch(/after fees|data-after-fees/);
  });
});

describe("2. a row's one meta line: tinted category, then pin, calendar and clock, no dots (owner 2026-11-27)", () => {
  it("the real guest row", () => {
    const meta = card().querySelector(".job-meta-row")!;
    expect(meta.className.split(" ")).toContain("gap-x-2.5");
    const label = meta.querySelector<HTMLElement>(".job-cat-label")!;
    expect(label.textContent).toBe("Cleaning");
    expect(label.getAttribute("style")).toContain(jobCategoryTint("cleaning").color);
    // One icon per part, in order: pin (town), calendar (day), clock (time).
    const icons = [...meta.querySelectorAll("svg")].map((s) => s.getAttribute("class")?.match(/lucide-([a-z-]+)/)?.[1]);
    expect(icons).toEqual(["map-pin", "calendar", "clock"]);
    expect(meta.textContent).not.toContain("·");
    // The phone's short day and the wide one, each shown at its own width.
    expect(meta.querySelector(".sm\\:hidden")?.textContent).toMatch(/^[A-Z][a-z]{2} 11\/29$/);
    expect(meta.querySelector(".hidden.sm\\:inline")?.textContent).toMatch(/^[A-Z][a-z]{2}, Nov 29$/);
    expect(meta.querySelector("[data-meta-time]")?.textContent).toBe("9 AM");
  });

  it("the HTML shell draws the same line", () => {
    const doc = new DOMParser().parseFromString(browseShellHtml([row], NOW), "text/html");
    const meta = doc.querySelector(".job-meta-row")!;
    expect(meta).not.toBeNull();
    const icons = [...meta.querySelectorAll("svg")].map((s) => s.getAttribute("class")?.match(/lucide-([a-z-]+)/)?.[1]);
    expect(icons).toEqual(["map-pin", "calendar", "clock"]);
    expect(meta.textContent).not.toContain("·");
    expect(meta.querySelector(".job-cat-label")?.getAttribute("style")).toContain(jobCategoryTint("cleaning").color);
    expect(meta.querySelector(".sm\\:hidden")?.textContent).toMatch(/^[A-Z][a-z]{2} 11\/29$/);
  });
});
