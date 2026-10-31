// Boards 66/172 slice 2 (owner-approved plan, 2026-10-21): the poster's cancel
// dialog shows "Back to you $X" ONLY from the server's quote (create-payment
// cancel_quote), the quote and the hourly refund share ONE split
// (_shared/posterCancelSplit.ts), and poster_cancel_job refuses a fee the
// poster was not shown (p_expected_fee_cents -> quote_changed).
//
// The class this guards: a money number on screen that the server did not
// compute, or a refund path that prices the cancel a second way. Each @mutate
// below re-opens one layer (the sweep, the quote, the RPC, the copy, the dialog).
//
// @mutate supabase/functions/void-cancelled-payments/index.ts | const capturedSplit = posterCancelSplit({ | const capturedSplit = posterCancelSplitCopy({
// @mutate supabase/functions/void-cancelled-payments/index.ts | const holdSplit = posterCancelSplit({ | const holdSplit = posterCancelSplitCopy({
// @mutate supabase/functions/create-payment/index.ts |           const holdSplit = posterCancelSplit({ |           const holdSplit = posterCancelSplitCopy({
// @mutate supabase/migrations/20261031015647_poster_cancel_strike_only_inside_24h.sql |     RAISE EXCEPTION 'quote_changed' |     RAISE NOTICE 'quote_changed'
// @mutate src/lib/lifecycleErrors.ts |     quote_changed: "The amount for your Helpr's time changed | quote_changed_old: "The amount for your Helpr's time changed
// @mutate src/components/CancellationDialog.tsx |         p_expected_fee_cents: expectedFeeCents, |         p_expected_fee_cents: undefined,
// @mutate src/components/CancellationDialog.tsx |   const backToYouCents = typeof quote?.back_to_you_cents === "number" ? quote.back_to_you_cents : null; |   const backToYouCents = Math.round(jobBudget * 100) - (typeof quote?.fee_cents === "number" ? quote.fee_cents : 0);
// @mutate src/components/CancellationDialog.tsx |         setQuoteNonce((n) => n + 1); |
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const toastError = vi.fn();
const invoke = vi.hoisted(() => vi.fn());
const rpc = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a), success: vi.fn(), warning: vi.fn() } }));
vi.mock("@/lib/haptics", () => ({ hapticError: vi.fn(), hapticSuccess: vi.fn(), hapticLight: vi.fn(), hapticMedium: vi.fn() }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
          in: vi.fn(() => ({ limit: vi.fn(() => Promise.resolve({ data: [], error: null })) })),
        })),
      })),
    })),
    rpc: (...a: unknown[]) => rpc(...a),
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
  },
}));

import { CancellationDialog } from "@/components/CancellationDialog";

const code = (p: string) => blankComments(readFileSync(p, "utf8"));
const calls = (src: string, fn: string) => (src.match(new RegExp(`\\b${fn}\\(`, "g")) ?? []).length;

describe("one split for the quote and the refund", () => {
  const sweep = code("supabase/functions/void-cancelled-payments/index.ts");
  const createPayment = code("supabase/functions/create-payment/index.ts");

  it("the sweep prices both the hold and the captured refund with posterCancelSplit", () => {
    expect(calls(sweep, "posterCancelSplit")).toBeGreaterThanOrEqual(2);
    // The captured refund's amount IS the split's, not a second refundToPayerCents.
    expect(sweep).toMatch(/const voidSplit = capturedSplit\.split;/);
    expect(sweep).toMatch(/amountCents: holdSplit\.backCents/);
  });

  it("the quote answers from the same function, for both charge states", () => {
    const quote = createPayment.slice(createPayment.indexOf('action === "cancel_quote"'), createPayment.indexOf('action === "cancel_escrow"'));
    expect(quote.length).toBeGreaterThan(500);
    expect(calls(quote, "posterCancelSplit")).toBe(2);
    expect(quote).toMatch(/back_to_you_cents: holdSplit\.backCents/);
    expect(quote).toMatch(/back_to_you_cents: capturedSplit\.backCents/);
  });
});

