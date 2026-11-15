/**
 * /browse's server-drawn cards must match the app's first render (lead 11-14): since 2df9a3c673 the overlay paints at
 * ~1.5 s on Slow 4G instead of ~3.4 s, so it is on screen for seconds before the app takes over, and any difference
 * reads as a flash or a reorder. Measured on that build (local, guest, 375; ~/.lh-shots/b2-perf-1114/
 * local-browse-film-*): the shell led with "Help move furniture, Wrap Christmas gifts, Hang lights, Deep clean" where
 * the app shows "Deep clean, Help move furniture, Hang lights, Wrap gifts", and every shell card lacked the date ·
 * time group, so each card was a line shorter and the footer stood ~80 px higher.
 *
 *   1. ORDER: the shell's order is the app's default "smart" order for a guest (useDashboardFilters: a live boost
 *      first, then sortJobsSmart's score; ties in the read's order), checked against src/lib/smartSort.ts itself.
 *   2. WHEN: for each kind of day (one day, a window, day + time, flexible time, nothing set), the shell's meta row from
 *      the line break on is the real guest JobCard's: the same text and the same element classes.
 *
 * @mutate src/lib/browseShellCards.mjs |       b.score - a.score \|\| |       0 \|\|
 * @mutate src/lib/browseShellCards.mjs |       Number(boosted(b.j)) - Number(boosted(a.j)) \|\| |       Number(!!b.j.is_urgent) - Number(!!a.j.is_urgent) \|\|
 * @mutate src/lib/browseShellCards.mjs | const RECENCY_HALFLIFE_MS = 4 * 24 * 60 * 60 * 1000; | const RECENCY_HALFLIFE_MS = 1 * 24 * 60 * 60 * 1000;
 * @mutate src/lib/browseShellCards.mjs | </span></span>${shellWhenHtml(job)}</div> | </span></span></div>
 * @mutate src/lib/browseShellCards.mjs |   return isFlexible ? `${clock} · Flexible` : clock; |   return clock;
 * @mutate src/lib/browseShellCards.mjs |   return `Any day ${a}-${a.split(" ")[0] === b.split(" ")[0] ? b.split(" ")[1] : b}`; |   return `Any day ${a}-${b}`;
 */
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/hooks/useFirstPayoutFee", () => ({ useFirstPayoutFeeDollars: () => 0, useFirstPayoutFeeCents: () => 0 }));
vi.mock("@/hooks/useMapKitJs", () => ({ useMapKitJs: () => "idle" }));
vi.mock("@/lib/haptics", () => ({ hapticLight: vi.fn() }));

import JobCard from "@/components/dashboard/JobCard";
import { GUEST_FEE_PERCENT } from "@/components/dashboard/GuestJobPreview";
import { sortJobsSmart } from "@/lib/smartSort";
import type { EnrichedJob } from "@/components/dashboard/types";
import { browseShellHtml, selectShellJobs, SHELL_JOB_COLUMNS } from "@/lib/browseShellCards.mjs";

const NOW = Date.parse("2026-11-14T18:00:00Z");
const row = (o: Record<string, unknown> = {}) => ({
  title: "Mow the front yard", category: "yard_work", budget: 85, location: "Lafayette, LA", status: "open",
  expires_at: null, boost_expires_at: null, boosted_at: null, created_at: "2026-11-13T12:00:00Z", is_urgent: false,
  urgent_fee: 0, is_group_job: false, helpers_needed: 1, date_needed: null, date_window_end: null, start_time: null,
  is_flexible_schedule: false, ...o,
});

