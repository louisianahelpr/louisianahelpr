/**
 * A3-114 (Auditor 11, 11-01): the thread's job card ignored a day set to finish and told the Helpr "your after photos
 * are in. Mark it done" (the server refuses it until that day) and the poster "waiting for them to mark it done".
 * It now reads the job page's own read (key ["job-continue-day", id]) and line (continueDayNextStep).
 *
 * @mutate src/components/messages/chatView/DealCard.tsx |   const step = (job.status === "in_progress" ? continueDayNextStep(continueDay.data, { side: viewerIsPoster ? "poster" : "helpr", otherFirst }) : null) ?? jobNextStep(stage, { |   const step = jobNextStep(stage, {
 * @mutate src/components/messages/chatView/DealCard.tsx |     enabled: !!data && data.job.status === "in_progress", |     enabled: false,
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Conversation } from "@/components/messages/types";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";

const day = vi.hoisted(() => ({ row: null as null | Record<string, unknown> }));
vi.mock("@/lib/continueDay", async (orig) => ({ ...(await orig<typeof import("@/lib/continueDay")>()), fetchContinueDay: async () => day.row }));

const POSTER = "aaaaaaaa-0000-4000-8000-000000000001";
const HELPR = "bbbbbbbb-0000-4000-8000-000000000002";
const JOB = "cccccccc-0000-4000-8000-000000000003";

const state = { owed: 2 };
const T = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

const ROW = {
  id: JOB,
  title: "Two-room clean",
  category: "cleaning",
  date_needed: jobLocalDateISO(22),
  start_time: "09:00:00",
  budget: 40,
  status: "in_progress",
  // Marked done 1 hour ago, everything before it done: the poster's step is the approval.
  helper_confirmed_at: T(30), helper_dayof_confirmed_at: T(5), poster_confirmed_at: T(5), helper_on_the_way_at: T(4),
  helper_arrived_at: T(3), helper_arrival_verified_at: T(3), poster_confirmed_arrival_at: T(3), poster_confirmed_working_at: T(3),
  // Yusef's case: after photos in, not marked done; a day set to finish 3 days out.
  helper_completed_at: null, require_photo_proof: true, proof_before_urls: ["b.jpg"], proof_after_urls: ["a.jpg"],
  helper_id: HELPR,
  customer_id: POSTER,
  payment_status: "escrow",
  parish: "East Baton Rouge",
  urgent_fee: 0,
  helpers_needed: 1,
  is_group_job: false,
  // The flat model: 5% + 70c on $40 = $2.70.
  helper_fee_flat_cents: 70,
  helper_fee_percent: 5,
};

function chain(result: unknown) {
  const c: Record<string, unknown> = {};
  for (const k of ["select", "eq", "order", "limit"]) c[k] = () => c;
  c.maybeSingle = async () => ({ data: result, error: null });
  return c;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) =>
      chain(table === "jobs" ? ROW : table === "applications" ? { status: "accepted" } : table === "job_tracking" ? { status: "working" } : null),
    rpc: async () => ({ data: [], error: null }),
  },
}));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: HELPR }, profile: null, isLoading: false }),
}));
vi.mock("@/hooks/useFirstPayoutFee", () => ({ useFirstPayoutFeeDollars: () => state.owed }));
vi.mock("@/hooks/useJobRescheduled", () => ({ useJobRescheduled: () => false }));
// The card's live refresh (F1) rides the job's shared channel; nothing changes during these renders.
vi.mock("@/lib/jobRealtimeBus", () => ({ subscribeJobRealtime: () => () => undefined }));

import { DealCard } from "@/components/messages/chatView/DealCard";

function convo(viewerIsPoster: boolean): Conversation {
  return {
    otherUserId: viewerIsPoster ? HELPR : POSTER,
    otherUserName: viewerIsPoster ? "Hallie" : "Pat",
    jobTitle: ROW.title,
    jobId: JOB,
    viewerIsPoster,
  } as Conversation;
}

function show(viewerIsPoster: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <DealCard convo={convo(viewerIsPoster)} userId={viewerIsPoster ? POSTER : HELPR} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const AHEAD = jobLocalDateISO(3);
const setDay = (over: Record<string, unknown> = {}) => ({
  id: "c1", job_id: JOB, proposed_by: POSTER, new_date: AHEAD, new_start_time: "09:00:00", note: null, status: "set", helper_confirmed_at: null, ...over,
});
const line = () => screen.getByTestId("deal-card").querySelector("[data-next-step]")?.textContent ?? "";

describe("the thread's job card reads a day set to finish (A3-114)", () => {
  it("without a day: the after-photos line (the audit's state)", async () => {
    day.row = null;
    show(false);
    await screen.findByTestId("deal-card");
    await vi.waitFor(() => expect(line()).toMatch(/mark it done/i));
  });

  it("the Helpr: 'Next: confirm you'll be there · continuing …', never 'Mark it done'", async () => {
    day.row = setDay();
    show(false);
    await screen.findByTestId("deal-card");
    await vi.waitFor(() => expect(line()).toMatch(/^Next: confirm you'll be there · continuing \w{3} \d+\/\d+ at 9 AM$/));
  });

  it("the poster: who confirmed, once the Helpr did", async () => {
    day.row = setDay({ helper_confirmed_at: T(0.5) });
    show(true);
    await screen.findByTestId("deal-card");
    await vi.waitFor(() => expect(line()).toMatch(/^Hallie confirmed \w{3} \d+\/\d+ at 9 AM$/));
    expect(ROW.status).toBe("in_progress");
  });
});
