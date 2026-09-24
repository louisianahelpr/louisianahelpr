/*
 * AN UNPAID JOB MUST HAVE A ROUTE BACK.
 *
 * Owner, 2026-09-21: "waiting should not show needs you or finish paying to
 * post it… a job can never be posted if it was enver paid for", and on where it
 * belongs instead: "It would be in post a job, drafts. The job can never be
 * posted anywhere or move forward until it's paid."
 *
 * The first half of that shipped as `jobIsUnfundedDraft`, which removes these
 * rows from My Posts. That was right on its own terms — every browse feed
 * already filtered them out, so My Posts was rendering a healthy "Waiting" card
 * for a job no Helpr could ever see — but removing them with nowhere to go left
 * an abandoned checkout INVISIBLE and unreachable. A poster who closed the tab
 * mid-Stripe had no way back to their own job.
 *
 * This guard is the pair to that filter: whatever My Posts stops showing, Post
 * a Job has to show. The two rules are read from one predicate
 * (UNPAID_DRAFT_PAYMENT_STATES) so they cannot drift into a state that is
 * filtered from one surface and absent from the other — invisible everywhere,
 * which is the exact failure this pair exists to prevent.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";

import { UNPAID_DRAFT_PAYMENT_STATES } from "@/hooks/useUnpaidJobDrafts";
import { jobIsUnfundedDraft } from "@/components/job-card/activityFilters";

const fundJob = vi.fn();
const drafts = vi.hoisted(() => ({ value: [] as unknown[] }));

vi.mock("@/hooks/useUnpaidJobDrafts", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useUnpaidJobDrafts")>(
    "@/hooks/useUnpaidJobDrafts",
  );
  return { ...actual, useUnpaidJobDrafts: () => drafts.value };
});
vi.mock("@/hooks/useFundExistingJob", () => ({
  useFundExistingJob: () => ({ fundJob, fundingJobId: null, isFunding: false }),
}));
vi.mock("@/hooks/useRecentPostedJobs", () => ({
  useRecentPostedJobs: () => [],
  prefetchRecentPostedJobs: () => {},
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn(), AhaEvent: {} }));

import { EntryChoice } from "./EntryChoice";

const form = {
  hasDraft: false,
  loadDraftAndContinue: vi.fn(),
  startFresh: vi.fn(),
  applyTemplate: vi.fn(),
  setStep: vi.fn(),
} as unknown as Parameters<typeof EntryChoice>[0]["form"];

const wrap = (ui: ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );

const draft = (over: Record<string, unknown> = {}) => ({
  id: "job-unpaid-1",
  title: "Mow a quarter-acre lawn",
  category: "yard_work",
  budget: 65,
  created_at: "2026-09-21T00:00:00Z",
  ...over,
});

beforeEach(() => {
  fundJob.mockClear();
  drafts.value = [];
});

describe("the two rules are ONE rule", () => {
  it("every payment state Post a Job calls a draft is one My Posts filters out", () => {
    // The pair. If these ever disagree, a job is filtered from My Posts by one
    // rule and not listed by the other — invisible on both surfaces at once.
    for (const payment_status of UNPAID_DRAFT_PAYMENT_STATES) {
      expect(
        jobIsUnfundedDraft({ status: "open", payment_status }),
        `Post a Job lists "${payment_status}" as a draft, but My Posts does not filter it out`,
      ).toBe(true);
    }
  });

  it("a FUNDED open job is neither filtered nor listed", () => {
    // The reverse direction: if this were true of escrow, the filter would
    // empty My Posts of live jobs.
    expect(jobIsUnfundedDraft({ status: "open", payment_status: "escrow" })).toBe(false);
    expect(UNPAID_DRAFT_PAYMENT_STATES).not.toContain("escrow");
  });
});

describe("Post a Job offers the way back", () => {
  it("shows nothing when there are no unpaid drafts", () => {
    drafts.value = [];
    wrap(<EntryChoice form={form} />);
    expect(screen.queryByText(/Finish Paying/i)).toBeNull();
  });

  it("shows nothing while still loading, rather than flashing an empty row", () => {
    drafts.value = null as unknown as unknown[];
    wrap(<EntryChoice form={form} />);
    expect(screen.queryByText(/Finish Paying/i)).toBeNull();
  });

  it("offers the unpaid job by name, and says why it is not live", () => {
    drafts.value = [draft()];
    wrap(<EntryChoice form={form} />);
    expect(screen.getByText(/Finish Paying/i)).toBeTruthy();
    // The title, so a poster with two drafts can tell them apart.
    expect(screen.getByText(/Mow a quarter-acre lawn/)).toBeTruthy();
    // And the consequence, which is the thing they could not see before.
    expect(screen.getByText(/nobody can see it until it/i)).toBeTruthy();
  });

  it("tapping it opens checkout FOR THAT JOB", async () => {
    drafts.value = [draft({ id: "job-a" }), draft({ id: "job-b", title: "Second one" })];
    wrap(<EntryChoice form={form} />);
    fireEvent.click(screen.getByText(/Second one/));
    await waitFor(() => expect(fundJob).toHaveBeenCalledTimes(1));
    // By id, not by position: two drafts differ only by which row was tapped.
    expect(fundJob).toHaveBeenCalledWith("job-b");
  });

  it("lists EVERY unpaid draft, not just the newest", () => {
    // A poster who abandoned two checkouts can reach both; showing only one
    // strands the other exactly as before this existed.
    drafts.value = [draft({ id: "a" }), draft({ id: "b", title: "B" }), draft({ id: "c", title: "C" })];
    const { container } = wrap(<EntryChoice form={form} />);
    expect(container.querySelectorAll("[data-unpaid-draft]")).toHaveLength(3);
  });
});

// Without the filter's own predicate, My Posts shows the unpaid job again as a
// healthy card in "Waiting" — a job no Helpr can see, filed under "waiting for
// applicants", which is where this started.
// @mutate src/components/job-card/activityFilters.ts | const moneyNeverLanded = | const moneyNeverLanded = false &&
