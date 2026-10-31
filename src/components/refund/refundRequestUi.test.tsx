/**
 * Board 141 (Q2272) client: what each side is offered and what is sent.
 *   - Ask: nothing is sendable until a choice, a valid amount and a reason;
 *     Part sends the amount in cents, All of it sends no amount (the server
 *     uses the whole price); the button names the Helpr by first name.
 *   - Answer: Agree shows the refund and the Helpr's take-home (money ink);
 *     Come back and finish is offered only on a booked job not started (the
 *     schedule-change rule), never as a greyed choice; the sent answer is the
 *     one picked.
 *   - The panel and the chip render nothing outside the job lists' switch
 *     provider (no session, no read), and the panel says where a request
 *     stands to each side.
 *
 * @mutate src/lib/refundRequests/index.ts |     p_amount_cents: (scope === "all" ? null : amountCents) as number, |     p_amount_cents: amountCents as number,
 * @mutate src/components/refund/RefundAnswerDialog.tsx |     ...(finishOffered |     ...(true
 * @mutate src/components/refund/RefundsSwitch.tsx | const RefundsOnContext = createContext(false); | const RefundsOnContext = createContext(true);
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

const rpc = vi.fn();
let latestRow: Record<string, unknown> | null = null;
vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "select", "eq", "order", "limit"]) chain[m] = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(() => Promise.resolve({ data: latestRow, error: null }));
  return { supabase: { ...chain, rpc: (...a: unknown[]) => rpc(...a) } };
});
vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/haptics", () => ({ hapticError: vi.fn(), hapticSuccess: vi.fn(), hapticLight: vi.fn() }));
// The switch is on for this viewer; the provider is what reads it.
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true }));

import { RefundRequestDialog } from "./RefundRequestDialog";
import { RefundAnswerDialog } from "./RefundAnswerDialog";
import { RefundRequestPanel } from "./RefundRequestPanel";
import { RefundsOnContext, RefundsSwitchProvider } from "./RefundsSwitch";
import type { RefundRequest } from "@/lib/refundRequests";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";

const POSTER = "11111111-1111-4111-8111-111111111111";
const HELPR = "22222222-2222-4222-8222-222222222222";
const JOB = {
  id: "33333333-3333-4333-8333-333333333333", title: "Assemble a bookshelf", budget: 40, status: "in_progress",
  payment_status: "escrow", customer_id: POSTER, helper_id: HELPR, date_needed: jobLocalDateISO(3), start_time: "10:00",
  helper_fee_percent: null, helper_fee_flat_cents: null, urgent_fee: 0,
};
const REQUEST: RefundRequest = {
  id: "44444444-4444-4444-8444-444444444444", job_id: JOB.id, requester_id: POSTER, responder_id: HELPR,
  refund_scope: "part", amount_cents: 2000, budget_cents: 4000, reason: "Two shelves are still missing their back panel.",
  status: "open", answer_by: new Date(Date.now() + 86400e3).toISOString(), answered_at: null, dispute_id: null, created_at: new Date().toISOString(),
};

function wrap(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  rpc.mockReset();
  latestRow = null;
});

describe("Ask for a refund (the poster)", () => {
  const open = () =>
    wrap(<RefundRequestDialog open onOpenChange={() => {}} job={JOB} helperName="Jolie T." userId={POSTER} />);

  it("is not sendable until a choice, an amount and what happened; the button names the Helpr", () => {
    open();
    const send = screen.getByRole("button", { name: "Send to Jolie" });
    expect(send).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: /Part of it/ }));
    fireEvent.change(screen.getByLabelText("How much back?"), { target: { value: "20" } });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText("What happened"), { target: { value: "Two shelves are still missing their back panel." } });
    expect(send).not.toBeDisabled();
  });

  it("Part of it sends the amount in cents", async () => {
    rpc.mockResolvedValue({ data: REQUEST.id, error: null });
    open();
    fireEvent.click(screen.getByRole("radio", { name: /Part of it/ }));
    fireEvent.change(screen.getByLabelText("How much back?"), { target: { value: "20" } });
    fireEvent.change(screen.getByLabelText("What happened"), { target: { value: "Two shelves are still missing their back panel." } });
    fireEvent.click(screen.getByRole("button", { name: "Send to Jolie" }));
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(rpc).toHaveBeenCalledWith("rpc_open_refund_request", expect.objectContaining({ p_job_id: JOB.id, p_scope: "part", p_amount_cents: 2000 }));
  });

  it("All of it sends no amount: the server uses the whole price", async () => {
    rpc.mockResolvedValue({ data: REQUEST.id, error: null });
    open();
    fireEvent.click(screen.getByRole("radio", { name: /All of it/ }));
    expect(screen.queryByLabelText("How much back?")).toBeNull();
    fireEvent.change(screen.getByLabelText("What happened"), { target: { value: "They never came to do the job at all." } });
    fireEvent.click(screen.getByRole("button", { name: "Send to Jolie" }));
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(rpc).toHaveBeenCalledWith("rpc_open_refund_request", expect.objectContaining({ p_scope: "all", p_amount_cents: null }));
  });

  it("a part as big as the price is not sendable", () => {
    open();
    fireEvent.click(screen.getByRole("radio", { name: /Part of it/ }));
    fireEvent.change(screen.getByLabelText("How much back?"), { target: { value: "40" } });
    fireEvent.change(screen.getByLabelText("What happened"), { target: { value: "Two shelves are still missing their back panel." } });
    expect(screen.getByRole("button", { name: "Send to Jolie" })).toBeDisabled();
  });
});

describe("Refund request (the Helpr)", () => {
  const answer = (job = JOB) =>
    wrap(<RefundAnswerDialog open onOpenChange={() => {}} job={job} request={REQUEST} posterName="Lexi L." feeFallbackPercent={12} userId={HELPR} />);

  it("Agree shows the refund and the take-home in money ink; Come back and finish offered on a job under way (Q2326)", () => {
    answer();
    const agree = screen.getByRole("radio", { name: /Agree · refund \$20/ });
    // $40 - $20 = $20, less the free tier's 12% = $17.60, paid as $17.
    expect(agree.textContent).toContain("You take home the rest: $17");
    for (const money of agree.querySelectorAll(".text-\\[hsl\\(var\\(--burnt-sienna\\)\\)\\]")) {
      expect(money.textContent).toMatch(/^\$\d/);
    }
    expect(screen.getByRole("radio", { name: /Come back and finish/ })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /I don't agree/ })).toBeTruthy();
    expect(screen.getByText(/Lexi asked for/)).toBeTruthy();
  });

  it("on a booked job not started yet, Come back and finish is offered and sends a time", async () => {
    rpc.mockResolvedValue({ data: { status: "finish_offered" }, error: null });
    const ahead = jobLocalDateISO(5);
    answer({ ...JOB, status: "accepted", date_needed: ahead });
    fireEvent.click(screen.getByRole("radio", { name: /Come back and finish/ }));
    const date = document.querySelector('input[type="date"]') as HTMLInputElement;
    const later = jobLocalDateISO(6);
    fireEvent.change(date, { target: { value: later } });
    fireEvent.click(screen.getByRole("button", { name: "Send answer" }));
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(rpc).toHaveBeenCalledWith("rpc_answer_refund_request", expect.objectContaining({ p_answer: "finish", p_date: later, p_request_id: REQUEST.id }));
  });

  it("no Come back and finish where the date/time request would refuse it (a job in revision), never a greyed choice", () => {
    answer({ ...JOB, status: "revision_requested" });
    expect(screen.queryByRole("radio", { name: /Come back and finish/ })).toBeNull();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
  });

  it("I don't agree sends that answer", async () => {
    rpc.mockResolvedValue({ data: { status: "declined" }, error: null });
    answer();
    fireEvent.click(screen.getByRole("radio", { name: /I don't agree/ }));
    fireEvent.click(screen.getByRole("button", { name: "Send answer" }));
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(rpc).toHaveBeenCalledWith("rpc_answer_refund_request", expect.objectContaining({ p_answer: "decline", p_date: null }));
  });
});

describe("the panel on the job card", () => {
  it("renders nothing outside the job lists' switch provider (no read made)", async () => {
    latestRow = REQUEST as unknown as Record<string, unknown>;
    const { container } = wrap(<RefundRequestPanel job={JOB} userId={HELPR} otherName="Lexi Lombas" feeFallbackPercent={12} expanded />);
    // Long enough for a read that WAS made to have answered and rendered.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(container.textContent).toBe("");
  });

  it("the Helpr asked sees who asked, how much, by when, and Answer", async () => {
    latestRow = REQUEST as unknown as Record<string, unknown>;
    wrap(
      <RefundsSwitchProvider>
        <RefundRequestPanel job={JOB} userId={HELPR} otherName="Lexi Lombas" feeFallbackPercent={12} expanded />
      </RefundsSwitchProvider>,
    );
    expect(await screen.findByText(/Lexi L\. asked for/)).toBeTruthy();
    expect(screen.getByText("$20").className).toContain("burnt-sienna");
    expect(screen.getByRole("button", { name: "Answer" })).toBeTruthy();
  });

  it("the poster sees what they asked and who answers", async () => {
    latestRow = REQUEST as unknown as Record<string, unknown>;
    // The context's value as the provider sets it (the switch read once by the lists).
    wrap(
      <RefundsOnContext.Provider value>
        <RefundRequestPanel job={JOB} userId={POSTER} otherName="Jolie Thibodeaux" feeFallbackPercent={null} expanded />
      </RefundsOnContext.Provider>,
    );
    expect(await screen.findByText(/You asked Jolie T\. for/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Answer" })).toBeNull();
    // The poster can take a waiting request back.
    rpc.mockResolvedValue({ data: { status: "closed" }, error: null });
    fireEvent.click(screen.getByRole("button", { name: "Withdraw request" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("rpc_withdraw_refund_request", { p_request_id: REQUEST.id }));
  });
});
