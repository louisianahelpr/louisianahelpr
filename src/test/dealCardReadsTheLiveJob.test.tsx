/**
 * THE CHAT'S JOB CARD READS THE SAME LIVE JOB AS THE WORKING CARD, AND REFRESHES WITH IT.
 *
 * Audit 2026-10-28 (part 4 half 2, F1; shot p4j-chat-sent-375.png): after Hallie took BOTH photos, her
 * Working card said "Mark it done" while the Messages job card still said "Arr. / Take the before photo".
 * Two causes, both in DealCard:
 *  1. Its jobs read did not select the photo columns (proof_before_urls, proof_after_urls,
 *     require_photo_proof, is_group_job), so beforePhotoIsThePrimary saw no photo and a required one
 *     (require_photo_proof defaults to true) on every arrived job, forever.
 *  2. It never read the job's tracking row (Start working lives there, not on the jobs row) and held no
 *     realtime binding, so even a correct read went stale until a remount.
 *
 * The supabase mock PROJECTS each row onto the columns the code selected, the way PostgREST does, so a
 * column the card forgets to select is absent here exactly as it is on prod.
 *
 * @mutate src/components/messages/chatView/DealCard.tsx | poster_completed_at,require_photo_proof,proof_before_urls,proof_after_urls,is_group_job" | poster_completed_at"
 * @mutate src/components/messages/chatView/DealCard.tsx | useDealCardLive(data?.job.id, data?.job.status); | void useQueryClient();
 * @mutate src/components/messages/chatView/DealCard.tsx | workUnderway: helperProgress(job as unknown as Job, data.trackingStatus).workUnderway, | workUnderway: undefined,
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { jobNextStep } from "@/components/tracker/jobNextStep";
import { nextStepWords } from "@/components/ui/NextStep";

type Row = Record<string, unknown>;
const hoisted = vi.hoisted(() => ({
  db: {} as Record<string, Record<string, unknown>[]>,
  listeners: [] as { table: string; filter?: string; handler: (p: unknown) => void }[],
}));

vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
// The Helpr's take-home on the card (F2, useHelprTakeHome) reads the viewer's profile and setup fee; not what this file checks.
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: null, profile: null, isLoading: false }) }));
vi.mock("@/hooks/useFirstPayoutFee", () => ({ useFirstPayoutFeeDollars: () => 0 }));
vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    let cols: string[] | null = null;
    const eqs: [string, unknown][] = [];
    let limit = Infinity;
    const run = () => {
      const rows = (hoisted.db[table] ?? [])
        .filter((r) => eqs.every(([k, v]) => r[k] === v))
        .slice(0, limit)
        .map((r) => (cols ? Object.fromEntries(cols.filter((c) => c in r).map((c) => [c, r[c]])) : { ...r }));
      return rows;
    };
    const b: Record<string, unknown> = {
      select: (c: string) => { cols = c.split(",").map((s) => s.trim()); return b; },
      eq: (k: string, v: unknown) => { eqs.push([k, v]); return b; },
      order: () => b,
      limit: (n: number) => { limit = n; return b; },
      maybeSingle: () => Promise.resolve({ data: run()[0] ?? null, error: null }),
      then: (fn: (r: unknown) => unknown) => Promise.resolve({ data: run(), error: null }).then(fn),
    };
    return b;
  };
  return {
    supabase: {
      from,
      rpc: () => Promise.resolve({ data: [], error: null }),
      channel: () => {
        const chan = {
          on: (_e: string, cfg: { table: string; filter?: string }, handler: (p: unknown) => void) => {
            hoisted.listeners.push({ table: cfg.table, filter: cfg.filter, handler });
            return chan;
          },
        };
        return chan;
      },
    },
  };
});
vi.mock("@/lib/realtimeRecovery", () => ({
  subscribeWithRecovery: (factory: (name: string) => unknown) => {
    factory("test-channel");
    return { close: vi.fn() };
  },
}));

import { DealCard } from "@/components/messages/chatView/DealCard";
import { helperCardLine } from "@/pages/jobs/appliedJobCard/HelperCollapsedStrip";
import type { AppliedApp, Job } from "@/components/job-card/activityConstants";
import type { Conversation } from "@/components/messages/types";
import { jobProgress, type ProgressJob } from "@/components/tracker/jobProgressState";

const JOB = "11111111-1111-4111-8111-111111111111";
const ME = "22222222-2222-4222-8222-222222222222";
const POSTER = "33333333-3333-4333-8333-333333333333";
const T = new Date(Date.now() - 60 * 60_000).toISOString();
const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

/** Hallie's audit job: arrived, the poster confirmed the arrival, both photos taken, working. */
const arrivedJob = (over: Row = {}): Row => ({
  id: JOB, title: "AA5-AUDIT-1029 test clean", category: "cleaning", date_needed: today, start_time: "08:00:00",
  budget: 40, status: "in_progress", helper_id: ME, customer_id: POSTER, payment_status: "escrow", parish: "Orleans",
  helper_confirmed_at: T, helper_dayof_confirmed_at: T, poster_confirmed_at: T, helper_on_the_way_at: T,
  helper_arrived_at: T, helper_arrival_verified_at: T, poster_confirmed_arrival_at: T, poster_confirmed_working_at: null,
  helper_completed_at: null, poster_completed_at: null, has_active_dispute: false,
  require_photo_proof: true, proof_before_urls: ["before.jpg"], proof_after_urls: ["after.jpg"], is_group_job: false,
  ...over,
});

