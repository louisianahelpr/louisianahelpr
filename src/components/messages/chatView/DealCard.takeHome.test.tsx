/**
 * The chat's pinned job card shows the Helpr their take-home, never the job
 * price (audit 2026-10-28 F2, Part 4 half 2: a $40 Cleaning job's card said
 * "$40 held safely" to Hallie while the Working card and the job page said
 * $33). The figure comes from useHelprTakeHome, the job page's computation;
 * the poster still sees the price they paid, "held safely".
 *
 * @mutate src/components/messages/chatView/DealCard.tsx |         {typeof job.budget === "number" && job.budget > 0 && viewerIsPoster && ( |         {typeof job.budget === "number" && job.budget > 0 && (
 * @mutate src/components/messages/chatView/DealCard.tsx |   const { net } = useHelprTakeHome(job); |   const net = job.budget;
 * @mutate src/components/messages/chatView/DealCard.tsx | <div className="shrink-0 text-right" data-deal-paid=""> | <div className="shrink-0 text-right" data-deal-paid="">{stage.held && <p>held safely</p>}
 *
 * Owner 11-01 (A3-87): the card's figure stands alone ("You take home" gone; an sr-only "Your pay"), and the
 * poster's price has no "held safely" line, as on the job page.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Conversation } from "../types";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";

const POSTER = "aaaaaaaa-0000-4000-8000-000000000001";
const HELPR = "bbbbbbbb-0000-4000-8000-000000000002";
const JOB = "cccccccc-0000-4000-8000-000000000003";

const state = { owed: 2 };

const ROW = {
  id: JOB,
  title: "Two-room clean",
  category: "cleaning",
  date_needed: jobLocalDateISO(22),
  start_time: "09:00:00",
  budget: 40,
  status: "accepted",
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

import { DealCard } from "./DealCard";

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

describe("chat job card: the Helpr sees their take-home (F2)", () => {
  beforeEach(() => {
    state.owed = 2;
  });

  it("the hired Helpr sees $35 (40 - 2.70 fee - the $2 setup fee, floored), not $40", async () => {
    const { container } = show(false);
    await waitFor(() => expect(container.querySelector("[data-deal-take-home]")?.textContent).toBe("Your pay $35"));
    expect(container.textContent).not.toMatch(/take home/i);
    expect(container.textContent).not.toContain("$40");
    expect(container.textContent).not.toContain("held safely");
  });

  it("with the setup fee already paid, the take-home is $37", async () => {
    state.owed = 0;
    const { container } = show(false);
    await waitFor(() => expect(container.querySelector("[data-deal-take-home]")?.textContent).toBe("Your pay $37"));
  });

  it("the poster still sees the $40 they paid, with no 'held safely' line (owner 11-01)", async () => {
    const { container } = show(true);
    await screen.findByText("$40");
    expect(container.textContent).not.toMatch(/held safely/i);
    // The card has loaded ("$40" is on screen), so the absence is real, not a first paint.
    expect(container.querySelector("[data-deal-take-home]")).toBeNull();
    expect(container.textContent).not.toContain("you take home");
  });
});
