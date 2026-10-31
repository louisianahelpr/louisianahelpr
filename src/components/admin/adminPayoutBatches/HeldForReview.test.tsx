/**
 * The admin side of HELD FOR REVIEW (20261019070737): a payout or refund that will not pay itself
 * is listed with its payee, payout account, amount, Stripe group and the ids the payee's OTHER
 * rows already used; only an admin moves it on, synchronously: "Release to automatic" (ALWAYS with
 * the no-transfer-outside-the-app confirmation) or "Mark settled by hand" (Stripe id or
 * "other: ...", amount, note; terminal).
 *
 * @mutate src/components/admin/adminPayoutBatches/HeldForReview.tsx |          { p_kind: draft.row.kind, p_id: draft.row.id, p_ref: draft.ref, p_amount_cents: toCents(draft.amount) ?? 0, p_note: draft.note }); |          { p_kind: draft.row.kind, p_id: draft.row.id, p_ref: draft.ref, p_amount_cents: draft.row.amount_cents, p_note: draft.note });
 * @mutate src/components/admin/adminPayoutBatches/HeldForReview.tsx |    ? d.confirmed | ? true
 * @mutate src/components/admin/adminPayoutBatches/HeldForReview.tsx |            {(r.sibling_refs ?? []).length > 0 && ( |            {false && (
 * @mutate src/components/admin/AdminPayoutBatches.tsx |      <HeldForReview />\n |
 * @mutate src/components/admin/adminPayoutBatches/HeldForReview.tsx |  shop_refund: "Shops refund",\n |
 * @mutate src/components/admin/adminPayoutBatches/HeldForReview.tsx | readOnly={WHOLE_AMOUNT_ONLY.has(r.kind)} | readOnly={false}
 * @mutate src/components/admin/adminPayoutBatches/HeldForReview.tsx |       if (draft.action === "settle" && draft.row.kind === "shop_refund" && !/^\s*other:/i.test(draft.ref)) { |       if (false) {
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { HeldForReview, type HeldRow } from "./HeldForReview";

const rpcMock = vi.fn();
const invokeMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpcMock(...a),
    functions: { invoke: (...a: unknown[]) => invokeMock(...a) },
    from: (table: string) => ({
      select: () => ({
        in: async (_c: string, ids: string[]) => (table === "profiles"
          ? { data: ids.filter((id) => id === "u1").map((user_id) => ({ user_id, full_name: "Dana Rivers" })), error: null }
          : { data: null, error: { message: "unexpected table" } }),
      }),
    }),
  },
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const ROW: HeldRow = { kind: "declutter", id: "0000000b-0000-4000-8000-0000000000cc", payee_id: "u1", payee_account: "acct_payee1",
  amount_cents: 3850, reason: "rejected: transfers inactive, rejected.fraud", held_at: "2026-10-19T07:00:00Z",
  stripe_group: "declutter_order_x", sibling_refs: [{ kind: "declutter", id: "p2", ref: "tr_sibling1", amount_cents: 2000 }] };

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><HeldForReview /></QueryClientProvider>);
}

beforeEach(() => {
  rpcMock.mockReset();
  invokeMock.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  rpcMock.mockImplementation(async (fn: string) => (fn === "admin_payouts_held_for_review" ? { data: [ROW], error: null } : { data: { result: "ok" }, error: null }));
});

describe("Held for review (admin money page)", () => {
  it("lists each held row with its payee, payout account, amount, Stripe group, why, and the payee's already-used ids", async () => {
    mount();
    expect(await screen.findByText(/Declutter seller payout/)).toBeTruthy();
    expect(screen.getByText(/rejected\.fraud/)).toBeTruthy();
    expect(screen.getByText(/payout account acct_payee1/)).toBeTruthy();
    expect(screen.getByText("declutter_order_x")).toBeTruthy();
    expect(screen.getByTestId("held-siblings").textContent).toMatch(/tr_sibling1/);
    expect(screen.getAllByTestId("held-row")).toHaveLength(1);
  });

  // AUD31-43: amount "38.5" with no $, payee a bare user id, reason the raw "<category>: ..." code, and the two
  // action buttons on one row that does not wrap (cut at 375).
  // @mutate src/components/admin/adminPayoutBatches/HeldForReview.tsx | const money = (cents: number) => `$${formatPriceExact(cents / 100)}`; | const money = (cents: number) => formatPriceExact(cents / 100);
  // @mutate src/components/admin/adminPayoutBatches/HeldForReview.tsx | {heldReasonWords(r.reason)} | {r.reason}
  // @mutate src/components/admin/adminPayoutBatches/HeldForReview.tsx | names?.[r.payee_id] ?? "name not loaded" | "name not loaded"
  // @mutate src/components/admin/adminPayoutBatches/HeldForReview.tsx |             <div className="mt-1 flex flex-wrap gap-2"> |             <div className="mt-1 flex gap-2">
  it("reads as money and words: $ amounts, the payee's name, the reason in words, and buttons that wrap", async () => {
    mount();
    expect(await screen.findByText("Declutter seller payout · $38.50")).toBeTruthy();
    expect(await screen.findByText(/Payee Dana Rivers \(u1\)/)).toBeTruthy();
    expect(screen.getByText("Stripe rejected the payee's payout account. Detail: transfers inactive, rejected.fraud")).toBeTruthy();
    expect(screen.getByTestId("held-siblings").textContent).toMatch(/tr_sibling1 \(\$20\)/);
    expect((screen.getByText("Release to automatic").closest("div") as HTMLElement).className).toMatch(/\bflex-wrap\b/);
  });

  it("Release ALWAYS needs the 'no transfer outside the app' confirmation and sends it", async () => {
    mount();
    fireEvent.click(await screen.findByText("Release to automatic"));
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "payee fixed their account" } });
    const go = screen.getByText("Release").closest("button") as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/no transfer or refund for this row was made outside the app/));
    fireEvent.click(go);
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("admin_payout_release",
      { p_kind: "declutter", p_id: ROW.id, p_note: "payee fixed their account", p_confirm_no_transfer: true }));
    expect(toast.success).toHaveBeenCalled();
  });

  it("Mark settled by hand sends the id, the amount in cents and the note, at once (no pending state)", async () => {
    mount();
    fireEvent.click(await screen.findByText("Mark settled by hand"));
    fireEvent.change(screen.getByLabelText("Stripe id"), { target: { value: "other: paid by check #1042" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "30.5" } });
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "payee deleted their account; mailed a check" } });
    const go = screen.getByText("Mark settled").closest("button") as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/I checked this Stripe id/));
    fireEvent.click(go);
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("admin_payout_settle_by_hand",
      { p_kind: "declutter", p_id: ROW.id, p_ref: "other: paid by check #1042", p_amount_cents: 3050, p_note: "payee deleted their account; mailed a check" }));
    expect(toast.success).toHaveBeenCalledWith("Marked settled by hand.");
  });

  it("a refusal shows its words (never a raw code)", async () => {
    rpcMock.mockImplementation(async (fn: string) => (fn === "admin_payouts_held_for_review"
      ? { data: [ROW], error: null } : { data: null, error: { message: "ref_already_used", code: "23505" } }));
    mount();
    fireEvent.click(await screen.findByText("Mark settled by hand"));
    fireEvent.change(screen.getByLabelText("Stripe id"), { target: { value: "tr_sibling1" } });
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "x" } });
    fireEvent.click(screen.getByLabelText(/I checked this Stripe id/));
    fireEvent.click(screen.getByText("Mark settled").closest("button") as HTMLButtonElement);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/already recorded on another payout or refund/)));
  });

  it("a held Shops refund is listed and settled only for its whole amount (the amount is fixed)", async () => {
    const SHOP: HeldRow = { kind: "shop_refund", id: "0000000b-0000-4000-8000-0000000000dd", payee_id: "buyer1", amount_cents: 1910,
      reason: "refunded_by_hand: re_abc ($19.10) was refunded in Stripe; decide this row by hand", held_at: "2026-10-19T08:00:00Z",
      stripe_group: "pi_shop1", sibling_refs: [] };
    rpcMock.mockImplementation(async (fn: string) => (fn === "admin_payouts_held_for_review" ? { data: [SHOP], error: null } : { data: { result: "settled" }, error: null }));
    mount();
    expect(await screen.findByText(/Shops refund/)).toBeTruthy();
    fireEvent.click(screen.getByText("Mark settled by hand"));
    const amount = screen.getByLabelText("Amount") as HTMLInputElement;
    expect(amount.value).toBe("19.10");
    expect(amount.readOnly).toBe(true);
    expect(screen.getByText(/settled only for its whole amount/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Stripe id"), { target: { value: "other: paid back in cash at the market" } });
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "the buyer has it all" } });
    fireEvent.click(screen.getByLabelText(/I checked this Stripe id/));
    fireEvent.click(screen.getByText("Mark settled").closest("button") as HTMLButtonElement);
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("admin_payout_settle_by_hand",
      { p_kind: "shop_refund", p_id: SHOP.id, p_ref: "other: paid back in cash at the market", p_amount_cents: 1910, p_note: "the buyer has it all" }));
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("a held Shops refund settled with a Stripe refund id goes through shop-checkout (checked with Stripe), never the RPC", async () => {
    const SHOP: HeldRow = { kind: "shop_refund", id: "0000000b-0000-4000-8000-0000000000de", payee_id: "buyer1", amount_cents: 1910,
      reason: "refunded_by_hand: re_abc", held_at: "2026-10-19T08:00:00Z", stripe_group: "pi_shop1", sibling_refs: [] };
    rpcMock.mockImplementation(async (fn: string) => (fn === "admin_payouts_held_for_review" ? { data: [SHOP], error: null } : { data: null, error: null }));
    invokeMock.mockResolvedValue({ data: { settled: true, result: "settled" }, error: null });
    mount();
    fireEvent.click(await screen.findByText("Mark settled by hand"));
    fireEvent.change(screen.getByLabelText("Stripe id"), { target: { value: "re_abc" } });
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "the Dashboard refund covers it" } });
    fireEvent.click(screen.getByLabelText(/I checked this Stripe id/));
    fireEvent.click(screen.getByText("Mark settled").closest("button") as HTMLButtonElement);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("shop-checkout", expect.objectContaining({
      body: expect.objectContaining({ action: "admin_settle_held_refund", refund_row_id: SHOP.id, refund_id: "re_abc", note: "the Dashboard refund covers it" }),
    })));
    expect(rpcMock).not.toHaveBeenCalledWith("admin_payout_settle_by_hand", expect.anything());
    expect(toast.success).toHaveBeenCalledWith("Marked settled by hand.");
  });

  it("a Shops row the queue would never send stays held: the refusal says so in words", async () => {
    rpcMock.mockImplementation(async (fn: string) => (fn === "admin_payouts_held_for_review"
      ? { data: [{ ...ROW, kind: "shop" }], error: null } : { data: null, error: { message: "refunded_in_stripe", code: "55000" } }));
    mount();
    fireEvent.click(await screen.findByText("Release to automatic"));
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "x" } });
    fireEvent.click(screen.getByLabelText(/no transfer or refund for this row was made outside the app/));
    fireEvent.click(screen.getByText("Release").closest("button") as HTMLButtonElement);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/refund made in Stripe stands on this order/)));
  });

  it("is mounted on the admin money page (floor)", () => {
    expect(readFileSync("src/components/admin/AdminPayoutBatches.tsx", "utf8")).toMatch(/<HeldForReview \/>/);
  });
});