describe("the shell's cards are in the app's first-render order", () => {
  it("a live boost first, then smartSort's score, ties in the read's order; urgent does not jump", () => {
    const rows = [
      row({ title: "Cheap and new", budget: 20, created_at: "2026-11-14T17:00:00Z" }),
      row({ title: "Rich and older", budget: 400, created_at: "2026-11-10T12:00:00Z" }),
      row({ title: "Urgent old", is_urgent: true, budget: 60, created_at: "2026-11-01T12:00:00Z" }),
      row({ title: "Boosted", boost_expires_at: "2026-11-15T00:00:00Z", budget: 30, created_at: "2026-11-02T00:00:00Z" }),
      row({ title: "Expired boost", boost_expires_at: "2026-11-14T00:00:00Z", budget: 30, created_at: "2026-11-03T00:00:00Z" }),
      row({ title: "Middle", budget: 116, created_at: "2026-11-12T09:00:00Z" }),
    ];
    // The app's comparator for a guest (useDashboardFilters, sortBy "smart", no parish): boost, then the smart rank.
    const withIds = rows.map((r, i) => ({ ...r, id: `j${i}`, latitude: null, longitude: null, posterSubscriptionTier: null }));
    const rank = new Map(sortJobsSmart(withIds as never[], null, NOW).map((j: { id: string }, i) => [j.id, i]));
    const boosted = (j: { boost_expires_at: string | null }) => !!j.boost_expires_at && Date.parse(j.boost_expires_at) > NOW;
    const app = [...withIds].sort((a, b) => Number(boosted(b)) - Number(boosted(a)) || rank.get(a.id)! - rank.get(b.id)!).map((j) => j.title);
    expect(selectShellJobs(rows, NOW).map((j: { title: string }) => j.title)).toEqual(app.slice(0, 4));
    expect(app[0]).toBe("Boosted");
    expect(app).not.toEqual(["Urgent old", ...app.filter((t) => t !== "Urgent old")]);
  });
});

/** The meta row's elements from the line break on: [tag, class] each, and their text. */
function whenPart(meta: Element | null) {
  if (!meta) return null;
  const start = meta.querySelector("[data-meta-break]");
  const kids = [...meta.children];
  const from = start ? kids.indexOf(start) : -1;
  const part = from < 0 ? [] : kids.slice(from);
  const shape = part.flatMap((el) => [el, ...el.querySelectorAll("*")]).filter((el) => !el.closest("svg") || el.tagName.toLowerCase() === "svg")
    .map((el) => `${el.tagName.toLowerCase()}.${el.getAttribute("class") ?? ""}`);
  return { shape, text: part.map((el) => el.textContent).join("|") };
}

describe("each shell card carries the real card's date and time group", () => {
  const cases: Record<string, Record<string, unknown>> = {
    "one day": { date_needed: "2026-11-29" },
    "one day and a time": { date_needed: "2026-11-29", start_time: "09:00:00" },
    "a time and Flexible": { date_needed: "2026-12-05", start_time: "13:00", is_flexible_schedule: true },
    "a window across months": { date_needed: "2026-11-28", date_window_end: "2026-12-03" },
    "a window in one month": { date_needed: "2026-12-04", date_window_end: "2026-12-10" },
    "only Flexible": { is_flexible_schedule: true },
    "nothing set": {},
  };
  for (const [name, o] of Object.entries(cases)) {
    it(name, () => {
      const r = row(o);
      const job = { ...r, id: "j1", description: "x", updated_at: r.created_at, pricing_mode: "set_price", photos: [] } as unknown as EnrichedJob;
      const { container } = render(
        <MemoryRouter>
          <JobCard job={job} variant="guest" effectiveFee={GUEST_FEE_PERCENT} currentUserId={undefined} showApply onApply={() => {}} onReport={() => {}} onSelect={() => {}} onToggleSave={() => {}} index={0} />
        </MemoryRouter>,
      );
      const real = whenPart(container.querySelector(".job-meta-row"));
      const shellDoc = new DOMParser().parseFromString(browseShellHtml([r], NOW), "text/html");
      const shell = whenPart(shellDoc.querySelector(".job-meta-row"));
      expect(real?.shape.length).toBeGreaterThan(3);
      expect(shell).toEqual(real);
    });
  }

  it("the server reads the columns the group needs", () => {
    for (const c of ["date_needed", "date_window_end", "start_time", "is_flexible_schedule"]) expect(SHELL_JOB_COLUMNS.split(",")).toContain(c);
  });
});
