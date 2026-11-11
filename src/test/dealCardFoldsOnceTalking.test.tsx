/**
 * F308 (whole-app audit 11-10, Job chat): the job card, banner and application card filled the first screen, so the
 * first real message started below the fold. Once the thread has messages the deal card folds to its title row and
 * Open job, with "Show progress" to open the tracker again. A step that waits on the viewer (approve) never folds.
 *
 * @mutate src/components/messages/chatView/DealCard.tsx |   const folded = hasMessages && !showProgress && !stage.waitingOnYou && !approveDue; |   const folded = false;
 * @mutate src/components/messages/chatView/DealCard.tsx |   const folded = hasMessages && !showProgress && !stage.waitingOnYou && !approveDue; |   const folded = hasMessages && !showProgress;
 * @mutate src/components/messages/ChatView.tsx | <DealCard convo={activeConvo} userId={userId} hasMessages={messages.length > 0} /> | <DealCard convo={activeConvo} userId={userId} />
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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

function show(viewerIsPoster: boolean, hasMessages: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <DealCard convo={convo(viewerIsPoster)} userId={viewerIsPoster ? POSTER : HELPR} hasMessages={hasMessages} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("F308: the thread's job card folds once there is talk", () => {
  it("waiting on the other person, with messages: title row and Open job; Show progress opens the tracker", async () => {
    show(false, true);
    expect(await screen.findByRole("button", { name: "Open job" })).toBeTruthy();
    const card = screen.getByTestId("deal-card");
    expect(card.textContent).toContain("Two-room clean");
    expect(card.querySelector("[data-next-step]")).toBeNull();
    expect(card.querySelector("[data-step-tip]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Show progress/ }));
    expect(card.querySelector("[data-step-tip]")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /Show progress/ })).toBeNull();
  });

  it("no messages yet: the whole card shows", async () => {
    show(false, false);
    await screen.findByRole("button", { name: "Open job" });
    expect(screen.getByTestId("deal-card").querySelector("[data-step-tip]")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /Show progress/ })).toBeNull();
  });

  it("a step that waits on the viewer (approve) never folds", async () => {
    show(true, true);
    await screen.findByRole("button", { name: "Approve" });
    expect(screen.getByTestId("deal-card").querySelector("[data-next-step]")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /Show progress/ })).toBeNull();
  });

  it("the chat passes whether the thread has messages", () => {
    expect(readFileSync("src/components/messages/ChatView.tsx", "utf8")).toContain("hasMessages={messages.length > 0} />");
  });
});
