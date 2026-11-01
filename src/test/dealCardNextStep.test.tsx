/**
 * Owner 11-01 (B107, the thread's job card at ~1900px): "Yusef marked it done. Check the work and approve" and a lone
 * "Open job". The card uses the shared next-step line (jobNextStep / NextStep, as the job page) with the window left,
 * and the green action on its right.
 *
 * @mutate src/components/messages/chatView/DealCard.tsx |         <div className="min-w-0 flex-1 text-ds-14">{step && <NextStep value={step} />}</div> |         <div className="min-w-0 flex-1 text-ds-14" />
 * @mutate src/components/messages/chatView/DealCard.tsx |           {approveDue ? "Approve" : "Open job"} |           Open job
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Conversation } from "@/components/messages/types";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";

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
  helper_completed_at: T(1),
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

describe("the thread's job card says the next step", () => {
  it("poster, marked done: 'Next: approve Hallie's work · 23h left' with Approve on the right", async () => {
    show(true);
    const btn = await screen.findByRole("button", { name: "Approve" });
    const card = screen.getByTestId("deal-card");
    expect(card.querySelector("[data-next-step]")?.textContent).toMatch(/^Next: approve Hallie's work · 2[23]h left$/);
    // The bar draws no second copy of the line.
    expect(card.textContent).not.toMatch(/Check the work and approve/);
    // The action is the row's LAST child: on the right.
    expect(btn.parentElement!.lastElementChild).toBe(btn);
  });

  it("the Helpr's side keeps Open job and reads its own line", async () => {
    show(false);
    expect(await screen.findByRole("button", { name: "Open job" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });
});