describe("poster_cancel_job refuses a fee the poster was not shown", () => {
  const def = effectiveDefs("supabase/migrations").get("poster_cancel_job");
  const body = blankSqlComments(def?.stmt ?? "");

  it("the newest definition takes p_expected_fee_cents and raises quote_changed before it writes", () => {
    expect(def?.file).toBeTruthy();
    expect(body).toMatch(/p_expected_fee_cents\s+bigint\s+DEFAULT\s+NULL/i);
    const raise = body.search(/RAISE\s+EXCEPTION\s+'quote_changed'/i);
    const write = body.search(/UPDATE\s+public\.jobs/i);
    expect(raise).toBeGreaterThan(0);
    expect(write).toBeGreaterThan(raise);
  });

  it("the refusal has words", () => {
    expect(code("src/lib/lifecycleErrors.ts")).toMatch(/poster_cancel_job:\s*\{[\s\S]*?quote_changed:\s*"The amount for your Helpr's time changed/);
  });
});

describe("the dialog shows the server's number and nothing else", () => {
  const props = {
    jobId: "job-1", jobTitle: "Fix the fence", jobDate: new Date(Date.now() + 6 * 3600e3).toISOString().slice(0, 10),
    jobStartTime: null, jobBudget: 100, hasHelper: true, wasFunded: true, helperName: "Marie R.",
    open: true, onClose: vi.fn(), onCancelled: vi.fn(),
  };
  beforeEach(() => {
    invoke.mockReset();
    rpc.mockReset();
    toastError.mockClear();
    props.onCancelled.mockClear();
  });

  it("'Back to you' is the quote's amount, and the cancel asks for the quoted fee", async () => {
    // 8,317 is not anything the screen could derive from the $100 budget.
    invoke.mockResolvedValue({ data: { can_cancel: true, fee_cents: 2500, fee_percent: 25, back_to_you_cents: 8317, unquoted_reason: null, charge_state: "captured" }, error: null });
    rpc.mockResolvedValue({ data: { action: "none", cancellation_fee: 25 }, error: null });
    render(<CancellationDialog {...props} />);
    const box = await screen.findByTestId("cancel-back-to-you");
    await waitFor(() => expect(box).toHaveTextContent("$83.17"));
    expect(invoke).toHaveBeenCalledWith("create-payment", { body: { action: "cancel_quote", jobId: "job-1" } });
    fireEvent.click(screen.getByRole("button", { name: /^cancel · pay \$25(\.00)?$/i }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("poster_cancel_job", expect.objectContaining({ p_job_id: "job-1", p_expected_fee_cents: 2500 })));
  });

  it("no quote, no number: the refund notice carries it", async () => {
    invoke.mockResolvedValue({ data: { can_cancel: true, fee_cents: 2500, back_to_you_cents: null, unquoted_reason: "earlier_refund", charge_state: null }, error: null });
    render(<CancellationDialog {...props} />);
    const box = await screen.findByTestId("cancel-back-to-you");
    await waitFor(() => expect(box).toHaveTextContent("Your refund notice will show the exact amount."));
    expect(box.textContent).not.toMatch(/\$/);
  });

  it("quote_changed cancels nothing, says so, and asks the server again", async () => {
    invoke.mockResolvedValue({ data: { can_cancel: true, fee_cents: 0, fee_percent: 0, back_to_you_cents: 10651, unquoted_reason: null, charge_state: "captured" }, error: null });
    rpc.mockResolvedValue({ data: null, error: { message: "quote_changed", hint: "The amount for your Helpr's time is now $25.00.", code: "P0001" } });
    render(<CancellationDialog {...props} />);
    await waitFor(() => expect(screen.getByTestId("cancel-back-to-you")).toHaveTextContent("$106.51"));
    fireEvent.click(screen.getByRole("button", { name: /^cancel job$/i }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/The amount for your Helpr's time changed/)));
    expect(props.onCancelled).not.toHaveBeenCalled();
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
  });
});
