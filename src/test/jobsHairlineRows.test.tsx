/**
 * Design audit A J2/J3 (owner approved 11-08, change 1 of 5): the Jobs feed is hairline ROWS, not white cards.
 * Every feed card but the photo hero is a row: no box, fill, radius or shadow, one full-width bottom hairline, a 56 px
 * thumb, and ONE badge however many apply (Boosted > Urgent > Today > Just in > Recommended). The photo hero keeps
 * its card. The owner's equal-height rule (Q2043, the poster line keeps its 20 px) still holds, so a row is ~100 px.
 * The pre-boot Browse shell mirrors the row (browseShellCards.test.tsx).
 *
 * @mutate src/components/dashboard/JobCard.tsx |   const row = !bare && !(hero && job.photos?.[0]); |   const row = false;
 * @mutate src/index.css | [data-feed-card][data-feed-row] {\n  background-color: transparent !important; | [data-feed-card][data-feed-row] {\n  background-color: hsl(var(--card)) !important;
 * @mutate src/components/dashboard/JobCardMedia.tsx | const JOB_CARD_MEDIA = "relative shrink-0 self-start w-14 h-14 | const JOB_CARD_MEDIA = "relative shrink-0 self-start w-[4.5rem] h-[4.5rem]
 * @mutate src/components/dashboard/SwipeableJobCard.tsx | ${hero && job.photos?.[0] ? "rounded-2xl" : ""} | rounded-2xl
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { blankComments, blankCssComments } from "./helpers/blankNonCode";
import JobCard from "@/components/dashboard/JobCard";
import type { EnrichedJob } from "@/components/dashboard/types";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";

vi.mock("@/hooks/useFirstPayoutFee", () => ({ useFirstPayoutFeeDollars: () => 0, useFirstPayoutFeeCents: () => 0 }));
vi.mock("@/hooks/useMapKitJs", () => ({ useMapKitJs: () => "idle" }));
vi.mock("@/lib/haptics", () => ({ hapticLight: vi.fn() }));

function job(overrides: Partial<EnrichedJob> = {}): EnrichedJob {
  return {
    id: "job-1", title: "Mow the front yard", description: "Front and back.", category: "yard_work", budget: 60,
    location: "Lafayette, LA", parish: "Lafayette", date_needed: jobLocalDateISO(0), start_time: null,
    created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 9 * 86_400_000).toISOString(),
    customer_id: "poster-1", is_urgent: true, urgent_fee: 0, is_group_job: false, helpers_needed: 1, is_recurring: false,
    ...overrides,
  } as unknown as EnrichedJob;
}
const draw = (j: EnrichedJob, extra: { hero?: boolean } = {}) =>
  render(<JobCard job={j} effectiveFee={0.15} onApply={vi.fn()} onReport={vi.fn()} onSelect={vi.fn()} recommended {...extra} />).container;

const css = blankCssComments(readFileSync("src/index.css", "utf8"));
const swipe = blankComments(readFileSync("src/components/dashboard/SwipeableJobCard.tsx", "utf8"));

describe("the Jobs feed is hairline rows (design audit A J2/J3, 11-08)", () => {
  afterEach(cleanup);

  it("a feed card is a row: no box, fill, radius or shadow; one bottom hairline; a 56 px thumb", () => {
    const root = draw(job()).querySelector<HTMLElement>("[data-feed-card]")!;
    expect(root.hasAttribute("data-feed-row")).toBe(true);
    const cls = root.className.split(/\s+/);
    expect(cls).toEqual(expect.arrayContaining(["border-b", "border-border"]));
    expect(cls.filter((c) => /^(rounded|bg-|shadow)/.test(c) || c === "border")).toEqual([]);
    const media = root.querySelector<HTMLElement>("[data-testid=job-card-media]")!;
    expect(media.className.split(/\s+/)).toEqual(expect.arrayContaining(["w-14", "h-14"]));
    expect(media.className).not.toMatch(/md:w-|md:h-/);
  });

  it("the stylesheet keeps a row unpainted in both themes, over the shared card rule", () => {
    const rule = (sel: string) => [...css.matchAll(/([^{}@;]+)\{([^{}]*)\}/g)].find((m) => m[1].trim() === sel)?.[2] ?? "";
    const row = rule("[data-feed-card][data-feed-row]");
    expect(row).toMatch(/background-color:\s*transparent !important/);
    expect(row).toMatch(/box-shadow:\s*none !important/);
    expect(row).toMatch(/border-radius:\s*0 !important/);
    expect(row).toMatch(/border-bottom-color:\s*hsl\(var\(--border\)\) !important/);
    expect(rule(':root[data-theme="dark"] [data-feed-card][data-feed-row]')).toMatch(/background-color:\s*transparent !important/);
    // The swipe layer's clip would cut a row's hairline at its rounded corners: only the photo hero is rounded.
    expect(swipe).toContain('${hero && job.photos?.[0] ? "rounded-2xl" : ""}');
  });

  it("ONE badge, even when urgent, today, just posted and recommended all apply; none at all when nothing does", () => {
    const c = draw(job({ isBoosted: true } as Partial<EnrichedJob>));
    expect(c.querySelectorAll("[data-job-badge]")).toHaveLength(1);
    expect(c.querySelector("[data-job-badge]")?.getAttribute("data-job-badge")).toBe("boosted");
    cleanup();
    expect(draw(job()).querySelector("[data-job-badge]")?.getAttribute("data-job-badge")).toBe("urgent");
    cleanup();
    const quiet = render(<JobCard job={job({ is_urgent: false, date_needed: jobLocalDateISO(5), created_at: "2026-01-01T00:00:00Z" })} effectiveFee={0.15} onApply={vi.fn()} onReport={vi.fn()} onSelect={vi.fn()} />).container;
    expect(quiet.querySelectorAll("[data-job-badge]")).toHaveLength(0);
    // The empty badge line takes no room (empty:hidden), so the title starts the row.
    expect(quiet.querySelector("[data-job-badge-line]")?.childElementCount).toBe(0);
    expect(quiet.querySelector("[data-job-badge-line]")?.className).toContain("empty:hidden");
  });

  it("a row names its category on the place line; the photo hero keeps its card", () => {
    const c = draw(job());
    expect(c.querySelector(".job-meta-row .job-cat-label")?.textContent).toMatch(/Yard/);
    cleanup();
    const hero = draw(job({ photos: ["https://example.test/a.jpg"] } as Partial<EnrichedJob>), { hero: true });
    const root = hero.querySelector<HTMLElement>("[data-feed-card]")!;
    expect(root.hasAttribute("data-feed-row")).toBe(false);
    expect(root.className).toContain("rounded-2xl");
  });
});
