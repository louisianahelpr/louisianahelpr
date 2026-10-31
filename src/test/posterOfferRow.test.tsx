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
 * @mutate src/components/series/JobSeriesCardControls.tsx | viewer={viewer} expanded={expanded} hideAsk /> | viewer={viewer} expanded={expanded} />
 * @mutate src/components/job-card/JobCardMetaRow.tsx |     ? "basis-full shrink-0 max-w-full md:basis-auto md:shrink md:min-w-0" |     ? "basis-full shrink-0 max-w-full md:basis-auto md:shrink md:min-w-0 md:mr-auto"
 * @mutate src/components/job-card/JobCardMetaRow.tsx | wrapAddress ? "flex-wrap gap-y-1 md:flex-nowrap" : "flex-nowrap" | wrapAddress ? "flex-wrap gap-y-1" : "flex-nowrap"
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { Job } from "@/components/job-card/activityConstants";
import type { PosterStepCtx } from "@/pages/posts/postedJobCard/steps/posterStepContract";
import { blankComments } from "@/test/helpers/blankNonCode";

vi.mock("@/hooks/useJobRescheduled", () => ({ useJobRescheduled: () => false })); // no QueryClient here
vi.mock("@/lib/scheduleChange", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/scheduleChange")>()),
  fetchPendingScheduleChange: async () => null,
}));
vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());

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

// The Change sheet (board 66) carries the time wheel, which scrolls its columns; jsdom has no scrollTo.
if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {};

describe("11. the date-change ask is a button left of Message", () => {
  // Owner, 2026-10-21: while nothing is confirmable, "Message <Helpr>" IS the row's primary, so More
  // no longer carries Message (primaryChipKey); the primary is asserted here too.
  it("an unanswered offer has no ask yet: Message is the primary, More holds Cancel", async () => {
    renderRow(job);
    // Everything but the primary is under More (owner, 2026-10-08).
    await openMore();
    const labels = [...document.querySelectorAll("[data-job-step-overflow-panel] button")]
      .map((b) => b.textContent?.trim() ?? "")
      .filter((t) => /Ask for a new date or time|Message|Cancel/.test(t));
    expect(labels).toEqual(["Cancel"]);
    expect(document.querySelector("[data-job-step-primary]")?.textContent ?? "").toMatch(/^Message /);
  });

  it("once accepted More holds Ask for a new date or time | Cancel (Message is the primary), and the ask opens the Change sheet", async () => {
    renderRow({ ...job, helper_confirmed_at: "2026-10-05T17:00:00Z" } as unknown as Job);
    await openMore();
    const labels = [...document.querySelectorAll("[data-job-step-overflow-panel] button")]
      .map((b) => b.textContent?.trim() ?? "")
      .filter((t) => /Ask for a new date or time|Message|Cancel/.test(t));
    // Most important first (owner, 2026-10-08): the ask, then Cancel; Message is the primary (2026-10-21).
    expect(labels).toEqual(["Ask for a new date or time", "Cancel"]);
    expect(document.querySelector("[data-job-step-primary]")?.textContent ?? "").toMatch(/^Message /);
    fireEvent.click(screen.getByRole("button", { name: /Ask for a new date or time/ }));
    // Board 66: the ask opens the one Change sheet (new time by request, or cancel).
    expect(await screen.findByText("Change this job")).toBeInTheDocument();
  });

  it("not on a crew or recurring job (the request covers one-time jobs only)", async () => {
    renderRow({ ...job, helper_confirmed_at: "2026-10-05T17:00:00Z", is_group_job: true } as unknown as Job);
    await openMore();
    expect(screen.queryByRole("button", { name: /Ask for a new date or time/ })).toBeNull();
  });

  it("the link under the row is gone from the poster's card (the block keeps only a request's state)", () => {
    const card = blankComments(readFileSync("src/pages/posts/PostedJobCard.tsx", "utf8"));
    // Since board 141 the expanded body renders it through JobRequestRows, which always hides the ask.
    expect(card).toMatch(/<JobRequestRows[^>]*viewer="poster"/);
    const rows = blankComments(readFileSync("src/components/series/JobSeriesCardControls.tsx", "utf8"));
    const body = rows.slice(rows.indexOf("export function JobRequestRows"));
    expect(body.length).toBeGreaterThan(100);
    expect(body).toMatch(/<ScheduleChangeForJob[^>]*viewer=\{viewer\}[^>]*hideAsk \/>/);
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
