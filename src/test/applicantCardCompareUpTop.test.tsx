/**
 * Owner request 2026-10-29 (iPhone screenshot of /posts > Applicants, card "Yusef H."):
 *  1. "Compare" had a row of its own at the bottom of every pending card. It now sits in the card's top-right
 *     icon row, LEFT of the private-note icon: a pill chip with a selected state (aria-pressed), a 44px tap
 *     target, named "Compare <name>". The bottom row is gone, so each card is shorter.
 *  2. The decline x beside Hire was a grey SQUARE (rounded-ds-sm, 32px). It is now the shared Button (outline,
 *     size sm): pill radius, Hire's height, named "Decline <name>".
 * The desktop table (wide) keeps its own Compare column (board 170), untouched.
 *
 * @mutate src/pages/posts/postedJobs/ApplicantsPanel.tsx | <CompareChip id={app.id} name={helperName} ids={compare.ids} toggle={compare.toggle} /> | null
 * @mutate src/pages/posts/postedJobs/applicantsPanel/ApplicantCompare.tsx |       aria-pressed={on} |       aria-pressed={false}
 * @mutate src/pages/posts/postedJobs/applicantsPanel/ApplicantCompare.tsx | ${on ? "btn-grad-primary" : "border border-border bg-card"} | border border-border bg-card
 * @mutate src/pages/posts/postedJobs/applicantsPanel/ApplicantHireRow.tsx |         className="w-11 shrink-0 px-0" |         className="w-11 shrink-0 px-0 !rounded-ds-sm"
 * @mutate src/pages/posts/postedJobs/applicantsPanel/ApplicantHireRow.tsx |         size="sm" |         size="default"
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/pages/posts/postedJobs/useApplicantCategoryCounts", () => ({ useApplicantCategoryCounts: () => null }));
vi.mock("@/hooks/usePaidTierBadge", () => ({ usePaidTierBadge: () => () => null }));
vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "or", "order", "limit", "maybeSingle", "single"]) chain[m] = () => chain;
  chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
  return {
    supabase: {
      from: () => chain,
      rpc: () => Promise.resolve({ data: [], error: null }),
      auth: { getSession: () => Promise.resolve({ data: { session: null }, error: null }) },
      storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: "" } }) }) },
    },
  };
});

import { ApplicantsPanel } from "@/pages/posts/postedJobs/ApplicantsPanel";
import type { EnrichedApplication, Job } from "@/components/job-card/activityConstants";

const JOB = { id: "job-1", title: "Rake the front yard", status: "open", created_at: new Date().toISOString() } as unknown as Job;
const app = (id: string, helper: string, name: string): EnrichedApplication =>
  ({
    id, job_id: JOB.id, helper_id: helper, status: "pending", message: "I can come Saturday.",
    created_at: new Date().toISOString(), profiles: { full_name: name, skills: null, user_id: helper },
  }) as unknown as EnrichedApplication;

function renderPanel(applications: EnrichedApplication[]) {
  const empty = new Map();
  render(
    <MemoryRouter initialEntries={["/posts"]}>
      <ApplicantsPanel
        selectedJob={JOB} setSelectedJob={() => {}} applications={applications} applicationsLoading={false}
        applicationsError={false} onLoadApplications={() => {}} onAcceptApplication={() => {}} onDeclineApplication={() => {}}
        neighborCountMap={empty} completedCountsMap={empty} repeatHireMap={empty} onTimeMap={empty} distanceBandMap={empty}
      />
    </MemoryRouter>,
  );
  return screen.getByRole("region", { name: /Applicants for Rake the front yard/ });
}

describe("applicant card: Compare up top, a round decline (owner 2026-10-29)", () => {
  it("Compare is a pill toggle in the top-right icon row, immediately left of the note icon", () => {
    const region = renderPanel([app("a1", "helper-1", "Yusef Harris"), app("a2", "helper-2", "Ann Boudreaux")]);
    const chips = within(region).getAllByRole("button", { name: /^Compare / });
    expect(chips.length).toBe(2);
    for (const chip of chips) {
      const name = chip.getAttribute("aria-label")!.replace(/^Compare /, "");
      const note = within(region).getByRole("button", { name: new RegExp(`private note on ${name}$`) });
      expect(chip.parentElement, `${name}: Compare shares the icon row`).toBe(note.parentElement);
      const kids = Array.from(note.parentElement!.children);
      expect(kids.indexOf(chip), `${name}: Compare immediately left of the note icon`).toBe(kids.indexOf(note) - 1);
      expect(chip.getAttribute("aria-pressed")).toBe("false");
      expect(chip.className.split(/\s+/)).toContain("min-h-11");
      expect(chip.querySelector(".rounded-full"), `${name}: the visual chip is a pill`).toBeTruthy();
    }
    // No Compare checkbox (the old bottom row) on the phone card.
    expect(within(region).queryByRole("checkbox", { name: /^Compare / })).toBeNull();
  });

  it("pressing Compare selects it: aria-pressed and the shared selected surface", () => {
    const region = renderPanel([app("a1", "helper-1", "Yusef Harris"), app("a2", "helper-2", "Ann Boudreaux")]);
    const chip = within(region).getByRole("button", { name: /^Compare Yusef/ });
    fireEvent.click(chip);
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    expect(chip.querySelector(".btn-grad-primary")).toBeTruthy();
  });

  it("one applicant: nothing to compare, no chip", () => {
    const region = renderPanel([app("a1", "helper-1", "Yusef Harris")]);
    expect(within(region).queryByRole("button", { name: /^Compare / })).toBeNull();
  });

  it("the decline x is the shared pill Button at Hire's height, named for the applicant", () => {
    const region = renderPanel([app("a1", "helper-1", "Yusef Harris"), app("a2", "helper-2", "Ann Boudreaux")]);
    const declines = within(region).getAllByRole("button", { name: /^Decline / });
    expect(declines.length).toBe(2);
    for (const decline of declines) {
      const cls = decline.className.split(/\s+/);
      expect(cls, "pill radius from the shared Button").toContain("rounded-full");
      expect(cls.some((c) => /rounded-ds-sm/.test(c)), "never the old square").toBe(false);
      expect(cls, "Hire's height (Button size sm)").toContain("h-11");
      expect(cls, "as wide as it is tall: a circle").toContain("w-11");
      const hire = Array.from(decline.parentElement!.children).find((c) => /^Select /.test(c.getAttribute("aria-label") ?? ""))!;
      expect(hire.className.split(/\s+/)).toContain("h-11");
    }
  });
});
