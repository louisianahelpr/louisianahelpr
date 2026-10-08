/**
 * THE POSTER'S EXPANDED OFFER CARD: THE ROW AND THE META LINE (Q1399; owner,
 * 2026-10-07).
 *
 *   11. "Ask for a new date or time" is a BUTTON on the action row, LEFT of
 *       Message, styled like Message (was an underlined link under the row);
 *       it opens the same request form.
 *    8. On a wide screen the date and time sit on the address's row, at its
 *       right; at phone width the address keeps its own line (jsdom has no
 *       media queries, so the breakpoint classes are what is checked; the
 *       pixels are in the screenshots under ~/.lh-shots/q1399/).
 *
 * @mutate src/pages/posts/postedJobCard/steps/ScheduledStep.tsx |         canAsk && !askedOfMe && ( |         false && (
 * @mutate src/pages/posts/PostedJobCard.tsx | viewer="poster" expanded={isExpanded} hideAsk /> | viewer="poster" expanded={isExpanded} />
 * @mutate src/components/job-card/JobCardMetaRow.tsx |     ? "basis-full shrink-0 max-w-full md:basis-auto md:shrink md:min-w-0" |     ? "basis-full shrink-0 max-w-full md:basis-auto md:shrink md:min-w-0 md:mr-auto"
 * @mutate src/components/job-card/JobCardMetaRow.tsx | fullAddress ? "flex-wrap gap-y-1 md:flex-nowrap" : "flex-nowrap" | fullAddress ? "flex-wrap gap-y-1" : "flex-nowrap"
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { Job } from "@/components/job-card/activityConstants";
import type { PosterStepCtx } from "@/pages/posts/postedJobCard/steps/posterStepContract";
import { blankComments } from "@/test/helpers/blankNonCode";

vi.mock("@/lib/scheduleChange", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/scheduleChange")>()),
  fetchPendingScheduleChange: async () => null,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { ScheduledStep } from "@/pages/posts/postedJobCard/steps/ScheduledStep";
import { JobCardMetaRow } from "@/components/job-card/JobCardMetaRow";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";
import { openMore } from "@/test/helpers/openMore";

const job = {
  id: "job-1",
  title: "clean",
  status: "accepted",
  customer_id: "poster-1",
  helper_id: "helper-1",
  date_needed: jobLocalDateISO(3),
  start_time: "14:00:00",
  helper_confirmed_at: null,
  helper_completed_at: null,
  is_group_job: false,
  parent_job_id: null,
  recurrence_days: null,
} as unknown as Job;

function renderRow(j: Job) {
  const ctx = { job: j, userId: "poster-1", navigate: vi.fn(), onCancel: vi.fn() } as unknown as PosterStepCtx;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ScheduledStep {...ctx} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("11. the date-change ask is a button left of Message", () => {
  it("an unanswered offer has no ask yet: More holds Message | Cancel (owner, 2026-10-08)", async () => {
    renderRow(job);
    // Everything but the primary is under More (owner, 2026-10-08).
    await openMore();
    const labels = [...document.querySelectorAll("[data-job-step-overflow-panel] button")]
      .map((b) => b.textContent?.trim() ?? "")
      .filter((t) => /Ask for a new date or time|Message|Cancel/.test(t));
    expect(labels).toEqual(["Message", "Cancel"]);
  });

  it("once accepted More holds Message | Ask for a new date or time | Cancel, and the ask opens the request form", async () => {
    renderRow({ ...job, helper_confirmed_at: "2026-10-05T17:00:00Z" } as unknown as Job);
    await openMore();
    const labels = [...document.querySelectorAll("[data-job-step-overflow-panel] button")]
      .map((b) => b.textContent?.trim() ?? "")
      .filter((t) => /Ask for a new date or time|Message|Cancel/.test(t));
    // Most important first (owner, 2026-10-08): Message, then the ask, then Cancel.
    expect(labels).toEqual(["Message", "Ask for a new date or time", "Cancel"]);
    fireEvent.click(screen.getByRole("button", { name: /Ask for a new date or time/ }));
    expect(await screen.findByText(/New date or time for "clean"/)).toBeInTheDocument();
  });

  it("not on a crew or recurring job (the request covers one-time jobs only)", async () => {
    renderRow({ ...job, helper_confirmed_at: "2026-10-05T17:00:00Z", is_group_job: true } as unknown as Job);
    await openMore();
    expect(screen.queryByRole("button", { name: /Ask for a new date or time/ })).toBeNull();
  });

  it("the link under the row is gone from the poster's card (the block keeps only a request's state)", () => {
    const card = blankComments(readFileSync("src/pages/posts/PostedJobCard.tsx", "utf8"));
    expect(card).toMatch(/<ScheduleChangeForJob[^>]*viewer="poster"[^>]*hideAsk/);
  });
});

describe("8. wide screens put the date and time on the address's row, right beside it (Q1549)", () => {
  it("the address only takes its own line below md; from md up the row is one line, date/time next to the address", () => {
    render(
      <JobCardMetaRow dateNeeded="2026-10-09" startTime="14:00" location="1103 Center St, New Iberia, LA 70560" expiresAt={null} showFullAddress />,
    );
    const address = screen.getByText("1103 Center St, New Iberia, LA 70560");
    let item: HTMLElement = address;
    while (item.parentElement && !item.parentElement.classList.contains("job-meta-row")) item = item.parentElement;
    for (const c of ["basis-full", "md:basis-auto", "md:min-w-0"]) expect(item.classList.contains(c), c).toBe(true);
    // Not pushed to the far edge (owner, 2026-10-08: "fix that gap").
    expect(item.classList.contains("md:mr-auto")).toBe(false);
    const row = item.parentElement!;
    expect(row.classList.contains("flex-wrap")).toBe(true);
    expect(row.classList.contains("md:flex-nowrap")).toBe(true);
  });
});
