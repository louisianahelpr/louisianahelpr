/**
 * An ACCEPTED, not-yet-confirmed job on the helper's Jobs card says when it
 * will re-open to other Helprs. OPEN.md: "No pre-expiry warning on an accepted
 * job — AppliedJobCard passes expiresAt only while pending, so the ghosting
 * clock is invisible until it fires."
 *
 * The ghosting clock is not `jobs.expires_at` (that only cancels OPEN jobs).
 * It is `auto-expire-jobs` step 1: an accepted job with no
 * `helper_confirmed_at` is reopened at `confirmDeadlineMs(date_needed)`
 * (supabase/functions/_shared/confirmDeadline.ts). The card states that same
 * deadline through JobConfirmation, mounted by HelperTrackerPanel, in both
 * states: before the window opens ("confirm by ..., or the job re-opens") and
 * once it is open ("Confirm by ... or this job re-opens" / "past due").
 * This file pins both on the Jobs card a helper actually sees.
 *
 * @mutate src/components/JobConfirmation.tsx | const deadlineNotice = !isOwner && isHelper && !myConfirmed && ( | const deadlineNotice = false && (
 * @mutate src/components/job-card/confirmationOpensClock.ts |     note: isOwner |     note: true
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AppliedApp, Job } from "@/components/job-card/activityConstants";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
// The card's side reads (tracking row, pets, realtime) return empty; this file
// is about what the card says from the job row alone.
function makeSupabase() {
  const result = { data: null, error: null };
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "select", "eq", "neq", "in", "order", "limit", "insert", "update", "upsert", "delete", "gte", "lte", "is", "not", "filter"]) {
    chain[m] = vi.fn(() => chain);
  }
  chain.single = vi.fn(() => Promise.resolve(result));
  chain.maybeSingle = vi.fn(() => Promise.resolve(result));
  chain.then = (res: (v: typeof result) => unknown) => Promise.resolve(result).then(res);
  return {
    supabase: {
      ...chain,
      channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() })),
      removeChannel: vi.fn(),
      rpc: vi.fn(() => Promise.resolve(result)),
      auth: { getUser: vi.fn(() => Promise.resolve({ data: { user: null }, error: null })) },
    },
  };
}
vi.mock("@/integrations/supabase/client", () => makeSupabase());

import { ConfirmedSection } from "@/pages/jobs/appliedJobCard/ConfirmedSection";

beforeAll(() => {
  Element.prototype.scrollTo = Element.prototype.scrollTo ?? (() => {});
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
});

const HELPER = "helper-1";
const NOW = Date.now();
const ago = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
/** The job's calendar date `days` out, in the job's timezone. */
const dayOut = (days: number) =>
  new Date(NOW + days * 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

function acceptedJob(date: string): Job {
  return {
    id: "job-1",
    title: "Mow the lawn",
    description: "Front and back",
    location: "Lafayette, LA",
    customer_id: "poster-1",
    helper_id: HELPER,
    budget: 100,
    category: "yard_work",
    status: "accepted",
    date_needed: date,
    start_time: "18:00",
    accepted_at: ago(2),
    helper_confirmed_at: null,
    helper_dayof_confirmed_at: null,
    poster_confirmed_at: null,
    helper_on_the_way_at: null,
    helper_arrived_at: null,
  } as unknown as Job;
}

function renderCard(job: Job) {
  const app = { id: "app-1", job_id: job.id, helper_id: HELPER, status: "accepted", posterName: "Pierre B.", created_at: ago(3), job } as unknown as AppliedApp;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ConfirmedSection app={app} job={job} userId={HELPER} navigate={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("an accepted, unconfirmed job shows the helper its re-open deadline", () => {
  it("days out, before the window opens: says when it re-opens", () => {
    const { container } = renderCard(acceptedJob(dayOut(5)));
    expect(container.textContent).toMatch(/confirm by .*re-opens to other Helprs/i);
  });

  it("the day before, with the window open or past due: says it re-opens", () => {
    const { container } = renderCard(acceptedJob(dayOut(1)));
    expect(container.textContent).toMatch(/re-open(s)? to other Helprs/i);
  });
});
