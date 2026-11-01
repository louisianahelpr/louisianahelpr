/**
 * "Book <Helpr> again" (owner idea Q2471 #3, 2026-10-29): one tap from a finished job copies the job (title,
 * details, category, address, price; never the date), makes it a direct offer to that Helpr, and asks only for a
 * date. "Hire again" stays the BLANK post to the same Helpr (owner 2026-10-25, commit e6a510b7c4).
 *
 * The four layers this proves, each able to fail on its own:
 *   1. the link: rebook=<job> (the copy) + offerTo=<helper> (the direct offer) + bookAgain=1;
 *   2. Post a job reads that link and opens at When and where (page 4), once the copy's category lands;
 *   3. the finished job's card (Posts, Completed step) draws the chip and it navigates to that link;
 *   4. the Job done screen draws the link (the ONE "again" button, audit 11-01 JA-53), plus the heart that saves the Helpr.
 *
 * @mutate src/lib/bookAgain.ts |   const q = new URLSearchParams({ rebook: jobId, offerTo: helperId, [BOOK_AGAIN_PARAM]: "1" }); |   const q = new URLSearchParams({ offerTo: helperId, [BOOK_AGAIN_PARAM]: "1" });
 * @mutate src/lib/bookAgain.ts |   return !!(searchParams.get(BOOK_AGAIN_PARAM) && searchParams.get("rebook") && searchParams.get("offerTo")); |   return !!searchParams.get("rebook");
 * @mutate src/pages/post-job/FormStep.tsx |     goOn: () => setPage?.(4), |     goOn: () => setPage?.(2),
 * @mutate src/pages/post-job/usePostJobForm.ts |     prefillOpensWhen: prefillOpensWhen(searchParams), |     prefillOpensWhen: false,
 * @mutate src/pages/posts/postedJobCard/steps/CompletedStep.tsx |         job.helper_id && !crew ? ( |         job.helper_id && crew ? (
 * @mutate src/pages/posts/postedJobCard/steps/CompletedStep.tsx |       ]}\n      dialogs={ |         job.helper_id ? <JobActionChip key="again2" icon={RotateCcw} label="Hire again" onClick={() => {}} /> : null,\n      ]}\n      dialogs={
 * @mutate src/pages/posts/postedJobCard/steps/CompletedStep.tsx |             onClick={ageGate("post", () => navigate(bookAgainLink(job.id, job.helper_id as string)))} |             onClick={ageGate("post", () => navigate(`/post-job?offerTo=${job.helper_id}`))}
 * @mutate src/components/jobDone/JobDoneSummary.tsx |             to={bookAgainLink(jobId, job.helper_id)} |             to={`/post-job?offerTo=${job.helper_id}`}
 * @mutate src/components/jobDone/JobDoneSummary.tsx |           {/* ONE "again" button | <Link to="/post-job">Hire again</Link>{/* ONE "again" button
 * @mutate src/components/jobDone/JobDoneSummary.tsx |           <SaveHelperButton helperId={job.helper_id} customerId={viewerId} /> |           {null}
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { bookAgainLabel, bookAgainLink, prefillOpensWhen } from "@/lib/bookAgain";
import { blankComments } from "./helpers/blankNonCode";
import { openMore } from "./helpers/openMore";

vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/haptics", () => ({
  hapticLight: vi.fn(), hapticError: vi.fn(), hapticSuccess: vi.fn(),
  hapticMedium: vi.fn(), hapticSelection: vi.fn(), hapticWarning: vi.fn(),
}));
vi.mock("@/components/PhotoProof", () => ({ PhotoProofDialog: () => null }));

const DONE_JOB = {
  title: "Mow the lawn",
  helper_id: "helper-1",
  budget: 100,
  status: "completed",
  payment_status: "released",
  is_group_job: false,
  helpers_needed: 1,
  urgent_fee: null,
  helper_fee_flat_cents: null,
  helper_fee_percent: null,
  platform_fee_amount: null,
  disputed_at: null,
  dispute_status: null,
  payout_scheduled_at: null,
  proof_before_urls: [],
  proof_after_urls: [],
};

vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "select", "eq", "neq", "in", "order", "limit", "is", "not", "gte", "lte"]) chain[m] = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(() => Promise.resolve({ data: DONE_JOB, error: null }));
  chain.single = vi.fn(() => Promise.resolve({ data: DONE_JOB, error: null }));
  chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
  return {
    supabase: {
      from: chain.from,
      rpc: vi.fn(() => Promise.resolve({ data: [], error: null })),
      auth: {
        getSession: vi.fn(() => Promise.resolve({ data: { session: null }, error: null })),
        getUser: vi.fn(() => Promise.resolve({ data: { user: null }, error: null })),
        onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      },
      channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() })),
      removeChannel: vi.fn(),
      functions: { invoke: vi.fn(() => Promise.resolve({ data: null, error: null })) },
    },
  };
});

const code = (f: string) => blankComments(readFileSync(join(process.cwd(), f), "utf8"));

function wrap(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Book <Helpr> again (Q2471 #3)", () => {
  it("the link copies the job (rebook), offers it to the same Helpr (offerTo) and asks to open at When and where", () => {
    const url = new URL(bookAgainLink("job-1", "helper-1"), "https://x.test");
    expect(url.pathname).toBe("/post-job");
    expect(url.searchParams.get("rebook")).toBe("job-1");
    expect(url.searchParams.get("offerTo")).toBe("helper-1");
    expect(url.searchParams.get("bookAgain")).toBe("1");
    expect(prefillOpensWhen(url.searchParams)).toBe(true);
  });

  it("only the full Book again link skips to When and where: never a plain Repost, Hire again or a lone flag", () => {
    const cases = ["", "rebook=j1", "offerTo=h1", "rebook=j1&offerTo=h1", "bookAgain=1", "bookAgain=1&offerTo=h1"];
    expect(cases.length).toBeGreaterThan(5);
    for (const q of cases) expect(prefillOpensWhen(new URLSearchParams(q)), q).toBe(false);
  });

  it("the label names the Helpr by first name, and never says 'Book Helpr again'", () => {
    expect(bookAgainLabel("Andre L.")).toBe("Book Andre again");
    expect(bookAgainLabel("Helpr")).toBe("Book again");
    expect(bookAgainLabel("")).toBe("Book again");
  });

  it("Post a job reads the link and FormStep opens page 4 (When and where) through the same once-only, gated hook", () => {
    expect(code("src/pages/post-job/usePostJobForm.ts")).toContain("prefillOpensWhen: prefillOpensWhen(searchParams),");
    expect(code("src/pages/post-job/FormStep.tsx")).toMatch(
      /usePrefillOpensDetails\(\{\s*deepLink: !!form\.prefillOpensWhen,\s*category: form\.category,\s*onFirstPage: page === 1,\s*blocked: atOpenJobLimit \|\| underAge,\s*goOn: \(\) => setPage\?\.\(4\),?\s*\}\)/,
    );
  });

  // One book-again (owner 2026-11-01: "Book Eli again" and "Hire again" side by side in the done list; keep one).
  it("the finished job's card draws ONE Book <Helpr> again, which opens the copy offered to that Helpr; no Hire again beside it", async () => {
    const { CompletedStep } = await import("@/pages/posts/postedJobCard/steps/CompletedStep");
    const navigate = vi.fn();
    const job = {
      id: "job-1", title: "Mow the lawn", customer_id: "poster-1", helper_id: "helper-1", budget: 100,
      status: "completed", payment_status: "released", is_group_job: false,
      proof_before_urls: [], proof_after_urls: [], poster_completed_at: new Date().toISOString(),
    };
    const ctx = {
      job, userId: "poster-1", helperNames: { "helper-1": "Hallie H." }, completedJobMeta: { "job-1": { tipped: true, reviewed: true } },
      navigate, onTip: vi.fn(), onReview: vi.fn(),
    } as unknown as Parameters<typeof CompletedStep>[0];
    const { container } = wrap(<CompletedStep {...ctx} />);
    await openMore(container);
    const chip = screen.getByRole("button", { name: /^Book Hallie again — / });
    fireEvent.click(chip);
    expect(navigate).toHaveBeenCalledWith(bookAgainLink("job-1", "helper-1"));
    await openMore(container);
    expect(screen.queryByRole("button", { name: /Hire again/ })).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Book Hallie again — / })).toHaveLength(1);
  });

  it("a crew job has no one Helpr to offer it to: no Book again chip", async () => {
    const { CompletedStep } = await import("@/pages/posts/postedJobCard/steps/CompletedStep");
    const job = {
      id: "job-2", title: "Move a couch", customer_id: "poster-1", helper_id: "helper-1", budget: 100,
      status: "completed", payment_status: "released", is_group_job: true,
      proof_before_urls: [], proof_after_urls: [],
    };
    const ctx = {
      job, userId: "poster-1", helperNames: { "helper-1": "Hallie H." }, completedJobMeta: { "job-2": { tipped: true, reviewed: true, crewToReview: [] } },
      navigate: vi.fn(), onTip: vi.fn(), onReview: vi.fn(),
    } as unknown as Parameters<typeof CompletedStep>[0];
    const { container } = wrap(<CompletedStep {...ctx} />);
    const inMore = await openMore(container);
    expect(inMore.length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /^Book .* again — / })).toBeNull();
  });

  // Audit 11-01 JA-53: ONE "again" button on Job done; "Hire again" beside it read the same.
  it("the Job done screen offers Book <Helpr> again (the copy) and the heart, and no second Hire again", async () => {
    const { JobDoneSummary } = await import("@/components/jobDone/JobDoneSummary");
    wrap(<JobDoneSummary jobId="job-1" side="poster" otherName="Hallie H." viewerId="poster-1" />);
    const book = await screen.findByTestId("book-again");
    expect(book.getAttribute("href")).toBe(bookAgainLink("job-1", "helper-1"));
    expect(book.textContent).toBe("Book Hallie again");
    expect(screen.queryByRole("link", { name: /Hire again/ })).toBeNull();
    expect(screen.getAllByRole("link").filter((l) => /again/i.test(l.textContent ?? ""))).toHaveLength(1);
    expect(await screen.findByRole("button", { name: /Save Helpr|Unsave Helpr|Loading saved status/ })).toBeTruthy();
  });
});