const convo = { otherUserId: POSTER, otherUserName: "E2E Poster", jobTitle: "x", jobId: JOB, viewerIsPoster: false } as Conversation;

function mount(): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>
  );
  render(<DealCard convo={convo} userId={ME} />, { wrapper: wrap });
}

/**
 * What the Helpr's Working card's tracker says for the same job and tracking row: AppliedJobCard builds its
 * line with helperCardLine and hands it to jobProgress as `card` (the bar never reads the face).
 */
function workingLine(job: Row, trackingStatus: string | null): string {
  const app = { id: "a", job, helper_id: ME, status: "accepted", closed_reason: null, posterName: "E2E Poster" } as unknown as AppliedApp;
  const tracking = trackingStatus ? ({ id: "t", status: trackingStatus, updated_at: T } as never) : null;
  const line = helperCardLine(app, job as unknown as Job, new Set<string>(), tracking);
  const p = jobProgress(job as ProgressJob, { viewer: "helpr", otherFirst: "E2E", card: { line, face: null } as never });
  // Owner 11-01 (B107): the card prints the line as the shared next step (jobNextStep / NextStep), as the job page does.
  const step = jobNextStep(p, { side: "helpr", otherFirst: "E2E" });
  return `${p.word}|${step ? nextStepWords(step) : p.next}`;
}

/** The deal card's bar word (its aria sentence) and its line, in the same shape. */
function dealLine(): string {
  const card = screen.getByTestId("deal-card");
  const aria = card.querySelector("[aria-label^='Job progress']")?.getAttribute("aria-label") ?? "";
  const word = /step \d of 8: ([^,]+),/.exec(aria)?.[1] ?? aria;
  const next = card.querySelector("[data-next-step]")?.textContent ?? card.querySelector("[data-job-progress-next]")?.textContent ?? "";
  return `${word}|${next}`;
}

beforeEach(() => {
  cleanup();
  hoisted.listeners.length = 0;
  hoisted.db = {
    jobs: [arrivedJob()],
    job_tracking: [{ id: "t", job_id: JOB, status: "working", created_at: T, updated_at: T }],
    applications: [{ job_id: JOB, helper_id: ME, status: "accepted" }],
    job_schedule_change_requests: [],
  };
});

describe("the chat's job card reads the Working card's live job", () => {
  it("says what the Working card says after both photos, never 'Take the before photo'", async () => {
    const expected = workingLine(arrivedJob(), "working");
    expect(expected, "fixture: the Working card's own line for this job").not.toMatch(/before photo/i);
    mount();
    await screen.findByTestId("deal-card");
    await waitFor(() => expect(dealLine()).toBe(expected));
    expect(screen.getByTestId("deal-card").textContent).not.toMatch(/before photo/i);
  });

  it("still asks for the before photo while it is owed (the fix reads the photos, it does not drop the ask)", async () => {
    hoisted.db.jobs = [arrivedJob({ proof_before_urls: [], proof_after_urls: [] })];
    hoisted.db.job_tracking = [{ id: "t", job_id: JOB, status: "arrived", created_at: T, updated_at: T }];
    mount();
    const expected = workingLine(arrivedJob({ proof_before_urls: [], proof_after_urls: [] }), "arrived");
    expect(expected).toMatch(/take the before photo/i);
    await screen.findByTestId("deal-card");
    await waitFor(() => expect(dealLine()).toBe(expected));
  });

  it("reads Start working off the tracking row, like the Working card (before photo taken, work not started)", async () => {
    const job = arrivedJob({ proof_after_urls: [], poster_confirmed_arrival_at: null, helper_arrival_verified_at: null });
    hoisted.db.jobs = [job];
    hoisted.db.job_tracking = [{ id: "t", job_id: JOB, status: "arrived", created_at: T, updated_at: T }];
    const expected = workingLine(job, "arrived");
    expect(expected, "fixture: the Working card says the work has not started").not.toMatch(/mark it done/i);
    mount();
    await screen.findByTestId("deal-card");
    await waitFor(() => expect(dealLine()).toBe(expected));
  });

  it("refreshes when the job row changes (a photo, a step), without a remount", async () => {
    hoisted.db.jobs = [arrivedJob({ proof_before_urls: [], proof_after_urls: [] })];
    hoisted.db.job_tracking = [{ id: "t", job_id: JOB, status: "arrived", created_at: T, updated_at: T }];
    mount();
    await waitFor(() => expect(screen.getByTestId("deal-card").textContent).toMatch(/take the before photo/i));

    // Both photos land and work starts (what Hallie did between the two screens).
    hoisted.db.jobs = [arrivedJob()];
    hoisted.db.job_tracking = [{ id: "t2", job_id: JOB, status: "working", created_at: T, updated_at: T }];
    const jobBinding = hoisted.listeners.find((l) => l.table === "jobs" && l.filter === `id=eq.${JOB}`);
    expect(jobBinding, "the card holds a realtime binding on its own job row").toBeTruthy();
    expect(hoisted.listeners.some((l) => l.table === "job_tracking" && l.filter === `job_id=eq.${JOB}`)).toBe(true);
    act(() => jobBinding!.handler({ new: { id: JOB } }));

    const expected = workingLine(arrivedJob(), "working");
    await waitFor(() => expect(dealLine()).toBe(expected));
    expect(screen.getByTestId("deal-card").textContent).not.toMatch(/before photo/i);
  });
});
